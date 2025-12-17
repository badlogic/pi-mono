/**
 * Trading Agent Types
 * Inspired by Moon Dev's multi-agent architecture
 */

export type TradingAction = "BUY" | "SELL" | "HOLD" | "NOTHING";

export interface TradeSignal {
	symbol: string;
	action: TradingAction;
	confidence: number; // 0-1
	price: number;
	reason: string;
	source: string; // Which agent generated this
	timestamp: number;
	metadata?: Record<string, unknown>;
}

export interface PriceData {
	symbol: string;
	price: number;
	change24h: number;
	volume24h: number;
	marketCap: number;
	timestamp: number;
}

export interface WhaleMovement {
	symbol: string;
	type: "buy" | "sell" | "transfer";
	amount: number;
	usdValue: number;
	fromAddress?: string;
	toAddress?: string;
	timestamp: number;
}

export interface SentimentData {
	symbol: string;
	score: number; // -1 to 1
	volume: number; // Number of mentions
	sources: string[];
	keywords: string[];
	timestamp: number;
}

export interface FundingRate {
	symbol: string;
	rate: number;
	predictedRate?: number;
	exchange: string;
	timestamp: number;
}

export interface AgentConfig {
	name: string;
	enabled: boolean;
	interval: number; // ms between runs
	symbols: string[];
	thresholds: Record<string, number>;
}

export interface ConsensusResult {
	symbol: string;
	action: TradingAction;
	confidence: number;
	votes: {
		model: string;
		action: TradingAction;
		confidence: number;
		reasoning: string;
	}[];
	timestamp: number;
}

export interface AlertConfig {
	userId: string;
	channelId: string;
	symbol: string;
	condition: ">" | "<" | "whale" | "sentiment" | "funding";
	threshold: number;
	enabled: boolean;
}

export interface AgentState {
	lastRun: number;
	isRunning: boolean;
	errorCount: number;
	lastError?: string;
	signalsGenerated: number;
}
