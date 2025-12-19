/**
 * Shared Memory Blocks - Multi-Agent Collaborative Memory
 *
 * Enables multiple agents to read/write the same memory blocks.
 * Superior to Letta: Real-time sync with conflict resolution.
 *
 * Features:
 * - Shared blocks accessible by multiple agents
 * - Read/write permissions per agent
 * - Optimistic locking for concurrent writes
 * - Change notifications via EventEmitter
 * - Automatic persistence
 */

import { EventEmitter } from "events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..", "..");

const DEFAULT_DATA_DIR = join(packageRoot, "data");

// ============================================================================
// Types
// ============================================================================

export interface SharedBlock {
	id: string;
	label: string;
	value: string;
	description?: string;
	limit: number;
	version: number;
	createdBy: string;
	createdAt: string;
	lastUpdatedBy: string;
	lastUpdatedAt: string;
	permissions: SharedBlockPermissions;
}

export interface SharedBlockPermissions {
	readers: string[]; // Agent IDs with read access ("*" for all)
	writers: string[]; // Agent IDs with write access ("*" for all)
	owner: string; // Agent ID that owns the block
}

export interface SharedBlockUpdate {
	success: boolean;
	block?: SharedBlock;
	error?: string;
	conflict?: boolean;
}

export interface SharedBlockSubscription {
	blockId: string;
	agentId: string;
	callback: (block: SharedBlock, change: "update" | "delete") => void;
}

// ============================================================================
// Shared Block Manager
// ============================================================================

export class SharedBlockManager extends EventEmitter {
	private blocks: Map<string, SharedBlock> = new Map();
	private subscriptions: Map<string, SharedBlockSubscription[]> = new Map();
	private dataDir: string;

	constructor(dataDir: string = DEFAULT_DATA_DIR) {
		super();
		this.dataDir = dataDir;
		this.loadState();
	}

	/**
	 * Generate unique block ID
	 */
	private generateBlockId(): string {
		return `shared_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
	}

	/**
	 * Load persisted state
	 */
	private loadState(): void {
		const statePath = join(this.dataDir, "shared_blocks.json");
		if (existsSync(statePath)) {
			try {
				const data = JSON.parse(readFileSync(statePath, "utf-8"));
				for (const [id, block] of Object.entries(data)) {
					this.blocks.set(id, block as SharedBlock);
				}
			} catch {
				// Ignore corrupt state
			}
		}
	}

	/**
	 * Persist state
	 */
	private saveState(): void {
		const dir = dirname(join(this.dataDir, "shared_blocks.json"));
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		writeFileSync(join(this.dataDir, "shared_blocks.json"), JSON.stringify(Object.fromEntries(this.blocks), null, 2));
	}

	/**
	 * Check if agent can read block
	 */
	private canRead(block: SharedBlock, agentId: string): boolean {
		return (
			block.permissions.readers.includes("*") ||
			block.permissions.readers.includes(agentId) ||
			block.permissions.owner === agentId
		);
	}

	/**
	 * Check if agent can write block
	 */
	private canWrite(block: SharedBlock, agentId: string): boolean {
		return (
			block.permissions.writers.includes("*") ||
			block.permissions.writers.includes(agentId) ||
			block.permissions.owner === agentId
		);
	}

	/**
	 * Notify subscribers of block changes
	 */
	private notifySubscribers(block: SharedBlock, change: "update" | "delete"): void {
		const subs = this.subscriptions.get(block.id) || [];
		for (const sub of subs) {
			if (this.canRead(block, sub.agentId)) {
				try {
					sub.callback(block, change);
				} catch (error) {
					console.error(`Error notifying subscriber ${sub.agentId}:`, error);
				}
			}
		}
		this.emit("block:change", { block, change });
	}

	// ========================================================================
	// Block Operations
	// ========================================================================

	/**
	 * Create a new shared block
	 */
	create(
		agentId: string,
		label: string,
		initialValue: string,
		options: {
			description?: string;
			limit?: number;
			readers?: string[];
			writers?: string[];
		} = {},
	): SharedBlock {
		const now = new Date().toISOString();
		const block: SharedBlock = {
			id: this.generateBlockId(),
			label,
			value: initialValue,
			description: options.description,
			limit: options.limit || 5000,
			version: 1,
			createdBy: agentId,
			createdAt: now,
			lastUpdatedBy: agentId,
			lastUpdatedAt: now,
			permissions: {
				readers: options.readers || ["*"],
				writers: options.writers || [agentId],
				owner: agentId,
			},
		};

		this.blocks.set(block.id, block);
		this.saveState();
		this.emit("block:created", block);

		return block;
	}

	/**
	 * Get a shared block (with permission check)
	 */
	get(blockId: string, agentId: string): SharedBlock | null {
		const block = this.blocks.get(blockId);
		if (!block) return null;
		if (!this.canRead(block, agentId)) return null;
		return { ...block };
	}

	/**
	 * Get block by label
	 */
	getByLabel(label: string, agentId: string): SharedBlock | null {
		for (const block of this.blocks.values()) {
			if (block.label === label && this.canRead(block, agentId)) {
				return { ...block };
			}
		}
		return null;
	}

	/**
	 * List all accessible blocks for an agent
	 */
	listAccessible(agentId: string): SharedBlock[] {
		return Array.from(this.blocks.values())
			.filter((block) => this.canRead(block, agentId))
			.map((block) => ({ ...block }));
	}

	/**
	 * Update a shared block (with optimistic locking)
	 */
	update(blockId: string, agentId: string, newValue: string, expectedVersion?: number): SharedBlockUpdate {
		const block = this.blocks.get(blockId);

		if (!block) {
			return { success: false, error: "Block not found" };
		}

		if (!this.canWrite(block, agentId)) {
			return { success: false, error: "Permission denied" };
		}

		// Optimistic locking
		if (expectedVersion !== undefined && block.version !== expectedVersion) {
			return {
				success: false,
				error: "Version conflict",
				conflict: true,
				block: { ...block },
			};
		}

		if (newValue.length > block.limit) {
			return {
				success: false,
				error: `Content exceeds limit (${newValue.length}/${block.limit})`,
			};
		}

		block.value = newValue;
		block.version++;
		block.lastUpdatedBy = agentId;
		block.lastUpdatedAt = new Date().toISOString();

		this.saveState();
		this.notifySubscribers(block, "update");

		return { success: true, block: { ...block } };
	}

	/**
	 * Replace text in block (with permission check)
	 */
	replace(blockId: string, agentId: string, oldText: string, newText: string): SharedBlockUpdate {
		const block = this.blocks.get(blockId);

		if (!block) {
			return { success: false, error: "Block not found" };
		}

		if (!this.canWrite(block, agentId)) {
			return { success: false, error: "Permission denied" };
		}

		if (!block.value.includes(oldText)) {
			return { success: false, error: "Text not found in block" };
		}

		const newValue = block.value.replace(oldText, newText);

		if (newValue.length > block.limit) {
			return {
				success: false,
				error: `Result exceeds limit (${newValue.length}/${block.limit})`,
			};
		}

		block.value = newValue;
		block.version++;
		block.lastUpdatedBy = agentId;
		block.lastUpdatedAt = new Date().toISOString();

		this.saveState();
		this.notifySubscribers(block, "update");

		return { success: true, block: { ...block } };
	}

	/**
	 * Insert text at end of block
	 */
	insert(blockId: string, agentId: string, text: string): SharedBlockUpdate {
		const block = this.blocks.get(blockId);

		if (!block) {
			return { success: false, error: "Block not found" };
		}

		if (!this.canWrite(block, agentId)) {
			return { success: false, error: "Permission denied" };
		}

		const newValue = block.value + (block.value.endsWith("\n") ? "" : "\n") + text;

		if (newValue.length > block.limit) {
			return {
				success: false,
				error: `Result exceeds limit (${newValue.length}/${block.limit})`,
			};
		}

		block.value = newValue;
		block.version++;
		block.lastUpdatedBy = agentId;
		block.lastUpdatedAt = new Date().toISOString();

		this.saveState();
		this.notifySubscribers(block, "update");

		return { success: true, block: { ...block } };
	}

	/**
	 * Delete a shared block (owner only)
	 */
	delete(blockId: string, agentId: string): boolean {
		const block = this.blocks.get(blockId);

		if (!block) return false;
		if (block.permissions.owner !== agentId) return false;

		this.blocks.delete(blockId);
		this.saveState();
		this.notifySubscribers(block, "delete");

		// Clean up subscriptions
		this.subscriptions.delete(blockId);

		return true;
	}

	/**
	 * Update block permissions (owner only)
	 */
	updatePermissions(
		blockId: string,
		agentId: string,
		permissions: Partial<SharedBlockPermissions>,
	): SharedBlockUpdate {
		const block = this.blocks.get(blockId);

		if (!block) {
			return { success: false, error: "Block not found" };
		}

		if (block.permissions.owner !== agentId) {
			return { success: false, error: "Only owner can update permissions" };
		}

		if (permissions.readers) {
			block.permissions.readers = permissions.readers;
		}
		if (permissions.writers) {
			block.permissions.writers = permissions.writers;
		}
		if (permissions.owner) {
			block.permissions.owner = permissions.owner;
		}

		block.version++;
		block.lastUpdatedAt = new Date().toISOString();

		this.saveState();
		this.notifySubscribers(block, "update");

		return { success: true, block: { ...block } };
	}

	// ========================================================================
	// Subscriptions
	// ========================================================================

	/**
	 * Subscribe to block changes
	 */
	subscribe(
		blockId: string,
		agentId: string,
		callback: (block: SharedBlock, change: "update" | "delete") => void,
	): () => void {
		const block = this.blocks.get(blockId);
		if (!block || !this.canRead(block, agentId)) {
			throw new Error("Block not found or no read permission");
		}

		if (!this.subscriptions.has(blockId)) {
			this.subscriptions.set(blockId, []);
		}

		const subscription: SharedBlockSubscription = {
			blockId,
			agentId,
			callback,
		};

		this.subscriptions.get(blockId)!.push(subscription);

		// Return unsubscribe function
		return () => {
			const subs = this.subscriptions.get(blockId);
			if (subs) {
				const idx = subs.indexOf(subscription);
				if (idx >= 0) {
					subs.splice(idx, 1);
				}
			}
		};
	}
}

// ============================================================================
// Shared Block Tools
// ============================================================================

export function createSharedBlockTools(manager: SharedBlockManager, agentId: string) {
	return {
		shared_block_create: {
			name: "shared_block_create",
			description: "Create a new shared memory block that multiple agents can access.",
			parameters: {
				type: "object",
				properties: {
					label: {
						type: "string",
						description: "Label for the shared block",
					},
					initial_value: {
						type: "string",
						description: "Initial content for the block",
					},
					description: {
						type: "string",
						description: "Description of what this block is for",
					},
					writers: {
						type: "array",
						items: { type: "string" },
						description: "Agent IDs that can write (default: only creator)",
					},
				},
				required: ["label", "initial_value"],
			},
			execute: async (args: { label: string; initial_value: string; description?: string; writers?: string[] }) => {
				const block = manager.create(agentId, args.label, args.initial_value, {
					description: args.description,
					writers: args.writers,
				});
				return JSON.stringify({
					success: true,
					block_id: block.id,
					label: block.label,
					version: block.version,
				});
			},
		},

		shared_block_read: {
			name: "shared_block_read",
			description: "Read a shared memory block by ID or label.",
			parameters: {
				type: "object",
				properties: {
					block_id: {
						type: "string",
						description: "ID of the shared block",
					},
					label: {
						type: "string",
						description: "Label of the shared block (alternative to ID)",
					},
				},
			},
			execute: async (args: { block_id?: string; label?: string }) => {
				let block: SharedBlock | null = null;

				if (args.block_id) {
					block = manager.get(args.block_id, agentId);
				} else if (args.label) {
					block = manager.getByLabel(args.label, agentId);
				}

				if (!block) {
					return JSON.stringify({ error: "Block not found or no permission" });
				}

				return JSON.stringify({
					id: block.id,
					label: block.label,
					value: block.value,
					version: block.version,
					last_updated_by: block.lastUpdatedBy,
					last_updated_at: block.lastUpdatedAt,
				});
			},
		},

		shared_block_update: {
			name: "shared_block_update",
			description: "Update the content of a shared memory block.",
			parameters: {
				type: "object",
				properties: {
					block_id: {
						type: "string",
						description: "ID of the shared block",
					},
					new_value: {
						type: "string",
						description: "New content for the block",
					},
					expected_version: {
						type: "number",
						description: "Expected version for optimistic locking",
					},
				},
				required: ["block_id", "new_value"],
			},
			execute: async (args: { block_id: string; new_value: string; expected_version?: number }) => {
				const result = manager.update(args.block_id, agentId, args.new_value, args.expected_version);
				return JSON.stringify(result);
			},
		},

		shared_block_insert: {
			name: "shared_block_insert",
			description: "Append content to a shared memory block.",
			parameters: {
				type: "object",
				properties: {
					block_id: {
						type: "string",
						description: "ID of the shared block",
					},
					text: {
						type: "string",
						description: "Text to append",
					},
				},
				required: ["block_id", "text"],
			},
			execute: async (args: { block_id: string; text: string }) => {
				const result = manager.insert(args.block_id, agentId, args.text);
				return JSON.stringify(result);
			},
		},

		shared_block_list: {
			name: "shared_block_list",
			description: "List all shared blocks accessible to this agent.",
			parameters: {
				type: "object",
				properties: {},
			},
			execute: async () => {
				const blocks = manager.listAccessible(agentId);
				return JSON.stringify({
					count: blocks.length,
					blocks: blocks.map((b) => ({
						id: b.id,
						label: b.label,
						version: b.version,
						chars: b.value.length,
						limit: b.limit,
						owner: b.permissions.owner,
					})),
				});
			},
		},
	};
}

// ============================================================================
// Singleton Instance
// ============================================================================

let sharedBlockManagerInstance: SharedBlockManager | null = null;

export function getSharedBlockManager(dataDir?: string): SharedBlockManager {
	if (!sharedBlockManagerInstance) {
		sharedBlockManagerInstance = new SharedBlockManager(dataDir);
	}
	return sharedBlockManagerInstance;
}

export function disposeSharedBlockManager(): void {
	sharedBlockManagerInstance = null;
}

export default SharedBlockManager;
