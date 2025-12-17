/**
 * Multi-Model Consensus System
 * Inspired by Moon Dev's swarm consensus architecture
 * Queries multiple AI models in parallel for trading decisions
 */

import type { ConsensusResult, PriceData, SentimentData, TradeSignal, TradingAction } from "./types.js";

interface ModelConfig {
	name: string;
	provider: string;
	model: string;
	enabled: boolean;
	weight: number; // Higher weight = more influence
}

interface ConsensusConfig {
	models: ModelConfig[];
	minConfidence: number; // Minimum confidence to act
	minAgreement: number; // Minimum % of models that must agree
	timeout: number; // Max time to wait for all models
}

const DEFAULT_MODELS: ModelConfig[] = [
	{ name: "Claude", provider: "anthropic", model: "claude-sonnet-4-20250514", enabled: true, weight: 1.5 },
	{ name: "GPT-4o", provider: "openai", model: "gpt-4o", enabled: true, weight: 1.0 },
	{ name: "DeepSeek", provider: "deepseek", model: "deepseek-chat", enabled: true, weight: 0.8 },
	{ name: "Llama-3.3-70B", provider: "groq", model: "llama-3.3-70b-versatile", enabled: true, weight: 0.9 },
	{ name: "Mixtral-8x7B", provider: "groq", model: "mixtral-8x7b-32768", enabled: false, weight: 0.7 },
];

export class ConsensusEngine {
	private config: ConsensusConfig;
	private openRouterKey: string | undefined;
	private groqKey: string | undefined;

	constructor(config: Partial<ConsensusConfig> = {}) {
		this.config = {
			models: DEFAULT_MODELS,
			minConfidence: 0.6,
			minAgreement: 0.5, // At least 50% must agree
			timeout: 60000, // 60 seconds
			...config,
		};
		this.openRouterKey = process.env.OPENROUTER_API_KEY;
		this.groqKey = process.env.GROQ_API_KEY;
	}

	/**
	 * Get consensus trading decision from multiple models
	 */
	async getConsensus(
		symbol: string,
		priceData: PriceData,
		sentiment?: SentimentData,
		additionalContext?: string,
	): Promise<ConsensusResult> {
		const enabledModels = this.config.models.filter((m) => m.enabled);

		if (enabledModels.length === 0) {
			throw new Error("No models enabled for consensus");
		}

		const prompt = this.buildPrompt(symbol, priceData, sentiment, additionalContext);

		// Query all models in parallel with timeout
		const modelPromises = enabledModels.map((model) =>
			this.queryModel(model, prompt).catch((error) => ({
				model: model.name,
				action: "HOLD" as TradingAction,
				confidence: 0,
				reasoning: `Error: ${error.message}`,
				error: true,
			})),
		);

		const results = await Promise.race([
			Promise.all(modelPromises),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("Consensus timeout")), this.config.timeout),
			),
		]).catch(() => {
			// On timeout, return what we have
			return modelPromises.map(() => ({
				model: "timeout",
				action: "HOLD" as TradingAction,
				confidence: 0,
				reasoning: "Timeout waiting for response",
				error: true,
			}));
		});

		// Filter out errors and calculate consensus
		const validResults = results.filter((r: any) => !r.error);

		if (validResults.length === 0) {
			return {
				symbol,
				action: "HOLD",
				confidence: 0,
				votes: results as any,
				timestamp: Date.now(),
			};
		}

		// Calculate weighted consensus
		const consensus = this.calculateConsensus(validResults as any, enabledModels);

		return {
			symbol,
			...consensus,
			votes: results as any,
			timestamp: Date.now(),
		};
	}

	private buildPrompt(
		symbol: string,
		priceData: PriceData,
		sentiment?: SentimentData,
		additionalContext?: string,
	): string {
		let prompt = `You are a crypto trading analyst. Analyze the following data and provide a trading recommendation.

## Market Data for ${symbol}
- Current Price: $${priceData.price.toLocaleString()}
- 24h Change: ${priceData.change24h >= 0 ? "+" : ""}${priceData.change24h.toFixed(2)}%
- 24h Volume: $${this.formatNumber(priceData.volume24h)}
- Market Cap: $${this.formatNumber(priceData.marketCap)}
`;

		if (sentiment) {
			prompt += `
## Sentiment Analysis
- Sentiment Score: ${sentiment.score.toFixed(2)} (range: -1 to 1)
- Mentions: ${sentiment.volume}
- Top Keywords: ${sentiment.keywords.slice(0, 5).join(", ")}
- Sources: ${sentiment.sources.slice(0, 3).join(", ")}
`;
		}

		if (additionalContext) {
			prompt += `
## Additional Context
${additionalContext}
`;
		}

		prompt += `
## Your Task
Analyze this data and respond with ONLY a JSON object (no markdown, no explanation):
{
  "action": "BUY" | "SELL" | "HOLD",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation (max 100 chars)"
}

Consider:
- Price momentum and trend
- Volume patterns
- Sentiment indicators
- Risk factors

Be conservative - only recommend BUY/SELL with high conviction.`;

		return prompt;
	}

	private async queryModel(
		model: ModelConfig,
		prompt: string,
	): Promise<{
		model: string;
		action: TradingAction;
		confidence: number;
		reasoning: string;
	}> {
		// Use Groq API directly for Groq models (faster)
		if (model.provider === "groq" && this.groqKey) {
			return this.queryGroq(model, prompt);
		}

		// Fall back to OpenRouter for other providers
		if (!this.openRouterKey) {
			throw new Error("OPENROUTER_API_KEY not set");
		}

		// Map provider to OpenRouter model format
		const modelId = this.getOpenRouterModel(model);

		const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.openRouterKey}`,
				"Content-Type": "application/json",
				"HTTP-Referer": "https://github.com/pi-discord-bot",
			},
			body: JSON.stringify({
				model: modelId,
				messages: [
					{
						role: "user",
						content: prompt,
					},
				],
				temperature: 0.3, // Lower temperature for more consistent trading decisions
				max_tokens: 200,
			}),
		});

		if (!response.ok) {
			throw new Error(`OpenRouter API error: ${response.status}`);
		}

		const data = await response.json();
		const content = data.choices?.[0]?.message?.content || "";

		// Parse JSON response
		try {
			// Extract JSON from response (handle markdown code blocks)
			const jsonMatch = content.match(/\{[\s\S]*\}/);
			if (!jsonMatch) {
				throw new Error("No JSON found in response");
			}

			const parsed = JSON.parse(jsonMatch[0]);

			return {
				model: model.name,
				action: this.normalizeAction(parsed.action),
				confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
				reasoning: String(parsed.reasoning || "").slice(0, 200),
			};
		} catch {
			// If parsing fails, try to extract action from text
			const upperContent = content.toUpperCase();
			let action: TradingAction = "HOLD";
			if (upperContent.includes("BUY")) action = "BUY";
			else if (upperContent.includes("SELL")) action = "SELL";

			return {
				model: model.name,
				action,
				confidence: 0.3, // Low confidence for unparseable responses
				reasoning: "Failed to parse structured response",
			};
		}
	}

	private getOpenRouterModel(model: ModelConfig): string {
		const modelMap: Record<string, string> = {
			"anthropic:claude-sonnet-4-20250514": "anthropic/claude-sonnet-4",
			"openai:gpt-4o": "openai/gpt-4o",
			"deepseek:deepseek-chat": "deepseek/deepseek-chat",
			"google:gemini-pro": "google/gemini-pro",
			"mistral:mistral-large": "mistralai/mistral-large-latest",
		};

		const key = `${model.provider}:${model.model}`;
		return modelMap[key] || model.model;
	}

	private normalizeAction(action: string): TradingAction {
		const upper = String(action).toUpperCase().trim();
		if (upper === "BUY") return "BUY";
		if (upper === "SELL") return "SELL";
		if (upper === "NOTHING") return "NOTHING";
		return "HOLD";
	}

	private calculateConsensus(
		results: Array<{ model: string; action: TradingAction; confidence: number; reasoning: string }>,
		models: ModelConfig[],
	): { action: TradingAction; confidence: number } {
		// Count weighted votes for each action
		const votes: Record<TradingAction, number> = {
			BUY: 0,
			SELL: 0,
			HOLD: 0,
			NOTHING: 0,
		};

		let totalWeight = 0;
		let totalConfidence = 0;

		for (const result of results) {
			const modelConfig = models.find((m) => m.name === result.model);
			const weight = modelConfig?.weight || 1;

			votes[result.action] += weight * result.confidence;
			totalWeight += weight;
			totalConfidence += result.confidence * weight;
		}

		// Find winning action
		let winningAction: TradingAction = "HOLD";
		let maxVotes = 0;

		for (const [action, voteCount] of Object.entries(votes)) {
			if (voteCount > maxVotes) {
				maxVotes = voteCount;
				winningAction = action as TradingAction;
			}
		}

		// Calculate consensus confidence
		const agreementRatio = maxVotes / totalWeight;
		const avgConfidence = totalConfidence / totalWeight;

		// Only act if agreement exceeds threshold
		if (agreementRatio < this.config.minAgreement) {
			return { action: "HOLD", confidence: avgConfidence * agreementRatio };
		}

		return {
			action: winningAction,
			confidence: Math.min(avgConfidence * agreementRatio, 0.95),
		};
	}

	/**
	 * Query Groq API directly (faster inference)
	 */
	private async queryGroq(
		model: ModelConfig,
		prompt: string,
	): Promise<{
		model: string;
		action: TradingAction;
		confidence: number;
		reasoning: string;
	}> {
		const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.groqKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: model.model,
				messages: [
					{
						role: "user",
						content: prompt,
					},
				],
				temperature: 0.3,
				max_tokens: 200,
			}),
		});

		if (!response.ok) {
			throw new Error(`Groq API error: ${response.status}`);
		}

		const data = await response.json();
		const content = data.choices?.[0]?.message?.content || "";

		// Parse JSON response
		try {
			const jsonMatch = content.match(/\{[\s\S]*\}/);
			if (!jsonMatch) {
				throw new Error("No JSON found in response");
			}

			const parsed = JSON.parse(jsonMatch[0]);

			return {
				model: model.name,
				action: this.normalizeAction(parsed.action),
				confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
				reasoning: String(parsed.reasoning || "").slice(0, 200),
			};
		} catch {
			// Fallback parsing
			const upperContent = content.toUpperCase();
			let action: TradingAction = "HOLD";
			if (upperContent.includes("BUY")) action = "BUY";
			else if (upperContent.includes("SELL")) action = "SELL";

			return {
				model: model.name,
				action,
				confidence: 0.3,
				reasoning: "Failed to parse structured response",
			};
		}
	}

	private formatNumber(num: number): string {
		if (num >= 1e12) return `${(num / 1e12).toFixed(2)}T`;
		if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
		if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
		if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
		return num.toFixed(2);
	}

	/**
	 * Quick single-model analysis (faster, cheaper)
	 */
	async quickAnalysis(symbol: string, priceData: PriceData, sentiment?: SentimentData): Promise<TradeSignal> {
		const primaryModel = this.config.models.find((m) => m.enabled) || DEFAULT_MODELS[0];
		const prompt = this.buildPrompt(symbol, priceData, sentiment);

		const result = await this.queryModel(primaryModel, prompt);

		return {
			symbol,
			action: result.action,
			confidence: result.confidence,
			price: priceData.price,
			reason: result.reasoning,
			source: `Consensus:${result.model}`,
			timestamp: Date.now(),
		};
	}
}
