/**
 * RPC mode: Headless operation with JSON stdin/stdout protocol.
 *
 * Used for embedding the agent in other applications.
 * Receives commands as JSON on stdin, outputs events and responses as JSON on stdout.
 *
 * Protocol:
 * - Commands: JSON objects with `type` field, optional `id` for correlation
 * - Responses: JSON objects with `type: "response"`, `command`, `success`, and optional `data`/`error`
 * - Events: AgentSessionEvent objects streamed as they occur
 * - Hook UI: Hook UI requests are emitted, client responds with hook_ui_response
 */

import * as crypto from "node:crypto";
import * as readline from "readline";
import type { AgentSession } from "../../core/agent-session.js";
import type { HookUIContext } from "../../core/hooks/index.js";
import { theme } from "../interactive/theme/theme.js";
import type { RpcCommand, RpcHookUIRequest, RpcHookUIResponse, RpcResponse, RpcSessionState } from "./rpc-types.js";

// Re-export types for consumers
export type { RpcCommand, RpcHookUIRequest, RpcHookUIResponse, RpcResponse, RpcSessionState } from "./rpc-types.js";

/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events and responses on stdout.
 */
export async function runRpcMode(session: AgentSession): Promise<never> {
	const output = (obj: RpcResponse | RpcHookUIRequest | object) => {
		console.log(JSON.stringify(obj));
	};

	const success = <T extends RpcCommand["type"]>(
		id: string | undefined,
		command: T,
		data?: object | null,
	): RpcResponse => {
		if (data === undefined) {
			return { id, type: "response", command, success: true } as RpcResponse;
		}
		return { id, type: "response", command, success: true, data } as RpcResponse;
	};

	const error = (id: string | undefined, command: string, message: string): RpcResponse => {
		return { id, type: "response", command, success: false, error: message };
	};

	// Pending hook UI requests waiting for response
	const pendingHookRequests = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();

	/**
	 * Create a hook UI context that uses the RPC protocol.
	 */
	const createHookUIContext = (): HookUIContext => ({
		async select(title: string, options: string[]): Promise<string | undefined> {
			const id = crypto.randomUUID();
			return new Promise((resolve, reject) => {
				pendingHookRequests.set(id, {
					resolve: (response: RpcHookUIResponse) => {
						if ("cancelled" in response && response.cancelled) {
							resolve(undefined);
						} else if ("value" in response) {
							resolve(response.value);
						} else {
							resolve(undefined);
						}
					},
					reject,
				});
				output({ type: "hook_ui_request", id, method: "select", title, options } as RpcHookUIRequest);
			});
		},

		async confirm(title: string, message: string): Promise<boolean> {
			const id = crypto.randomUUID();
			return new Promise((resolve, reject) => {
				pendingHookRequests.set(id, {
					resolve: (response: RpcHookUIResponse) => {
						if ("cancelled" in response && response.cancelled) {
							resolve(false);
						} else if ("confirmed" in response) {
							resolve(response.confirmed);
						} else {
							resolve(false);
						}
					},
					reject,
				});
				output({ type: "hook_ui_request", id, method: "confirm", title, message } as RpcHookUIRequest);
			});
		},

		async input(title: string, placeholder?: string): Promise<string | undefined> {
			const id = crypto.randomUUID();
			return new Promise((resolve, reject) => {
				pendingHookRequests.set(id, {
					resolve: (response: RpcHookUIResponse) => {
						if ("cancelled" in response && response.cancelled) {
							resolve(undefined);
						} else if ("value" in response) {
							resolve(response.value);
						} else {
							resolve(undefined);
						}
					},
					reject,
				});
				output({ type: "hook_ui_request", id, method: "input", title, placeholder } as RpcHookUIRequest);
			});
		},

		notify(message: string, type?: "info" | "warning" | "error"): void {
			// Fire and forget - no response needed
			output({
				type: "hook_ui_request",
				id: crypto.randomUUID(),
				method: "notify",
				message,
				notifyType: type,
			} as RpcHookUIRequest);
		},

		setStatus(key: string, text: string | undefined): void {
			// Fire and forget - no response needed
			output({
				type: "hook_ui_request",
				id: crypto.randomUUID(),
				method: "setStatus",
				statusKey: key,
				statusText: text,
			} as RpcHookUIRequest);
		},

		async custom() {
			// Custom UI not supported in RPC mode
			return undefined as never;
		},

		setEditorText(text: string): void {
			// Fire and forget - host can implement editor control
			output({
				type: "hook_ui_request",
				id: crypto.randomUUID(),
				method: "set_editor_text",
				text,
			} as RpcHookUIRequest);
		},

		getEditorText(): string {
			// Synchronous method can't wait for RPC response
			// Host should track editor state locally if needed
			return "";
		},

		get theme() {
			return theme;
		},
	});

	// Set up hooks with RPC-based UI context
	const hookRunner = session.hookRunner;
	if (hookRunner) {
		hookRunner.initialize({
			getModel: () => session.agent.state.model,
			sendMessageHandler: (message, triggerTurn) => {
				session.sendHookMessage(message, triggerTurn).catch((e) => {
					output(error(undefined, "hook_send", e.message));
				});
			},
			appendEntryHandler: (customType, data) => {
				session.sessionManager.appendCustomEntry(customType, data);
			},
			uiContext: createHookUIContext(),
			hasUI: false,
		});
		hookRunner.onError((err) => {
			output({ type: "hook_error", hookPath: err.hookPath, event: err.event, error: err.error });
		});
		// Emit session_start event
		await hookRunner.emit({
			type: "session_start",
		});
	}

	// Emit session start event to custom tools
	// Note: Tools get no-op UI context in RPC mode (host handles UI via protocol)
	for (const { tool } of session.customTools) {
		if (tool.onSession) {
			try {
				await tool.onSession(
					{
						previousSessionFile: undefined,
						reason: "start",
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

	// Output all agent events as JSON
	session.subscribe((event) => {
		output(event);
	});

	// Handle a single command
	const handleCommand = async (command: RpcCommand): Promise<RpcResponse> => {
		const id = command.id;

		switch (command.type) {
			// =================================================================
			// Prompting
			// =================================================================

			case "prompt": {
				// Don't await - events will stream
				// Hook commands and file slash commands are handled in session.prompt()
				session
					.prompt(command.message, {
						images: command.images,
					})
					.catch((e) => output(error(id, "prompt", e.message)));
				return success(id, "prompt");
			}

			case "queue_message": {
				await session.queueMessage(command.message);
				return success(id, "queue_message");
			}

			case "abort": {
				await session.abort();
				return success(id, "abort");
			}

			case "reset": {
				const cancelled = !(await session.reset());
				return success(id, "reset", { cancelled });
			}

			// =================================================================
			// State
			// =================================================================

			case "get_state": {
				const state: RpcSessionState = {
					model: session.model,
					thinkingLevel: session.thinkingLevel,
					isStreaming: session.isStreaming,
					isCompacting: session.isCompacting,
					queueMode: session.queueMode,
					sessionFile: session.sessionFile,
					sessionId: session.sessionId,
					autoCompactionEnabled: session.autoCompactionEnabled,
					messageCount: session.messages.length,
					queuedMessageCount: session.queuedMessageCount,
				};
				return success(id, "get_state", state);
			}

			// =================================================================
			// Model
			// =================================================================

			case "set_model": {
				const models = await session.getAvailableModels();
				const model = models.find((m) => m.provider === command.provider && m.id === command.modelId);
				if (!model) {
					return error(id, "set_model", `Model not found: ${command.provider}/${command.modelId}`);
				}
				await session.setModel(model);
				return success(id, "set_model", model);
			}

			case "cycle_model": {
				const result = await session.cycleModel();
				if (!result) {
					return success(id, "cycle_model", null);
				}
				return success(id, "cycle_model", result);
			}

			case "get_available_models": {
				const models = await session.getAvailableModels();
				return success(id, "get_available_models", { models });
			}

			// =================================================================
			// Thinking
			// =================================================================

			case "set_thinking_level": {
				session.setThinkingLevel(command.level);
				return success(id, "set_thinking_level");
			}

			case "cycle_thinking_level": {
				const level = session.cycleThinkingLevel();
				if (!level) {
					return success(id, "cycle_thinking_level", null);
				}
				return success(id, "cycle_thinking_level", { level });
			}

			// =================================================================
			// Queue Mode
			// =================================================================

			case "set_queue_mode": {
				session.setQueueMode(command.mode);
				return success(id, "set_queue_mode");
			}

			// =================================================================
			// Compaction
			// =================================================================

			case "compact": {
				const result = await session.compact(command.customInstructions);
				return success(id, "compact", result);
			}

			case "set_auto_compaction": {
				session.setAutoCompactionEnabled(command.enabled);
				return success(id, "set_auto_compaction");
			}

			// =================================================================
			// Retry
			// =================================================================

			case "set_auto_retry": {
				session.setAutoRetryEnabled(command.enabled);
				return success(id, "set_auto_retry");
			}

			case "abort_retry": {
				session.abortRetry();
				return success(id, "abort_retry");
			}

			// =================================================================
			// Bash
			// =================================================================

			case "bash": {
				const result = await session.executeBash(command.command);
				return success(id, "bash", result);
			}

			case "abort_bash": {
				session.abortBash();
				return success(id, "abort_bash");
			}

			// =================================================================
			// Session
			// =================================================================

			case "get_session_stats": {
				const stats = session.getSessionStats();
				return success(id, "get_session_stats", stats);
			}

			case "export_html": {
				const path = session.exportToHtml(command.outputPath);
				return success(id, "export_html", { path });
			}

			case "switch_session": {
				const cancelled = !(await session.switchSession(command.sessionPath));
				return success(id, "switch_session", { cancelled });
			}

			case "branch": {
				const result = await session.branch(command.entryId);
				return success(id, "branch", { text: result.selectedText, cancelled: result.cancelled });
			}

			case "get_branch_messages": {
				const messages = session.getUserMessagesForBranching();
				return success(id, "get_branch_messages", { messages });
			}

			case "get_last_assistant_text": {
				const text = session.getLastAssistantText();
				return success(id, "get_last_assistant_text", { text });
			}

			// =================================================================
			// Messages
			// =================================================================

			case "get_messages": {
				return success(id, "get_messages", { messages: session.messages });
			}

			default: {
				const unknownCommand = command as { type: string };
				return error(undefined, unknownCommand.type, `Unknown command: ${unknownCommand.type}`);
			}
		}
	};

	// Listen for JSON input
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: false,
	});

	rl.on("line", async (line: string) => {
		try {
			const parsed = JSON.parse(line);

			// Handle hook UI responses
			if (parsed.type === "hook_ui_response") {
				const response = parsed as RpcHookUIResponse;
				const pending = pendingHookRequests.get(response.id);
				if (pending) {
					pendingHookRequests.delete(response.id);
					pending.resolve(response);
				}
				return;
			}

			// Handle regular commands
			const command = parsed as RpcCommand;
			const response = await handleCommand(command);
			output(response);
		} catch (e: any) {
			output(error(undefined, "parse", `Failed to parse command: ${e.message}`));
		}
	});

	// Keep process alive forever
	return new Promise(() => {});
}
