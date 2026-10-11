import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { stream as streamAnthropic } from "../src/api/anthropic-messages.ts";
import type { Context, Model } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

interface CapturedRequest {
	headers: IncomingMessage["headers"];
	body: Record<string, unknown>;
}

function createModel(baseUrl: string): Model<"anthropic-messages"> {
	return {
		id: "claude-sonnet-5-5",
		name: "Claude Sonnet 5.5",
		api: "anthropic-messages",
		provider: "test-anthropic",
		baseUrl,
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200000,
		maxTokens: 32000,
	};
}

function createContext(): Context {
	return {
		messages: [
			{ role: "user", content: "Read these images", timestamp: Date.now() - 2 },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "01.png" } }],
				api: "anthropic-messages",
				provider: "test-anthropic",
				model: "claude-sonnet-5-5",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "toolUse",
				timestamp: Date.now() - 1,
			},
			{
				role: "toolResult",
				toolCallId: "tool-1",
				toolName: "read",
				content: [
					{ type: "text", text: "[Image saved to /tmp/pi-codemode/01.png (image/png, 1.2 KB)]" },
					{ type: "image", data: "ZmFrZQ==", mimeType: "image/png" },
					{ type: "text", text: "Script error:\nError: ENOENT: no such file or directory, access '02.png'" },
				],
				isError: true,
				timestamp: Date.now(),
			},
		],
	};
}

async function readRequestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function writeEmptySseResponse(response: ServerResponse): void {
	response.writeHead(200, { "content-type": "text/event-stream" });
	response.end();
}

async function captureAnthropicRequest(context: Context): Promise<CapturedRequest> {
	let capturedRequest: CapturedRequest | undefined;

	const server = createServer(async (request, response) => {
		capturedRequest = {
			headers: request.headers,
			body: await readRequestBody(request),
		};
		writeEmptySseResponse(response);
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address() as AddressInfo;

	try {
		const stream = streamAnthropic(createModel(`http://127.0.0.1:${address.port}`), normalizeContext(context), {
			apiKey: "test-key",
			cacheRetention: "none",
		});

		for await (const event of stream) {
			if (event.type === "done" || event.type === "error") break;
		}
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	}

	if (!capturedRequest) {
		throw new Error("Anthropic request was not captured");
	}
	return capturedRequest;
}

/** The single tool_result block sent for the erroring read. */
function getToolResult(body: Record<string, unknown>): Record<string, unknown> {
	const messages = body.messages;
	if (!Array.isArray(messages)) throw new Error("Expected messages in request body");
	for (const message of messages) {
		if (!message || typeof message !== "object") continue;
		const content = (message as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (block && typeof block === "object" && (block as { type?: unknown }).type === "tool_result") {
				return block as Record<string, unknown>;
			}
		}
	}
	throw new Error("Expected a tool_result block in request body");
}

describe("Anthropic error tool result images", () => {
	it("keeps error tool results text-only when the result carries images", async () => {
		const request = await captureAnthropicRequest(createContext());
		const toolResult = getToolResult(request.body);

		expect(toolResult.is_error).toBe(true);

		const content = toolResult.content;
		if (typeof content === "string") return;
		expect(Array.isArray(content)).toBe(true);
		const blocks = content as Array<{ type?: string }>;
		const imageBlocks = blocks.filter((block) => block?.type === "image");
		expect(imageBlocks).toEqual([]);
	});
});
