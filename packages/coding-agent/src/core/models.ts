/**
 * Model utilities - provides access to built-in models and utility functions.
 */

import type { Api, KnownProvider, ModelInfo, Usage } from "./ai-types.js";
import { MODELS } from "./models.generated.js";

const modelRegistry: Map<string, Map<string, ModelInfo<Api>>> = new Map();

// Initialize registry from MODELS on module load
for (const [provider, models] of Object.entries(MODELS)) {
	const providerModels = new Map<string, ModelInfo<Api>>();
	for (const [id, model] of Object.entries(models)) {
		providerModels.set(id, model as ModelInfo<Api>);
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
): ModelInfo<ModelApi<TProvider, TModelId>> {
	const providerModels = modelRegistry.get(provider);
	return providerModels?.get(modelId as string) as ModelInfo<ModelApi<TProvider, TModelId>>;
}

export function getProviders(): KnownProvider[] {
	return Array.from(modelRegistry.keys()) as KnownProvider[];
}

export function getModels<TProvider extends KnownProvider>(
	provider: TProvider,
): ModelInfo<ModelApi<TProvider, keyof (typeof MODELS)[TProvider]>>[] {
	const models = modelRegistry.get(provider);
	return models
		? (Array.from(models.values()) as ModelInfo<ModelApi<TProvider, keyof (typeof MODELS)[TProvider]>>[])
		: [];
}

export function calculateCost<TApi extends Api>(model: ModelInfo<TApi>, usage: Usage): Usage["cost"] {
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
 */
export function supportsXhigh<TApi extends Api>(model: ModelInfo<TApi>): boolean {
	return XHIGH_MODELS.has(model.id);
}

/**
 * Check if two models are equal by comparing both their id and provider.
 */
export function modelsAreEqual<TApi extends Api>(
	a: ModelInfo<TApi> | null | undefined,
	b: ModelInfo<TApi> | null | undefined,
): boolean {
	if (!a || !b) return false;
	return a.id === b.id && a.provider === b.provider;
}
