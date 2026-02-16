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
 * - Extension UI: Extension UI requests are emitted, client responds with extension_ui_response
 */

import * as crypto from "node:crypto";
import { dirname } from "node:path";
import * as readline from "readline";
import type { AgentSession } from "../../core/agent-session.js";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
} from "../../core/extensions/index.js";
import { SessionManager } from "../../core/session-manager.js";
import { type Theme, theme } from "../interactive/theme/theme.js";
import { deleteSessionByPath, renameSessionByPath } from "./rpc-session-mutation.js";
import { buildToolCallMap, projectTree } from "./rpc-tree-projection.js";
import type {
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcForkMessage,
	RpcResponse,
	RpcSessionListItem,
	RpcSessionState,
	RpcSlashCommand,
} from "./rpc-types.js";

// Re-export types for consumers
export type {
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
	RpcSessionListItem,
	RpcSessionState,
	RpcTreeNode,
} from "./rpc-types.js";

/**
 * Run in RPC mode.
 * Listens for JSON commands on stdin, outputs events and responses on stdout.
 */
export async function runRpcMode(session: AgentSession): Promise<never> {
	const output = (obj: RpcResponse | RpcExtensionUIRequest | object) => {
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

	// Pending extension UI requests waiting for response
	const pendingExtensionRequests = new Map<
		string,
		{ resolve: (value: any) => void; reject: (error: Error) => void }
	>();

	// Shutdown request flag
	let shutdownRequested = false;

	/** Helper for dialog methods with signal/timeout support */
	function createDialogPromise<T>(
		opts: ExtensionUIDialogOptions | undefined,
		defaultValue: T,
		request: Record<string, unknown>,
		parseResponse: (response: RpcExtensionUIResponse) => T,
	): Promise<T> {
		if (opts?.signal?.aborted) return Promise.resolve(defaultValue);

		const id = crypto.randomUUID();
		return new Promise((resolve, reject) => {
			let timeoutId: ReturnType<typeof setTimeout> | undefined;

			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				opts?.signal?.removeEventListener("abort", onAbort);
				pendingExtensionRequests.delete(id);
			};

			const onAbort = () => {
				cleanup();
				resolve(defaultValue);
			};
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			if (opts?.timeout) {
				timeoutId = setTimeout(() => {
					cleanup();
					resolve(defaultValue);
				}, opts.timeout);
			}

			pendingExtensionRequests.set(id, {
				resolve: (response: RpcExtensionUIResponse) => {
					cleanup();
					resolve(parseResponse(response));
				},
				reject,
			});
			output({ type: "extension_ui_request", id, ...request } as RpcExtensionUIRequest);
		});
	}

	/**
	 * Create an extension UI context that uses the RPC protocol.
	 */
	const createExtensionUIContext = (): ExtensionUIContext => ({
		select: (title, options, opts) =>
			createDialogPromise(opts, undefined, { method: "select", title, options, timeout: opts?.timeout }, (r) =>
				"cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
			),

		confirm: (title, message, opts) =>
			createDialogPromise(opts, false, { method: "confirm", title, message, timeout: opts?.timeout }, (r) =>
				"cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false,
			),

		input: (title, placeholder, opts) =>
			createDialogPromise(opts, undefined, { method: "input", title, placeholder, timeout: opts?.timeout }, (r) =>
				"cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined,
			),

		notify(message: string, type?: "info" | "warning" | "error"): void {
			// Fire and forget - no response needed
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "notify",
				message,
				notifyType: type,
			} as RpcExtensionUIRequest);
		},

		onTerminalInput(): () => void {
			// Raw terminal input not supported in RPC mode - requires direct TTY access
			return () => {};
		},

		setStatus(key: string, text: string | undefined): void {
			// Fire and forget - no response needed
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setStatus",
				statusKey: key,
				statusText: text,
			} as RpcExtensionUIRequest);
		},

		setWorkingMessage(message?: string): void {
			// Fire and forget - no response needed
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setWorkingMessage",
				message,
			} as RpcExtensionUIRequest);
		},

		setWidget(key: string, content: unknown, options?: ExtensionWidgetOptions): void {
			// Only support string arrays in RPC mode - factory functions are ignored
			if (content === undefined || Array.isArray(content)) {
				output({
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setWidget",
					widgetKey: key,
					widgetLines: content as string[] | undefined,
					widgetPlacement: options?.placement,
				} as RpcExtensionUIRequest);
			}
			// Component factories are not supported in RPC mode - would need TUI access
		},

		setFooter(_factory: unknown): void {
			// Custom footer not supported in RPC mode - requires TUI access
		},

		setHeader(_factory: unknown): void {
			// Custom header not supported in RPC mode - requires TUI access
		},

		setTitle(title: string): void {
			// Fire and forget - host can implement terminal title control
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setTitle",
				title,
			} as RpcExtensionUIRequest);
		},

		async custom() {
			// Custom UI not supported in RPC mode
			return undefined as never;
		},

		pasteToEditor(text: string): void {
			// Paste handling not supported in RPC mode - falls back to setEditorText
			this.setEditorText(text);
		},

		setEditorText(text: string): void {
			// Fire and forget - host can implement editor control
			output({
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "set_editor_text",
				text,
			} as RpcExtensionUIRequest);
		},

		getEditorText(): string {
			// Synchronous method can't wait for RPC response
			// Host should track editor state locally if needed
			return "";
		},

		async editor(title: string, prefill?: string): Promise<string | undefined> {
			const id = crypto.randomUUID();
			return new Promise((resolve, reject) => {
				pendingExtensionRequests.set(id, {
					resolve: (response: RpcExtensionUIResponse) => {
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
				output({ type: "extension_ui_request", id, method: "editor", title, prefill } as RpcExtensionUIRequest);
			});
		},

		setEditorComponent(): void {
			// Custom editor components not supported in RPC mode
		},

		get theme() {
			return theme;
		},

		getAllThemes() {
			return [];
		},

		getTheme(_name: string) {
			return undefined;
		},

		setTheme(_theme: string | Theme) {
			// Theme switching not supported in RPC mode
			return { success: false, error: "Theme switching not supported in RPC mode" };
		},

		getToolsExpanded() {
			// Tool expansion not supported in RPC mode - no TUI
			return false;
		},

		setToolsExpanded(_expanded: boolean) {
			// Tool expansion not supported in RPC mode - no TUI
		},
	});

	// Set up extensions with RPC-based UI context
	await session.bindExtensions({
		uiContext: createExtensionUIContext(),
		commandContextActions: {
			waitForIdle: () => session.agent.waitForIdle(),
			newSession: async (options) => {
				// Delegate to AgentSession (handles setup + agent state sync)
				const success = await session.newSession(options);
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
			switchSession: async (sessionPath) => {
				const success = await session.switchSession(sessionPath);
				return { cancelled: !success };
			},
			reload: async () => {
				await session.reload();
			},
		},
		shutdownHandler: () => {
			shutdownRequested = true;
		},
		onError: (err) => {
			output({ type: "extension_error", extensionPath: err.extensionPath, event: err.event, error: err.error });
		},
	});

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
				// Extension commands are executed immediately, file prompt templates are expanded
				// If streaming and streamingBehavior specified, queues via steer/followUp
				session
					.prompt(command.message, {
						images: command.images,
						streamingBehavior: command.streamingBehavior,
						source: "rpc",
					})
					.catch((e) => output(error(id, "prompt", e.message)));
				return success(id, "prompt");
			}

			case "steer": {
				await session.steer(command.message, command.images);
				return success(id, "steer");
			}

			case "follow_up": {
				await session.followUp(command.message, command.images);
				return success(id, "follow_up");
			}

			case "abort": {
				session.abortBranchSummary();
				await session.abort();
				return success(id, "abort");
			}

			case "new_session": {
				const options = command.parentSession ? { parentSession: command.parentSession } : undefined;
				const cancelled = !(await session.newSession(options));
				return success(id, "new_session", { cancelled });
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
					steeringMode: session.steeringMode,
					followUpMode: session.followUpMode,
					sessionFile: session.sessionFile,
					sessionId: session.sessionId,
					sessionName: session.sessionName,
					autoCompactionEnabled: session.autoCompactionEnabled,
					messageCount: session.messages.length,
					pendingMessageCount: session.pendingMessageCount,
				};
				return success(id, "get_state", state);
			}

			// =================================================================
			// Model
			// =================================================================

			case "set_model": {
				const models = await session.modelRegistry.getAvailable();
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
				const models = await session.modelRegistry.getAvailable();
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
			// Queue Modes
			// =================================================================

			case "set_steering_mode": {
				session.setSteeringMode(command.mode);
				return success(id, "set_steering_mode");
			}

			case "set_follow_up_mode": {
				session.setFollowUpMode(command.mode);
				return success(id, "set_follow_up_mode");
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
				const path = await session.exportToHtml(command.outputPath);
				return success(id, "export_html", { path });
			}

			case "switch_session": {
				const cancelled = !(await session.switchSession(command.sessionPath));
				return success(id, "switch_session", { cancelled });
			}

			case "fork": {
				const result = await session.fork(command.entryId);
				return success(id, "fork", { text: result.selectedText, cancelled: result.cancelled });
			}

			case "get_fork_messages": {
				const raw = session.getUserMessagesForForking();
				const messages: RpcForkMessage[] = [];
				for (const msg of raw) {
					const entry = session.sessionManager.getEntry(msg.entryId);
					if (!entry) {
						return error(id, "get_fork_messages", `Entry ${msg.entryId} not found`);
					}
					messages.push({ ...msg, timestamp: entry.timestamp });
				}
				return success(id, "get_fork_messages", { messages });
			}

			case "get_last_assistant_text": {
				const text = session.getLastAssistantText();
				return success(id, "get_last_assistant_text", { text });
			}

			case "set_session_name": {
				const name = command.name.trim();
				if (!name) {
					return error(id, "set_session_name", "Session name cannot be empty");
				}
				session.setSessionName(name);
				return success(id, "set_session_name");
			}

			// =================================================================
			// Session Mutation (arbitrary session paths)
			// =================================================================

			case "rename_session": {
				renameSessionByPath(command.sessionPath, command.name);
				return success(id, "rename_session");
			}

			case "delete_session": {
				await deleteSessionByPath(command.sessionPath, session.sessionManager.getSessionFile());
				return success(id, "delete_session");
			}

			// =================================================================
			// Messages
			// =================================================================

			case "get_messages": {
				return success(id, "get_messages", { messages: session.messages });
			}

			// =================================================================
			// Commands (available for invocation via prompt)
			// =================================================================

			case "get_commands": {
				const commands: RpcSlashCommand[] = [];

				// Extension commands
				for (const { command, extensionPath } of session.extensionRunner?.getRegisteredCommandsWithPaths() ?? []) {
					commands.push({
						name: command.name,
						description: command.description,
						source: "extension",
						path: extensionPath,
					});
				}

				// Prompt templates (source is always "user" | "project" | "path" in coding-agent)
				for (const template of session.promptTemplates) {
					commands.push({
						name: template.name,
						description: template.description,
						source: "prompt",
						location: template.source as RpcSlashCommand["location"],
						path: template.filePath,
					});
				}

				// Skills (source is always "user" | "project" | "path" in coding-agent)
				for (const skill of session.resourceLoader.getSkills().skills) {
					commands.push({
						name: `skill:${skill.name}`,
						description: skill.description,
						source: "skill",
						location: skill.source as RpcSlashCommand["location"],
						path: skill.filePath,
					});
				}

				return success(id, "get_commands", { commands });
			}

			// =================================================================
			// Session listing
			// =================================================================

			case "list_sessions": {
				const scope = command.scope ?? "current";

				let cwd: string;
				let sessionDir: string | undefined;
				if (scope === "all") {
					cwd = session.sessionManager.getCwd();
					sessionDir = undefined;
				} else {
					// After switch_session, the core SessionManager's cwd/sessionDir remain
					// startup-bound. Use the active session header instead, so listing
					// follows the switched-to project.
					const headerCwd = session.sessionManager.getHeader()?.cwd;
					const sessionFile = session.sessionFile;
					if (headerCwd && sessionFile) {
						cwd = headerCwd;
						sessionDir = dirname(sessionFile);
					} else {
						cwd = session.sessionManager.getCwd();
						sessionDir = session.sessionManager.getSessionDir();
					}
				}

				const raw = scope === "all" ? await SessionManager.listAll() : await SessionManager.list(cwd, sessionDir);

				const sessions: RpcSessionListItem[] = raw.map((s) => ({
					path: s.path,
					id: s.id,
					cwd: s.cwd,
					name: s.name,
					parentSessionPath: s.parentSessionPath,
					created: s.created.toISOString(),
					modified: s.modified.toISOString(),
					messageCount: s.messageCount,
					firstMessage: s.firstMessage,
					...(command.includeSearchText ? { allMessagesText: s.allMessagesText } : {}),
				}));
				return success(id, "list_sessions", { sessions });
			}

			// =================================================================
			// Tree
			// =================================================================

			case "get_tree": {
				const rawTree = session.sessionManager.getTree();
				const toolCallMap = buildToolCallMap(rawTree);
				const tree = projectTree(rawTree, toolCallMap, command.includeContent ?? false);
				const leafId = session.sessionManager.getLeafId();
				return success(id, "get_tree", { tree, leafId });
			}

			case "set_label": {
				// Trim and treat empty/whitespace-only labels as "clear" (consistent with rename_session)
				const label = command.label?.trim() || undefined;
				session.sessionManager.appendLabelChange(command.entryId, label);
				return success(id, "set_label");
			}

			case "navigate_tree": {
				const result = await session.navigateTree(command.targetId, {
					summarize: command.summarize,
					customInstructions: command.customInstructions,
					replaceInstructions: command.replaceInstructions,
					label: command.label,
				});
				return success(id, "navigate_tree", {
					cancelled: result.cancelled,
					aborted: result.aborted,
					editorText: result.editorText,
					summaryEntry: result.summaryEntry
						? {
								id: result.summaryEntry.id,
								summary: result.summaryEntry.summary,
								fromExtension: result.summaryEntry.fromHook === true,
							}
						: undefined,
				});
			}

			default: {
				const unknownCommand = command as { id?: string; type: string };
				return error(unknownCommand.id, unknownCommand.type, `Unknown command: ${unknownCommand.type}`);
			}
		}
	};

	/**
	 * Check if shutdown was requested and perform shutdown if so.
	 * Called after handling each command when waiting for the next command.
	 */
	async function checkShutdownRequested(): Promise<void> {
		if (!shutdownRequested) return;

		const currentRunner = session.extensionRunner;
		if (currentRunner?.hasHandlers("session_shutdown")) {
			await currentRunner.emit({ type: "session_shutdown" });
		}

		// Close readline interface to stop waiting for input
		rl.close();
		process.exit(0);
	}

	// Listen for JSON input
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		terminal: false,
	});

	rl.on("line", async (line: string) => {
		try {
			const parsed = JSON.parse(line);

			// Handle extension UI responses
			if (parsed.type === "extension_ui_response") {
				const response = parsed as RpcExtensionUIResponse;
				const pending = pendingExtensionRequests.get(response.id);
				if (pending) {
					pendingExtensionRequests.delete(response.id);
					pending.resolve(response);
				}
				return;
			}

			// Handle regular commands
			const command = parsed as RpcCommand;
			try {
				const response = await handleCommand(command);
				output(response);
			} catch (e: unknown) {
				output(error(command.id, command.type, e instanceof Error ? e.message : String(e)));
			}

			// Check for deferred shutdown request (idle between commands)
			await checkShutdownRequested();
		} catch (e: unknown) {
			output(error(undefined, "parse", `Failed to parse command: ${e instanceof Error ? e.message : String(e)}`));
		}
	});

	// Keep process alive forever
	return new Promise(() => {});
}
