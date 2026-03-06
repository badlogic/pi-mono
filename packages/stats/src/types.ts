import type { AssistantMessage, StopReason, Usage } from "@mariozechner/pi-ai";

export interface UsageStats extends Usage {
	premiumRequests?: number;
}

export interface AssistantMessageWithMetrics extends AssistantMessage {
	duration?: number;
	ttft?: number;
	usage: UsageStats;
}

export interface MessageStats {
	id?: number;
	sessionFile: string;
	entryId: string;
	folder: string;
	model: string;
	provider: string;
	api: string;
	timestamp: number;
	duration: number | null;
	ttft: number | null;
	stopReason: StopReason;
	errorMessage: string | null;
	usage: UsageStats;
}

export interface RequestDetails extends MessageStats {
	messages: unknown[];
	output: unknown;
}

export interface AggregatedStats {
	totalRequests: number;
	successfulRequests: number;
	failedRequests: number;
	errorRate: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens: number;
	totalCacheWriteTokens: number;
	cacheRate: number;
	totalCost: number;
	totalPremiumRequests: number;
	avgDuration: number | null;
	avgTtft: number | null;
	avgTokensPerSecond: number | null;
	firstTimestamp: number;
	lastTimestamp: number;
}

export interface ModelStats extends AggregatedStats {
	model: string;
	provider: string;
}

export interface FolderStats extends AggregatedStats {
	folder: string;
}

export interface TimeSeriesPoint {
	timestamp: number;
	requests: number;
	errors: number;
	tokens: number;
	cost: number;
}

export interface ModelTimeSeriesPoint {
	timestamp: number;
	model: string;
	provider: string;
	requests: number;
}

export interface ModelPerformancePoint {
	timestamp: number;
	model: string;
	provider: string;
	requests: number;
	avgTtft: number | null;
	avgTokensPerSecond: number | null;
}

export interface DashboardStats {
	overall: AggregatedStats;
	byModel: ModelStats[];
	byFolder: FolderStats[];
	timeSeries: TimeSeriesPoint[];
	modelSeries: ModelTimeSeriesPoint[];
	modelPerformanceSeries: ModelPerformancePoint[];
}

export interface SessionHeader {
	type: "session";
	version?: number;
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
}

export interface SessionMessageEntry {
	type: "message";
	id: string;
	parentId: string | null;
	timestamp: string;
	message: AssistantMessageWithMetrics | { role: string };
}

export type SessionEntry = SessionHeader | SessionMessageEntry | { type: string; id?: string };
