/**
 * Memory Blocks System - Letta-Style Structured Agent Memory
 *
 * Implements persistent, structured memory sections that agents can self-edit.
 * Superior to Letta: Local-first with automatic persistence, no API required.
 *
 * Features:
 * - Structured memory blocks (persona, human, project, custom)
 * - Self-editing tools (memory_replace, memory_insert, memory_rethink)
 * - Character limits and read-only protection
 * - Automatic persistence to filesystem
 * - Integration with Act-Learn-Reuse system
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..", "..");

// Default data directory
const DEFAULT_DATA_DIR = join(packageRoot, "data");

// ============================================================================
// Types
// ============================================================================

export interface MemoryBlock {
	label: string;
	value: string;
	description?: string;
	readOnly: boolean;
	limit: number; // Character limit
	lastUpdated: string;
}

export interface MemoryBlockConfig {
	label: string;
	description?: string;
	initialValue?: string;
	readOnly?: boolean;
	limit?: number;
}

export interface AgentMemoryState {
	agentId: string;
	blocks: Record<string, MemoryBlock>;
	createdAt: string;
	lastUpdated: string;
}

export interface MemoryEditResult {
	success: boolean;
	block: string;
	action: "replace" | "insert" | "rethink";
	oldValue?: string;
	newValue?: string;
	error?: string;
}

// ============================================================================
// Default Block Templates
// ============================================================================

export const DEFAULT_BLOCKS: MemoryBlockConfig[] = [
	{
		label: "persona",
		description: "The agent's personality, capabilities, and behavioral guidelines",
		initialValue: `You are a helpful AI assistant with expertise in coding, trading, and general tasks.
You maintain context across conversations and learn from interactions.
You are direct, accurate, and proactive in solving problems.`,
		readOnly: false,
		limit: 2000,
	},
	{
		label: "human",
		description: "Information about the user interacting with the agent",
		initialValue: `Name: Unknown
Preferences: Not yet learned
History: New user`,
		readOnly: false,
		limit: 1500,
	},
	{
		label: "project",
		description: "Current project context and objectives",
		initialValue: `No active project context.`,
		readOnly: false,
		limit: 3000,
	},
	{
		label: "skills",
		description: "Available skills and their descriptions (read-only, managed by skill system)",
		initialValue: `Skills are loaded dynamically from the skills directory.`,
		readOnly: true,
		limit: 5000,
	},
	{
		label: "scratchpad",
		description: "Temporary working memory for current task",
		initialValue: ``,
		readOnly: false,
		limit: 2000,
	},
];

// Trading-specific blocks
export const TRADING_BLOCKS: MemoryBlockConfig[] = [
	{
		label: "market_state",
		description: "Current market conditions and active positions",
		initialValue: `Market: Not analyzed
Positions: None
Signals: None pending`,
		readOnly: false,
		limit: 2000,
	},
	{
		label: "trading_rules",
		description: "Active trading rules and risk parameters",
		initialValue: `Max position size: 2% of portfolio
Stop loss: -5% to -10%
Take profit: Scale out at 1.5x, 2x, 3x
Max drawdown: 15%`,
		readOnly: false,
		limit: 1500,
	},
];

// ============================================================================
// Memory Block Manager
// ============================================================================

export class MemoryBlockManager {
	private state: AgentMemoryState;
	private dataDir: string;
	private persistPath: string;

	constructor(agentId: string, dataDir: string = DEFAULT_DATA_DIR) {
		this.dataDir = dataDir;
		this.persistPath = join(dataDir, "memory", `${agentId}.json`);

		// Load existing state or create new
		this.state = this.loadState(agentId);
	}

	/**
	 * Load state from disk or create new
	 */
	private loadState(agentId: string): AgentMemoryState {
		if (existsSync(this.persistPath)) {
			try {
				const data = readFileSync(this.persistPath, "utf-8");
				return JSON.parse(data);
			} catch {
				// Corrupted file, create new
			}
		}

		// Create new state with default blocks
		const now = new Date().toISOString();
		const state: AgentMemoryState = {
			agentId,
			blocks: {},
			createdAt: now,
			lastUpdated: now,
		};

		// Initialize default blocks
		for (const config of DEFAULT_BLOCKS) {
			state.blocks[config.label] = {
				label: config.label,
				value: config.initialValue || "",
				description: config.description,
				readOnly: config.readOnly || false,
				limit: config.limit || 2000,
				lastUpdated: now,
			};
		}

		return state;
	}

	/**
	 * Persist state to disk
	 */
	private persist(): void {
		const dir = dirname(this.persistPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		this.state.lastUpdated = new Date().toISOString();
		writeFileSync(this.persistPath, JSON.stringify(this.state, null, 2));
	}

	/**
	 * Get a memory block by label
	 */
	getBlock(label: string): MemoryBlock | null {
		return this.state.blocks[label] || null;
	}

	/**
	 * Get all memory blocks
	 */
	getAllBlocks(): Record<string, MemoryBlock> {
		return { ...this.state.blocks };
	}

	/**
	 * Get formatted context for injection into agent prompt
	 */
	getContextString(): string {
		const sections: string[] = [];

		for (const [label, block] of Object.entries(this.state.blocks)) {
			if (block.value.trim()) {
				sections.push(`## ${label.toUpperCase()}\n${block.value}`);
			}
		}

		if (sections.length === 0) {
			return "";
		}

		return `\n# AGENT MEMORY\n${sections.join("\n\n")}\n`;
	}

	/**
	 * Add a new block
	 */
	addBlock(config: MemoryBlockConfig): MemoryBlock {
		const now = new Date().toISOString();
		const block: MemoryBlock = {
			label: config.label,
			value: config.initialValue || "",
			description: config.description,
			readOnly: config.readOnly || false,
			limit: config.limit || 2000,
			lastUpdated: now,
		};

		this.state.blocks[config.label] = block;
		this.persist();

		return block;
	}

	/**
	 * Remove a block
	 */
	removeBlock(label: string): boolean {
		if (this.state.blocks[label]) {
			delete this.state.blocks[label];
			this.persist();
			return true;
		}
		return false;
	}

	// ========================================================================
	// Self-Edit Tools (Agent-callable)
	// ========================================================================

	/**
	 * Replace specific text in a memory block
	 * Tool: memory_replace
	 */
	memoryReplace(label: string, oldText: string, newText: string): MemoryEditResult {
		const block = this.state.blocks[label];

		if (!block) {
			return {
				success: false,
				block: label,
				action: "replace",
				error: `Block "${label}" not found`,
			};
		}

		if (block.readOnly) {
			return {
				success: false,
				block: label,
				action: "replace",
				error: `Block "${label}" is read-only`,
			};
		}

		if (!block.value.includes(oldText)) {
			return {
				success: false,
				block: label,
				action: "replace",
				error: `Text "${oldText.substring(0, 50)}..." not found in block`,
			};
		}

		const newValue = block.value.replace(oldText, newText);

		if (newValue.length > block.limit) {
			return {
				success: false,
				block: label,
				action: "replace",
				error: `Result exceeds limit (${newValue.length}/${block.limit} chars)`,
			};
		}

		const oldValue = block.value;
		block.value = newValue;
		block.lastUpdated = new Date().toISOString();
		this.persist();

		return {
			success: true,
			block: label,
			action: "replace",
			oldValue,
			newValue,
		};
	}

	/**
	 * Insert text at the end of a memory block
	 * Tool: memory_insert
	 */
	memoryInsert(label: string, text: string): MemoryEditResult {
		const block = this.state.blocks[label];

		if (!block) {
			return {
				success: false,
				block: label,
				action: "insert",
				error: `Block "${label}" not found`,
			};
		}

		if (block.readOnly) {
			return {
				success: false,
				block: label,
				action: "insert",
				error: `Block "${label}" is read-only`,
			};
		}

		const newValue = block.value + (block.value.endsWith("\n") ? "" : "\n") + text;

		if (newValue.length > block.limit) {
			return {
				success: false,
				block: label,
				action: "insert",
				error: `Result exceeds limit (${newValue.length}/${block.limit} chars)`,
			};
		}

		const oldValue = block.value;
		block.value = newValue;
		block.lastUpdated = new Date().toISOString();
		this.persist();

		return {
			success: true,
			block: label,
			action: "insert",
			oldValue,
			newValue,
		};
	}

	/**
	 * Completely rewrite a memory block
	 * Tool: memory_rethink
	 */
	memoryRethink(label: string, newContent: string): MemoryEditResult {
		const block = this.state.blocks[label];

		if (!block) {
			return {
				success: false,
				block: label,
				action: "rethink",
				error: `Block "${label}" not found`,
			};
		}

		if (block.readOnly) {
			return {
				success: false,
				block: label,
				action: "rethink",
				error: `Block "${label}" is read-only`,
			};
		}

		if (newContent.length > block.limit) {
			return {
				success: false,
				block: label,
				action: "rethink",
				error: `Content exceeds limit (${newContent.length}/${block.limit} chars)`,
			};
		}

		const oldValue = block.value;
		block.value = newContent;
		block.lastUpdated = new Date().toISOString();
		this.persist();

		return {
			success: true,
			block: label,
			action: "rethink",
			oldValue,
			newValue: newContent,
		};
	}

	/**
	 * Get memory statistics
	 */
	getStats(): {
		totalBlocks: number;
		totalChars: number;
		blockStats: { label: string; chars: number; limit: number; usage: string }[];
	} {
		const blockStats = Object.values(this.state.blocks).map((block) => ({
			label: block.label,
			chars: block.value.length,
			limit: block.limit,
			usage: `${Math.round((block.value.length / block.limit) * 100)}%`,
		}));

		return {
			totalBlocks: Object.keys(this.state.blocks).length,
			totalChars: blockStats.reduce((sum, b) => sum + b.chars, 0),
			blockStats,
		};
	}
}

// ============================================================================
// Agent Memory Tools (For tool registration)
// ============================================================================

export interface MemoryToolContext {
	manager: MemoryBlockManager;
}

/**
 * Create memory tools for agent registration
 */
export function createMemoryTools(manager: MemoryBlockManager) {
	return {
		memory_replace: {
			name: "memory_replace",
			description: "Replace specific text in a memory block. Use for targeted edits to existing content.",
			parameters: {
				type: "object",
				properties: {
					block: {
						type: "string",
						description: "Memory block label (persona, human, project, scratchpad, etc.)",
					},
					old_text: {
						type: "string",
						description: "Exact text to find and replace",
					},
					new_text: {
						type: "string",
						description: "Text to replace with",
					},
				},
				required: ["block", "old_text", "new_text"],
			},
			execute: async (args: { block: string; old_text: string; new_text: string }) => {
				const result = manager.memoryReplace(args.block, args.old_text, args.new_text);
				return JSON.stringify(result);
			},
		},

		memory_insert: {
			name: "memory_insert",
			description: "Add new text to the end of a memory block. Use for appending new information.",
			parameters: {
				type: "object",
				properties: {
					block: {
						type: "string",
						description: "Memory block label (persona, human, project, scratchpad, etc.)",
					},
					text: {
						type: "string",
						description: "Text to append to the block",
					},
				},
				required: ["block", "text"],
			},
			execute: async (args: { block: string; text: string }) => {
				const result = manager.memoryInsert(args.block, args.text);
				return JSON.stringify(result);
			},
		},

		memory_rethink: {
			name: "memory_rethink",
			description: "Completely rewrite a memory block. Use when the entire block needs restructuring.",
			parameters: {
				type: "object",
				properties: {
					block: {
						type: "string",
						description: "Memory block label (persona, human, project, scratchpad, etc.)",
					},
					content: {
						type: "string",
						description: "New content for the entire block",
					},
				},
				required: ["block", "content"],
			},
			execute: async (args: { block: string; content: string }) => {
				const result = manager.memoryRethink(args.block, args.content);
				return JSON.stringify(result);
			},
		},

		memory_read: {
			name: "memory_read",
			description: "Read the current content of a memory block.",
			parameters: {
				type: "object",
				properties: {
					block: {
						type: "string",
						description: "Memory block label to read",
					},
				},
				required: ["block"],
			},
			execute: async (args: { block: string }) => {
				const block = manager.getBlock(args.block);
				if (!block) {
					return JSON.stringify({ error: `Block "${args.block}" not found` });
				}
				return JSON.stringify({
					label: block.label,
					value: block.value,
					readOnly: block.readOnly,
					usage: `${block.value.length}/${block.limit} chars`,
				});
			},
		},

		memory_list: {
			name: "memory_list",
			description: "List all available memory blocks and their usage.",
			parameters: {
				type: "object",
				properties: {},
			},
			execute: async () => {
				const stats = manager.getStats();
				return JSON.stringify(stats);
			},
		},
	};
}

// ============================================================================
// Factory Functions
// ============================================================================

// Cache of memory managers by agent ID
const managers = new Map<string, MemoryBlockManager>();

/**
 * Get or create a memory manager for an agent
 */
export function getMemoryManager(agentId: string, dataDir?: string): MemoryBlockManager {
	const key = `${agentId}:${dataDir || "default"}`;

	if (!managers.has(key)) {
		managers.set(key, new MemoryBlockManager(agentId, dataDir));
	}

	return managers.get(key)!;
}

/**
 * Create a memory manager with trading blocks
 */
export function createTradingMemoryManager(agentId: string, dataDir?: string): MemoryBlockManager {
	const manager = new MemoryBlockManager(agentId, dataDir);

	// Add trading-specific blocks
	for (const config of TRADING_BLOCKS) {
		if (!manager.getBlock(config.label)) {
			manager.addBlock(config);
		}
	}

	return manager;
}

/**
 * Dispose a memory manager
 */
export function disposeMemoryManager(agentId: string, dataDir?: string): void {
	const key = `${agentId}:${dataDir || "default"}`;
	managers.delete(key);
}

export default MemoryBlockManager;
