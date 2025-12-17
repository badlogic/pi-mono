/**
 * Price Monitoring Agent
 * Tracks crypto prices and generates alerts/signals
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, PriceData, TradeSignal } from "../types.js";

interface PriceAgentConfig extends AgentConfig {
	thresholds: {
		priceChangeAlert: number; // % change to trigger alert
		volumeSpikeMultiplier: number; // Volume spike detection
	};
}

interface PriceCache {
	[symbol: string]: {
		prices: number[];
		volumes: number[];
		lastUpdate: number;
	};
}

export class PriceAgent extends BaseAgent {
	private cache: PriceCache = {};
	private readonly MAX_HISTORY = 100;

	constructor(config: Partial<PriceAgentConfig> = {}) {
		super({
			name: "PriceAgent",
			enabled: true,
			interval: 30000, // 30 seconds
			symbols: ["BTC", "ETH", "SOL", "DOGE", "XRP"],
			thresholds: {
				priceChangeAlert: 5, // 5% change
				volumeSpikeMultiplier: 3, // 3x average volume
			},
			...config,
		});
	}

	protected async run(): Promise<void> {
		const prices = await this.fetchPrices();

		for (const data of prices) {
			this.updateCache(data);
			await this.analyzePrice(data);
		}
	}

	private async fetchPrices(): Promise<PriceData[]> {
		const symbols = this.config.symbols.map((s) => s.toLowerCase()).join(",");

		try {
			const response = await fetch(
				`https://api.coingecko.com/api/v3/simple/price?ids=${symbols}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`,
			);

			if (!response.ok) {
				throw new Error(`CoinGecko API error: ${response.status}`);
			}

			const data = await response.json();
			const now = Date.now();

			return Object.entries(data).map(([id, info]: [string, any]) => ({
				symbol: id.toUpperCase(),
				price: info.usd,
				change24h: info.usd_24h_change || 0,
				volume24h: info.usd_24h_vol || 0,
				marketCap: info.usd_market_cap || 0,
				timestamp: now,
			}));
		} catch (error) {
			console.error("[PriceAgent] Fetch error:", error);
			return [];
		}
	}

	private updateCache(data: PriceData): void {
		if (!this.cache[data.symbol]) {
			this.cache[data.symbol] = {
				prices: [],
				volumes: [],
				lastUpdate: 0,
			};
		}

		const cache = this.cache[data.symbol];
		cache.prices.push(data.price);
		cache.volumes.push(data.volume24h);
		cache.lastUpdate = data.timestamp;

		// Keep only last N entries
		if (cache.prices.length > this.MAX_HISTORY) {
			cache.prices.shift();
			cache.volumes.shift();
		}
	}

	private async analyzePrice(data: PriceData): Promise<void> {
		const thresholds = this.config.thresholds as PriceAgentConfig["thresholds"];

		// Check for significant price change
		if (Math.abs(data.change24h) >= thresholds.priceChangeAlert) {
			const signal: TradeSignal = {
				symbol: data.symbol,
				action: data.change24h > 0 ? "BUY" : "SELL",
				confidence: Math.min(Math.abs(data.change24h) / 20, 1), // Max confidence at 20% move
				price: data.price,
				reason: `${data.change24h > 0 ? "+" : ""}${data.change24h.toFixed(2)}% in 24h`,
				source: this.name,
				timestamp: data.timestamp,
				metadata: {
					change24h: data.change24h,
					volume24h: data.volume24h,
					marketCap: data.marketCap,
				},
			};

			await this.emitSignal(signal);
		}

		// Check for volume spike
		const cache = this.cache[data.symbol];
		if (cache && cache.volumes.length >= 10) {
			const avgVolume = cache.volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
			if (data.volume24h > avgVolume * thresholds.volumeSpikeMultiplier) {
				const signal: TradeSignal = {
					symbol: data.symbol,
					action: "HOLD", // Volume spike needs more analysis
					confidence: 0.6,
					price: data.price,
					reason: `Volume spike: ${(data.volume24h / avgVolume).toFixed(1)}x average`,
					source: this.name,
					timestamp: data.timestamp,
					metadata: {
						volume24h: data.volume24h,
						avgVolume,
						volumeMultiplier: data.volume24h / avgVolume,
					},
				};

				await this.emitSignal(signal);
			}
		}
	}

	/**
	 * Get current price for a symbol
	 */
	async getPrice(symbol: string): Promise<PriceData | null> {
		try {
			const response = await fetch(
				`https://api.coingecko.com/api/v3/simple/price?ids=${symbol.toLowerCase()}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`,
			);

			if (!response.ok) return null;

			const data = await response.json();
			const info = data[symbol.toLowerCase()];

			if (!info) return null;

			return {
				symbol: symbol.toUpperCase(),
				price: info.usd,
				change24h: info.usd_24h_change || 0,
				volume24h: info.usd_24h_vol || 0,
				marketCap: info.usd_market_cap || 0,
				timestamp: Date.now(),
			};
		} catch {
			return null;
		}
	}

	/**
	 * Get price history from cache
	 */
	getPriceHistory(symbol: string): number[] {
		return this.cache[symbol]?.prices || [];
	}
}
