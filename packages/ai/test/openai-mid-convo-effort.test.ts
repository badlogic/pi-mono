import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stream as streamOpenAICodexResponses } from "../src/api/openai-codex-responses.ts";
import { type OpenAIResponsesOptions, stream as streamOpenAIResponses } from "../src/api/openai-responses.ts";
import { getModel, normalizeContext } from "../src/compat.ts";
import type { Api, AssistantMessage, Message, Model } from "../src/types.ts";

// https://github.com/earendil-works/pi/issues/10853

type InputItem = { type?: string; role?: string; reasoning?: { effort?: string } };
type Payload = { input: InputItem[]; reasoning?: { effort?: string; summary?: string }; include?: string[] };

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	vi.restoreAllMocks();
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
});

const COMPLETED_SSE = [
	{
		type: "response.output_item.added",
		output_index: 0,
		item: { type: "message", id: "msg_1", role: "assistant", status: "in_progress", content: [] },
	},
	{ type: "response.output_text.delta", output_index: 0, item_id: "msg_1", delta: "ok" },
	{
		type: "response.output_item.done",
		output_index: 0,
		item: {
			type: "message",
			id: "msg_1",
			role: "assistant",
			status: "completed",
			content: [{ type: "output_text", text: "ok", annotations: [] }],
		},
	},
	{ type: "response.completed", response: { id: "resp_1", status: "completed" } },
]
	.map((event) => `data: ${JSON.stringify(event)}\n\n`)
	.join("");

const sol: Model<"openai-responses"> = {
	...getModel("openai", "gpt-6-sol"),
	compat: { ...getModel("openai", "gpt-6-sol").compat, supportsMidConvoEffort: true },
};

const user = (text: string): Message => ({ role: "user", content: text, timestamp: 1 });

function reply(model: Model<Api>, effort: string, stopReason: "stop" | "toolUse" = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content:
			stopReason === "toolUse"
				? [{ type: "toolCall", id: "call_1|fc_1", name: "bash", arguments: {} }]
				: [{ type: "text", text: "ok" }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		providerThinkingLevel: effort,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 1,
	};
}

const updates = (payload: Payload) => payload.input.filter((item) => item.type === "configuration_update");

async function send(
	model: Model<"openai-responses">,
	messages: Message[],
	reasoningEffort: OpenAIResponsesOptions["reasoningEffort"],
): Promise<{ payload: Payload; message: AssistantMessage }> {
	let payload: Payload = { input: [] };
	vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
		payload = JSON.parse(String(init?.body)) as Payload;
		return new Response(COMPLETED_SSE, { status: 200, headers: { "content-type": "text/event-stream" } });
	});
	const message = await streamOpenAIResponses(model, normalizeContext({ systemPrompt: "sys", messages }), {
		apiKey: "sk-test",
		reasoningEffort,
	}).result();
	vi.restoreAllMocks();
	return { payload, message };
}

describe("OpenAI mid-conversation reasoning effort", () => {
	it("keeps the first effort and sends a change before the next user message", async () => {
		const { payload, message } = await send(sol, [user("a"), reply(sol, "low"), user("b")], "high");

		expect(payload.reasoning).toEqual({ effort: "low", summary: "auto" });
		expect(payload.input.slice(-2)).toEqual([
			{ type: "configuration_update", reasoning: { effort: "high" } },
			{ role: "user", content: [{ type: "input_text", text: "b" }] },
		]);
		expect(message.providerThinkingLevel).toBe("high");
	});

	it("replays recorded changes so each request extends the previous one", async () => {
		const history = [user("a"), reply(sol, "low"), user("b")];
		const second = await send(sol, history, "high");
		const third = await send(sol, [...history, second.message, user("c")], "low");

		expect(third.payload.reasoning).toEqual(second.payload.reasoning);
		expect(third.payload.input.slice(0, second.payload.input.length)).toEqual(second.payload.input);
		expect(updates(third.payload)).toEqual([
			{ type: "configuration_update", reasoning: { effort: "high" } },
			{ type: "configuration_update", reasoning: { effort: "low" } },
		]);
	});

	it("applies a change made during a tool loop at the next user message", async () => {
		const toolResult: Message = {
			role: "toolResult",
			toolCallId: "call_1|fc_1",
			toolName: "bash",
			content: [{ type: "text", text: "done" }],
			isError: false,
			timestamp: 1,
		};
		const { payload, message } = await send(sol, [user("a"), reply(sol, "low", "toolUse"), toolResult], "high");

		expect(payload.reasoning?.effort).toBe("low");
		expect(updates(payload)).toEqual([]);
		expect(message.providerThinkingLevel).toBe("low");
	});

	it("keeps encrypted reasoning when the conversation started with thinking off", async () => {
		const { payload } = await send(sol, [user("a"), reply(sol, "none"), user("b")], "high");

		expect(payload.reasoning).toEqual({ effort: "none", summary: "auto" });
		expect(payload.include).toEqual(["reasoning.encrypted_content"]);
		expect(updates(payload)).toEqual([{ type: "configuration_update", reasoning: { effort: "high" } }]);
	});

	it("changes the request-level effort on models without the capability", async () => {
		const model = getModel("openai", "gpt-5.5");
		const { payload, message } = await send(model, [user("a"), reply(model, "low"), user("b")], "high");

		expect(payload.reasoning?.effort).toBe("high");
		expect(updates(payload)).toEqual([]);
		expect(message.providerThinkingLevel).toBeUndefined();
	});

	it("keeps the first effort on Codex", async () => {
		process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-codex-effort-"));
		const codexSol: Model<"openai-codex-responses"> = {
			...getModel("openai-codex", "gpt-6-sol"),
			compat: { ...getModel("openai-codex", "gpt-6-sol").compat, supportsMidConvoEffort: true },
		};
		let payload: Payload = { input: [] };
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = String(input);
			if (url !== "https://chatgpt.com/backend-api/codex/responses") return new Response("", { status: 404 });
			const body = init?.body instanceof Uint8Array ? zstdDecompressSync(init.body) : init?.body;
			payload = JSON.parse(String(body)) as Payload;
			return new Response(COMPLETED_SSE, { status: 200, headers: { "content-type": "text/event-stream" } });
		});
		const accountClaim = { "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } };
		const token = `aaa.${Buffer.from(JSON.stringify(accountClaim)).toString("base64")}.bbb`;

		const message = await streamOpenAICodexResponses(
			codexSol,
			normalizeContext({ systemPrompt: "sys", messages: [user("a"), reply(codexSol, "low"), user("b")] }),
			{ apiKey: token, reasoningEffort: "high", transport: "sse" },
		).result();

		expect(payload.reasoning).toEqual({ effort: "low", summary: "auto" });
		expect(updates(payload)).toEqual([{ type: "configuration_update", reasoning: { effort: "high" } }]);
		expect(message.providerThinkingLevel).toBe("high");
	});
});
