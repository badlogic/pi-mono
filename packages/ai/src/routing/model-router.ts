import type { Model } from "../types.js";
import type { RoutingContext, RoutingDecision, RoutingStrategy } from "./types.js";

export class ModelRouterService {
	constructor(private strategies: RoutingStrategy[]) {}

	async route(context: RoutingContext, availableModels: Model<any>[]): Promise<RoutingDecision> {
		for (const strategy of this.strategies) {
			try {
				const decision = await strategy.route(context, availableModels);
				if (decision) {
					return decision;
				}
			} catch (error) {
				console.warn(`[ModelRouterService] Strategy ${strategy.name} failed:`, error);
			}
		}

		// Fallback to the requested model as is if no strategy matched
		return {
			model: context.requestedModel,
			reasoning: "No routing strategy matched, using requested model as fallback",
			latencyMs: 0,
		};
	}
}
