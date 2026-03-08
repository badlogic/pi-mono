import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { streamOpenAICodexResponses } from "../src/providers/openai-codex-responses.js";
import type { Context, Model } from "../src/types.js";

const originalFetch = global.fetch;
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	global.fetch = originalFetch;
	if (originalAgentDir === undefined) {
		delete process.env.PI_CODING_AGENT_DIR;
	} else {
		process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	}
	vi.restoreAllMocks();
});

/**
 * Helper: build a mock JWT token with a chatgpt_account_id claim.
 */
function mockToken(): string {
	const payload = Buffer.from(
		JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
		"utf8",
	).toString("base64");
	return `aaa.${payload}.bbb`;
}

/**
 * Helper: build the SSE event sequence that the Codex API sends for a simple
 * text response. Matches the format used by other tests in this file.
 */
function buildSSEPayload({ includeDone = false }: { includeDone?: boolean } = {}): string {
	const events = [
		`data: ${JSON.stringify({
			type: "response.output_item.added",
			item: { type: "message", id: "msg_1", role: "assistant", status: "in_progress", content: [] },
		})}`,
		`data: ${JSON.stringify({ type: "response.content_part.added", part: { type: "output_text", text: "" } })}`,
		`data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hello" })}`,
		`data: ${JSON.stringify({
			type: "response.output_item.done",
			item: {
				type: "message",
				id: "msg_1",
				role: "assistant",
				status: "completed",
				content: [{ type: "output_text", text: "Hello" }],
			},
		})}`,
		`data: ${JSON.stringify({
			type: "response.completed",
			response: {
				status: "completed",
				usage: {
					input_tokens: 5,
					output_tokens: 3,
					total_tokens: 8,
					input_tokens_details: { cached_tokens: 0 },
				},
			},
		})}`,
	];

	if (includeDone) {
		events.push(`data: [DONE]`);
	}

	return `${events.join("\n\n")}\n\n`;
}

const model: Model<"openai-codex-responses"> = {
	id: "gpt-5.1-codex",
	name: "GPT-5.1 Codex",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://chatgpt.com/backend-api",
	reasoning: true,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 400000,
	maxTokens: 128000,
};

const context: Context = {
	systemPrompt: "You are a helpful assistant.",
	messages: [{ role: "user", content: "Say hello", timestamp: Date.now() }],
};

/**
 * Creates a fetch mock that returns an SSE response with the given ReadableStream.
 */
function mockFetch(stream: ReadableStream<Uint8Array>) {
	return vi.fn(async (input: string | URL) => {
		const url = typeof input === "string" ? input : input.toString();
		if (url === "https://api.github.com/repos/openai/codex/releases/latest") {
			return new Response(JSON.stringify({ tag_name: "rust-v0.0.0" }), { status: 200 });
		}
		if (url.startsWith("https://raw.githubusercontent.com/openai/codex/")) {
			return new Response("PROMPT", { status: 200, headers: { etag: '"etag"' } });
		}
		if (url === "https://chatgpt.com/backend-api/codex/responses") {
			return new Response(stream, {
				status: 200,
				headers: { "content-type": "text/event-stream" },
			});
		}
		return new Response("not found", { status: 404 });
	});
}

describe("openai-codex streaming hang", () => {
	/**
	 * BUG REPRO: mapCodexEvents hangs when the HTTP body doesn't close after
	 * response.completed + [DONE].
	 *
	 * In real HTTP connections with keep-alive, the response body stream may not
	 * close immediately after the server finishes writing. The SSE parser
	 * (parseSSE) filters out [DONE] but doesn't treat it as a termination
	 * signal. mapCodexEvents does `continue` after yielding response.completed,
	 * which loops back to parseSSE's reader.read() — blocking forever.
	 *
	 * This test simulates a keep-alive connection by enqueueing all SSE events
	 * (including [DONE]) but never calling controller.close(). The stream
	 * should still complete because response.completed is the last meaningful
	 * event.
	 */
	it("completes after response.completed even when response body stays open", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pi-codex-hang-"));
		process.env.PI_CODING_AGENT_DIR = tempDir;
		const token = mockToken();
		const sse = buildSSEPayload({ includeDone: true });
		const encoder = new TextEncoder();

		// Key difference from passing tests: controller.close() is NEVER called.
		// This simulates HTTP keep-alive where the body stream stays open after
		// [DONE] is sent.
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(sse));
				// NOT calling controller.close() — body stays open like keep-alive
			},
		});

		global.fetch = mockFetch(stream) as typeof fetch;

		const streamResult = streamOpenAICodexResponses(model, context, { apiKey: token });

		// With the bug: this hangs forever (vitest timeout will catch it).
		// With the fix (continue → return in mapCodexEvents): completes immediately.
		const result = await streamResult.result();
		expect(result.content.find((c) => c.type === "text")?.text).toBe("Hello");
		expect(result.stopReason).toBe("stop");
	});

	/**
	 * Same scenario but without [DONE] — simulates a server that sends
	 * response.completed but never [DONE] and never closes the body.
	 * Should still complete.
	 */
	it("completes after response.completed even without [DONE] signal", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pi-codex-hang-"));
		process.env.PI_CODING_AGENT_DIR = tempDir;
		const token = mockToken();
		const sse = buildSSEPayload({ includeDone: false });
		const encoder = new TextEncoder();

		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(sse));
				// Body stays open — no close(), no [DONE]
			},
		});

		global.fetch = mockFetch(stream) as typeof fetch;

		const streamResult = streamOpenAICodexResponses(model, context, { apiKey: token });
		const result = await streamResult.result();
		expect(result.content.find((c) => c.type === "text")?.text).toBe("Hello");
		expect(result.stopReason).toBe("stop");
	});
});
