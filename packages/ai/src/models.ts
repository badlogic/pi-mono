import { MODELS } from "./models.generated.js";
import type { Api, KnownProvider, Model, ReasoningEffort, Usage } from "./types.js";

const modelRegistry: Map<string, Map<string, Model<Api>>> = new Map();

const CODEX_THINKING_SUFFIXES = ["-none", "-minimal", "-low", "-medium", "-high", "-xhigh"];
const CODEX_THINKING_LEVELS: Record<string, ReasoningEffort[]> = {
	"gpt-5.2-codex": ["low", "medium", "high", "xhigh"],
	"gpt-5.1-codex-max": ["low", "medium", "high", "xhigh"],
	"gpt-5.1-codex": ["low", "medium", "high"],
	"gpt-5.1-codex-mini": ["medium", "high"],
	"codex-mini-latest": ["medium", "high"],
	"gpt-5-codex-mini": ["medium", "high"],
	"gpt-5-codex": ["low", "medium", "high"],
};

function isCodexThinkingVariant(modelId: string): boolean {
	const normalized = modelId.toLowerCase();
	return CODEX_THINKING_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function normalizeCodexModelId(modelId: string): string {
	const normalized = modelId.toLowerCase();
	for (const suffix of CODEX_THINKING_SUFFIXES) {
		if (normalized.endsWith(suffix)) {
			return modelId.slice(0, modelId.length - suffix.length);
		}
	}
	return modelId;
}

function applyCodexThinkingLevels<TApi extends Api>(model: Model<TApi>): Model<TApi> {
	if (model.provider !== "openai-codex") return model;
	const thinkingLevels = CODEX_THINKING_LEVELS[model.id];
	if (!thinkingLevels) return model;
	return { ...model, thinkingLevels };
}

// Initialize registry from MODELS on module load
for (const [provider, models] of Object.entries(MODELS)) {
	const providerModels = new Map<string, Model<Api>>();
	for (const [id, model] of Object.entries(models)) {
		const typedModel = model as Model<Api>;
		if (provider === "openai-codex" && isCodexThinkingVariant(typedModel.id)) {
			continue;
		}
		providerModels.set(id, applyCodexThinkingLevels(typedModel));
	}
	modelRegistry.set(provider, providerModels);
}

type ModelApi<
	TProvider extends KnownProvider,
	TModelId extends keyof (typeof MODELS)[TProvider],
> = (typeof MODELS)[TProvider][TModelId] extends { api: infer TApi } ? (TApi extends Api ? TApi : never) : never;

export function getModel<TProvider extends KnownProvider, TModelId extends keyof (typeof MODELS)[TProvider]>(
	provider: TProvider,
	modelId: TModelId,
): Model<ModelApi<TProvider, TModelId>> {
	const providerModels = modelRegistry.get(provider);
	const direct = providerModels?.get(modelId as string);
	if (direct) return direct as Model<ModelApi<TProvider, TModelId>>;
	if (provider === "openai-codex") {
		const normalized = normalizeCodexModelId(modelId as string);
		const normalizedModel = providerModels?.get(normalized);
		if (normalizedModel) {
			return normalizedModel as Model<ModelApi<TProvider, TModelId>>;
		}
	}
	return direct as unknown as Model<ModelApi<TProvider, TModelId>>;
}

export function getProviders(): KnownProvider[] {
	return Array.from(modelRegistry.keys()) as KnownProvider[];
}

export function getModels<TProvider extends KnownProvider>(
	provider: TProvider,
): Model<ModelApi<TProvider, keyof (typeof MODELS)[TProvider]>>[] {
	const models = modelRegistry.get(provider);
	return models ? (Array.from(models.values()) as Model<ModelApi<TProvider, keyof (typeof MODELS)[TProvider]>>[]) : [];
}

export function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage["cost"] {
	usage.cost.input = (model.cost.input / 1000000) * usage.input;
	usage.cost.output = (model.cost.output / 1000000) * usage.output;
	usage.cost.cacheRead = (model.cost.cacheRead / 1000000) * usage.cacheRead;
	usage.cost.cacheWrite = (model.cost.cacheWrite / 1000000) * usage.cacheWrite;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage.cost;
}

/** Models that support xhigh thinking level */
const XHIGH_MODELS = new Set(["gpt-5.1-codex-max", "gpt-5.2", "gpt-5.2-codex"]);

/**
 * Check if a model supports xhigh thinking level.
 * Currently only certain OpenAI models support this.
 */
export function supportsXhigh<TApi extends Api>(model: Model<TApi>): boolean {
	if (model.thinkingLevels) {
		return model.thinkingLevels.includes("xhigh");
	}
	return XHIGH_MODELS.has(model.id);
}

/**
 * Check if two models are equal by comparing both their id and provider.
 * Returns false if either model is null or undefined.
 */
export function modelsAreEqual<TApi extends Api>(
	a: Model<TApi> | null | undefined,
	b: Model<TApi> | null | undefined,
): boolean {
	if (!a || !b) return false;
	return a.id === b.id && a.provider === b.provider;
}
