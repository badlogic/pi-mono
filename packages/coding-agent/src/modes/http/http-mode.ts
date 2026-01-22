/**
 * HTTP mode: Headless operation with HTTP/SSE protocol.
 *
 * Used for embedding the agent in containerized deployments without stdin/stdout shim.
 * Exposes the RPC protocol via HTTP REST API with SSE for event streaming.
 *
 * Endpoints:
 * - GET /health - Health check for container orchestration
 * - GET /events - SSE stream of all agent events
 * - POST /rpc - Execute RPC command
 * - POST /extension_ui_response - Handle extension UI responses
 * - POST /shutdown - Graceful shutdown
 */

import * as crypto from "node:crypto";
import type * as http from "node:http";
import type { AgentSession, AgentSessionEvent } from "../../core/agent-session.js";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
} from "../../core/extensions/index.js";
import { type Theme, theme } from "../interactive/theme/theme.js";
import type { RpcExtensionUIRequest, RpcExtensionUIResponse } from "../rpc/rpc-types.js";
import { createHttpServer, startHttpServer } from "./http-server.js";

export type HttpModeOptions = {
	port?: number;
	bind?: string;
};

// ============================================================================
// Extension UI Request Types
// ============================================================================

/** Pending extension UI request waiting for response */
export type PendingExtensionRequest = {
	resolve: (value: RpcExtensionUIResponse) => void;
	reject: (error: Error) => void;
};

/** Map of pending extension UI requests by ID */
export type PendingExtensionRequests = Map<string, PendingExtensionRequest>;

const DEFAULT_PORT = 19000;
const DEFAULT_BIND = "127.0.0.1";
const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

// ============================================================================
// SSE Helpers
// ============================================================================

/**
 * Write an SSE event to a response stream.
 */
function writeSseEvent(res: http.ServerResponse, eventType: string, data: unknown): void {
	res.write(`event: ${eventType}\n`);
	res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Broadcast an SSE event to all connected clients.
 */
function broadcastSseEvent(connections: Set<http.ServerResponse>, eventType: string, data: unknown): void {
	for (const res of connections) {
		try {
			writeSseEvent(res, eventType, data);
		} catch {
			// Connection may have been closed, will be cleaned up on next event
		}
	}
}

/**
 * Determine the SSE event type for an agent session event.
 * All session events are `agent_event`. Extension UI requests are emitted
 * separately with their own `extension_ui_request` type.
 */
function getSseEventType(_event: AgentSessionEvent): string {
	return "agent_event";
}

// ============================================================================
// Extension UI Context
// ============================================================================

/**
 * Helper for dialog methods with signal/timeout support.
 * Creates a promise that:
 * - Emits the UI request via SSE
 * - Tracks the request in pendingExtensionRequests
 * - Resolves when the response arrives via POST /extension_ui_response
 */
function createDialogPromise<T>(
	sseConnections: Set<http.ServerResponse>,
	pendingExtensionRequests: PendingExtensionRequests,
	opts: ExtensionUIDialogOptions | undefined,
	defaultValue: T,
	request: Record<string, unknown>,
	parseResponse: (response: RpcExtensionUIResponse) => T,
): Promise<T> {
	if (opts?.signal?.aborted) return Promise.resolve(defaultValue);

	const id = crypto.randomUUID();
	return new Promise((resolve, _reject) => {
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
			reject: (error: Error) => {
				cleanup();
				// On error, resolve with default value instead of rejecting
				console.error(`Extension UI request ${id} failed: ${error.message}`);
				resolve(defaultValue);
			},
		});

		// Emit extension UI request via SSE
		const uiRequest = { type: "extension_ui_request", id, ...request } as RpcExtensionUIRequest;
		broadcastSseEvent(sseConnections, "extension_ui_request", uiRequest);
	});
}

/**
 * Create an extension UI context that uses HTTP/SSE.
 * UI requests are emitted via SSE, responses come via POST /extension_ui_response.
 */
function createExtensionUIContext(
	sseConnections: Set<http.ServerResponse>,
	pendingExtensionRequests: PendingExtensionRequests,
): ExtensionUIContext {
	return {
		select: (title, options, opts) =>
			createDialogPromise(
				sseConnections,
				pendingExtensionRequests,
				opts,
				undefined,
				{ method: "select", title, options, timeout: opts?.timeout },
				(r) => ("cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined),
			),

		confirm: (title, message, opts) =>
			createDialogPromise(
				sseConnections,
				pendingExtensionRequests,
				opts,
				false,
				{ method: "confirm", title, message, timeout: opts?.timeout },
				(r) => ("cancelled" in r && r.cancelled ? false : "confirmed" in r ? r.confirmed : false),
			),

		input: (title, placeholder, opts) =>
			createDialogPromise(
				sseConnections,
				pendingExtensionRequests,
				opts,
				undefined,
				{ method: "input", title, placeholder, timeout: opts?.timeout },
				(r) => ("cancelled" in r && r.cancelled ? undefined : "value" in r ? r.value : undefined),
			),

		notify(message: string, type?: "info" | "warning" | "error"): void {
			// Fire and forget - no response needed
			const uiRequest: RpcExtensionUIRequest = {
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "notify",
				message,
				notifyType: type,
			};
			broadcastSseEvent(sseConnections, "extension_ui_request", uiRequest);
		},

		setStatus(key: string, text: string | undefined): void {
			// Fire and forget - no response needed
			const uiRequest: RpcExtensionUIRequest = {
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setStatus",
				statusKey: key,
				statusText: text,
			};
			broadcastSseEvent(sseConnections, "extension_ui_request", uiRequest);
		},

		setWorkingMessage(_message?: string): void {
			// Working message not supported in HTTP mode - requires TUI loader access
		},

		setWidget(key: string, content: unknown, options?: ExtensionWidgetOptions): void {
			// Only support string arrays in HTTP mode - factory functions are ignored
			if (content === undefined || Array.isArray(content)) {
				const uiRequest: RpcExtensionUIRequest = {
					type: "extension_ui_request",
					id: crypto.randomUUID(),
					method: "setWidget",
					widgetKey: key,
					widgetLines: content as string[] | undefined,
					widgetPlacement: options?.placement,
				};
				broadcastSseEvent(sseConnections, "extension_ui_request", uiRequest);
			}
			// Component factories are not supported in HTTP mode - would need TUI access
		},

		setFooter(_factory: unknown): void {
			// Custom footer not supported in HTTP mode - requires TUI access
		},

		setHeader(_factory: unknown): void {
			// Custom header not supported in HTTP mode - requires TUI access
		},

		setTitle(title: string): void {
			// Fire and forget - host can implement terminal title control
			const uiRequest: RpcExtensionUIRequest = {
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "setTitle",
				title,
			};
			broadcastSseEvent(sseConnections, "extension_ui_request", uiRequest);
		},

		async custom() {
			// Custom UI not supported in HTTP mode
			return undefined as never;
		},

		setEditorText(text: string): void {
			// Fire and forget - host can implement editor control
			const uiRequest: RpcExtensionUIRequest = {
				type: "extension_ui_request",
				id: crypto.randomUUID(),
				method: "set_editor_text",
				text,
			};
			broadcastSseEvent(sseConnections, "extension_ui_request", uiRequest);
		},

		getEditorText(): string {
			// Synchronous method can't wait for HTTP response
			// Host should track editor state locally if needed
			return "";
		},

		async editor(title: string, prefill?: string): Promise<string | undefined> {
			const id = crypto.randomUUID();
			return new Promise((resolve, reject) => {
				pendingExtensionRequests.set(id, {
					resolve: (response: RpcExtensionUIResponse) => {
						pendingExtensionRequests.delete(id);
						if ("cancelled" in response && response.cancelled) {
							resolve(undefined);
						} else if ("value" in response) {
							resolve(response.value);
						} else {
							resolve(undefined);
						}
					},
					reject: (error: Error) => {
						pendingExtensionRequests.delete(id);
						reject(error);
					},
				});
				const uiRequest: RpcExtensionUIRequest = {
					type: "extension_ui_request",
					id,
					method: "editor",
					title,
					prefill,
				};
				broadcastSseEvent(sseConnections, "extension_ui_request", uiRequest);
			});
		},

		setEditorComponent(): void {
			// Custom editor components not supported in HTTP mode
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
			// Theme switching not supported in HTTP mode
			return { success: false, error: "Theme switching not supported in HTTP mode" };
		},
	};
}

/**
 * Run in HTTP mode.
 * Starts an HTTP server that exposes the RPC protocol via HTTP/SSE.
 */
export async function runHttpMode(session: AgentSession, options: HttpModeOptions = {}): Promise<never> {
	const port = options.port ?? DEFAULT_PORT;
	const bind = options.bind ?? DEFAULT_BIND;

	// Track SSE connections for event broadcasting
	const sseConnections = new Set<http.ServerResponse>();

	// Track pending extension UI requests
	const pendingExtensionRequests: PendingExtensionRequests = new Map();

	// Track shutdown state
	let shutdownInitiated = false;

	// Heartbeat timer reference
	let heartbeatTimer: NodeJS.Timeout | undefined;

	// Session event unsubscribe function
	let unsubscribeSession: (() => void) | undefined;

	// Get extension runner
	const extensionRunner = session.extensionRunner;

	// Shutdown handler
	const handleShutdown = async () => {
		if (shutdownInitiated) return;
		shutdownInitiated = true;

		console.log("HTTP mode: shutting down...");

		// Stop heartbeat timer
		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = undefined;
		}

		// Unsubscribe from session events
		if (unsubscribeSession) {
			unsubscribeSession();
			unsubscribeSession = undefined;
		}

		// Close all SSE connections
		for (const res of sseConnections) {
			try {
				res.end();
			} catch {
				// Ignore errors during shutdown
			}
		}
		sseConnections.clear();

		// Emit session_shutdown event to extensions
		if (extensionRunner?.hasHandlers("session_shutdown")) {
			await extensionRunner.emit({ type: "session_shutdown" });
		}

		// Reject any pending extension UI requests
		for (const [id, pending] of pendingExtensionRequests) {
			pending.reject(new Error("Server shutting down"));
			pendingExtensionRequests.delete(id);
		}

		// Close HTTP server
		await serverHandle.close();

		process.exit(0);
	};

	// Create HTTP server
	const serverHandle = createHttpServer({
		port,
		bind,
		session,
		onShutdown: handleShutdown,
		sseConnections,
		pendingExtensionRequests,
	});

	// Handle server-level errors
	serverHandle.server.on("error", (err) => {
		console.error(`HTTP server error: ${err.message}`);
		process.exit(1);
	});

	// Subscribe to session events and broadcast via SSE
	unsubscribeSession = session.subscribe((event: AgentSessionEvent) => {
		const eventType = getSseEventType(event);
		broadcastSseEvent(sseConnections, eventType, event);
	});

	// Start heartbeat timer
	heartbeatTimer = setInterval(() => {
		broadcastSseEvent(sseConnections, "heartbeat", { timestamp: Date.now() });
	}, HEARTBEAT_INTERVAL_MS);

	// Set up extensions with HTTP-based UI context
	if (extensionRunner) {
		extensionRunner.initialize(
			// ExtensionActions
			{
				sendMessage: (message, messageOptions) => {
					session.sendCustomMessage(message, messageOptions).catch((e) => {
						console.error(`Extension sendMessage error: ${e.message}`);
					});
				},
				sendUserMessage: (content, messageOptions) => {
					session.sendUserMessage(content, messageOptions).catch((e) => {
						console.error(`Extension sendUserMessage error: ${e.message}`);
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
				setLabel: (entryId, label) => {
					session.sessionManager.appendLabelChange(entryId, label);
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
				getModel: () => session.agent.state.model,
				isIdle: () => !session.isStreaming,
				abort: () => session.abort(),
				hasPendingMessages: () => session.pendingMessageCount > 0,
				shutdown: () => {
					// Defer shutdown to allow current processing to complete
					setImmediate(() => {
						handleShutdown();
					});
				},
				getContextUsage: () => session.getContextUsage(),
				compact: (compactOptions) => {
					void (async () => {
						try {
							const result = await session.compact(compactOptions?.customInstructions);
							compactOptions?.onComplete?.(result);
						} catch (error) {
							const err = error instanceof Error ? error : new Error(String(error));
							compactOptions?.onError?.(err);
						}
					})();
				},
			},
			// ExtensionCommandContextActions - commands invokable via prompt("/command")
			{
				waitForIdle: () => session.agent.waitForIdle(),
				newSession: async (newSessionOptions) => {
					const success = await session.newSession({ parentSession: newSessionOptions?.parentSession });
					if (success && newSessionOptions?.setup) {
						await newSessionOptions.setup(session.sessionManager);
					}
					return { cancelled: !success };
				},
				fork: async (entryId) => {
					const result = await session.fork(entryId);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, navOptions) => {
					const result = await session.navigateTree(targetId, {
						summarize: navOptions?.summarize,
						customInstructions: navOptions?.customInstructions,
						replaceInstructions: navOptions?.replaceInstructions,
						label: navOptions?.label,
					});
					return { cancelled: result.cancelled };
				},
			},
			createExtensionUIContext(sseConnections, pendingExtensionRequests),
		);

		// Emit extension errors via SSE
		extensionRunner.onError((err) => {
			broadcastSseEvent(sseConnections, "extension_error", {
				type: "extension_error",
				extensionPath: err.extensionPath,
				event: err.event,
				error: err.error,
			});
		});

		// Emit session_start event
		await extensionRunner.emit({
			type: "session_start",
		});
	}

	// Start listening
	await startHttpServer(serverHandle, port, bind);
	console.log(`HTTP mode: listening on http://${bind}:${port}`);

	// Handle graceful shutdown signals
	process.on("SIGTERM", handleShutdown);
	process.on("SIGINT", handleShutdown);

	// Keep process alive forever
	return new Promise(() => {});
}
