import { PROVIDERS } from "./models.generated.js";
import type { KnownProvider, Model, Usage } from "./types.js";

// Re-export Model type
export type { KnownProvider, Model } from "./types.js";

// Dynamic model registry initialized from PROVIDERS
const modelRegistry: Map<string, Map<string, Model>> = new Map();

// Initialize registry from PROVIDERS on module load
for (const [provider, models] of Object.entries(PROVIDERS)) {
	const providerModels = new Map<string, Model>();
	for (const [id, model] of Object.entries(models)) {
		providerModels.set(id, model as Model);
	}
	modelRegistry.set(provider, providerModels);
}

/**
 * Get a model from the registry - typed overload for known providers
 */
export function getModel<P extends KnownProvider>(provider: P, modelId: keyof (typeof PROVIDERS)[P]): Model;
export function getModel(provider: string, modelId: string): Model | undefined;
export function getModel(provider: any, modelId: any): Model | undefined {
	return modelRegistry.get(provider)?.get(modelId);
}

/**
 * Register a custom model
 */
export function registerModel(model: Model): void {
	if (!modelRegistry.has(model.provider)) {
		modelRegistry.set(model.provider, new Map());
	}
	modelRegistry.get(model.provider)!.set(model.id, model);
}

/**
 * Calculate cost for token usage
 */
export function calculateCost(model: Model, usage: Usage): Usage["cost"] {
	usage.cost.input = (model.cost.input / 1000000) * usage.input;
	usage.cost.output = (model.cost.output / 1000000) * usage.output;
	usage.cost.cacheRead = (model.cost.cacheRead / 1000000) * usage.cacheRead;
	usage.cost.cacheWrite = (model.cost.cacheWrite / 1000000) * usage.cacheWrite;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage.cost;
}
