/**
 * Shared discriminator module for energy-aware demos.
 *
 * A lightweight classifier (GPT-OSS-20B) evaluates each prompt and returns a
 * RoutingDecision selecting one of four tiers based on task complexity and
 * whether chain-of-thought reasoning is needed:
 *
 *   thinking → Kimi K2.5      (0.21 tok/J, $1.327/1M)  — CoT reasoning, debugging
 *   complex  → Qwen3.5 397B  (1.03 tok/J, $0/1M)      — high quality, no CoT needed
 *   medium   → Devstral 24B  (9.92 tok/J, $0.12/1M)   — moderate complexity
 *   simple   → GPT-OSS 20B   (0.50 tok/J, $0.10/1M)   — boilerplate, obvious tasks
 *
 * Tiers are optional in the config — if "thinking" or "medium" are omitted,
 * the classifier falls back to the nearest configured tier.
 *
 * Both demos (coding-agent and hn-watcher) use this module. Each provides its
 * own DiscriminatorConfig with domain-appropriate models and a system prompt
 * tuned to its classification task.
 */

import { completeSimple, type Model, type ModelCapability } from "@mariozechner/pi-ai";

// -- Types --------------------------------------------------------------------

export type DiscriminatorTier = "thinking" | "complex" | "medium" | "simple";

export interface DiscriminatorTierConfig {
	/** Model to use for this tier. */
	model: Model<"openai-completions">;
	/**
	 * Max tokens for "brief" responses. When the classifier returns
	 * length="brief", this cap is applied to the downstream model call.
	 * Undefined means no cap — use the model's default maxTokens.
	 */
	briefMaxTokens?: number;
}

export interface DiscriminatorConfig {
	/** Lightweight model used to classify prompts (low cost, fast). */
	classifierModel: Model<"openai-completions">;
	/**
	 * Tasks needing step-by-step reasoning, chain-of-thought, or debugging.
	 * Falls back to `complex` if not configured.
	 * Recommended: Kimi K2.5 (strong CoT, 262K context).
	 */
	thinking?: DiscriminatorTierConfig;
	/**
	 * High-quality tasks where a direct answer suffices (no CoT needed).
	 * Required.
	 * Recommended: Qwen3.5-397B ($0/1M, free tier).
	 */
	complex: DiscriminatorTierConfig;
	/**
	 * Moderate-complexity tasks: clear but non-trivial implementation.
	 * Falls back to `simple` if not configured.
	 * Recommended: Devstral-24B (0.809 tok/J, 262K context).
	 */
	medium?: DiscriminatorTierConfig;
	/**
	 * Boilerplate, obvious implementation, or very short answers.
	 * Required.
	 * Recommended: GPT-OSS-20B (1.371 tok/J, most energy-efficient).
	 */
	simple: DiscriminatorTierConfig;
	/**
	 * Energy efficiency in tokens per joule per model id.
	 * Used as a fallback when the API does not return energy_joules.
	 */
	tokensPerJoule: Record<string, number>;
	/** System prompt override. Uses DEFAULT_DISCRIMINATOR_SYSTEM_PROMPT if not set. */
	systemPrompt?: string;
}

export interface RoutingDecision {
	/** Which tier the classifier chose. */
	tier: DiscriminatorTier;
	/** Model to call for the downstream task. */
	model: Model<"openai-completions">;
	/**
	 * When the classifier returns length="brief", this is the max tokens cap
	 * from the tier config. Undefined means no cap.
	 */
	maxTokens?: number;
	/** Short explanation from the classifier (≤ 80 characters). */
	reason: string;
	/** Energy spent on the discriminator call itself, in joules. */
	energyJ: number;
}

export interface DiscriminateOptions {
	/** Required model capabilities. If set, the resolved tier's model must support all of them. */
	requires?: ModelCapability[];
	/**
	 * Maximum tier the classifier is allowed to select (cost ceiling).
	 * Tier order: simple < medium < complex < thinking.
	 * If the classifier picks a tier above maxTier, it is clamped down to maxTier.
	 */
	maxTier?: DiscriminatorTier;
}

// -- Default system prompt ----------------------------------------------------

/**
 * Four-tier discriminator prompt. Works for general tasks — override via
 * DiscriminatorConfig.systemPrompt for domain-specific classification.
 */
export const DEFAULT_DISCRIMINATOR_SYSTEM_PROMPT =
	"You are a prompt routing classifier for a four-tier AI system.\n" +
	"Choose the tier that best matches the task:\n" +
	'  "thinking" — needs step-by-step reasoning, debugging, or chain-of-thought (Kimi K2.5)\n' +
	'  "complex"  — needs high quality but reasoning is not required; direct answer ok (Qwen3.5 397B)\n' +
	'  "medium"   — moderately complex but clear spec; no deep reasoning needed (Devstral 24B)\n' +
	'  "simple"   — boilerplate, obvious implementation, or trivial answer (GPT-OSS 20B)\n' +
	'Also classify response length: "full" if a detailed response is needed, "brief" if a short concise answer suffices.\n' +
	'Reply with ONLY valid JSON: {"tier":"medium","length":"full","reason":"<=10 words"}';

/** Tier cost order: lower index = cheaper. */
const TIER_ORDER: DiscriminatorTier[] = ["simple", "medium", "complex", "thinking"];

/** Clamp a tier down to a maximum allowed tier. */
function clampTier(tier: DiscriminatorTier, maxTier: DiscriminatorTier): DiscriminatorTier {
	const tierIdx = TIER_ORDER.indexOf(tier);
	const maxIdx = TIER_ORDER.indexOf(maxTier);
	return tierIdx > maxIdx ? maxTier : tier;
}

// -- Tier resolution ----------------------------------------------------------

/** Returns true if the model's capabilities include all required capabilities. */
function meetsRequirements(model: Model<"openai-completions">, requires: ModelCapability[]): boolean {
	if (requires.length === 0) return true;
	const caps = model.capabilities ?? [];
	return requires.every((r) => caps.includes(r));
}

/**
 * Resolves a tier name to the configured TierConfig, falling back gracefully
 * when optional tiers are not configured:
 *   thinking → complex (if thinking not configured)
 *   medium   → simple  (if medium not configured)
 */
function resolveTier(
	tier: DiscriminatorTier,
	config: DiscriminatorConfig,
): { resolvedTier: DiscriminatorTier; tierConfig: DiscriminatorTierConfig } {
	if (tier === "thinking") {
		return config.thinking
			? { resolvedTier: "thinking", tierConfig: config.thinking }
			: { resolvedTier: "complex", tierConfig: config.complex };
	}
	if (tier === "medium") {
		return config.medium
			? { resolvedTier: "medium", tierConfig: config.medium }
			: { resolvedTier: "simple", tierConfig: config.simple };
	}
	if (tier === "simple") return { resolvedTier: "simple", tierConfig: config.simple };
	return { resolvedTier: "complex", tierConfig: config.complex };
}

/**
 * Fallback chains per tier: when the resolved tier's model lacks required
 * capabilities, try these tiers in order.
 */
const FALLBACK_CHAINS: Record<DiscriminatorTier, DiscriminatorTier[]> = {
	simple: ["medium", "complex", "thinking"],
	medium: ["simple", "complex", "thinking"],
	complex: ["medium", "simple", "thinking"],
	thinking: ["complex", "medium", "simple"],
};

/**
 * Like resolveTier, but walks a fallback chain when the initial tier's model
 * doesn't meet capability requirements. Falls back to `complex` as safe default.
 */
function resolveTierWithRequirements(
	tier: DiscriminatorTier,
	config: DiscriminatorConfig,
	requires: ModelCapability[],
): { resolvedTier: DiscriminatorTier; tierConfig: DiscriminatorTierConfig } {
	const primary = resolveTier(tier, config);
	if (meetsRequirements(primary.tierConfig.model, requires)) return primary;

	for (const fallback of FALLBACK_CHAINS[tier]) {
		const candidate = resolveTier(fallback, config);
		if (meetsRequirements(candidate.tierConfig.model, requires)) return candidate;
	}

	// Last resort: complex is always defined
	return { resolvedTier: "complex", tierConfig: config.complex };
}

// -- Core function ------------------------------------------------------------

/**
 * Classifies a prompt and returns a full RoutingDecision.
 *
 * Falls back to complex+full (safe default) on any error.
 *
 * @param phase      Short label for this context, e.g. "build-1" or "score".
 * @param prompt     Task prompt to classify (truncated to 500 chars).
 * @param config     Tier configs, energy rates, optional system prompt override.
 * @param memContext Optional memory context injected before the prompt.
 * @param apiKey     Neuralwatt API key.
 * @param options    Optional: require specific model capabilities (e.g. tool_calling).
 */
export async function discriminate(
	phase: string,
	prompt: string,
	config: DiscriminatorConfig,
	memContext: string,
	apiKey: string,
	options?: DiscriminateOptions,
): Promise<RoutingDecision> {
	const systemPrompt = config.systemPrompt ?? DEFAULT_DISCRIMINATOR_SYSTEM_PROMPT;
	const contextPrefix = memContext ? `${memContext}\n\n` : "";
	const input = `${contextPrefix}Classify (phase: ${phase}):\n${prompt.slice(0, 500)}`;

	try {
		const msg = await completeSimple(
			config.classifierModel,
			{
				systemPrompt,
				messages: [{ role: "user", content: input, timestamp: Date.now() }],
			},
			{ apiKey, maxTokens: 60 },
		);

		const raw = msg.content
			.filter((c) => c.type === "text")
			.map((c) => (c as { type: "text"; text: string }).text)
			.join("")
			.trim();

		const api = msg.energy?.energy_joules;
		const tokensPerJoule = config.tokensPerJoule[config.classifierModel.id] ?? 1.0;
		const energyJ = api != null && api > 0 ? api : msg.usage.totalTokens / tokensPerJoule;

		// Parse JSON from classifier response
		let parsed: { tier?: string; length?: string; reason?: string } = {};
		try {
			parsed = JSON.parse(raw) as typeof parsed;
		} catch {
			const m = raw.match(/\{[^{}]+\}/);
			if (m) {
				try {
					parsed = JSON.parse(m[0]) as typeof parsed;
				} catch {
					// Fall through to defaults
				}
			}
		}

		const VALID_TIERS: DiscriminatorTier[] = ["thinking", "complex", "medium", "simple"];
		const rawTier = typeof parsed.tier === "string" ? parsed.tier : "complex";
		const tier: DiscriminatorTier = (VALID_TIERS as string[]).includes(rawTier)
			? (rawTier as DiscriminatorTier)
			: "complex";

		const clampedTier = options?.maxTier ? clampTier(tier, options.maxTier) : tier;
		const requires = options?.requires ?? [];
		const { resolvedTier, tierConfig } =
			requires.length > 0
				? resolveTierWithRequirements(clampedTier, config, requires)
				: resolveTier(clampedTier, config);
		const isBrief = parsed.length === "brief";
		const maxTokens = isBrief ? tierConfig.briefMaxTokens : undefined;
		const reason =
			typeof parsed.reason === "string" && parsed.reason.length > 0 ? parsed.reason.slice(0, 80) : resolvedTier;

		return { tier: resolvedTier, model: tierConfig.model, maxTokens, reason, energyJ };
	} catch {
		return {
			tier: "complex",
			model: config.complex.model,
			maxTokens: undefined,
			reason: "fallback (classifier error)",
			energyJ: 0,
		};
	}
}
