/**
 * Types for the alive subagents system.
 *
 * @module subagents/types
 */

import type { ChildProcess } from "node:child_process";
import type { Agent, AgentTool, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { ExtensionRunner } from "../extensions/runner.js";
import type { ModelRegistry } from "../model-registry.js";

// ============================================================================
// Subagent Configuration
// ============================================================================

/**
 * Source of an agent definition
 */
export type SubagentSource = "user" | "project" | "builtin";

/**
 * Memory persistence scope for subagents
 */
export type MemoryScope = "none" | "user" | "project";

/**
 * Execution mode for subagents
 */
export type SubagentMode = "in-memory" | "process";

/**
 * Status of an alive subagent
 */
export type SubagentStatus =
	| "starting" // Process/agent is being initialized
	| "idle" // Ready for input
	| "running" // Currently processing
	| "waiting-input" // Waiting for user/parent input
	| "done" // Task completed
	| "error" // Error state
	| "stopped"; // Manually stopped

/**
 * Parsed agent definition from markdown file
 */
export interface SubagentConfig {
	/** Agent name (unique identifier) */
	name: string;

	/** Description shown to LLM for delegation decisions */
	description: string;

	/** System prompt for the subagent */
	systemPrompt: string;

	/** Allowed tool names (undefined = all tools) */
	tools?: string[];

	/** Preferred model ID (e.g., "claude-haiku-4-5") */
	model?: string;

	/** Memory persistence setting */
	memory?: MemoryScope;

	/** Source of the definition */
	source: SubagentSource;

	/** File path of the definition */
	filePath: string;
}

/**
 * Options for starting a subagent
 */
export interface StartSubagentOptions {
	/** Execution mode (default: in-memory) */
	mode?: SubagentMode;

	/** Working directory (default: current cwd) */
	cwd?: string;

	/** Wait for result before returning (default: true for fork, false for alive) */
	waitForResult?: boolean;

	/** Timeout in milliseconds */
	timeout?: number;

	/** Additional context to inject */
	context?: string;

	/** Parent message ID for correlation */
	parentMessageId?: string;
}

/**
 * Message sent to/from a subagent
 */
export interface SubagentMessage {
	/** Unique message ID */
	id: string;

	/** Subagent instance ID */
	subagentId: string;

	/** Message role */
	role: "user" | "assistant" | "system" | "toolResult";

	/** Message content */
	content: string;

	/** Timestamp */
	timestamp: number;

	/** Source of the message */
	source: "parent" | "user" | "self";
}

/**
 * Token usage metrics
 */
export interface SubagentUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalCost: number;
}

/**
 * An alive subagent instance
 */
export interface AliveSubagent {
	// Identity
	/** Unique instance ID (short UUID) */
	id: string;

	/** Agent type name (e.g., "scout") */
	name: string;

	/** Full configuration */
	config: SubagentConfig;

	// Execution
	/** Execution mode */
	mode: SubagentMode;

	/** Current status */
	status: SubagentStatus;

	/** Original task string */
	task: string;

	/** Working directory */
	cwd: string;

	// State (in-memory mode)
	/** Agent instance (for in-memory mode) */
	agent?: Agent;

	/** Tool instances for this subagent */
	tools?: AgentTool[];

	/** Model configuration */
	model?: Model<Api>;

	/** Thinking level */
	thinkingLevel?: ThinkingLevel;

	// State (process mode)
	/** Child process (for process mode) */
	process?: ChildProcess;

	/** RPC client (for process mode) */
	rpcClient?: RpcClientLike;

	// Communication
	/** Pending messages to be processed */
	pendingMessages: SubagentMessage[];

	/** All message history */
	messageHistory: SubagentMessage[];

	/** Unsubscribe function for agent events */
	unsubscribe?: () => void;

	// Metrics
	/** Start timestamp */
	startTime: number;

	/** Last activity timestamp */
	lastActivity: number;

	/** Token usage */
	usage: SubagentUsage;

	/** Number of turns completed */
	turnCount: number;

	// Memory
	/** Memory content loaded */
	memoryContent?: string;

	/** Memory file path */
	memoryFile?: string;

	// Abort
	/** Abort controller for cancellation */
	abortController?: AbortController;
}

/**
 * Minimal RPC client interface for process-based subagents
 */
export interface RpcClientLike {
	call(method: string, params?: unknown): Promise<unknown>;
	on(event: string, handler: (data: unknown) => void): void;
	off(event: string, handler: (data: unknown) => void): void;
}

// ============================================================================
// Manager Types
// ============================================================================

/**
 * Tool factory for creating tool subsets
 */
export interface ToolFactory {
	createSubset(toolNames: string[]): AgentTool[];
	createAll(): AgentTool[];
}

/**
 * Configuration for SubagentManager
 */
export interface SubagentManagerConfig {
	/** Current working directory */
	cwd: string;

	/** Maximum concurrent subagents */
	maxConcurrent?: number;

	/** Default execution mode */
	defaultMode?: SubagentMode;

	/** Default timeout in milliseconds */
	defaultTimeout?: number;

	/** Enable memory persistence */
	enableMemory?: boolean;

	/** Model registry for resolving models */
	modelRegistry: ModelRegistry;

	/** Tool factory for creating tool subsets */
	toolFactory: ToolFactory;

	/** Extension runner for event emission */
	extensionRunner?: ExtensionRunner;
}

/**
 * Result from starting a subagent
 */
export interface StartSubagentResult {
	/** Subagent instance ID */
	id: string;

	/** Initial status */
	status: SubagentStatus;

	/** Whether task is complete (fork mode) */
	complete: boolean;

	/** Output (if complete) */
	output?: string;

	/** Usage (if complete) */
	usage?: SubagentUsage;
}

/**
 * Result from getting subagent output
 */
export interface SubagentOutput {
	/** Subagent ID */
	id: string;

	/** Current status */
	status: SubagentStatus;

	/** Full output text */
	output: string;

	/** Last N messages */
	recentMessages: SubagentMessage[];

	/** Usage metrics */
	usage: SubagentUsage;

	/** Turn count */
	turnCount: number;
}

/**
 * Filter for listing subagents
 */
export interface SubagentFilter {
	/** Filter by status */
	status?: SubagentStatus | SubagentStatus[];

	/** Filter by name */
	name?: string;

	/** Filter by mode */
	mode?: SubagentMode;
}

/**
 * Event from SubagentManager
 */
export type SubagentManagerEvent =
	| { type: "started"; subagent: AliveSubagent }
	| { type: "stopped"; subagentId: string; reason: "completed" | "killed" | "error" | "timeout" }
	| { type: "status"; subagentId: string; status: SubagentStatus }
	| { type: "message"; subagentId: string; message: SubagentMessage }
	| { type: "error"; subagentId: string; error: Error };

/**
 * Handler for SubagentManager events
 */
export type SubagentManagerEventHandler = (event: SubagentManagerEvent) => void;

// ============================================================================
// Discovery Types
// ============================================================================

/**
 * Result from agent discovery
 */
export interface DiscoveryResult {
	/** All discovered agents */
	agents: SubagentConfig[];

	/** User agents directory path */
	userAgentsDir: string | null;

	/** Project agents directory path */
	projectAgentsDir: string | null;

	/** Built-in agents directory path */
	builtinAgentsDir: string;
}

/**
 * Parsed frontmatter from agent markdown file
 */
export interface AgentFrontmatter {
	name: string;
	description: string;
	tools?: string;
	model?: string;
	memory?: MemoryScope;
}

// ============================================================================
// Tool Result Types
// ============================================================================

/**
 * Result from subagent_start tool
 */
export interface SubagentStartDetails {
	subagentId: string;
	name: string;
	status: SubagentStatus;
	mode: SubagentMode;
	output?: string;
	usage?: SubagentUsage;
	error?: string;
}

/**
 * Result from subagent_send tool
 */
export interface SubagentSendDetails {
	subagentId: string;
	status: SubagentStatus;
	output: string;
	error?: string;
}

/**
 * Result from subagent_list tool
 */
export interface SubagentListDetails {
	agents: Array<{
		id: string;
		name: string;
		status: SubagentStatus;
		task: string;
		turnCount: number;
		usage: SubagentUsage;
	}>;
}

// ============================================================================
// Extension Context Types
// ============================================================================

/**
 * Subagent-related methods added to ExtensionContext
 */
export interface SubagentContextActions {
	/** Get the SubagentManager */
	getSubagentManager(): SubagentManager;

	/** Get active subagent ID (if user has switched context) */
	getActiveSubagent(): string | undefined;

	/** Set active subagent for user interaction */
	setActiveSubagent(id: string | undefined): void;

	/** Send message to a subagent */
	sendToSubagent(id: string, message: string): Promise<void>;

	/** List all alive subagents */
	listSubagents(filter?: SubagentFilter): AliveSubagent[];
}

// Forward declaration - will be implemented in manager.ts
export type SubagentManager = import("./manager.js").SubagentManager;
