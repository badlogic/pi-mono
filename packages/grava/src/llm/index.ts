/**
 * Layer 7: LLM Provider — 基于 pi-ai
 *
 * Unified API · Audit layer calls multiple providers · Cognitive memory injected into system prompt
 *
 * This layer wraps pi-ai to provide:
 * - Primary model for fast mode
 * - Multiple models for audit mode
 * - Cross-provider context portability (makes multi-model audit trivial)
 * - Token/cost tracking across all calls
 */

import type { LlmConfig } from "../types.js";
import type { LlmResponse } from "../audit/index.js";

// ─── LLM Layer ───

export interface LlmCallOptions {
	provider: string;
	model: string;
	systemPrompt: string;
	userMessage: string;
	maxTokens?: number;
	temperature?: number;
}

/**
 * LLM layer wrapping pi-ai's unified provider API.
 *
 * In production, this would import and use pi-ai directly:
 * ```ts
 * import { stream } from "@mariozechner/pi-ai";
 * ```
 *
 * For now, this defines the interface that connects to pi-ai.
 */
export class LlmLayer {
	private totalTokensUsed = 0;
	private totalCalls = 0;

	constructor(private config: LlmConfig) {}

	/** Get the primary provider/model for fast mode */
	get primary(): { provider: string; model: string } {
		return {
			provider: this.config.primaryProvider,
			model: this.config.primaryModel,
		};
	}

	/** Get all audit providers */
	get auditProviders(): { provider: string; model: string }[] {
		return this.config.auditProviders ?? [];
	}

	/**
	 * Call an LLM via pi-ai.
	 *
	 * This is the function passed to AuditEngine.audit() as the `callLlm` parameter.
	 * In production, this calls pi-ai's stream() or complete() function.
	 */
	async call(options: LlmCallOptions): Promise<LlmResponse> {
		this.totalCalls++;

		// In production, this would call pi-ai:
		//
		// const result = await complete({
		//   provider: options.provider,
		//   model: options.model,
		//   messages: [
		//     { role: "system", content: options.systemPrompt },
		//     { role: "user", content: options.userMessage },
		//   ],
		//   maxTokens: options.maxTokens,
		//   temperature: options.temperature,
		// });

		// Placeholder response
		const response: LlmResponse = {
			provider: options.provider,
			model: options.model,
			content: `[LLM response from ${options.provider}/${options.model}]`,
			tokensUsed: 0,
		};

		this.totalTokensUsed += response.tokensUsed;
		return response;
	}

	/** Create a bound caller function for the audit engine */
	createCaller(): (provider: string, model: string, systemPrompt: string, userMessage: string) => Promise<LlmResponse> {
		return (provider, model, systemPrompt, userMessage) =>
			this.call({ provider, model, systemPrompt, userMessage });
	}

	/** Get usage statistics */
	get stats(): { totalTokensUsed: number; totalCalls: number } {
		return { totalTokensUsed: this.totalTokensUsed, totalCalls: this.totalCalls };
	}
}
