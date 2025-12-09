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
import type { HookUIContext } from "../core/hooks/index.js";

/**
 * Create a no-op hook UI context for print mode.
 * Hooks can still run but can't prompt the user interactively.
 */
function createNoOpHookUIContext(): HookUIContext {
	return {
		async select() {
			return null;
		},
		async confirm() {
			return false;
		},
		async input() {
			return null;
		},
		notify() {
			// Silent in print mode
		},
	};
}

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
	// Initialize hooks with no-op UI context (hooks run but can't prompt)
	session.setHookUIContext(createNoOpHookUIContext(), (err) => {
		console.error(`Hook error (${err.hookPath}): ${err.error}`);
	});
	await session.initHooks();

	if (mode === "json") {
		// Output all events as JSON
		session.subscribe((event) => {
			console.log(JSON.stringify(event));
		});
	}

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
}
