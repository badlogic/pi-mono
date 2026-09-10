import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { getModel, streamSimple } from "../src/compat.ts";
import type { Api, Context, Model, Tool } from "../src/types.ts";
import { resolveToolHistory } from "../src/utils/deferred-tools.ts";
import { extractInitialSystemPrompt, getTranscriptCapabilities } from "../src/utils/system-messages.ts";

const read: Tool = { name: "read", description: "Read a file", parameters: Type.Object({}) };
const edit: Tool = { name: "edit", description: "Edit a file", parameters: Type.Object({}) };
const user = { role: "user", content: "hello", timestamp: 2 } as const;

interface Payload {
	betas?: string[];
	tools?: Array<{ name: string; defer_loading?: boolean }>;
	input?: Array<{ type?: string; tools?: Array<{ name: string; description: string }>; content?: string }>;
	system?: Array<{ text: string }>;
	instructions?: string;
	config?: { systemInstruction?: string };
	messages?: Array<{ role: string; content: string | Array<{ type: string; tool?: { name: string } }> }>;
}

async function capture(model: Model<Api>, context: Context): Promise<Payload> {
	let captured: Payload | undefined;
	await streamSimple({ ...model, baseUrl: "http://127.0.0.1:9" }, context, {
		apiKey:
			model.api === "openai-codex-responses"
				? `header.${btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test" } }))}.signature`
				: "fake-key",
		onPayload(payload) {
			captured = payload as Payload;
			throw new Error("payload captured");
		},
	}).result();
	if (!captured) throw new Error("No payload captured");
	return captured;
}

function snapshots(payload: Payload): string[][] {
	return (payload.input ?? [])
		.filter((item) => item.type === "additional_tools")
		.map((item) => item.tools?.map((tool) => tool.name) ?? []);
}

describe("self-contained tool transcripts", () => {
	const context: Context = {
		messages: [
			{ role: "system", content: "initial instructions", toolsAdded: [read], timestamp: 1 },
			user,
			{ role: "system", content: "", toolsAdded: [edit], timestamp: 3 },
			{ role: "system", content: "", toolsRemoved: [read], timestamp: 4 },
			{ role: "system", content: "", toolsRemoved: [edit], timestamp: 5 },
			{ role: "system", content: "", toolsAdded: [read], timestamp: 6 },
		],
	};

	it.each([
		getModel("openai", "gpt-5.4"),
		getModel("openai-codex", "gpt-5.6-sol"),
		{ ...getModel("openai", "gpt-5.4"), api: "azure-openai-responses" } satisfies Model<"azure-openai-responses">,
	])("replays complete snapshots through $api, including empty and reloaded loadouts", async (model) => {
		const payload = await capture(model, context);
		expect(payload.tools).toBeUndefined();
		expect(snapshots(payload)).toEqual([["read"], ["read", "edit"], ["edit"], [], ["read"]]);
		const prefix = await capture(model, { messages: context.messages.slice(0, 2) });
		expect(payload.input?.slice(0, prefix.input?.length)).toEqual(prefix.input);
		if (model.api === "openai-codex-responses") expect(payload.instructions).toBe("initial instructions");
	});

	it("does not let removal definitions invent initial availability", () => {
		const history = resolveToolHistory({
			messages: [{ role: "system", content: "", toolsRemoved: [read], timestamp: 1 }],
		});
		expect(history.initial).toEqual([]);
	});

	it("preserves explicit initial tools independently of later definitions", async () => {
		const changed = { ...read, description: "New definition" };
		const payload = await capture(getModel("openai", "gpt-5.4"), {
			tools: [read],
			messages: [user, { role: "system", content: "", toolsRemoved: [read], toolsAdded: [changed], timestamp: 3 }],
		});
		const definitions = payload.input
			?.filter((item) => item.type === "additional_tools")
			.map((item) => item.tools?.[0]?.description);
		expect(definitions).toEqual([read.description, changed.description]);
		expect(payload.tools).toBeUndefined();
	});

	it("uses normal definitions and native references on Anthropic without Context.tools", async () => {
		const model = getModel("anthropic", "claude-fable-5-1");
		const payload = await capture(model, context);
		expect(payload.system?.map((block) => block.text)).toEqual(["initial instructions"]);
		expect(payload.tools?.filter((tool) => tool.name === "read" || tool.name === "edit")).toEqual([
			expect.objectContaining({ name: "read" }),
			expect.objectContaining({ name: "edit" }),
		]);
		const changes = payload.messages
			?.flatMap((message) => (typeof message.content === "string" ? [] : message.content))
			.filter((block) => block.type === "tool_addition" || block.type === "tool_removal")
			.map((block) => [block.type, block.tool?.name]);
		expect(changes).toEqual([
			["tool_addition", "read"],
			["tool_addition", "edit"],
			["tool_removal", "read"],
			["tool_removal", "edit"],
			["tool_addition", "read"],
		]);
		const empty = await capture(model, { messages: [user] });
		expect(empty.tools).toEqual([
			expect.objectContaining({ name: "__pi_deferred_tool_placeholder__", defer_loading: true }),
		]);
		expect(payload.tools?.filter((tool) => tool.defer_loading)).toEqual(empty.tools);
		expect(payload.tools).toHaveLength(3);
	});

	it.each([undefined, []] satisfies Array<Tool[] | undefined>)(
		"registers only the dummy with an empty loadout: %j",
		async (tools) => {
			const base = getModel("anthropic", "claude-fable-5-1");
			const model = { ...base, compat: { ...base.compat, supportsEagerToolInputStreaming: false } };
			const empty = await capture(model, { tools, messages: [user] });
			expect(empty.tools).toEqual([
				expect.objectContaining({ name: "__pi_deferred_tool_placeholder__", defer_loading: true }),
			]);
			const added = await capture(model, {
				tools,
				messages: [user, { role: "system", content: "", toolsAdded: [read], timestamp: 3 }],
			});
			expect(added.betas).toEqual(empty.betas);
			expect(added.tools?.filter((tool) => tool.defer_loading)).toEqual(empty.tools);
		},
	);

	it.each([getModel("anthropic", "claude-fable-5-1"), getModel("openai", "gpt-5.4")])(
		"treats Context.tools exactly like an initial toolsAdded message: $api",
		async (model) => {
			const convenience = await capture(model, { tools: [read], messages: [user] });
			const transcript = await capture(model, {
				messages: [{ role: "system", content: "", toolsAdded: [read], timestamp: 1 }, user],
			});
			expect(convenience).toEqual(transcript);
		},
	);

	it("keeps the dummy and existing declarations unchanged when tools are added or removed", async () => {
		const model = getModel("anthropic", "claude-fable-5-1");
		const initial = await capture(model, { messages: context.messages.slice(0, 2) });
		const extended = await capture(model, context);
		expect(extended.tools?.filter((tool) => tool.name !== "edit")).toEqual(initial.tools);
		expect(extended.system).toEqual(initial.system);
	});

	it.each([getModel("google", "gemini-2.5-flash"), getModel("anthropic", "claude-opus-4-6")])(
		"keeps leading system instructions at the top level without mid-conversation support: $api",
		async (model) => {
			const payload = await capture(model, { messages: context.messages.slice(0, 2) });
			expect(payload.config?.systemInstruction ?? payload.system?.[0]?.text).toBe("initial instructions");
		},
	);

	it("extracts only the leading system text without mutating the transcript", () => {
		const normalized = extractInitialSystemPrompt(context);
		expect(normalized.systemPrompt).toBe("initial instructions");
		expect(context.messages[0].content).toBe("initial instructions");
		expect(normalized.messages[0]).toMatchObject({ content: "", toolsAdded: [read] });
		const later: Context = { messages: [user, ...context.messages] };
		expect(extractInitialSystemPrompt(later)).toBe(later);
	});

	it("distinguishes instruction, addition-only, and complete transition support", () => {
		expect(getTranscriptCapabilities(getModel("openai", "gpt-5.4"))).toEqual({
			midConversationSystemMessages: true,
			midConversationToolAdditions: true,
			midConversationToolRemovals: true,
		});
		expect(getTranscriptCapabilities(getModel("anthropic", "claude-opus-4-6"))).toEqual({
			midConversationSystemMessages: false,
			midConversationToolAdditions: false,
			midConversationToolRemovals: false,
		});
		expect(getTranscriptCapabilities(getModel("openai", "gpt-5.2"))).toEqual({
			midConversationSystemMessages: true,
			midConversationToolAdditions: false,
			midConversationToolRemovals: false,
		});
		expect(
			getTranscriptCapabilities({ ...getModel("openai", "gpt-5.4"), compat: { supportsToolSearch: true } }),
		).toEqual({
			midConversationSystemMessages: true,
			midConversationToolAdditions: true,
			midConversationToolRemovals: false,
		});
		expect(getTranscriptCapabilities(getModel("google", "gemini-2.5-flash"))).toEqual({
			midConversationSystemMessages: false,
			midConversationToolAdditions: false,
			midConversationToolRemovals: false,
		});
	});
});
