/**
 * Context Compression System
 *
 * Intelligent context window management with automatic summarization.
 * Superior to Letta: No external API required, local summarization.
 *
 * Features:
 * - Automatic summarization of long conversations
 * - Priority-based context inclusion
 * - Rolling window with pinned items
 * - Token estimation
 * - Configurable compression strategies
 */

// ============================================================================
// Types
// ============================================================================

export interface ContextItem {
	id: string;
	type: "message" | "memory" | "tool_result" | "system";
	role?: "user" | "assistant" | "system" | "tool";
	content: string;
	timestamp: string;
	priority: number; // 0-10, higher = more important
	pinned: boolean;
	tokens?: number;
	metadata?: Record<string, unknown>;
}

export interface CompressionConfig {
	maxTokens: number;
	targetTokens: number;
	minMessages: number;
	summaryRatio: number; // Compress to this ratio (e.g., 0.3 = 30%)
	preserveRecent: number; // Always keep last N messages
	preserveSystem: boolean;
	preservePinned: boolean;
}

export interface CompressedContext {
	items: ContextItem[];
	summary?: string;
	originalCount: number;
	compressedCount: number;
	estimatedTokens: number;
	compressionRatio: number;
}

export interface SummarizationResult {
	summary: string;
	keyPoints: string[];
	preservedIds: string[];
}

// ============================================================================
// Token Estimation
// ============================================================================

/**
 * Estimate tokens for text (rough approximation)
 * Average: ~4 characters per token for English
 */
export function estimateTokens(text: string): number {
	if (!text) return 0;
	// More accurate estimation based on whitespace and punctuation
	const words = text.split(/\s+/).length;
	const chars = text.length;
	// Roughly 0.75 tokens per word + some overhead for special chars
	return Math.ceil(words * 0.75 + chars * 0.1);
}

/**
 * Estimate tokens for a context item
 */
export function estimateItemTokens(item: ContextItem): number {
	if (item.tokens) return item.tokens;

	let tokens = estimateTokens(item.content);

	// Add overhead for message structure
	if (item.role) tokens += 4; // role token
	tokens += 3; // message delimiters

	return tokens;
}

/**
 * Estimate total tokens for context items
 */
export function estimateTotalTokens(items: ContextItem[]): number {
	return items.reduce((sum, item) => sum + estimateItemTokens(item), 0);
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
	maxTokens: 128000, // Claude's context window
	targetTokens: 80000, // Target after compression
	minMessages: 10,
	summaryRatio: 0.25,
	preserveRecent: 5,
	preserveSystem: true,
	preservePinned: true,
};

// ============================================================================
// Context Manager
// ============================================================================

export class ContextManager {
	private config: CompressionConfig;
	private items: ContextItem[] = [];
	private summaries: string[] = [];

	constructor(config: Partial<CompressionConfig> = {}) {
		this.config = { ...DEFAULT_COMPRESSION_CONFIG, ...config };
	}

	/**
	 * Add item to context
	 */
	addItem(item: Omit<ContextItem, "id" | "tokens">): ContextItem {
		const fullItem: ContextItem = {
			...item,
			id: `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
			tokens: estimateTokens(item.content),
		};

		this.items.push(fullItem);
		return fullItem;
	}

	/**
	 * Add message to context
	 */
	addMessage(
		role: ContextItem["role"],
		content: string,
		options: { priority?: number; pinned?: boolean; metadata?: Record<string, unknown> } = {},
	): ContextItem {
		return this.addItem({
			type: "message",
			role,
			content,
			timestamp: new Date().toISOString(),
			priority: options.priority ?? (role === "system" ? 8 : role === "user" ? 6 : 5),
			pinned: options.pinned ?? false,
			metadata: options.metadata,
		});
	}

	/**
	 * Pin an item (prevent removal during compression)
	 */
	pinItem(id: string): boolean {
		const item = this.items.find((i) => i.id === id);
		if (item) {
			item.pinned = true;
			return true;
		}
		return false;
	}

	/**
	 * Unpin an item
	 */
	unpinItem(id: string): boolean {
		const item = this.items.find((i) => i.id === id);
		if (item) {
			item.pinned = false;
			return true;
		}
		return false;
	}

	/**
	 * Set item priority
	 */
	setPriority(id: string, priority: number): boolean {
		const item = this.items.find((i) => i.id === id);
		if (item) {
			item.priority = Math.max(0, Math.min(10, priority));
			return true;
		}
		return false;
	}

	/**
	 * Get current context
	 */
	getContext(): ContextItem[] {
		return [...this.items];
	}

	/**
	 * Get estimated token count
	 */
	getTokenCount(): number {
		return estimateTotalTokens(this.items);
	}

	/**
	 * Check if compression is needed
	 */
	needsCompression(): boolean {
		return this.getTokenCount() > this.config.maxTokens;
	}

	/**
	 * Compress context to fit within token limits
	 */
	compress(summarizer?: (items: ContextItem[]) => Promise<string>): Promise<CompressedContext> {
		return this.compressWithStrategy("priority", summarizer);
	}

	/**
	 * Compress with specific strategy
	 */
	async compressWithStrategy(
		strategy: "priority" | "recency" | "summary",
		summarizer?: (items: ContextItem[]) => Promise<string>,
	): Promise<CompressedContext> {
		const originalCount = this.items.length;
		const currentTokens = this.getTokenCount();

		// No compression needed
		if (currentTokens <= this.config.targetTokens) {
			return {
				items: [...this.items],
				originalCount,
				compressedCount: this.items.length,
				estimatedTokens: currentTokens,
				compressionRatio: 1,
			};
		}

		// Separate items by preservation rules
		const { preserved, candidates } = this.categorizeItems();

		// Apply compression strategy
		let keptItems: ContextItem[];
		let summary: string | undefined;

		switch (strategy) {
			case "priority":
				keptItems = this.compressByPriority(preserved, candidates);
				break;
			case "recency":
				keptItems = this.compressByRecency(preserved, candidates);
				break;
			case "summary": {
				const result = await this.compressBySummary(preserved, candidates, summarizer);
				keptItems = result.items;
				summary = result.summary;
				break;
			}
			default:
				keptItems = this.compressByPriority(preserved, candidates);
		}

		// Update internal state
		this.items = keptItems;
		if (summary) {
			this.summaries.push(summary);
		}

		const newTokens = this.getTokenCount();

		return {
			items: keptItems,
			summary,
			originalCount,
			compressedCount: keptItems.length,
			estimatedTokens: newTokens,
			compressionRatio: newTokens / currentTokens,
		};
	}

	/**
	 * Categorize items into preserved and candidates for removal
	 */
	private categorizeItems(): { preserved: ContextItem[]; candidates: ContextItem[] } {
		const preserved: ContextItem[] = [];
		const candidates: ContextItem[] = [];

		const recentThreshold = this.items.length - this.config.preserveRecent;

		this.items.forEach((item, index) => {
			const isRecent = index >= recentThreshold;
			const isSystem = this.config.preserveSystem && item.type === "system";
			const isPinned = this.config.preservePinned && item.pinned;

			if (isRecent || isSystem || isPinned) {
				preserved.push(item);
			} else {
				candidates.push(item);
			}
		});

		return { preserved, candidates };
	}

	/**
	 * Compress by priority (keep highest priority items)
	 */
	private compressByPriority(preserved: ContextItem[], candidates: ContextItem[]): ContextItem[] {
		const preservedTokens = estimateTotalTokens(preserved);
		const availableTokens = this.config.targetTokens - preservedTokens;

		// Sort candidates by priority (descending)
		const sorted = [...candidates].sort((a, b) => b.priority - a.priority);

		// Keep items until we hit token limit
		const kept: ContextItem[] = [];
		let usedTokens = 0;

		for (const item of sorted) {
			const itemTokens = estimateItemTokens(item);
			if (usedTokens + itemTokens <= availableTokens) {
				kept.push(item);
				usedTokens += itemTokens;
			}
		}

		// Merge and sort by original order (timestamp)
		return [...kept, ...preserved].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	}

	/**
	 * Compress by recency (keep most recent items)
	 */
	private compressByRecency(preserved: ContextItem[], candidates: ContextItem[]): ContextItem[] {
		const preservedTokens = estimateTotalTokens(preserved);
		const availableTokens = this.config.targetTokens - preservedTokens;

		// Sort candidates by timestamp (descending = most recent first)
		const sorted = [...candidates].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

		// Keep most recent items until token limit
		const kept: ContextItem[] = [];
		let usedTokens = 0;

		for (const item of sorted) {
			const itemTokens = estimateItemTokens(item);
			if (usedTokens + itemTokens <= availableTokens) {
				kept.push(item);
				usedTokens += itemTokens;
			}
		}

		// Merge and sort chronologically
		return [...kept, ...preserved].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	}

	/**
	 * Compress by summarization
	 */
	private async compressBySummary(
		preserved: ContextItem[],
		candidates: ContextItem[],
		summarizer?: (items: ContextItem[]) => Promise<string>,
	): Promise<{ items: ContextItem[]; summary: string }> {
		// Generate summary of candidates
		let summary: string;

		if (summarizer) {
			summary = await summarizer(candidates);
		} else {
			// Simple extractive summary (fallback)
			summary = this.generateSimpleSummary(candidates);
		}

		// Create summary item
		const summaryItem: ContextItem = {
			id: `summary_${Date.now()}`,
			type: "system",
			content: `## Previous Conversation Summary\n${summary}`,
			timestamp: candidates[0]?.timestamp || new Date().toISOString(),
			priority: 7,
			pinned: false,
			tokens: estimateTokens(summary),
		};

		// Merge summary with preserved items
		const items = [summaryItem, ...preserved].sort(
			(a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
		);

		return { items, summary };
	}

	/**
	 * Generate simple extractive summary (no LLM required)
	 */
	private generateSimpleSummary(items: ContextItem[]): string {
		const messages = items.filter((i) => i.type === "message");

		// Group by role and extract key points
		const userMessages = messages.filter((m) => m.role === "user").slice(-5);
		const assistantMessages = messages.filter((m) => m.role === "assistant").slice(-5);

		const lines: string[] = [];

		if (userMessages.length > 0) {
			lines.push("**User discussed:**");
			for (const msg of userMessages) {
				const excerpt = msg.content.substring(0, 100).replace(/\n/g, " ");
				lines.push(`- ${excerpt}${msg.content.length > 100 ? "..." : ""}`);
			}
		}

		if (assistantMessages.length > 0) {
			lines.push("\n**Assistant covered:**");
			for (const msg of assistantMessages) {
				const excerpt = msg.content.substring(0, 100).replace(/\n/g, " ");
				lines.push(`- ${excerpt}${msg.content.length > 100 ? "..." : ""}`);
			}
		}

		lines.push(`\n*${items.length} messages summarized*`);

		return lines.join("\n");
	}

	/**
	 * Clear all items
	 */
	clear(): void {
		this.items = [];
	}

	/**
	 * Get compression stats
	 */
	getStats(): {
		itemCount: number;
		tokenCount: number;
		maxTokens: number;
		targetTokens: number;
		utilization: number;
		needsCompression: boolean;
		summaryCount: number;
	} {
		const tokenCount = this.getTokenCount();
		return {
			itemCount: this.items.length,
			tokenCount,
			maxTokens: this.config.maxTokens,
			targetTokens: this.config.targetTokens,
			utilization: tokenCount / this.config.maxTokens,
			needsCompression: this.needsCompression(),
			summaryCount: this.summaries.length,
		};
	}
}

// ============================================================================
// Context Compression Tools
// ============================================================================

export function createContextTools(manager: ContextManager) {
	return {
		context_stats: {
			name: "context_stats",
			description: "Get statistics about current context window usage.",
			parameters: {
				type: "object",
				properties: {},
			},
			execute: async () => {
				const stats = manager.getStats();
				return JSON.stringify({
					...stats,
					utilizationPercent: `${Math.round(stats.utilization * 100)}%`,
				});
			},
		},

		context_pin: {
			name: "context_pin",
			description: "Pin an item to prevent it from being removed during compression.",
			parameters: {
				type: "object",
				properties: {
					item_id: {
						type: "string",
						description: "ID of the context item to pin",
					},
				},
				required: ["item_id"],
			},
			execute: async (args: { item_id: string }) => {
				const success = manager.pinItem(args.item_id);
				return JSON.stringify({ success, item_id: args.item_id });
			},
		},

		context_compress: {
			name: "context_compress",
			description: "Manually trigger context compression to free up space.",
			parameters: {
				type: "object",
				properties: {
					strategy: {
						type: "string",
						enum: ["priority", "recency", "summary"],
						description: "Compression strategy (default: priority)",
					},
				},
			},
			execute: async (args: { strategy?: "priority" | "recency" | "summary" }) => {
				const result = await manager.compressWithStrategy(args.strategy || "priority");
				return JSON.stringify({
					originalCount: result.originalCount,
					compressedCount: result.compressedCount,
					estimatedTokens: result.estimatedTokens,
					compressionRatio: `${Math.round(result.compressionRatio * 100)}%`,
					hasSummary: !!result.summary,
				});
			},
		},
	};
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createContextManager(config?: Partial<CompressionConfig>): ContextManager {
	return new ContextManager(config);
}

export default ContextManager;
