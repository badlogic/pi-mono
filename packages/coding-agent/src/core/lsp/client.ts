/**
 * LSP JSON-RPC client over stdio.
 *
 * Handles the full LSP lifecycle: initialize, open/change documents,
 * collect diagnostics via textDocument/publishDiagnostics notifications.
 */

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { LspDiagnostic, LspServerDefinition } from "./servers.js";

// ============================================================================
// JSON-RPC Types
// ============================================================================

interface JsonRpcMessage {
	jsonrpc: "2.0";
}

interface JsonRpcRequest extends JsonRpcMessage {
	id: number;
	method: string;
	params?: unknown;
}

interface JsonRpcNotification extends JsonRpcMessage {
	method: string;
	params?: unknown;
}

interface JsonRpcResponse extends JsonRpcMessage {
	id: number;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

// ============================================================================
// LSP Protocol Types (minimal subset)
// ============================================================================

interface PublishDiagnosticsParams {
	uri: string;
	diagnostics: LspDiagnostic[];
}

// ============================================================================
// LSP Client
// ============================================================================

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (reason: Error) => void;
};

export type DiagnosticsListener = (uri: string, diagnostics: LspDiagnostic[]) => void;

export class LspClient extends EventEmitter {
	private process: ChildProcess | undefined;
	private nextId = 1;
	private pending = new Map<number, PendingRequest>();
	private buffer = "";
	private contentLength = -1;
	private initialized = false;
	private _disposed = false;
	private diagnosticsListeners: DiagnosticsListener[] = [];
	readonly definition: LspServerDefinition;

	constructor(definition: LspServerDefinition) {
		super();
		this.definition = definition;
	}

	get disposed(): boolean {
		return this._disposed;
	}

	/**
	 * Spawn the LSP server process and perform the initialize handshake.
	 */
	async start(rootUri: string, cwd: string): Promise<void> {
		if (this._disposed) throw new Error("Client is disposed");

		const command = this.definition.command[0];
		const args = this.definition.command.slice(1);

		this.process = spawn(command, args, {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, ...this.definition.env },
		});

		this.process.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
		this.process.stderr?.on("data", (_chunk: Buffer) => {});

		this.process.on("exit", (code) => {
			this._disposed = true;
			this.rejectAllPending(new Error(`LSP server exited with code ${code}`));
			this.emit("exit", code);
		});

		this.process.on("error", (err) => {
			this._disposed = true;
			this.rejectAllPending(err);
			this.emit("error", err);
		});

		// LSP initialize
		await this.request("initialize", {
			processId: process.pid,
			rootUri,
			capabilities: {
				textDocument: {
					publishDiagnostics: {
						relatedInformation: false,
					},
					synchronization: {
						didSave: true,
						didOpen: true,
						didClose: true,
						didChange: true,
					},
				},
			},
		});

		this.notify("initialized", {});
		this.initialized = true;
	}

	/**
	 * Register a listener for diagnostics notifications.
	 */
	onDiagnostics(listener: DiagnosticsListener): () => void {
		this.diagnosticsListeners.push(listener);
		return () => {
			const idx = this.diagnosticsListeners.indexOf(listener);
			if (idx !== -1) this.diagnosticsListeners.splice(idx, 1);
		};
	}

	/**
	 * Send didOpen notification for a file.
	 */
	didOpen(uri: string, languageId: string, version: number, text: string): void {
		this.notify("textDocument/didOpen", {
			textDocument: { uri, languageId, version, text },
		});
	}

	/**
	 * Send didChange notification with full content sync.
	 */
	didChange(uri: string, version: number, text: string): void {
		this.notify("textDocument/didChange", {
			textDocument: { uri, version },
			contentChanges: [{ text }],
		});
	}

	/**
	 * Send didSave notification.
	 */
	didSave(uri: string, text: string): void {
		this.notify("textDocument/didSave", {
			textDocument: { uri },
			text,
		});
	}

	/**
	 * Send didClose notification.
	 */
	didClose(uri: string): void {
		this.notify("textDocument/didClose", {
			textDocument: { uri },
		});
	}

	/**
	 * Touch a file and optionally wait for diagnostics to arrive.
	 * This is the core "blocking sync" mechanism from the PRD.
	 *
	 * Opens or re-syncs a file, then waits for the LSP to publish
	 * diagnostics for that URI (or times out).
	 */
	async touchFile(
		uri: string,
		languageId: string,
		text: string,
		waitForDiagnostics: boolean,
		timeoutMs = 10_000,
	): Promise<LspDiagnostic[]> {
		if (!this.initialized || this._disposed) return [];

		const version = Date.now();

		return new Promise<LspDiagnostic[]>((resolve) => {
			if (!waitForDiagnostics) {
				this.didOpen(uri, languageId, version, text);
				resolve([]);
				return;
			}

			let timer: ReturnType<typeof setTimeout> | undefined;
			let unsubscribe: (() => void) | undefined;

			const finish = (diagnostics: LspDiagnostic[]) => {
				if (timer) clearTimeout(timer);
				if (unsubscribe) unsubscribe();
				resolve(diagnostics);
			};

			unsubscribe = this.onDiagnostics((diagUri, diagnostics) => {
				if (diagUri === uri) {
					finish(diagnostics);
				}
			});

			timer = setTimeout(() => {
				finish([]);
			}, timeoutMs);

			// Open with fresh content
			this.didOpen(uri, languageId, version, text);
			this.didChange(uri, version + 1, text);
			this.didSave(uri, text);
		});
	}

	/**
	 * Gracefully shutdown and exit the LSP server.
	 */
	async dispose(): Promise<void> {
		if (this._disposed) return;
		this._disposed = true;

		try {
			if (this.initialized) {
				await this.request("shutdown", null);
				this.notify("exit", null);
			}
		} catch {
			// Ignore errors during shutdown
		}

		this.process?.kill("SIGTERM");

		// Force kill after 2 seconds
		setTimeout(() => {
			this.process?.kill("SIGKILL");
		}, 2000);
	}

	// ========================================================================
	// Private: JSON-RPC transport
	// ========================================================================

	private request(method: string, params: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (this._disposed) {
				reject(new Error("Client is disposed"));
				return;
			}

			const id = this.nextId++;
			this.pending.set(id, { resolve, reject });
			this.send({ jsonrpc: "2.0", id, method, params } satisfies JsonRpcRequest);
		});
	}

	private notify(method: string, params: unknown): void {
		if (this._disposed) return;
		this.send({ jsonrpc: "2.0", method, params } satisfies JsonRpcNotification);
	}

	private send(message: JsonRpcRequest | JsonRpcNotification): void {
		const json = JSON.stringify(message);
		const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
		this.process?.stdin?.write(header + json);
	}

	private onData(chunk: Buffer): void {
		this.buffer += chunk.toString("utf-8");
		this.processBuffer();
	}

	private processBuffer(): void {
		while (true) {
			if (this.contentLength === -1) {
				const headerEnd = this.buffer.indexOf("\r\n\r\n");
				if (headerEnd === -1) return;

				const header = this.buffer.substring(0, headerEnd);
				const match = header.match(/Content-Length:\s*(\d+)/i);
				if (!match) {
					// Malformed header, skip it
					this.buffer = this.buffer.substring(headerEnd + 4);
					continue;
				}
				this.contentLength = parseInt(match[1], 10);
				this.buffer = this.buffer.substring(headerEnd + 4);
			}

			if (this.buffer.length < this.contentLength) return;

			const body = this.buffer.substring(0, this.contentLength);
			this.buffer = this.buffer.substring(this.contentLength);
			this.contentLength = -1;

			try {
				const message = JSON.parse(body) as JsonRpcResponse | JsonRpcNotification;
				this.handleMessage(message);
			} catch {
				// Malformed JSON, skip
			}
		}
	}

	private handleMessage(message: JsonRpcResponse | JsonRpcNotification): void {
		// Response to a request
		if ("id" in message && typeof message.id === "number") {
			const pending = this.pending.get(message.id);
			if (pending) {
				this.pending.delete(message.id);
				if (message.error) {
					pending.reject(new Error(`LSP error: ${message.error.message}`));
				} else {
					pending.resolve(message.result);
				}
			}
			return;
		}

		// Notification
		if ("method" in message) {
			if (message.method === "textDocument/publishDiagnostics") {
				const params = message.params as PublishDiagnosticsParams;
				for (const listener of this.diagnosticsListeners) {
					listener(params.uri, params.diagnostics);
				}
			}
		}
	}

	private rejectAllPending(error: Error): void {
		for (const pending of this.pending.values()) {
			pending.reject(error);
		}
		this.pending.clear();
	}
}
