import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it } from "vitest";
import { type OpenAIResponsesOptions, stream as streamOpenAIResponses } from "../src/api/openai-responses.ts";
import { processResponsesStream } from "../src/api/openai-responses-shared.ts";
import type { AssistantMessage, Message, Model, ServerCompaction } from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

function createModel(): Model<"openai-responses"> {
	return {
		id: "test-model",
		name: "test-model",
		api: "openai-responses",
		provider: "test-provider",
		baseUrl: "https://example.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 262144,
		maxTokens: 8192,
	};
}

function createOutput(model: Model<"openai-responses">): AssistantMessage {
	return {
		role: "assistant",
		content: [],
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
		stopReason: "pending",
		timestamp: Date.now(),
	};
}

// A compaction output item as returned by a provider that supports adoption
// metadata: OpenAI's item shape (opaque encrypted_content) plus a non-standard
// `pi` object carrying the cut-point bookkeeping pi's adoption needs.
const compactionItem = {
	type: "compaction",
	id: "cmpct_abc123",
	status: "completed",
	encrypted_content: "## Goal\nFix the bug in /a/b.py.\n## Next\nRun the test suite.",
	pi: { input_tokens: 1200, items_compacted: 5, items_retained: 3 },
};

// The same item without adoption metadata (opaque provider checkpoint).
const opaqueCompactionItem = {
	type: "compaction",
	id: "cmpct_opaque",
	status: "completed",
	encrypted_content: "opaque-checkpoint",
};

const messageItem = {
	type: "message",
	id: "msg_pi_0",
	status: "completed",
	role: "assistant",
	content: [{ type: "output_text", text: "Done.", annotations: [] }],
};

/**
 * Stream event variants:
 *  - "full": compaction item in added/done events AND in the completed response
 *  - "completed-only": only in the completed response (gateway omission of per-item events)
 *  - "none": no compaction anywhere
 */
async function* compactionEvents(variant: "full" | "completed-only" | "none"): AsyncIterable<ResponseStreamEvent> {
	let seq = 0;
	const withAdded = variant === "full";
	const inCompleted = variant !== "none";
	const output = inCompleted ? [compactionItem, messageItem] : [messageItem];
	const msgIndex = inCompleted ? 1 : 0;
	if (withAdded) {
		yield {
			type: "response.output_item.added",
			output_index: 0,
			sequence_number: seq++,
			item: compactionItem,
		} as ResponseStreamEvent;
		yield {
			type: "response.output_item.done",
			output_index: 0,
			sequence_number: seq++,
			item: compactionItem,
		} as ResponseStreamEvent;
	}
	yield {
		type: "response.output_item.added",
		output_index: msgIndex,
		sequence_number: seq++,
		item: { ...messageItem, status: "in_progress", content: [] },
	} as ResponseStreamEvent;
	yield {
		type: "response.output_text.delta",
		output_index: msgIndex,
		content_index: 0,
		item_id: messageItem.id,
		sequence_number: seq++,
		delta: "Done.",
	} as ResponseStreamEvent;
	yield {
		type: "response.output_item.done",
		output_index: msgIndex,
		sequence_number: seq++,
		item: messageItem,
	} as ResponseStreamEvent;
	yield {
		type: "response.completed",
		sequence_number: seq++,
		response: { id: "resp_test", status: "completed", output },
	} as unknown as ResponseStreamEvent;
}

async function run(variant: "full" | "completed-only" | "none", onServerCompaction?: (c: ServerCompaction) => void) {
	const model = createModel();
	const output = createOutput(model);
	const stream = new AssistantMessageEventStream();
	await processResponsesStream(compactionEvents(variant), output, stream, model, {
		requestItemCounts: [1, 1, 1, 1, 1, 1, 1],
		onServerCompaction: onServerCompaction as (c: ServerCompaction, m: Model<any>) => void,
	});
	return output;
}

describe("server-side compaction capture (openai-responses)", () => {
	it("captures the compaction item with adoption metadata and forwards request item counts", async () => {
		let captured: ServerCompaction | undefined;
		const output = await run("full", (c) => {
			captured = c;
		});

		expect(captured?.id).toBe("cmpct_abc123");
		expect(captured?.summary).toContain("## Goal");
		expect(captured?.summary).toContain("/a/b.py");
		expect(captured?.inputTokens).toBe(1200);
		expect(captured?.itemsCompacted).toBe(5);
		expect(captured?.itemsRetained).toBe(3);
		expect(captured?.inputItemCounts).toEqual([1, 1, 1, 1, 1, 1, 1]);
		// The compaction item must not create a content slot; only the answer message does.
		expect(output.content.map((b) => b.type)).toEqual(["text"]);
		expect(output.stopReason).toBe("stop");
	});

	it("falls back to the terminal response output when added/done events omit it", async () => {
		let captured: ServerCompaction | undefined;
		await run("completed-only", (c) => {
			captured = c;
		});
		expect(captured?.id).toBe("cmpct_abc123");
		expect(captured?.summary).toContain("/a/b.py");
	});

	it("does not invoke the callback when the server did not compact", async () => {
		let calls = 0;
		const output = await run("none", () => calls++);
		expect(calls).toBe(0);
		expect(output.content.map((b) => b.type)).toEqual(["text"]);
	});

	it("captures opaque compaction items without adoption metadata", async () => {
		const model = createModel();
		const output = createOutput(model);
		const stream = new AssistantMessageEventStream();
		const events: ResponseStreamEvent[] = [
			{
				type: "response.output_item.added",
				output_index: 0,
				sequence_number: 0,
				item: opaqueCompactionItem,
			} as ResponseStreamEvent,
			{
				type: "response.output_item.done",
				output_index: 0,
				sequence_number: 1,
				item: opaqueCompactionItem,
			} as ResponseStreamEvent,
			{
				type: "response.output_item.added",
				output_index: 1,
				sequence_number: 2,
				item: { ...messageItem, status: "in_progress", content: [] },
			} as ResponseStreamEvent,
			{
				type: "response.output_text.delta",
				output_index: 1,
				content_index: 0,
				item_id: messageItem.id,
				sequence_number: 3,
				delta: "Done.",
			} as ResponseStreamEvent,
			{
				type: "response.output_item.done",
				output_index: 1,
				sequence_number: 4,
				item: messageItem,
			} as ResponseStreamEvent,
			{
				type: "response.completed",
				sequence_number: 5,
				response: { id: "resp_test", status: "completed", output: [opaqueCompactionItem, messageItem] },
			} as unknown as ResponseStreamEvent,
		];
		let captured: ServerCompaction | undefined;
		const asyncEvents = (async function* () {
			yield* events;
		})() as AsyncIterable<ResponseStreamEvent>;
		await processResponsesStream(asyncEvents, output, stream, model, {
			requestItemCounts: [1, 1],
			onServerCompaction: ((c: ServerCompaction) => {
				captured = c;
			}) as (c: ServerCompaction, m: Model<any>) => void,
		});
		expect(captured?.id).toBe("cmpct_opaque");
		expect(captured?.summary).toBe("opaque-checkpoint");
		expect(captured?.itemsCompacted).toBeUndefined();
		expect(output.content.map((b) => b.type)).toEqual(["text"]);
	});
});

interface CompactionPayload {
	input: unknown[];
	context_management?: Array<{ type: string; compact_threshold?: number }>;
}

async function capturePayload(
	model: Model<"openai-responses">,
	messages: Message[],
	options?: OpenAIResponsesOptions,
): Promise<CompactionPayload> {
	let payload: CompactionPayload | undefined;
	const fetchMock = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
		payload = JSON.parse(String(init?.body)) as CompactionPayload;
		const item = {
			type: "message",
			id: "msg_1",
			role: "assistant",
			status: "completed",
			content: [{ type: "output_text", text: "ok", annotations: [] }],
		};
		const body = [
			{ type: "response.created", response: { id: "resp_1" } },
			{ type: "response.output_item.added", output_index: 0, item },
			{ type: "response.output_item.done", output_index: 0, item },
			{ type: "response.completed", response: { id: "resp_1", status: "completed" } },
		]
			.map((event) => `data: ${JSON.stringify(event)}\n\n`)
			.join("");
		return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
	};
	await streamOpenAIResponses(model, normalizeContext({ messages }), {
		apiKey: "sk-test",
		fetch: fetchMock as typeof globalThis.fetch,
		...options,
	}).result();
	if (!payload) throw new Error("Request payload was not captured");
	return payload;
}

describe("server-side compaction request emission (openai-responses)", () => {
	const user = (text: string): Message => ({ role: "user", content: text, timestamp: 0 });

	function modelWith(compat: Model<"openai-responses">["compat"]): Model<"openai-responses"> {
		return {
			id: "test-model",
			name: "test-model",
			api: "openai-responses",
			provider: "openai",
			baseUrl: "https://api.openai.com/v1",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 272000,
			maxTokens: 128000,
			compat,
		};
	}

	it("emits context_management when the model opts in and a threshold is set", async () => {
		const payload = await capturePayload(modelWith({ serverSideCompaction: true }), [user("hi")], {
			contextManagement: { compactThreshold: 200_000 },
		});
		expect(payload.context_management).toEqual([{ type: "compaction", compact_threshold: 200_000 }]);
	});

	it("does not emit context_management without opt-in", async () => {
		const payload = await capturePayload(modelWith({}), [user("hi")], {
			contextManagement: { compactThreshold: 200_000 },
		});
		expect(payload.context_management).toBeUndefined();
	});

	it("does not emit context_management without a threshold", async () => {
		const payload = await capturePayload(modelWith({ serverSideCompaction: true }), [user("hi")]);
		expect(payload.context_management).toBeUndefined();
	});
});
