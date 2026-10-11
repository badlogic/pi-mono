import { Type } from "typebox";
import { describe, expect, test } from "vitest";
import { streamSimple } from "../src/compat.ts";
import type { AssistantMessage, Context, Model, Tool, ToolResultMessage } from "../src/types.ts";

const baseTool: Tool = { name: "tool_search", description: "Search tools", parameters: Type.Object({}) };
const lateTool: Tool = { name: "read", description: "Read a file", parameters: Type.Object({}), deferLoading: true };
const model: Model<"anthropic-messages"> = {
	id: "claude-sonnet-4-6",
	name: "Sonnet",
	api: "anthropic-messages",
	provider: "anthropic",
	baseUrl: "http://127.0.0.1:9",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100000,
	maxTokens: 1000,
};
const assistant: AssistantMessage = {
	role: "assistant",
	content: [{ type: "toolCall", id: "call_1", name: "tool_search", arguments: {} }],
	api: model.api,
	provider: model.provider,
	model: model.id,
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "toolUse",
	timestamp: 2,
};
const result: ToolResultMessage = {
	role: "toolResult",
	toolCallId: "call_1",
	toolName: "tool_search",
	content: [{ type: "text", text: "Tool loaded" }],
	addedToolNames: ["read"],
	isError: false,
	timestamp: 3,
};
interface Payload {
	betas?: string[];
	tools?: Array<{ name: string; defer_loading?: boolean }>;
	messages: Array<{ role: string; content: string | Array<{ type: string; content?: unknown; text?: string }> }>;
}
async function capture(context: Context, target = model, apiKey = "test-key"): Promise<Payload> {
	let payload: Payload | undefined;
	await streamSimple(target, context, {
		apiKey,
		onPayload: (value) => {
			payload = value as Payload;
			throw new Error("Payload captured before network request");
		},
	}).result();
	if (!payload) throw new Error("No payload captured");
	return payload;
}
const user = { role: "user" as const, content: "hi", timestamp: 1 };
const context: Context = { tools: [baseTool, lateTool], messages: [user, assistant, result] };

describe("Anthropic client-side deferred tools", () => {
	test("keeps the tool prefix stable before loading, after loading, and after calling", async () => {
		const initial = await capture({ ...context, messages: [user] });
		const loaded = await capture(context);
		const called = await capture({
			...context,
			messages: [
				...context.messages,
				{ ...assistant, content: [{ type: "toolCall", id: "call_2", name: "read", arguments: {} }] },
			],
		});
		expect(initial.tools).toMatchObject([{ name: "tool_search" }, { name: "read", defer_loading: true }]);
		expect(loaded.tools).toEqual(initial.tools);
		expect(called.tools).toEqual(initial.tools);
		expect(loaded.messages.at(-1)?.content).toMatchObject([
			{ type: "tool_result", content: [{ type: "tool_reference", tool_name: "read" }] },
			{ type: "text", text: "Tool loaded" },
		]);
		expect(loaded.betas ?? []).not.toContain("inline-tools-2026-09-15");
	});

	test("canonicalizes OAuth names and deduplicates references", async () => {
		const payload = await capture(
			{ ...context, messages: [user, assistant, { ...result, addedToolNames: ["Read", "read"] }] },
			model,
			"sk-ant-oat-fake",
		);
		expect(payload.tools?.map((tool) => tool.name)).toEqual(["tool_search", "Read"]);
		expect(payload.messages.at(-1)?.content).toMatchObject([
			{ type: "tool_result", content: [{ type: "tool_reference", tool_name: "Read" }] },
			{ type: "text", text: "Tool loaded" },
		]);
	});

	test("keeps every parallel tool result before displaced content and loads references only once", async () => {
		const payload = await capture({
			...context,
			messages: [user, assistant, result, { ...result, toolCallId: "call_2" }],
		});
		expect(payload.messages.at(-1)?.content).toMatchObject([
			{ type: "tool_result", content: [{ type: "tool_reference", tool_name: "read" }] },
			{ type: "tool_result", content: "Tool loaded" },
			{ type: "text", text: "Tool loaded" },
		]);
	});

	test("deduplicates OAuth-canonicalized tool declarations with the later definition winning", async () => {
		const payload = await capture(
			{
				tools: [baseTool, lateTool, { ...lateTool, name: "Read", description: "Canonical definition" }],
				messages: [user],
			},
			model,
			"sk-ant-oat-fake",
		);
		expect(payload.tools).toHaveLength(2);
		expect(payload.tools?.[1]).toMatchObject({
			name: "Read",
			description: "Canonical definition",
			defer_loading: true,
		});
	});

	test("does not load a tool missing from the current declarations", async () => {
		const payload = await capture({ ...context, tools: [baseTool] });
		expect(payload.tools?.map((tool) => tool.name)).toEqual(["tool_search"]);
		expect(payload.messages.at(-1)?.content).toMatchObject([{ type: "tool_result", content: "Tool loaded" }]);
	});

	test("keeps a tool active when called before its load marker", async () => {
		const payload = await capture({
			...context,
			messages: [
				user,
				{ ...assistant, content: [{ type: "toolCall", id: "call_1", name: "read", arguments: {} }] },
				result,
			],
		});
		expect(payload.tools?.every((tool) => !tool.defer_loading)).toBe(true);
	});

	test("falls back to active tools for unsupported models and all-deferred lists", async () => {
		for (const target of [
			{ ...model, id: "claude-haiku-4-5" },
			{ ...model, compat: { supportsToolReferences: false } },
		]) {
			const payload = await capture(context, target);
			expect(payload.tools?.every((tool) => !tool.defer_loading)).toBe(true);
		}
		const payload = await capture({ tools: [lateTool], messages: [user] });
		expect(payload.tools).toMatchObject([{ name: "read" }]);
		expect(payload.tools?.[0]?.defer_loading).toBeUndefined();
	});

	test("preserves inline tool updates alongside client-side reference loading", async () => {
		const payload = await capture(
			{
				...context,
				messages: [
					...context.messages,
					{ role: "system", content: "", toolsAdded: [{ ...baseTool, name: "new_tool" }], timestamp: 4 },
				],
			},
			{ ...model, compat: { supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true } },
		);
		expect(payload.betas).toContain("inline-tools-2026-09-15");
		expect(payload.tools?.map((tool) => tool.name)).toEqual(["tool_search", "__pi_deferred_placeholder__", "read"]);
		expect(payload.messages).toContainEqual(
			expect.objectContaining({
				role: "system",
				content: expect.arrayContaining([expect.objectContaining({ type: "tool_addition" })]),
			}),
		);
	});
});
