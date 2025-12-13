import type { AgentEvent, Message } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { Agent } from "../src/index.js";
import type { AgentRunConfig, AgentTransport } from "../src/transports/types.js";
import type { Attachment } from "../src/types.js";

class CaptureTransport implements AgentTransport {
	lastRun: { messages: Message[]; userMessage: Message } | null = null;

	async *run(
		messages: Message[],
		userMessage: Message,
		_config: AgentRunConfig,
		_signal?: AbortSignal,
	): AsyncIterable<AgentEvent> {
		this.lastRun = { messages, userMessage };

		yield { type: "message_end", message: userMessage };

		const assistantMessage: Message = {
			role: "assistant",
			content: [{ type: "text", text: "ok" }],
			api: "openai-responses",
			provider: "openai",
			model: "gpt-4o-mini",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		yield { type: "message_end", message: assistantMessage };
		yield { type: "turn_end", message: assistantMessage, toolResults: [] };
		yield { type: "agent_end", messages: [userMessage, assistantMessage] };
	}

	async *continue(messages: Message[], config: AgentRunConfig, signal?: AbortSignal): AsyncIterable<AgentEvent> {
		const last = messages[messages.length - 1];
		if (!last) {
			yield { type: "agent_end", messages: [] };
			return;
		}
		yield* this.run(messages, last, config, signal);
	}
}

describe("Document attachments", () => {
	it("should transform document attachments without extractedText into DocumentContent blocks", async () => {
		const transport = new CaptureTransport();
		const agent = new Agent({ transport });

		const attachment: Attachment = {
			id: "doc_1",
			type: "document",
			fileName: "test.pdf",
			mimeType: "application/pdf",
			size: 123,
			content: "dGVzdA==",
		};

		agent.replaceMessages([
			{
				role: "user",
				content: "Please read this",
				attachments: [attachment],
				timestamp: Date.now(),
			},
		]);

		await agent.prompt("ok");

		expect(transport.lastRun).toBeTruthy();
		const history = transport.lastRun!.messages;
		expect(history).toHaveLength(1);

		const msg = history[0]!;
		expect(msg.role).toBe("user");
		expect(Array.isArray((msg as { content: unknown }).content)).toBe(true);

		const blocks = (msg as { content: Array<{ type: string; mimeType?: string }> }).content;
		expect(blocks.some((b) => b.type === "document" && b.mimeType === "application/pdf")).toBe(true);
	});

	it("should include document attachments in the prompted user message", async () => {
		const transport = new CaptureTransport();
		const agent = new Agent({ transport });

		const attachment: Attachment = {
			id: "doc_2",
			type: "document",
			fileName: "test.pdf",
			mimeType: "application/pdf",
			size: 123,
			content: "dGVzdA==",
		};

		await agent.prompt("ok", [attachment]);

		expect(transport.lastRun).toBeTruthy();
		const userMessage = transport.lastRun!.userMessage;
		expect(userMessage.role).toBe("user");
		expect(Array.isArray((userMessage as { content: unknown }).content)).toBe(true);

		const blocks = (userMessage as { content: Array<{ type: string; fileName?: string }> }).content;
		expect(blocks.some((b) => b.type === "document" && b.fileName === "test.pdf")).toBe(true);
	});
});
