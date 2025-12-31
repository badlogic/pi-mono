/**
 * Print mode (single-shot): Send prompts, output result, exit.
 *
 * Used for:
 * - `pi -p "prompt"` - text output
 * - `pi --mode json "prompt"` - JSON event stream
 */

import type { AssistantMessage, ImageContent } from "@mariozechner/pi-ai";
import type { AgentSession } from "../core/agent-session.js";

/**
 * Run in print (single-shot) mode.
 * Sends prompts to the agent and outputs the result.
 *
 * @param session The agent session
 * @param mode Output mode: "text" for final response only, "json" for all events
 * @param messages Array of prompts to send
 * @param initialMessage Optional first message (may contain @file content)
 * @param initialImages Optional images for the initial message
 */
export async function runPrintMode(
	session: AgentSession,
	mode: "text" | "json",
	messages: string[],
	initialMessage?: string,
	initialImages?: ImageContent[],
): Promise<void> {
	// Hook runner already has no-op UI context by default (set in main.ts)
	// Set up hooks for print mode (no UI)
	const hookRunner = session.hookRunner;
	if (hookRunner) {
		hookRunner.initialize({
			getModel: () => session.model,
			sendMessageHandler: (message, triggerTurn) => {
				session.sendHookMessage(message, triggerTurn).catch((e) => {
					console.error(`Hook sendMessage failed: ${e instanceof Error ? e.message : String(e)}`);
				});
			},
			appendEntryHandler: (customType, data) => {
				session.sessionManager.appendCustomEntry(customType, data);
			},
		});
		hookRunner.onError((err) => {
			console.error(`Hook error (${err.hookPath}): ${err.error}`);
		});
		// Emit session_start event
		await hookRunner.emit({
			type: "session_start",
		});
	}

	// Emit session start event to custom tools (no UI in print mode)
	for (const { tool } of session.customTools) {
		if (tool.onSession) {
			try {
				await tool.onSession(
					{
						reason: "start",
						previousSessionFile: undefined,
					},
					{
						sessionManager: session.sessionManager,
						modelRegistry: session.modelRegistry,
						model: session.model,
					},
				);
			} catch (_err) {
				// Silently ignore tool errors
			}
		}
	}

	// Always subscribe to enable session persistence via _handleAgentEvent
	session.subscribe((event) => {
		// In JSON mode, output all events
		if (mode === "json") {
			console.log(JSON.stringify(event));
		}
	});

	// Send initial message with attachments
	if (initialMessage) {
		await session.prompt(initialMessage, { images: initialImages });
	}

	// Send remaining messages
	for (const message of messages) {
		await session.prompt(message);
	}

	// In text mode, output final response
	if (mode === "text") {
		const state = session.state;
		const lastMessage = state.messages[state.messages.length - 1];

		if (lastMessage?.role === "assistant") {
			const assistantMsg = lastMessage as AssistantMessage;

			// Check for error/aborted
			if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
				console.error(assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`);
				process.exit(1);
			}

			// Output text content
			for (const content of assistantMsg.content) {
				if (content.type === "text") {
					console.log(content.text);
				}
			}
		}
	}

	// Ensure stdout is fully flushed before returning
	// This prevents race conditions where the process exits before all output is written
	await new Promise<void>((resolve, reject) => {
		process.stdout.write("", (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}
