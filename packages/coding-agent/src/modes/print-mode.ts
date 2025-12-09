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
import { HookRunner, loadHooks, NoopUIAdapter, type TurnEndEvent, type TurnStartEvent } from "../core/hooks/index.js";
import type { SettingsManager } from "../core/settings-manager.js";

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
	settingsManager?: SettingsManager,
): Promise<void> {
	// Initialize hooks if settings manager provided
	let hookRunner: HookRunner | null = null;
	if (settingsManager) {
		const hookPaths = settingsManager.getHookPaths();
		if (hookPaths.length > 0) {
			const cwd = process.cwd();
			const { hooks, errors } = await loadHooks(hookPaths, cwd, "headless", false);

			for (const { path, error } of errors) {
				console.error(`Failed to load hook "${path}": ${error}`);
			}

			if (hooks.length > 0) {
				const timeout = settingsManager.getHookTimeout();
				hookRunner = new HookRunner(hooks, NoopUIAdapter, cwd, timeout);

				hookRunner.onError((err) => {
					console.error(`Hook "${err.hookPath}" error on ${err.event}: ${err.error}`);
				});
			}
		}
	}

	// Track turn index for hooks
	let turnIndex = 0;

	// Subscribe to events (output JSON in json mode, emit to hooks in both modes)
	session.subscribe(async (event) => {
		if (mode === "json") {
			console.log(JSON.stringify(event));
		}

		// Emit to hooks
		if (hookRunner) {
			if (event.type === "agent_start") {
				await hookRunner.emit({ type: "agent_start" });
			} else if (event.type === "agent_end") {
				await hookRunner.emit({ type: "agent_end", messages: event.messages });
			} else if (event.type === "turn_start") {
				const hookEvent: TurnStartEvent = {
					type: "turn_start",
					turnIndex,
					timestamp: Date.now(),
				};
				await hookRunner.emit(hookEvent);
			} else if (event.type === "turn_end") {
				const hookEvent: TurnEndEvent = {
					type: "turn_end",
					turnIndex,
					message: event.message,
					toolResults: event.toolResults,
				};
				await hookRunner.emit(hookEvent);
				turnIndex++;
			}
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
}
