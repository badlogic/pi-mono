import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ToolCall, ToolResultMessage } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import type { SessionMessageEntry } from "../src/core/session-manager.js";
import { createTestSession } from "./utilities.js";

const isAssistantMessage = (m: AgentMessage): m is AssistantMessage => (m as { role?: string }).role === "assistant";
const isToolResultMessage = (m: AgentMessage): m is ToolResultMessage => (m as { role?: string }).role === "toolResult";

describe("AgentSession.dispatchToolCall", () => {
	it("persists an assistant toolCall message and a toolResult message", async () => {
		const ctx = createTestSession({ inMemory: true });
		try {
			const filePath = path.join(ctx.tempDir, "hello.txt");
			fs.writeFileSync(filePath, "hello", "utf-8");

			const result = await ctx.session.dispatchToolCall("read", { path: filePath });

			expect(result.role).toBe("toolResult");
			expect(result.toolName).toBe("read");
			const text = result.content.find((c) => c.type === "text")?.text;
			expect(text).toContain("hello");

			const messages = ctx.session.state.messages;
			let toolCallMsg: AssistantMessage | undefined;
			let toolResultMsg: ToolResultMessage | undefined;

			for (let i = messages.length - 1; i >= 0; i--) {
				const message = messages[i];
				if (!toolResultMsg && isToolResultMessage(message)) toolResultMsg = message;
				if (!toolCallMsg && isAssistantMessage(message)) toolCallMsg = message;
				if (toolCallMsg && toolResultMsg) break;
			}

			expect(toolCallMsg).toBeDefined();
			expect(toolResultMsg).toBeDefined();

			const toolCalls = (toolCallMsg?.content ?? []).filter((c): c is ToolCall => c.type === "toolCall");
			expect(toolCalls.some((c) => c.name === "read")).toBe(true);
			expect(toolResultMsg?.toolName).toBe("read");

			const entries = ctx.sessionManager.getEntries();
			const lastTwo = entries.slice(-2);
			expect(lastTwo.map((e) => e.type)).toEqual(["message", "message"]);

			const first = lastTwo[0] as SessionMessageEntry;
			const second = lastTwo[1] as SessionMessageEntry;
			expect(first.message.role).toBe("assistant");
			expect(second.message.role).toBe("toolResult");
		} finally {
			ctx.cleanup();
		}
	});
});
