/**
 * Types for embedded sessions.
 */

import type { AgentTool, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Model } from "@mariozechner/pi-ai";

/**
 * Options for creating an embedded session.
 */
export interface EmbeddedSessionOptions {
	/** Display title for the overlay. Default: "Embedded Session" */
	title?: string;

	/** Override model. Default: inherit from parent */
	model?: Model<any>;

	/** Override thinking level. Default: inherit from parent */
	thinkingLevel?: ThinkingLevel;

	/** Include parent's tools. Default: true */
	inheritTools?: boolean;

	/** Additional tools for this embedded session only */
	additionalTools?: AgentTool[];

	/** Exclude specific tools from parent. E.g., ["write", "edit"] for read-only */
	excludeTools?: string[];

	/** Initial message to send automatically when session opens */
	initialMessage?: string;

	/** Include parent context (fork recent messages). Default: false */
	includeParentContext?: boolean;

	/** Number of recent parent exchanges to include. Default: 5 */
	parentContextDepth?: number;

	/**
	 * Session file path.
	 * - undefined: auto-generate in embedded/ directory
	 * - false: in-memory only (no persistence)
	 * - string: specific path
	 */
	sessionFile?: string | false;

	/** Generate summary on close. Default: true */
	generateSummary?: boolean;

	/** Overlay width. Default: "90%" */
	width?: number | `${number}%`;

	/** Overlay max height. Default: "85%" */
	maxHeight?: number | `${number}%`;
}

/**
 * Result from an embedded session.
 */
export interface EmbeddedSessionResult {
	/** Whether user cancelled (Escape) vs completed (/done) */
	cancelled: boolean;

	/** Generated summary (if generateSummary was true and not cancelled) */
	summary?: string;

	/** Embedded session ID */
	sessionId: string;

	/** Session file path (if persisted) */
	sessionFile?: string;

	/** Duration in ms */
	durationMs: number;

	/** Files read during session */
	filesRead: string[];

	/** Files modified during session */
	filesModified: string[];

	/** Message count */
	messageCount: number;

	/** Token usage */
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
}
