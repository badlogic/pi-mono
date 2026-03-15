import type { Api, Context, Model } from "../types.js";

export interface RoutingContext {
	requestedModel: Model<Api>;
	context: Context;
	signal?: AbortSignal;
}

export interface RoutingDecision {
	model: Model<Api>;
	reasoning: string;
	latencyMs: number;
}

export interface RoutingStrategy {
	name: string;
	route(context: RoutingContext, availableModels: Model<any>[]): Promise<RoutingDecision | null>;
}
