import type { AssistantMessage, Message, Model } from "../../types.js";

export const COMPACT_BOUNDARY_TAG = "[COMPACT_BOUNDARY]";
export const COMPACT_SUMMARY_TAG = "[COMPACT_SUMMARY]";

export interface CompactionContext {
	model: Model<any>;
	systemPrompt?: string;
	signal?: AbortSignal;
}

export interface CompactionOptions {
	force?: boolean;
	triggerRatio?: number; // defaults to config.triggerRatio
	hardRatio?: number; // defaults to config.hardRatio
}

export interface CompactionConfig {
	triggerRatio: number; // start compacting when estimated / contextWindow exceeds this
	hardRatio: number; // always compact if above this
	tailMessages: number; // raw messages to keep uncompressed at the tail
	summaryPrompt?: string;
}

export interface CompactionStats {
	tokensBefore: number;
	tokensAfter: number;
	trigger: "auto" | "manual";
}

export interface CompactionResult {
	messages: Message[];
	compacted: boolean;
	reason?: string;
	boundaryMessage?: AssistantMessage;
	summaryMessage?: AssistantMessage;
	stats?: CompactionStats;
}
