/**
 * Dynamic Hook Extension Loader
 *
 * Provides runtime loading, hot-reload, and lifecycle management for hook extensions.
 * Enables users to add custom hooks without modifying core code.
 *
 * Features:
 * - Load hooks from extensions directory
 * - Hot-reload hooks without restart
 * - Custom lifecycle events (loaded, unloaded, reloaded, error)
 * - Hook validation and error isolation
 */

import { EventEmitter } from "events";
import { existsSync, readdirSync, statSync, watch, type FSWatcher } from "fs";
import { dirname, join, resolve } from "path";
import { pathToFileURL } from "url";
import { fileURLToPath } from "url";
import type { AgentHookFactory, HookRegistration } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Types
// ============================================================================

export interface ExtensionMetadata {
	id: string;
	name: string;
	description?: string;
	version?: string;
	author?: string;
	enabled?: boolean;
}

export interface LoadedExtension {
	metadata: ExtensionMetadata;
	registration: HookRegistration;
	filePath: string;
	loadedAt: number;
	reloadCount: number;
}

export type ExtensionEvent =
	| { type: "loaded"; extension: LoadedExtension }
	| { type: "unloaded"; extensionId: string }
	| { type: "reloaded"; extension: LoadedExtension }
	| { type: "error"; extensionId: string; error: Error }
	| { type: "discovered"; files: string[] };

export interface ExtensionLoaderConfig {
	/** Directory to scan for extensions */
	extensionsDir: string;
	/** Whether to watch for file changes */
	watchForChanges: boolean;
	/** File patterns to include (default: *.hook.ts, *.hook.js) */
	patterns: string[];
	/** Auto-enable loaded extensions */
	autoEnable: boolean;
}

// ============================================================================
// Extension Loader
// ============================================================================

export class ExtensionLoader extends EventEmitter {
	private config: ExtensionLoaderConfig;
	private extensions: Map<string, LoadedExtension> = new Map();
	private watcher: FSWatcher | null = null;
	private moduleCache: Map<string, number> = new Map(); // file -> mtime

	constructor(config: Partial<ExtensionLoaderConfig> = {}) {
		super();
		this.config = {
			extensionsDir: join(__dirname, "extensions"),
			watchForChanges: false,
			patterns: ["*.hook.ts", "*.hook.js", "*.hook.mjs"],
			autoEnable: true,
			...config,
		};
	}

	/**
	 * Discover and load all extensions from directory
	 */
	async loadAll(): Promise<LoadedExtension[]> {
		const loaded: LoadedExtension[] = [];

		if (!existsSync(this.config.extensionsDir)) {
			return loaded;
		}

		const files = this.discoverExtensionFiles();
		this.emit("event", { type: "discovered", files } as ExtensionEvent);

		for (const file of files) {
			try {
				const ext = await this.loadExtension(file);
				if (ext) {
					loaded.push(ext);
				}
			} catch (error) {
				const extensionId = this.fileToId(file);
				this.emit("event", {
					type: "error",
					extensionId,
					error: error instanceof Error ? error : new Error(String(error)),
				} as ExtensionEvent);
			}
		}

		if (this.config.watchForChanges) {
			this.startWatching();
		}

		return loaded;
	}

	/**
	 * Load a single extension from file
	 */
	async loadExtension(filePath: string): Promise<LoadedExtension | null> {
		const absolutePath = resolve(filePath);

		if (!existsSync(absolutePath)) {
			throw new Error(`Extension file not found: ${absolutePath}`);
		}

		const extensionId = this.fileToId(absolutePath);

		// Check if already loaded
		if (this.extensions.has(extensionId)) {
			return this.extensions.get(extensionId)!;
		}

		// Import the module (ESM dynamic import)
		const fileUrl = pathToFileURL(absolutePath).href;
		const module = await import(`${fileUrl}?t=${Date.now()}`);

		// Validate module structure
		if (!module.default && !module.hook && !module.factory) {
			throw new Error(`Extension ${extensionId} must export 'default', 'hook', or 'factory'`);
		}

		const factory: AgentHookFactory = module.default || module.hook || module.factory;
		const metadata: ExtensionMetadata = {
			id: extensionId,
			name: module.name || extensionId,
			description: module.description,
			version: module.version,
			author: module.author,
			enabled: this.config.autoEnable,
			...module.metadata,
		};

		const registration: HookRegistration = {
			id: metadata.id,
			name: metadata.name,
			description: metadata.description,
			factory,
			enabled: metadata.enabled ?? this.config.autoEnable,
		};

		const extension: LoadedExtension = {
			metadata,
			registration,
			filePath: absolutePath,
			loadedAt: Date.now(),
			reloadCount: 0,
		};

		this.extensions.set(extensionId, extension);
		this.moduleCache.set(absolutePath, statSync(absolutePath).mtimeMs);

		this.emit("event", { type: "loaded", extension } as ExtensionEvent);

		return extension;
	}

	/**
	 * Unload an extension
	 */
	unloadExtension(extensionId: string): boolean {
		const extension = this.extensions.get(extensionId);
		if (!extension) {
			return false;
		}

		this.extensions.delete(extensionId);
		this.moduleCache.delete(extension.filePath);

		this.emit("event", { type: "unloaded", extensionId } as ExtensionEvent);

		return true;
	}

	/**
	 * Reload an extension (hot-reload)
	 */
	async reloadExtension(extensionId: string): Promise<LoadedExtension | null> {
		const existing = this.extensions.get(extensionId);
		if (!existing) {
			return null;
		}

		const filePath = existing.filePath;
		const reloadCount = existing.reloadCount + 1;

		// Unload first
		this.extensions.delete(extensionId);

		try {
			// Re-import with cache busting
			const fileUrl = pathToFileURL(filePath).href;
			const module = await import(`${fileUrl}?t=${Date.now()}`);

			const factory: AgentHookFactory = module.default || module.hook || module.factory;
			const metadata: ExtensionMetadata = {
				id: extensionId,
				name: module.name || extensionId,
				description: module.description,
				version: module.version,
				author: module.author,
				enabled: existing.metadata.enabled,
				...module.metadata,
			};

			const registration: HookRegistration = {
				id: metadata.id,
				name: metadata.name,
				description: metadata.description,
				factory,
				enabled: metadata.enabled ?? true,
			};

			const extension: LoadedExtension = {
				metadata,
				registration,
				filePath,
				loadedAt: Date.now(),
				reloadCount,
			};

			this.extensions.set(extensionId, extension);
			this.moduleCache.set(filePath, statSync(filePath).mtimeMs);

			this.emit("event", { type: "reloaded", extension } as ExtensionEvent);

			return extension;
		} catch (error) {
			this.emit("event", {
				type: "error",
				extensionId,
				error: error instanceof Error ? error : new Error(String(error)),
			} as ExtensionEvent);
			return null;
		}
	}

	/**
	 * Get all loaded extensions
	 */
	getExtensions(): LoadedExtension[] {
		return Array.from(this.extensions.values());
	}

	/**
	 * Get hook registrations for use with AgentHookManager
	 */
	getRegistrations(): HookRegistration[] {
		return this.getExtensions().map((ext) => ext.registration);
	}

	/**
	 * Get a specific extension
	 */
	getExtension(extensionId: string): LoadedExtension | undefined {
		return this.extensions.get(extensionId);
	}

	/**
	 * Enable/disable an extension
	 */
	setEnabled(extensionId: string, enabled: boolean): boolean {
		const extension = this.extensions.get(extensionId);
		if (!extension) {
			return false;
		}

		extension.metadata.enabled = enabled;
		extension.registration.enabled = enabled;
		return true;
	}

	/**
	 * Start watching for file changes
	 */
	startWatching(): void {
		if (this.watcher) {
			return;
		}

		if (!existsSync(this.config.extensionsDir)) {
			return;
		}

		this.watcher = watch(this.config.extensionsDir, { recursive: true }, async (eventType, filename) => {
			if (!filename || !this.matchesPattern(filename)) {
				return;
			}

			const filePath = join(this.config.extensionsDir, filename);
			const extensionId = this.fileToId(filePath);

			if (eventType === "rename") {
				// File added or removed
				if (existsSync(filePath)) {
					await this.loadExtension(filePath);
				} else {
					this.unloadExtension(extensionId);
				}
			} else if (eventType === "change") {
				// File modified - hot reload
				const currentMtime = existsSync(filePath) ? statSync(filePath).mtimeMs : 0;
				const cachedMtime = this.moduleCache.get(filePath) || 0;

				if (currentMtime > cachedMtime) {
					await this.reloadExtension(extensionId);
				}
			}
		});
	}

	/**
	 * Stop watching for file changes
	 */
	stopWatching(): void {
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}
	}

	/**
	 * Cleanup and dispose
	 */
	dispose(): void {
		this.stopWatching();
		this.extensions.clear();
		this.moduleCache.clear();
		this.removeAllListeners();
	}

	// ============================================================================
	// Private Helpers
	// ============================================================================

	private discoverExtensionFiles(): string[] {
		const files: string[] = [];

		const scanDir = (dir: string) => {
			const entries = readdirSync(dir);
			for (const entry of entries) {
				const fullPath = join(dir, entry);
				const stat = statSync(fullPath);

				if (stat.isDirectory()) {
					scanDir(fullPath);
				} else if (this.matchesPattern(entry)) {
					files.push(fullPath);
				}
			}
		};

		scanDir(this.config.extensionsDir);
		return files;
	}

	private matchesPattern(filename: string): boolean {
		return this.config.patterns.some((pattern) => {
			const regex = new RegExp(pattern.replace(/\*/g, ".*").replace(/\./g, "\\."));
			return regex.test(filename);
		});
	}

	private fileToId(filePath: string): string {
		const relative = filePath.replace(this.config.extensionsDir, "").replace(/^[/\\]/, "");
		return relative
			.replace(/\.(hook\.)?(ts|js|mjs)$/, "")
			.replace(/[/\\]/g, "-")
			.toLowerCase();
	}
}

// ============================================================================
// Convenience Functions
// ============================================================================

let defaultLoader: ExtensionLoader | null = null;

/**
 * Get or create the default extension loader
 */
export function getExtensionLoader(config?: Partial<ExtensionLoaderConfig>): ExtensionLoader {
	if (!defaultLoader) {
		defaultLoader = new ExtensionLoader(config);
	}
	return defaultLoader;
}

/**
 * Load all extensions from default directory
 */
export async function loadAllExtensions(config?: Partial<ExtensionLoaderConfig>): Promise<LoadedExtension[]> {
	const loader = getExtensionLoader(config);
	return loader.loadAll();
}

/**
 * Create extensions directory if it doesn't exist
 */
export function ensureExtensionsDir(dir?: string): string {
	const extensionsDir = dir || join(__dirname, "extensions");
	if (!existsSync(extensionsDir)) {
		const { mkdirSync } = require("fs");
		mkdirSync(extensionsDir, { recursive: true });
	}
	return extensionsDir;
}

/**
 * Subscribe to extension events
 */
export function onExtensionEvent(handler: (event: ExtensionEvent) => void): () => void {
	const loader = getExtensionLoader();
	loader.on("event", handler);
	return () => loader.off("event", handler);
}
