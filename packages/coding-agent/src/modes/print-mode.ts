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
 * Options for print mode.
 */
export interface PrintModeOptions {
	/** Output mode: "text" for final response only, "json" for all events */
	mode: "text" | "json";
	/** Array of additional prompts to send after initialMessage */
	messages?: string[];
	/** First message to send (may contain @file content) */
	initialMessage?: string;
	/** Images to attach to the initial message */
	initialImages?: ImageContent[];
}

/**
 * Run in print (single-shot) mode.
 * Sends prompts to the agent and outputs the result.
 */
export async function runPrintMode(session: AgentSession, options: PrintModeOptions): Promise<void> {
	const { mode, messages = [], initialMessage, initialImages } = options;
	if (mode === "json") {
		const header = session.sessionManager.getHeader();
		if (header) {
			console.log(JSON.stringify(header));
		}
	}
	// Set up extensions for print mode (no UI, no command context)
	const extensionRunner = session.extensionRunner;
	if (extensionRunner) {
		extensionRunner.initialize(
			// ExtensionActions
			{
				sendMessage: (message, options) => {
					session.sendCustomMessage(message, options).catch((e) => {
						console.error(`Extension sendMessage failed: ${e instanceof Error ? e.message : String(e)}`);
					});
				},
				sendUserMessage: (content, options) => {
					session.sendUserMessage(content, options).catch((e) => {
						console.error(`Extension sendUserMessage failed: ${e instanceof Error ? e.message : String(e)}`);
					});
				},
				appendEntry: (customType, data) => {
					session.sessionManager.appendCustomEntry(customType, data);
				},
				setSessionName: (name) => {
					session.sessionManager.appendSessionInfo(name);
				},
				getSessionName: () => {
					return session.sessionManager.getSessionName();
				},
				getActiveTools: () => session.getActiveToolNames(),
				getAllTools: () => session.getAllTools(),
				setActiveTools: (toolNames: string[]) => session.setActiveToolsByName(toolNames),
				setModel: async (model) => {
					const key = await session.modelRegistry.getApiKey(model);
					if (!key) return false;
					await session.setModel(model);
					return true;
				},
				getThinkingLevel: () => session.thinkingLevel,
				setThinkingLevel: (level) => session.setThinkingLevel(level),
			},
			// ExtensionContextActions
			{
				getModel: () => session.model,
				isIdle: () => !session.isStreaming,
				abort: () => session.abort(),
				hasPendingMessages: () => session.pendingMessageCount > 0,
				shutdown: () => {},
			},
			// ExtensionCommandContextActions - commands invokable via prompt("/command")
			{
				waitForIdle: () => session.agent.waitForIdle(),
				newSession: async (options) => {
					const success = await session.newSession({ parentSession: options?.parentSession });
					if (success && options?.setup) {
						await options.setup(session.sessionManager);
					}
					return { cancelled: !success };
				},
				fork: async (entryId) => {
					const result = await session.fork(entryId);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, options) => {
					const result = await session.navigateTree(targetId, {
						summarize: options?.summarize,
						customInstructions: options?.customInstructions,
						replaceInstructions: options?.replaceInstructions,
						label: options?.label,
					});
					return { cancelled: result.cancelled };
				},
			},
			// No UI context - hasUI will be false
		);
		extensionRunner.onError((err) => {
			console.error(`Extension error (${err.extensionPath}): ${err.error}`);
		});
		// Emit session_start event
		await extensionRunner.emit({
			type: "session_start",
		});
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
