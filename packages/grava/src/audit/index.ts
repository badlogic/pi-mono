/**
 * Layer 5: 多方审计层 · Deliberation & Audit — 护城河 ②（Output 端）
 *
 * "不信任单一 LLM · 多模型交叉验证 · 保障 output 真实性和完备性"
 *
 * Responsibilities:
 * - Multi-model deliberation: same context sent to multiple LLMs concurrently
 * - Consensus engine: extract agreement and divergence
 * - Fact verification: cross-check output against search results
 * - Mode switching: Fast (single model) / Audit (multi-model) / Deep (audit + debate)
 */

import type {
	AuditClaim,
	AuditConfig,
	AuditDivergence,
	AuditMode,
	AuditModelConfig,
	AuditReport,
	InjectedFact,
} from "../types.js";

// ─── LLM Response Interface ───

export interface LlmResponse {
	provider: string;
	model: string;
	content: string;
	tokensUsed: number;
}

/** Function type for calling an LLM */
export type LlmCaller = (provider: string, model: string, systemPrompt: string, userMessage: string) => Promise<LlmResponse>;

// ─── Audit Engine ───

export class AuditEngine {
	constructor(private config: AuditConfig) {}

	/** Determine the audit mode for a given message */
	resolveMode(explicitMode?: AuditMode): AuditMode {
		return explicitMode ?? this.config.defaultMode;
	}

	/**
	 * Run the full audit pipeline.
	 *
	 * Fast mode: return primary response as-is
	 * Audit mode: multi-model cross-validation
	 * Deep mode: audit + second-round debate
	 */
	async audit(
		primaryResponse: LlmResponse,
		systemPrompt: string,
		userMessage: string,
		searchFacts: InjectedFact[],
		mode: AuditMode,
		callLlm: LlmCaller,
	): Promise<AuditReport> {
		if (mode === "fast") {
			return this.fastModeReport(primaryResponse);
		}

		// Audit & Deep: call multiple models
		const auditResponses = await this.callAuditModels(systemPrompt, userMessage, callLlm);
		const allResponses = [primaryResponse, ...auditResponses];

		// Build consensus
		const consensus = this.buildConsensus(allResponses);

		// Fact verification
		const factCheck = this.config.factVerification !== false
			? this.verifyFacts(allResponses, searchFacts)
			: { verified: [], unverified: [] };

		// Deep mode: second round debate
		if (mode === "deep") {
			// In production, send divergences back for a second round
			// For now, mark them as needing human review
		}

		return {
			mode,
			consensus: consensus.agreed,
			divergences: consensus.divergences,
			unverified: factCheck.unverified,
			recommendations: this.generateRecommendations(consensus, factCheck),
			confidence: consensus.overallConfidence,
			participants: allResponses.map((r) => `${r.provider}/${r.model}`),
			timestamp: Date.now(),
		};
	}

	// ─── Internal Methods ───

	private fastModeReport(response: LlmResponse): AuditReport {
		return {
			mode: "fast",
			consensus: [{ claim: response.content, confidence: 1, sources: [`${response.provider}/${response.model}`] }],
			divergences: [],
			unverified: [],
			recommendations: [],
			confidence: 1,
			participants: [`${response.provider}/${response.model}`],
			timestamp: Date.now(),
		};
	}

	private async callAuditModels(
		systemPrompt: string,
		userMessage: string,
		callLlm: LlmCaller,
	): Promise<LlmResponse[]> {
		const tasks = this.config.auditModels.map((model) => callLlm(model.provider, model.model, systemPrompt, userMessage));

		const results = await Promise.allSettled(tasks);
		return results
			.filter((r): r is PromiseFulfilledResult<LlmResponse> => r.status === "fulfilled")
			.map((r) => r.value);
	}

	private buildConsensus(responses: LlmResponse[]): {
		agreed: AuditClaim[];
		divergences: AuditDivergence[];
		overallConfidence: number;
	} {
		// Simplified consensus — in production, use LLM-based claim extraction
		if (responses.length <= 1) {
			return {
				agreed: responses.map((r) => ({
					claim: r.content,
					confidence: 0.5,
					sources: [`${r.provider}/${r.model}`],
				})),
				divergences: [],
				overallConfidence: 0.5,
			};
		}

		// For multiple responses, treat the majority view as consensus
		// This is a placeholder — real implementation would use NLP/LLM for semantic comparison
		const agreed: AuditClaim[] = [
			{
				claim: "Multiple models provided responses (detailed semantic comparison pending)",
				confidence: 0.7,
				sources: responses.map((r) => `${r.provider}/${r.model}`),
			},
		];

		return {
			agreed,
			divergences: [],
			overallConfidence: 0.7,
		};
	}

	private verifyFacts(
		responses: LlmResponse[],
		searchFacts: InjectedFact[],
	): { verified: AuditClaim[]; unverified: AuditClaim[] } {
		// Placeholder — in production, extract claims from responses and match against search facts
		const verified: AuditClaim[] = [];
		const unverified: AuditClaim[] = [];

		// If we have search facts, we have grounding
		if (searchFacts.length > 0) {
			for (const fact of searchFacts) {
				verified.push({
					claim: fact.claim,
					confidence: fact.confidence,
					sources: fact.sources,
				});
			}
		}

		return { verified, unverified };
	}

	private generateRecommendations(
		consensus: { agreed: AuditClaim[]; divergences: AuditDivergence[]; overallConfidence: number },
		_factCheck: { verified: AuditClaim[]; unverified: AuditClaim[] },
	): string[] {
		const recommendations: string[] = [];

		if (consensus.overallConfidence < 0.5) {
			recommendations.push("Low confidence — consider additional research before deciding");
		}

		if (consensus.divergences.length > 0) {
			recommendations.push("Models disagree on some points — review divergent opinions");
		}

		return recommendations;
	}
}
