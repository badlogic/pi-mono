import { PROVIDERS } from "./models.generated.js";
import type { Api, KnownProvider, Model, Usage } from "./types.js";

const modelRegistry: Map<string, Map<string, Model<Api>>> = new Map();

// Initialize registry from PROVIDERS on module load
for (const [provider, models] of Object.entries(PROVIDERS)) {
	const providerModels = new Map<string, Model<Api>>();
	for (const [id, model] of Object.entries(models)) {
		providerModels.set(id, model as Model<Api>);
	}
	modelRegistry.set(provider, providerModels);
}

type ModelApi<
	TProvider extends KnownProvider,
	TModelId extends keyof (typeof PROVIDERS)[TProvider],
> = (typeof PROVIDERS)[TProvider][TModelId] extends { api: infer TApi } ? (TApi extends Api ? TApi : never) : never;

export function getModel<TProvider extends KnownProvider, TModelId extends keyof (typeof PROVIDERS)[TProvider]>(
	provider: TProvider,
	modelId: TModelId,
): Model<ModelApi<TProvider, TModelId>>;
export function getModel<TApi extends Api>(provider: string, modelId: string): Model<TApi> | undefined;
export function getModel<TApi extends Api>(provider: any, modelId: any): Model<TApi> | undefined {
	return modelRegistry.get(provider)?.get(modelId) as Model<TApi> | undefined;
}

export function registerModel<TApi extends Api>(model: Model<TApi>): void {
	if (!modelRegistry.has(model.provider)) {
		modelRegistry.set(model.provider, new Map());
	}
	modelRegistry.get(model.provider)!.set(model.id, model);
}

export function calculateCost<TApi extends Api>(model: Model<TApi>, usage: Usage): Usage["cost"] {
	usage.cost.input = (model.cost.input / 1000000) * usage.input;
	usage.cost.output = (model.cost.output / 1000000) * usage.output;
	usage.cost.cacheRead = (model.cost.cacheRead / 1000000) * usage.cacheRead;
	usage.cost.cacheWrite = (model.cost.cacheWrite / 1000000) * usage.cacheWrite;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage.cost;
}
