/**
 * Print mode (single-shot): Send prompts, output result, exit.
 *
 * Used for:
 * - `pi -p "prompt"` - text output
 * - `pi --mode json "prompt"` - JSON event stream
 */

import type { AssistantMessage, ImageContent } from "@mariozechner/pi-ai";
import type { AgentSession } from "../core/agent-session.js";
import { PrintModeProgress } from "./print-mode-progress.js";

/** Options for print mode */
export interface PrintModeOptions {
	/** Suppress progress output even on TTY */
	quiet?: boolean;
}

/**
 * Determine if progress should be shown based on mode, TTY, and quiet flag.
 * Exported for testing.
 */
export function shouldShowProgress(mode: "text" | "json", isTTY: boolean, quiet?: boolean): boolean {
	// Progress is shown only when:
	// - In text mode (not json)
	// - stderr is a TTY
	// - --quiet flag is not set
	return mode === "text" && isTTY && !quiet;
}

/**
 * Run in print (single-shot) mode.
 * Sends prompts to the agent and outputs the result.
 *
 * @param session The agent session
 * @param mode Output mode: "text" for final response only, "json" for all events
 * @param messages Array of prompts to send
 * @param initialMessage Optional first message (may contain @file content)
 * @param initialImages Optional images for the initial message
 * @param options Additional options for print mode
 */
export async function runPrintMode(
	session: AgentSession,
	mode: "text" | "json",
	messages: string[],
	initialMessage?: string,
	initialImages?: ImageContent[],
	options?: PrintModeOptions,
): Promise<void> {
	const showProgress = shouldShowProgress(mode, !!process.stderr.isTTY, options?.quiet);

	// Create progress renderer if enabled
	const progress = showProgress ? new PrintModeProgress() : null;

	// Extension runner already has no-op UI context by default (set in loader)
	// Set up extensions for print mode (no UI)
	const extensionRunner = session.extensionRunner;
	if (extensionRunner) {
		extensionRunner.initialize({
			getModel: () => session.model,
			sendMessageHandler: (message, opts) => {
				session.sendCustomMessage(message, opts).catch((e) => {
					console.error(`Extension sendMessage failed: ${e instanceof Error ? e.message : String(e)}`);
				});
			},
			sendUserMessageHandler: (content, opts) => {
				session.sendUserMessage(content, opts).catch((e) => {
					console.error(`Extension sendUserMessage failed: ${e instanceof Error ? e.message : String(e)}`);
				});
			},
			appendEntryHandler: (customType, data) => {
				session.sessionManager.appendCustomEntry(customType, data);
			},
			getActiveToolsHandler: () => session.getActiveToolNames(),
			getAllToolsHandler: () => session.getAllToolNames(),
			setActiveToolsHandler: (toolNames: string[]) => session.setActiveToolsByName(toolNames),
			setModelHandler: async (model) => {
				const key = await session.modelRegistry.getApiKey(model);
				if (!key) return false;
				await session.setModel(model);
				return true;
			},
			getThinkingLevelHandler: () => session.thinkingLevel,
			setThinkingLevelHandler: (level) => session.setThinkingLevel(level),
		});
		extensionRunner.onError((err) => {
			console.error(`Extension error (${err.extensionPath}): ${err.error}`);
		});
		// Emit session_start event
		await extensionRunner.emit({
			type: "session_start",
		});
	}

	// Start progress display if enabled
	if (progress) {
		progress.start(session.model, session.thinkingLevel);
	}

	// Always subscribe to enable session persistence via _handleAgentEvent
	session.subscribe((event) => {
		// Update progress display
		if (progress) {
			progress.handleEvent(event);
		}

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

	// Stop progress display before outputting final result
	if (progress) {
		progress.stop();
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
