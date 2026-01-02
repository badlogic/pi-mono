import { describe, expect, it, vi } from "vitest";
import { stream } from "../src/stream.js";
import type { Context, Model } from "../src/types.js";

type BedrockChunk = { chunk?: { bytes?: Uint8Array } };

let sendMock: (() => Promise<{ body: AsyncIterable<BedrockChunk> }>) | undefined;
let lastClientConfig: unknown;
let lastCommandInput: unknown;

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
	class BedrockRuntimeClient {
		constructor(config: unknown) {
			lastClientConfig = config;
		}

		send() {
			if (!sendMock) {
				throw new Error("sendMock not set");
			}
			return sendMock();
		}
	}

	class InvokeModelWithResponseStreamCommand {
		constructor(input: unknown) {
			lastCommandInput = input;
		}
	}

	return { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand };
});

function createBody(events: Array<Record<string, unknown>>): AsyncIterable<BedrockChunk> {
	const encoder = new TextEncoder();
	return (async function* () {
		for (const event of events) {
			yield { chunk: { bytes: encoder.encode(`${JSON.stringify(event)}\n`) } };
		}
	})();
}

function createModel(): Model<"anthropic-bedrock"> {
	return {
		id: "anthropic.claude-3-5-sonnet-20240620-v1:0",
		name: "Claude Sonnet (Bedrock)",
		api: "anthropic-bedrock",
		provider: "bedrock",
		baseUrl: "https://bedrock-runtime.us-west-2.amazonaws.com",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 8192,
	};
}

describe("anthropic-bedrock provider", () => {
	it("streams text responses without requiring an API key", async () => {
		const events = [
			{
				type: "message_start",
				message: {
					usage: {
						input_tokens: 12,
						output_tokens: 0,
						cache_read_input_tokens: 0,
						cache_creation_input_tokens: 0,
					},
				},
			},
			{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
			{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } },
			{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Bedrock" } },
			{ type: "content_block_stop", index: 0 },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 12, output_tokens: 2 } },
		];

		sendMock = async () => ({ body: createBody(events) });

		const model = createModel();
		const context: Context = {
			messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
		};

		const s = stream(model, context);
		let text = "";
		for await (const event of s) {
			if (event.type === "text_delta") {
				text += event.delta;
			}
		}

		const response = await s.result();
		expect(text).toBe("Hello Bedrock");
		expect(response.stopReason).toBe("stop");
		expect(response.usage.input).toBe(12);
		expect(response.usage.output).toBe(2);
		expect(lastClientConfig).toMatchObject({ region: "us-west-2" });
		expect((lastCommandInput as { modelId?: string }).modelId).toBe(model.id);
	});

	it("derives region from VPC and gov endpoints", async () => {
		const events = [
			{
				type: "message_start",
				message: {
					usage: { input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
				},
			},
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 1, output_tokens: 0 } },
		];

		const context: Context = {
			messages: [{ role: "user", content: "Ping", timestamp: Date.now() }],
		};

		sendMock = async () => ({ body: createBody(events) });
		const vpcModel = {
			...createModel(),
			baseUrl: "https://vpce-12345.bedrock-runtime.us-gov-west-1.vpce.amazonaws.com",
		};
		const vpcStream = stream(vpcModel, context);
		for await (const _event of vpcStream) {
			// Drain stream
		}
		await vpcStream.result();
		expect(lastClientConfig).toMatchObject({ region: "us-gov-west-1" });

		sendMock = async () => ({ body: createBody(events) });
		const hostModel = { ...createModel(), baseUrl: "bedrock-runtime.eu-central-1.amazonaws.com" };
		const hostStream = stream(hostModel, context);
		for await (const _event of hostStream) {
			// Drain stream
		}
		await hostStream.result();
		expect(lastClientConfig).toMatchObject({ region: "eu-central-1" });
	});

	it("parses tool call arguments from partial JSON", async () => {
		const events = [
			{
				type: "message_start",
				message: {
					usage: { input_tokens: 8, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
				},
			},
			{
				type: "content_block_start",
				index: 0,
				content_block: { type: "tool_use", id: "toolu_1", name: "calculator", input: {} },
			},
			{ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"a":1' } },
			{ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: ',"b":2}' } },
			{ type: "content_block_stop", index: 0 },
			{ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { input_tokens: 8, output_tokens: 1 } },
		];

		sendMock = async () => ({ body: createBody(events) });

		const model = createModel();
		const context: Context = {
			messages: [{ role: "user", content: "Use the calculator", timestamp: Date.now() }],
		};

		const s = stream(model, context);
		let toolArgs: Record<string, unknown> | undefined;
		for await (const event of s) {
			if (event.type === "toolcall_end") {
				toolArgs = event.toolCall.arguments as Record<string, unknown>;
			}
		}

		const response = await s.result();
		expect(response.stopReason).toBe("toolUse");
		expect(toolArgs).toEqual({ a: 1, b: 2 });
	});
});
