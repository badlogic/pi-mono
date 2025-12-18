/**
 * LSP Hook for Discord Bot Agent System
 *
 * Provides Language Server Protocol integration for diagnostics feedback.
 * After file writes/edits, automatically fetches LSP diagnostics and appends
 * them to the tool result so the agent can fix errors.
 *
 * Supported Languages:
 * - TypeScript/JavaScript (typescript-language-server)
 * - Python (pyright-langserver)
 * - Go (gopls)
 * - Rust (rust-analyzer)
 * - Dart/Flutter (dart language-server)
 * - Vue (vue-language-server)
 * - Svelte (svelteserver)
 *
 * Adapted from pi-hooks lsp-hook.ts for discord-bot agent system.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "fs";
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve } from "path";
import type { AgentHookAPI, LSPConfig, LSPDiagnostic, LSPHandle, LSPServerConfig } from "./types.js";

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CONFIG: LSPConfig = {
	enabled: true,
	waitMs: 3000,
	initTimeoutMs: 30000,
	servers: ["typescript", "pyright", "gopls", "rust-analyzer", "dart"],
};

// ============================================================================
// Performance Configuration
// ============================================================================

const MAX_ACTIVE_CONNECTIONS = 3; // Limit concurrent LSP connections
const LAZY_INIT = true; // Don't pre-warm on session start

const LANGUAGE_IDS: Record<string, string> = {
	".dart": "dart",
	".ts": "typescript",
	".tsx": "typescriptreact",
	".js": "javascript",
	".jsx": "javascriptreact",
	".mjs": "javascript",
	".cjs": "javascript",
	".mts": "typescript",
	".cts": "typescript",
	".vue": "vue",
	".svelte": "svelte",
	".astro": "astro",
	".py": "python",
	".pyi": "python",
	".go": "go",
	".rs": "rust",
};

// ============================================================================
// Utilities
// ============================================================================

const SEARCH_PATHS = [
	...(process.env.PATH?.split(delimiter) || []),
	"/usr/local/bin",
	"/opt/homebrew/bin",
	`${process.env.HOME || ""}/.pub-cache/bin`,
	`${process.env.HOME || ""}/fvm/default/bin`,
	`${process.env.HOME || ""}/go/bin`,
	`${process.env.HOME || ""}/.cargo/bin`,
	`${process.env.HOME || ""}/.local/bin`,
];

function which(cmd: string): string | undefined {
	const ext = process.platform === "win32" ? ".exe" : "";
	for (const dir of SEARCH_PATHS) {
		const full = join(dir, cmd + ext);
		try {
			if (existsSync(full) && statSync(full).isFile()) return full;
		} catch {}
	}
	return undefined;
}

function findNearestFile(startDir: string, targets: string[], stopDir: string): string | undefined {
	let current = resolve(startDir);
	const stop = resolve(stopDir);

	while (current.length >= stop.length) {
		for (const target of targets) {
			const candidate = join(current, target);
			if (existsSync(candidate)) return candidate;
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return undefined;
}

function findRoot(file: string, cwd: string, markers: string[]): string | undefined {
	const found = findNearestFile(dirname(file), markers, cwd);
	return found ? dirname(found) : cwd;
}

function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms);
		promise.then(
			(result) => {
				clearTimeout(timer);
				resolve(result);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

function formatDiagnostic(d: LSPDiagnostic): string {
	const severity = ["", "ERROR", "WARN", "INFO", "HINT"][d.severity || 1];
	return `${severity} [${d.range.start.line + 1}:${d.range.start.character + 1}] ${d.message}`;
}

function simpleSpawn(binary: string, args: string[] = ["--stdio"]): (root: string) => Promise<LSPHandle | undefined> {
	return async (root) => {
		const cmd = which(binary);
		if (!cmd) return undefined;
		return {
			process: spawn(cmd, args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] }),
		};
	};
}

// ============================================================================
// LSP Server Configurations
// ============================================================================

const LSP_SERVERS: LSPServerConfig[] = [
	// Dart/Flutter
	{
		id: "dart",
		extensions: [".dart"],
		findRoot: (file, cwd) => findRoot(file, cwd, ["pubspec.yaml", "analysis_options.yaml"]),
		spawn: async (root) => {
			let dartBin = which("dart");

			const pubspecPath = join(root, "pubspec.yaml");
			if (existsSync(pubspecPath)) {
				try {
					const content = readFileSync(pubspecPath, "utf-8");
					if (content.includes("flutter:") || content.includes("sdk: flutter")) {
						const flutterBin = which("flutter");
						if (flutterBin) {
							const flutterDir = dirname(realpathSync(flutterBin));
							for (const p of ["cache/dart-sdk/bin/dart", "../cache/dart-sdk/bin/dart"]) {
								const candidate = join(flutterDir, p);
								if (existsSync(candidate)) {
									dartBin = candidate;
									break;
								}
							}
						}
					}
				} catch {}
			}

			if (!dartBin) return undefined;
			return {
				process: spawn(dartBin, ["language-server", "--protocol=lsp"], {
					cwd: root,
					stdio: ["pipe", "pipe", "pipe"],
				}),
			};
		},
	},

	// TypeScript/JavaScript
	{
		id: "typescript",
		extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
		findRoot: (file, cwd) => {
			if (findNearestFile(dirname(file), ["deno.json", "deno.jsonc"], cwd)) return undefined;
			return findRoot(file, cwd, ["package.json", "tsconfig.json", "jsconfig.json"]);
		},
		spawn: async (root) => {
			const localBin = join(root, "node_modules/.bin/typescript-language-server");
			const cmd = existsSync(localBin) ? localBin : which("typescript-language-server");
			if (!cmd) return undefined;
			return {
				process: spawn(cmd, ["--stdio"], {
					cwd: root,
					stdio: ["pipe", "pipe", "pipe"],
				}),
			};
		},
	},

	// Vue
	{
		id: "vue",
		extensions: [".vue"],
		findRoot: (file, cwd) => findRoot(file, cwd, ["package.json", "vite.config.ts", "vite.config.js"]),
		spawn: simpleSpawn("vue-language-server"),
	},

	// Svelte
	{
		id: "svelte",
		extensions: [".svelte"],
		findRoot: (file, cwd) => findRoot(file, cwd, ["package.json", "svelte.config.js"]),
		spawn: simpleSpawn("svelteserver"),
	},

	// Python
	{
		id: "pyright",
		extensions: [".py", ".pyi"],
		findRoot: (file, cwd) =>
			findRoot(file, cwd, ["pyproject.toml", "setup.py", "requirements.txt", "pyrightconfig.json"]),
		spawn: simpleSpawn("pyright-langserver"),
	},

	// Go
	{
		id: "gopls",
		extensions: [".go"],
		findRoot: (file, cwd) => {
			const workRoot = findRoot(file, cwd, ["go.work"]);
			if (workRoot !== cwd) return workRoot;
			return findRoot(file, cwd, ["go.mod"]);
		},
		spawn: simpleSpawn("gopls", []),
	},

	// Rust
	{
		id: "rust-analyzer",
		extensions: [".rs"],
		findRoot: (file, cwd) => findRoot(file, cwd, ["Cargo.toml"]),
		spawn: simpleSpawn("rust-analyzer", []),
	},
];

// ============================================================================
// LSP Client Interface
// ============================================================================

interface LSPClient {
	connection: any;
	process: ChildProcessWithoutNullStreams;
	diagnostics: Map<string, LSPDiagnostic[]>;
	openFiles: Map<string, number>;
	diagnosticsListeners: Map<string, Array<() => void>>;
}

// ============================================================================
// LSP Manager
// ============================================================================

class LSPManager {
	private clients = new Map<string, LSPClient>();
	private spawning = new Map<string, Promise<LSPClient | undefined>>();
	private broken = new Set<string>();
	private cwd: string;
	private config: LSPConfig;
	private lastUsed = new Map<string, number>(); // Track LRU for connection eviction

	constructor(cwd: string, config: LSPConfig = DEFAULT_CONFIG) {
		this.cwd = cwd;
		this.config = config;
	}

	private clientKey(serverId: string, root: string): string {
		return `${serverId}:${root}`;
	}

	/**
	 * Evict least recently used connection if at limit
	 */
	private async evictIfNeeded(): Promise<void> {
		if (this.clients.size < MAX_ACTIVE_CONNECTIONS) return;

		// Find LRU connection
		let oldestKey: string | null = null;
		let oldestTime = Infinity;

		for (const [key, time] of this.lastUsed.entries()) {
			if (time < oldestTime) {
				oldestTime = time;
				oldestKey = key;
			}
		}

		if (oldestKey) {
			const client = this.clients.get(oldestKey);
			if (client) {
				try {
					await client.connection.sendRequest("shutdown");
					await client.connection.sendNotification("exit");
					client.connection.end();
					client.process.kill();
				} catch {}
				this.clients.delete(oldestKey);
				this.lastUsed.delete(oldestKey);
			}
		}
	}

	private async initializeClient(config: LSPServerConfig, root: string): Promise<LSPClient | undefined> {
		const key = this.clientKey(config.id, root);

		try {
			const handle = await config.spawn(root);
			if (!handle) {
				this.broken.add(key);
				return undefined;
			}

			// Dynamic import for vscode-jsonrpc (optional dependency)
			let createMessageConnection: any;
			let StreamMessageReader: any;
			let StreamMessageWriter: any;

			try {
				// @ts-expect-error vscode-jsonrpc is optional
				const jsonrpc = await import("vscode-jsonrpc/node.js");
				createMessageConnection = jsonrpc.createMessageConnection;
				StreamMessageReader = jsonrpc.StreamMessageReader;
				StreamMessageWriter = jsonrpc.StreamMessageWriter;
			} catch {
				console.warn("vscode-jsonrpc not available, LSP disabled");
				this.broken.add(key);
				return undefined;
			}

			const proc = handle.process as ChildProcessWithoutNullStreams;
			const connection = createMessageConnection(
				new StreamMessageReader(proc.stdout!),
				new StreamMessageWriter(proc.stdin!),
			);

			const client: LSPClient = {
				connection,
				process: proc,
				diagnostics: new Map(),
				openFiles: new Map(),
				diagnosticsListeners: new Map(),
			};

			// Handle incoming diagnostics
			connection.onNotification("textDocument/publishDiagnostics", (params: { uri: string; diagnostics: any[] }) => {
				const filePath = decodeURIComponent(new URL(params.uri).pathname);
				client.diagnostics.set(filePath, params.diagnostics as LSPDiagnostic[]);

				const listeners = client.diagnosticsListeners.get(filePath);
				if (listeners) {
					for (const fn of listeners) {
						fn();
					}
					client.diagnosticsListeners.delete(filePath);
				}
			});

			// Handle LSP requests
			connection.onRequest("workspace/configuration", () => [handle.initializationOptions ?? {}]);
			connection.onRequest("window/workDoneProgress/create", () => null);
			connection.onRequest("client/registerCapability", () => {});
			connection.onRequest("client/unregisterCapability", () => {});
			connection.onRequest("workspace/workspaceFolders", () => [{ name: "workspace", uri: `file://${root}` }]);

			// Handle lifecycle
			proc.on("exit", () => this.clients.delete(key));
			proc.on("error", () => {
				this.clients.delete(key);
				this.broken.add(key);
			});

			connection.listen();

			// Initialize LSP protocol
			await withTimeout(
				connection.sendRequest("initialize", {
					rootUri: `file://${root}`,
					processId: process.pid,
					workspaceFolders: [{ name: "workspace", uri: `file://${root}` }],
					initializationOptions: handle.initializationOptions ?? {},
					capabilities: {
						window: { workDoneProgress: true },
						workspace: { configuration: true, workspaceFolders: true },
						textDocument: {
							synchronization: {
								didOpen: true,
								didChange: true,
								didClose: true,
							},
							publishDiagnostics: { versionSupport: true },
						},
					},
				}),
				this.config.initTimeoutMs,
				`${config.id} initialize`,
			);

			await connection.sendNotification("initialized", {});

			if (handle.initializationOptions) {
				await connection.sendNotification("workspace/didChangeConfiguration", {
					settings: handle.initializationOptions,
				});
			}

			return client;
		} catch (error) {
			console.error(`LSP ${config.id} init failed:`, error);
			this.broken.add(key);
			return undefined;
		}
	}

	async getClientsForFile(filePath: string): Promise<LSPClient[]> {
		const ext = extname(filePath);
		const absPath = isAbsolute(filePath) ? filePath : resolve(this.cwd, filePath);
		const clients: LSPClient[] = [];

		for (const config of LSP_SERVERS) {
			if (!config.extensions.includes(ext)) continue;
			if (!this.config.servers.includes(config.id)) continue;

			const root = config.findRoot(absPath, this.cwd);
			if (!root) continue;

			const key = this.clientKey(config.id, root);
			if (this.broken.has(key)) continue;

			const existing = this.clients.get(key);
			if (existing) {
				// Update LRU timestamp
				this.lastUsed.set(key, Date.now());
				clients.push(existing);
				continue;
			}

			// Evict if at connection limit before spawning new
			await this.evictIfNeeded();

			if (!this.spawning.has(key)) {
				const promise = this.initializeClient(config, root);
				this.spawning.set(key, promise);
				promise.finally(() => this.spawning.delete(key));
			}

			const client = await this.spawning.get(key);
			if (client) {
				this.clients.set(key, client);
				this.lastUsed.set(key, Date.now());
				clients.push(client);
			}
		}

		return clients;
	}

	async touchFileAndWait(filePath: string, timeoutMs: number): Promise<LSPDiagnostic[]> {
		const absPath = isAbsolute(filePath) ? filePath : resolve(this.cwd, filePath);
		const clients = await this.getClientsForFile(absPath);
		if (clients.length === 0) return [];

		const uri = `file://${absPath}`;
		const languageId = LANGUAGE_IDS[extname(filePath)] || "plaintext";

		let content: string;
		try {
			content = readFileSync(absPath, "utf-8");
		} catch {
			return [];
		}

		const waitPromises: Promise<void>[] = [];
		for (const client of clients) {
			client.diagnostics.delete(absPath);

			const promise = new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, timeoutMs);
				const listeners = client.diagnosticsListeners.get(absPath) || [];
				listeners.push(() => {
					clearTimeout(timer);
					resolve();
				});
				client.diagnosticsListeners.set(absPath, listeners);
			});
			waitPromises.push(promise);
		}

		for (const client of clients) {
			const version = client.openFiles.get(absPath);

			try {
				if (version !== undefined) {
					const newVersion = version + 1;
					client.openFiles.set(absPath, newVersion);
					await client.connection.sendNotification("textDocument/didChange", {
						textDocument: { uri, version: newVersion },
						contentChanges: [{ text: content }],
					});
				} else {
					client.openFiles.set(absPath, 0);
					await client.connection.sendNotification("textDocument/didOpen", {
						textDocument: { uri, languageId, version: 0, text: content },
					});
				}
			} catch {}
		}

		await Promise.all(waitPromises);

		const allDiagnostics: LSPDiagnostic[] = [];
		for (const client of clients) {
			const diags = client.diagnostics.get(absPath);
			if (diags) allDiagnostics.push(...diags);
		}
		return allDiagnostics;
	}

	async shutdown(): Promise<void> {
		for (const client of this.clients.values()) {
			try {
				await client.connection.sendRequest("shutdown");
				await client.connection.sendNotification("exit");
				client.connection.end();
				client.process.kill();
			} catch {}
		}
		this.clients.clear();
	}
}

// ============================================================================
// Hook Factory
// ============================================================================

/**
 * Create LSP hook for agent system
 */
export function createLSPHook(config: Partial<LSPConfig> = {}): (api: AgentHookAPI) => void {
	const finalConfig: LSPConfig = { ...DEFAULT_CONFIG, ...config };

	return (api: AgentHookAPI) => {
		let lspManager: LSPManager | null = null;

		api.on("session", async (event, ctx) => {
			if (!finalConfig.enabled) return;

			if (event.reason === "start" || event.reason === "switch") {
				lspManager = new LSPManager(ctx.cwd, finalConfig);

				// Only pre-warm if lazy init is disabled
				if (!LAZY_INIT) {
					const warmupMap: Record<string, string> = {
						"pubspec.yaml": ".dart",
						"package.json": ".ts",
						"pyproject.toml": ".py",
						"go.mod": ".go",
						"Cargo.toml": ".rs",
					};

					for (const [marker, ext] of Object.entries(warmupMap)) {
						if (existsSync(join(ctx.cwd, marker))) {
							lspManager.getClientsForFile(join(ctx.cwd, `dummy${ext}`)).catch(() => {});
							break;
						}
					}
				}
			} else if (event.reason === "clear") {
				if (lspManager) {
					await lspManager.shutdown();
					lspManager = null;
				}
			}
		});

		api.on("tool_result", async (event, ctx) => {
			if (!finalConfig.enabled || !lspManager) return undefined;

			const isWrite = event.toolName === "write";
			const isEdit = event.toolName === "edit";
			if (!isWrite && !isEdit) return undefined;

			const filePath = event.input.path as string;
			if (!filePath) return undefined;

			const ext = extname(filePath);
			if (!LSP_SERVERS.some((s) => s.extensions.includes(ext))) return undefined;

			try {
				const diagnostics = await lspManager.touchFileAndWait(filePath, finalConfig.waitMs);

				// For edits: only errors. For writes: show all
				const errors = isEdit ? diagnostics.filter((d) => d.severity === 1) : diagnostics;
				if (errors.length === 0) return undefined;

				const absPath = isAbsolute(filePath) ? filePath : resolve(ctx.cwd, filePath);
				const relativePath = relative(ctx.cwd, absPath);
				const errorCount = errors.filter((e) => e.severity === 1).length;

				// Build notification
				const MAX_DISPLAY = 5;
				const lines = errors.slice(0, MAX_DISPLAY).map((e) => {
					const sev = e.severity === 1 ? "ERROR" : "WARN";
					return `${sev}[${e.range.start.line + 1}] ${e.message.split("\n")[0]}`;
				});

				let notification = `LSP: ${relativePath}\n${lines.join("\n")}`;
				if (errors.length > MAX_DISPLAY) {
					notification += `\n... +${errors.length - MAX_DISPLAY} more`;
				}

				if (ctx.hasUI) {
					ctx.ui.notify(notification, errorCount > 0 ? "error" : "warning");
				}

				// Append diagnostics to result for LLM
				const output = `\nThis file has errors, please fix:\n<file_diagnostics>\n${errors.map(formatDiagnostic).join("\n")}\n</file_diagnostics>\n`;
				return { result: event.result + output };
			} catch (error) {
				console.error("LSP diagnostics failed:", error);
			}

			return undefined;
		});
	};
}

/**
 * Default LSP hook instance
 */
export const lspHook = createLSPHook();

// ============================================================================
// LSP Configuration Management
// ============================================================================

export interface LSPStatus {
	id: string;
	extensions: string[];
	available: boolean;
	binary: string | undefined;
	enabled: boolean;
}

// Global enabled servers state (per-session)
const enabledServers = new Map<string, Set<string>>();

/**
 * Get LSP status for all servers
 */
export function getLSPStatus(sessionId?: string): LSPStatus[] {
	const enabled = sessionId ? enabledServers.get(sessionId) : null;
	const defaultEnabled = new Set(DEFAULT_CONFIG.servers);

	return LSP_SERVERS.map((server) => {
		const binary = which(server.id === "typescript" ? "typescript-language-server" : server.id);
		return {
			id: server.id,
			extensions: server.extensions,
			available: !!binary,
			binary,
			enabled: enabled ? enabled.has(server.id) : defaultEnabled.has(server.id),
		};
	});
}

/**
 * Enable an LSP server for a session
 */
export function enableLSP(sessionId: string, serverId: string): boolean {
	const validIds = LSP_SERVERS.map((s) => s.id);
	if (!validIds.includes(serverId)) return false;

	if (!enabledServers.has(sessionId)) {
		enabledServers.set(sessionId, new Set(DEFAULT_CONFIG.servers));
	}
	enabledServers.get(sessionId)!.add(serverId);
	return true;
}

/**
 * Disable an LSP server for a session
 */
export function disableLSP(sessionId: string, serverId: string): boolean {
	if (!enabledServers.has(sessionId)) {
		enabledServers.set(sessionId, new Set(DEFAULT_CONFIG.servers));
	}
	return enabledServers.get(sessionId)!.delete(serverId);
}

/**
 * Get enabled servers for a session
 */
export function getEnabledLSP(sessionId: string): string[] {
	const enabled = enabledServers.get(sessionId);
	return enabled ? Array.from(enabled) : [...DEFAULT_CONFIG.servers];
}

/**
 * Reset LSP configuration for a session
 */
export function resetLSPConfig(sessionId: string): void {
	enabledServers.delete(sessionId);
}

/**
 * Detect project languages from files
 */
export function detectProjectLanguages(cwd: string): string[] {
	const detected: Set<string> = new Set();

	const markerToLanguage: Record<string, string> = {
		"package.json": "typescript",
		"tsconfig.json": "typescript",
		"pyproject.toml": "pyright",
		"requirements.txt": "pyright",
		"go.mod": "gopls",
		"Cargo.toml": "rust-analyzer",
		"pubspec.yaml": "dart",
	};

	for (const [marker, lang] of Object.entries(markerToLanguage)) {
		if (existsSync(join(cwd, marker))) {
			detected.add(lang);
		}
	}

	return Array.from(detected);
}

/**
 * Get language from file extension
 */
export function getLanguageFromExtension(ext: string): string | undefined {
	return LANGUAGE_IDS[ext];
}

/**
 * Check if a server is available (binary exists)
 */
export function isLSPAvailable(serverId: string): boolean {
	const binary = serverId === "typescript" ? "typescript-language-server" : serverId;
	return !!which(binary);
}

/**
 * Export utilities
 */
export const LSPUtils = {
	which,
	findRoot,
	formatDiagnostic,
	LANGUAGE_IDS,
	LSP_SERVERS: LSP_SERVERS.map((s) => ({ id: s.id, extensions: s.extensions })),
	// Configuration
	getLSPStatus,
	enableLSP,
	disableLSP,
	getEnabledLSP,
	resetLSPConfig,
	detectProjectLanguages,
	getLanguageFromExtension,
	isLSPAvailable,
};
