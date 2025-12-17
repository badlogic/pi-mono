/**
 * Sentiment Analysis Agent
 * Monitors social media sentiment for crypto tokens
 * Uses AI to analyze sentiment from news and social feeds
 */

import { BaseAgent } from "../base-agent.js";
import type { AgentConfig, SentimentData } from "../types.js";

interface SentimentAgentConfig extends AgentConfig {
	thresholds: {
		extremePositive: number; // Score above this is bullish signal
		extremeNegative: number; // Score below this is bearish signal
		minMentions: number; // Minimum mentions to consider
	};
}

export class SentimentAgent extends BaseAgent {
	private sentimentCache: Map<string, SentimentData[]> = new Map();
	private readonly MAX_HISTORY = 50;

	constructor(config: Partial<SentimentAgentConfig> = {}) {
		super({
			name: "SentimentAgent",
			enabled: true,
			interval: 300000, // 5 minutes
			symbols: ["BTC", "ETH", "SOL"],
			thresholds: {
				extremePositive: 0.7,
				extremeNegative: -0.7,
				minMentions: 10,
			},
			...config,
		});
	}

	protected async run(): Promise<void> {
		for (const symbol of this.config.symbols) {
			try {
				const sentiment = await this.analyzeSentiment(symbol);
				if (sentiment) {
					this.updateCache(symbol, sentiment);
					await this.generateSignals(sentiment);
				}
			} catch (error) {
				console.error(`[SentimentAgent] Error analyzing ${symbol}:`, error);
			}
		}
	}

	private async analyzeSentiment(symbol: string): Promise<SentimentData | null> {
		// Fetch crypto news from CryptoPanic
		const news = await this.fetchNews(symbol);
		if (!news || news.length === 0) return null;

		// Calculate sentiment score from titles
		const sentimentScores = news.map((item: any) => this.calculateTitleSentiment(item.title));
		const avgScore = sentimentScores.reduce((a: number, b: number) => a + b, 0) / sentimentScores.length;

		// Extract keywords
		const keywords = this.extractKeywords(news.map((n: any) => n.title).join(" "));

		return {
			symbol,
			score: avgScore,
			volume: news.length,
			sources: [...new Set(news.map((n: any) => n.source?.title || "unknown"))],
			keywords,
			timestamp: Date.now(),
		};
	}

	private async fetchNews(symbol: string): Promise<any[]> {
		try {
			const response = await fetch(
				`https://cryptopanic.com/api/v1/posts/?auth_token=free&currencies=${symbol}&filter=hot&public=true`,
			);

			if (!response.ok) return [];

			const data = await response.json();
			return data.results?.slice(0, 20) || [];
		} catch {
			return [];
		}
	}

	private calculateTitleSentiment(title: string): number {
		const lower = title.toLowerCase();

		// Bullish keywords
		const bullish = [
			"surge",
			"soar",
			"rally",
			"breakout",
			"bull",
			"moon",
			"pump",
			"gain",
			"rise",
			"high",
			"record",
			"ath",
			"buy",
			"accumulate",
			"bullish",
			"growth",
			"adoption",
			"institutional",
			"etf approved",
		];

		// Bearish keywords
		const bearish = [
			"crash",
			"dump",
			"plunge",
			"bear",
			"sell",
			"drop",
			"fall",
			"low",
			"fear",
			"panic",
			"hack",
			"scam",
			"fraud",
			"regulation",
			"ban",
			"bearish",
			"decline",
			"loss",
			"liquidation",
			"capitulation",
		];

		let score = 0;
		for (const word of bullish) {
			if (lower.includes(word)) score += 0.2;
		}
		for (const word of bearish) {
			if (lower.includes(word)) score -= 0.2;
		}

		return Math.max(-1, Math.min(1, score));
	}

	private extractKeywords(text: string): string[] {
		const words = text.toLowerCase().split(/\W+/);
		const stopWords = new Set([
			"the",
			"a",
			"an",
			"is",
			"are",
			"was",
			"were",
			"be",
			"been",
			"have",
			"has",
			"had",
			"do",
			"does",
			"did",
			"will",
			"would",
			"could",
			"should",
			"may",
			"might",
			"must",
			"shall",
			"can",
			"to",
			"of",
			"in",
			"for",
			"on",
			"with",
			"at",
			"by",
			"from",
			"as",
			"into",
			"through",
			"during",
			"before",
			"after",
			"above",
			"below",
			"between",
			"under",
			"again",
			"further",
			"then",
			"once",
			"and",
			"but",
			"or",
			"nor",
			"so",
			"yet",
			"both",
			"either",
			"neither",
			"not",
			"only",
			"own",
			"same",
			"than",
			"too",
			"very",
			"just",
			"also",
			"now",
			"here",
			"there",
			"when",
			"where",
			"why",
			"how",
			"all",
			"each",
			"every",
			"both",
			"few",
			"more",
			"most",
			"other",
			"some",
			"such",
			"no",
			"nor",
			"not",
			"only",
			"own",
			"its",
			"it",
			"this",
			"that",
			"these",
			"those",
			"what",
			"which",
		]);

		const wordCount = new Map<string, number>();
		for (const word of words) {
			if (word.length > 3 && !stopWords.has(word)) {
				wordCount.set(word, (wordCount.get(word) || 0) + 1);
			}
		}

		return [...wordCount.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10)
			.map(([word]) => word);
	}

	private updateCache(symbol: string, data: SentimentData): void {
		if (!this.sentimentCache.has(symbol)) {
			this.sentimentCache.set(symbol, []);
		}

		const history = this.sentimentCache.get(symbol)!;
		history.push(data);

		if (history.length > this.MAX_HISTORY) {
			history.shift();
		}
	}

	private async generateSignals(sentiment: SentimentData): Promise<void> {
		const thresholds = this.config.thresholds as SentimentAgentConfig["thresholds"];

		if (sentiment.volume < thresholds.minMentions) {
			return; // Not enough data
		}

		// Extreme positive sentiment
		if (sentiment.score >= thresholds.extremePositive) {
			await this.emitSignal({
				symbol: sentiment.symbol,
				action: "BUY",
				confidence: Math.min(sentiment.score, 0.9),
				price: 0, // Price agent will fill this
				reason: `Strong bullish sentiment (${sentiment.score.toFixed(2)}): ${sentiment.keywords.slice(0, 3).join(", ")}`,
				source: this.name,
				timestamp: sentiment.timestamp,
				metadata: {
					sentimentScore: sentiment.score,
					mentions: sentiment.volume,
					keywords: sentiment.keywords,
					sources: sentiment.sources,
				},
			});
		}

		// Extreme negative sentiment
		if (sentiment.score <= thresholds.extremeNegative) {
			await this.emitSignal({
				symbol: sentiment.symbol,
				action: "SELL",
				confidence: Math.min(Math.abs(sentiment.score), 0.9),
				price: 0,
				reason: `Strong bearish sentiment (${sentiment.score.toFixed(2)}): ${sentiment.keywords.slice(0, 3).join(", ")}`,
				source: this.name,
				timestamp: sentiment.timestamp,
				metadata: {
					sentimentScore: sentiment.score,
					mentions: sentiment.volume,
					keywords: sentiment.keywords,
					sources: sentiment.sources,
				},
			});
		}
	}

	/**
	 * Get current sentiment for a symbol
	 */
	async getSentiment(symbol: string): Promise<SentimentData | null> {
		return this.analyzeSentiment(symbol);
	}

	/**
	 * Get sentiment history
	 */
	getSentimentHistory(symbol: string): SentimentData[] {
		return this.sentimentCache.get(symbol) || [];
	}
}
