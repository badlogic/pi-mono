/**
 * Trading Agent Orchestrator
 * Coordinates all trading agents and manages signal flow
 * Inspired by Moon Dev's multi-agent architecture
 */

import type { Client, TextChannel } from "discord.js";
import { EmbedBuilder } from "discord.js";
import { PriceAgent } from "./agents/price-agent.js";
import { SentimentAgent } from "./agents/sentiment-agent.js";
import { WhaleAgent } from "./agents/whale-agent.js";
import type { BaseAgent } from "./base-agent.js";
import { ConsensusEngine } from "./consensus.js";
import { type TradingOutcome, tradingLearning } from "./learning-service.js";
import type { ConsensusResult, TradeSignal } from "./types.js";

interface OrchestratorConfig {
	enabled: boolean;
	signalChannelId?: string;
	alertChannelId?: string;
	useConsensus: boolean;
	minSignalConfidence: number;
}

export class TradingOrchestrator {
	private config: OrchestratorConfig;
	private client: Client | null = null;
	private agents: Map<string, BaseAgent> = new Map();
	private consensus: ConsensusEngine;
	private signalHistory: TradeSignal[] = [];
	private readonly MAX_HISTORY = 500;

	// Agent instances
	public priceAgent: PriceAgent;
	public sentimentAgent: SentimentAgent;
	public whaleAgent: WhaleAgent;

	constructor(config: Partial<OrchestratorConfig> = {}) {
		this.config = {
			enabled: true,
			useConsensus: true,
			minSignalConfidence: 0.6,
			...config,
		};

		// Initialize agents
		this.priceAgent = new PriceAgent();
		this.sentimentAgent = new SentimentAgent();
		this.whaleAgent = new WhaleAgent();

		// Register agents
		this.agents.set("price", this.priceAgent);
		this.agents.set("sentiment", this.sentimentAgent);
		this.agents.set("whale", this.whaleAgent);

		// Initialize consensus engine
		this.consensus = new ConsensusEngine();

		// Wire up signal handlers
		this.setupSignalHandlers();
	}

	private setupSignalHandlers(): void {
		const handleSignal = async (signal: TradeSignal) => {
			await this.processSignal(signal);
		};

		for (const agent of this.agents.values()) {
			agent.onSignal(handleSignal);
		}
	}

	/**
	 * Set Discord client for sending alerts
	 */
	setClient(client: Client): void {
		this.client = client;
	}

	/**
	 * Start all trading agents
	 */
	async start(): Promise<void> {
		if (!this.config.enabled) {
			console.log("[Orchestrator] Trading agents disabled");
			return;
		}

		console.log("[Orchestrator] Starting trading agents...");

		for (const [name, agent] of this.agents) {
			if (agent.isEnabled) {
				await agent.start();
				console.log(`[Orchestrator] Started ${name} agent`);
			}
		}

		console.log("[Orchestrator] All trading agents started");
	}

	/**
	 * Stop all trading agents
	 */
	async stop(): Promise<void> {
		console.log("[Orchestrator] Stopping trading agents...");

		for (const [name, agent] of this.agents) {
			await agent.stop();
			console.log(`[Orchestrator] Stopped ${name} agent`);
		}
	}

	/**
	 * Process incoming signal from any agent
	 */
	private async processSignal(signal: TradeSignal): Promise<void> {
		// Store in history
		this.signalHistory.push(signal);
		while (this.signalHistory.length > this.MAX_HISTORY) {
			this.signalHistory.shift();
		}

		// Filter low confidence signals
		if (signal.confidence < this.config.minSignalConfidence) {
			return;
		}

		// Optionally run through consensus for high-value signals
		if (this.config.useConsensus && signal.action !== "HOLD") {
			const priceData = await this.priceAgent.getPrice(signal.symbol);
			if (priceData) {
				const sentiment = await this.sentimentAgent.getSentiment(signal.symbol);
				const consensusResult = await this.consensus.getConsensus(
					signal.symbol,
					priceData,
					sentiment || undefined,
					`Original signal: ${signal.reason}`,
				);

				// Update signal with consensus
				signal = {
					...signal,
					action: consensusResult.action,
					confidence: consensusResult.confidence,
					reason: `Consensus: ${consensusResult.votes.map((v) => `${v.model}:${v.action}`).join(", ")}`,
					metadata: {
						...signal.metadata,
						consensus: consensusResult,
					},
				};
			}
		}

		// Send to Discord if configured
		await this.sendSignalToDiscord(signal);
	}

	/**
	 * Send signal to Discord channel
	 */
	private async sendSignalToDiscord(signal: TradeSignal): Promise<void> {
		if (!this.client || !this.config.signalChannelId) {
			return;
		}

		try {
			const channel = await this.client.channels.fetch(this.config.signalChannelId);
			if (!channel || !channel.isTextBased()) return;

			const embed = this.createSignalEmbed(signal);
			await (channel as TextChannel).send({ embeds: [embed] });
		} catch (error) {
			console.error("[Orchestrator] Failed to send signal to Discord:", error);
		}
	}

	private createSignalEmbed(signal: TradeSignal): EmbedBuilder {
		const colors: Record<string, number> = {
			BUY: 0x00ff00, // Green
			SELL: 0xff0000, // Red
			HOLD: 0xffff00, // Yellow
			NOTHING: 0x808080, // Gray
		};

		const emojis: Record<string, string> = {
			BUY: "🟢",
			SELL: "🔴",
			HOLD: "🟡",
			NOTHING: "⚪",
		};

		const embed = new EmbedBuilder()
			.setTitle(`${emojis[signal.action]} Trading Signal: ${signal.symbol}`)
			.setColor(colors[signal.action] || 0x808080)
			.addFields(
				{ name: "Action", value: signal.action, inline: true },
				{ name: "Confidence", value: `${(signal.confidence * 100).toFixed(1)}%`, inline: true },
				{ name: "Source", value: signal.source, inline: true },
				{ name: "Reason", value: signal.reason.slice(0, 1024) },
			)
			.setTimestamp(signal.timestamp);

		if (signal.price > 0) {
			embed.addFields({ name: "Price", value: `$${signal.price.toLocaleString()}`, inline: true });
		}

		return embed;
	}

	/**
	 * Get consensus analysis for a symbol
	 */
	async getConsensusAnalysis(symbol: string): Promise<ConsensusResult | null> {
		const priceData = await this.priceAgent.getPrice(symbol);
		if (!priceData) return null;

		const sentiment = await this.sentimentAgent.getSentiment(symbol);
		return this.consensus.getConsensus(symbol, priceData, sentiment || undefined);
	}

	/**
	 * Get quick AI analysis (single model, faster)
	 */
	async getQuickAnalysis(symbol: string): Promise<TradeSignal | null> {
		const priceData = await this.priceAgent.getPrice(symbol);
		if (!priceData) return null;

		const sentiment = await this.sentimentAgent.getSentiment(symbol);
		return this.consensus.quickAnalysis(symbol, priceData, sentiment || undefined);
	}

	/**
	 * Get recent signals
	 */
	getRecentSignals(limit = 20, symbol?: string): TradeSignal[] {
		let signals = [...this.signalHistory].reverse();

		if (symbol) {
			signals = signals.filter((s) => s.symbol === symbol);
		}

		return signals.slice(0, limit);
	}

	/**
	 * Get agent stats
	 */
	getStats(): Record<string, any> {
		const stats: Record<string, any> = {
			enabled: this.config.enabled,
			agents: {},
			totalSignals: this.signalHistory.length,
		};

		for (const [name, agent] of this.agents) {
			stats.agents[name] = {
				enabled: agent.isEnabled,
				...agent.stats,
			};
		}

		return stats;
	}

	/**
	 * Record a trading outcome for learning
	 * Call this when a trade is closed to improve future predictions
	 */
	async recordOutcome(signal: TradeSignal, exitPrice: number, success: boolean): Promise<void> {
		const marketCondition = this.determineMarketCondition(signal);

		const outcome: TradingOutcome = {
			timestamp: new Date().toISOString(),
			symbol: signal.symbol,
			action: signal.action as "BUY" | "SELL" | "HOLD",
			entryPrice: signal.price,
			exitPrice,
			pnl: signal.action === "BUY" ? exitPrice - signal.price : signal.price - exitPrice,
			success,
			confidence: signal.confidence,
			marketCondition,
			agents: [signal.source],
			reason: signal.reason,
		};

		await tradingLearning.recordOutcome(outcome);
		console.log(`[Orchestrator] Recorded ${success ? "successful" : "failed"} outcome for ${signal.symbol}`);
	}

	/**
	 * Determine market condition from recent signals and price data
	 */
	private determineMarketCondition(signal: TradeSignal): "bull" | "bear" | "sideways" | "volatile" {
		const recentSignals = this.getRecentSignals(10, signal.symbol);

		if (recentSignals.length < 3) {
			return "sideways";
		}

		// Count buy vs sell signals
		const buySignals = recentSignals.filter((s) => s.action === "BUY").length;
		const sellSignals = recentSignals.filter((s) => s.action === "SELL").length;

		// Check for volatility (many signals with mixed actions)
		if (buySignals > 3 && sellSignals > 3) {
			return "volatile";
		}

		// Check for trend
		if (buySignals > sellSignals * 2) {
			return "bull";
		}
		if (sellSignals > buySignals * 2) {
			return "bear";
		}

		return "sideways";
	}

	/**
	 * Get learning stats
	 */
	getLearningStats(): { outcomes: number; sessionAge: number } {
		return tradingLearning.getStats();
	}

	/**
	 * Force expertise update (call when session ends)
	 */
	async updateExpertise(): Promise<void> {
		await tradingLearning.updateExpertise();
	}

	/**
	 * Get market summary
	 */
	async getMarketSummary(symbols: string[] = ["BTC", "ETH", "SOL"]): Promise<{
		prices: Record<string, any>;
		sentiment: Record<string, any>;
		whaleActivity: any;
		signals: TradeSignal[];
	}> {
		const prices: Record<string, any> = {};
		const sentiment: Record<string, any> = {};

		for (const symbol of symbols) {
			const priceData = await this.priceAgent.getPrice(symbol);
			if (priceData) prices[symbol] = priceData;

			const sentimentData = await this.sentimentAgent.getSentiment(symbol);
			if (sentimentData) sentiment[symbol] = sentimentData;
		}

		return {
			prices,
			sentiment,
			whaleActivity: this.whaleAgent.getActivitySummary(),
			signals: this.getRecentSignals(10),
		};
	}
}

// Singleton instance
let orchestratorInstance: TradingOrchestrator | null = null;

export function getTradingOrchestrator(config?: Partial<OrchestratorConfig>): TradingOrchestrator {
	if (!orchestratorInstance) {
		orchestratorInstance = new TradingOrchestrator(config);
	}
	return orchestratorInstance;
}
