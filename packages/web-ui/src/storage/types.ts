import type { Model } from "@mariozechner/pi-ai";
import type { ThinkingLevel } from "../agent/agent.js";
import type { AppMessage } from "../components/Messages.js";

/**
 * Base interface for all storage backends.
 * Provides a simple key-value storage abstraction that can be implemented
 * by localStorage, IndexedDB, chrome.storage, or remote APIs.
 */
export interface StorageBackend {
	/**
	 * Get a value by key. Returns null if key doesn't exist.
	 */
	get<T = unknown>(key: string): Promise<T | null>;

	/**
	 * Set a value for a key.
	 */
	set<T = unknown>(key: string, value: T): Promise<void>;

	/**
	 * Delete a key.
	 */
	delete(key: string): Promise<void>;

	/**
	 * Get all keys.
	 */
	keys(): Promise<string[]>;

	/**
	 * Clear all data.
	 */
	clear(): Promise<void>;

	/**
	 * Check if a key exists.
	 */
	has(key: string): Promise<boolean>;
}

/**
 * Lightweight session metadata for listing and searching.
 * Stored separately from full session data for performance.
 */
export interface SessionMetadata {
	/** Unique session identifier (UUID v4) */
	id: string;

	/** User-defined title or auto-generated from first message */
	title: string;

	/** ISO 8601 UTC timestamp of creation */
	createdAt: string;

	/** ISO 8601 UTC timestamp of last modification */
	lastModified: string;

	/** Total number of messages (user + assistant + tool results) */
	messageCount: number;

	/** Cumulative usage statistics */
	usage: {
		/** Total input tokens */
		input: number;
		/** Total output tokens */
		output: number;
		/** Total cache read tokens */
		cacheRead: number;
		/** Total cache write tokens */
		cacheWrite: number;
		/** Total cost breakdown */
		cost: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite: number;
			total: number;
		};
	};

	/** Last used model ID (e.g., "claude-sonnet-4") */
	modelId: string | null;

	/** Last used thinking level */
	thinkingLevel: ThinkingLevel;

	/**
	 * Preview text for search and display.
	 * First 2KB of conversation text (user + assistant messages in sequence).
	 * Tool calls and tool results are excluded.
	 */
	preview: string;
}

/**
 * Full session data including all messages.
 * Only loaded when user opens a specific session.
 */
export interface SessionData {
	/** Unique session identifier (UUID v4) */
	id: string;

	/** User-defined title or auto-generated from first message */
	title: string;

	/** Last selected model */
	model: Model<any>;

	/** Last selected thinking level */
	thinkingLevel: ThinkingLevel;

	/** Full conversation history (with attachments inline) */
	messages: AppMessage[];

	/** ISO 8601 UTC timestamp of creation */
	createdAt: string;

	/** ISO 8601 UTC timestamp of last modification */
	lastModified: string;
}

/**
 * Backend interface for session storage.
 * Implementations: IndexedDB (browser/extension), VSCode global state, etc.
 */
export interface SessionStorageBackend {
	/**
	 * Save both session data and metadata atomically.
	 * Should use transactions to ensure consistency.
	 */
	saveSession(data: SessionData, metadata: SessionMetadata): Promise<void>;

	/**
	 * Get full session data by ID.
	 * Returns null if session doesn't exist.
	 */
	getSession(id: string): Promise<SessionData | null>;

	/**
	 * Get session metadata by ID.
	 * Returns null if session doesn't exist.
	 */
	getMetadata(id: string): Promise<SessionMetadata | null>;

	/**
	 * Get all session metadata (for listing/searching).
	 * Should be efficient - metadata is small (~2KB each).
	 */
	getAllMetadata(): Promise<SessionMetadata[]>;

	/**
	 * Delete a session (both data and metadata).
	 * Should use transactions to ensure both are deleted.
	 */
	deleteSession(id: string): Promise<void>;

	/**
	 * Update session title (in both data and metadata).
	 * Optimized operation - no need to save full session.
	 */
	updateTitle(id: string, title: string): Promise<void>;

	/**
	 * Get storage quota information.
	 * Used for warning users when approaching limits.
	 */
	getQuotaInfo(): Promise<{ usage: number; quota: number; percent: number }>;

	/**
	 * Request persistent storage (prevents eviction).
	 * Returns true if granted, false otherwise.
	 */
	requestPersistence(): Promise<boolean>;
}

/**
 * Options for configuring AppStorage.
 */
export interface AppStorageConfig {
	/** Backend for simple settings (proxy, theme, etc.) */
	settings?: StorageBackend;
	/** Backend for provider API keys */
	providerKeys?: StorageBackend;
	/** Backend for sessions (optional - can be undefined if persistence not needed) */
	sessions?: SessionStorageBackend;
}
