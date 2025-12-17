/**
 * Whale Tracking Agent
 * Monitors large wallet movements and exchange flows
 * Inspired by Moon Dev's whale detection patterns
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, WhaleMovement } from "../types.js";

interface WhaleAgentConfig extends AgentConfig {
	thresholds: {
		minUsdValue: number; // Minimum USD value to track
		exchangeFlowAlert: number; // Alert on large exchange inflows/outflows
	};
}

export class WhaleAgent extends BaseAgent {
	private recentMovements: WhaleMovement[] = [];
	private readonly MAX_MOVEMENTS = 100;

	constructor(config: Partial<WhaleAgentConfig> = {}) {
		super({
			name: "WhaleAgent",
			enabled: true,
			interval: 60000, // 1 minute
			symbols: ["BTC", "ETH"],
			thresholds: {
				minUsdValue: 1000000, // $1M minimum
				exchangeFlowAlert: 10000000, // $10M exchange flow alert
			},
			...config,
		});
	}

	protected async run(): Promise<void> {
		// Fetch whale alerts from public APIs
		const movements = await this.fetchWhaleMovements();

		for (const movement of movements) {
			this.recentMovements.push(movement);
			await this.analyzeMovement(movement);
		}

		// Keep only recent movements
		while (this.recentMovements.length > this.MAX_MOVEMENTS) {
			this.recentMovements.shift();
		}
	}

	private async fetchWhaleMovements(): Promise<WhaleMovement[]> {
		const movements: WhaleMovement[] = [];

		// Try multiple whale tracking sources
		try {
			// Whale Alert API (free tier)
			const whaleAlerts = await this.fetchWhaleAlert();
			movements.push(...whaleAlerts);
		} catch (error) {
			console.error("[WhaleAgent] Whale Alert fetch error:", error);
		}

		return movements;
	}

	private async fetchWhaleAlert(): Promise<WhaleMovement[]> {
		// Note: Whale Alert requires API key for full access
		// This is a simplified implementation using public data
		try {
			// Use CryptoQuant or similar free APIs for whale data
			// For now, we'll use exchange flow data from CoinGlass
			const response = await fetch(
				"https://open-api.coinglass.com/public/v2/indicator/exchange_netflow?symbol=BTC&interval=h1",
				{
					headers: {
						accept: "application/json",
					},
				},
			);

			if (!response.ok) return [];

			const data = await response.json();
			if (!data.success || !data.data) return [];

			// Convert to our format
			return data.data.slice(0, 10).map((item: any) => ({
				symbol: "BTC",
				type: item.netflow > 0 ? "buy" : "sell",
				amount: Math.abs(item.netflow),
				usdValue: Math.abs(item.netflow) * (item.price || 0),
				timestamp: item.createTime || Date.now(),
			}));
		} catch {
			return [];
		}
	}

	private async analyzeMovement(movement: WhaleMovement): Promise<void> {
		const thresholds = this.config.thresholds as WhaleAgentConfig["thresholds"];

		if (movement.usdValue < thresholds.minUsdValue) {
			return; // Below threshold
		}

		// Large exchange inflow (often bearish - selling pressure)
		if (movement.type === "sell" && movement.usdValue >= thresholds.exchangeFlowAlert) {
			await this.emitSignal({
				symbol: movement.symbol,
				action: "SELL",
				confidence: Math.min(movement.usdValue / (thresholds.exchangeFlowAlert * 5), 0.85),
				price: 0,
				reason: `Whale selling detected: $${this.formatLargeNumber(movement.usdValue)}`,
				source: this.name,
				timestamp: movement.timestamp,
				metadata: {
					movementType: movement.type,
					amount: movement.amount,
					usdValue: movement.usdValue,
				},
			});
		}

		// Large exchange outflow (often bullish - accumulation)
		if (movement.type === "buy" && movement.usdValue >= thresholds.exchangeFlowAlert) {
			await this.emitSignal({
				symbol: movement.symbol,
				action: "BUY",
				confidence: Math.min(movement.usdValue / (thresholds.exchangeFlowAlert * 5), 0.85),
				price: 0,
				reason: `Whale accumulation detected: $${this.formatLargeNumber(movement.usdValue)}`,
				source: this.name,
				timestamp: movement.timestamp,
				metadata: {
					movementType: movement.type,
					amount: movement.amount,
					usdValue: movement.usdValue,
				},
			});
		}
	}

	private formatLargeNumber(num: number): string {
		if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
		if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
		if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
		return num.toFixed(2);
	}

	/**
	 * Get recent whale movements
	 */
	getRecentMovements(symbol?: string): WhaleMovement[] {
		if (symbol) {
			return this.recentMovements.filter((m) => m.symbol === symbol);
		}
		return [...this.recentMovements];
	}

	/**
	 * Get whale activity summary
	 */
	getActivitySummary(): {
		totalBuyVolume: number;
		totalSellVolume: number;
		netFlow: number;
		movementCount: number;
	} {
		const summary = {
			totalBuyVolume: 0,
			totalSellVolume: 0,
			netFlow: 0,
			movementCount: this.recentMovements.length,
		};

		for (const movement of this.recentMovements) {
			if (movement.type === "buy") {
				summary.totalBuyVolume += movement.usdValue;
			} else if (movement.type === "sell") {
				summary.totalSellVolume += movement.usdValue;
			}
		}

		summary.netFlow = summary.totalBuyVolume - summary.totalSellVolume;
		return summary;
	}
}
