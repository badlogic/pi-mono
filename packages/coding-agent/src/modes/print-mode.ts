/**
 * Print mode (single-shot): Send prompts, output result, exit.
 *
 * Used for:
 * - `pi -p "prompt"` - text output
 * - `pi --mode json "prompt"` - JSON event stream
 */

import type { Attachment } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { AgentSession } from "../core/agent-session.js";

/**
 * Run in print (single-shot) mode.
 * Sends prompts to the agent and outputs the result.
 *
 * @param session The agent session
 * @param mode Output mode: "text" for final response only, "json" for all events
 * @param messages Array of prompts to send
 * @param initialMessage Optional first message (may contain @file content)
 * @param initialAttachments Optional attachments for the initial message
 */
export async function runPrintMode(
	session: AgentSession,
	mode: "text" | "json",
	messages: string[],
	initialMessage?: string,
	initialAttachments?: Attachment[],
): Promise<void> {
	// Load entries once for session start events
	const entries = session.sessionManager.loadEntries();

	// Hook runner already has no-op UI context by default (set in main.ts)
	// Set up hooks for print mode (no UI)
	const hookRunner = session.hookRunner;
	if (hookRunner) {
		// Use actual session file if configured (via --session), otherwise null
		hookRunner.setSessionFile(session.sessionFile);
		hookRunner.onError((err) => {
			console.error(`Hook error (${err.hookPath}): ${err.error}`);
		});
		// No-op send handler for print mode (single-shot, no async messages)
		hookRunner.setSendHandler(() => {
			console.error("Warning: pi.send() is not supported in print mode");
		});
		// Emit session event
		await hookRunner.emit({
			type: "session",
			entries,
			sessionFile: session.sessionFile,
			previousSessionFile: null,
			reason: "start",
		});
	}

	// Emit session start event to custom tools (no UI in print mode)
	for (const { tool } of session.customTools) {
		if (tool.onSession) {
			try {
				await tool.onSession({
					entries,
					sessionFile: session.sessionFile,
					previousSessionFile: null,
					reason: "start",
				});
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
		await session.prompt(initialMessage, { attachments: initialAttachments });
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
