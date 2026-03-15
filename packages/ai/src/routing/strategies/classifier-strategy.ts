import { completeSimple } from "../../stream.js";
import type { Model } from "../../types.js";
import { parseStreamingJson } from "../../utils/json-parse.js";
import { CLASSIFIER_SYSTEM_PROMPT, type ClassifierResult } from "../classifier-prompt.js";
import type { RoutingContext, RoutingDecision, RoutingStrategy } from "../types.js";

export interface ClassifierRoutingContext extends RoutingContext {
	apiKey?: string;
}

export class ClassifierRoutingStrategy implements RoutingStrategy {
	readonly name = "Classifier";

	constructor(
		private classifierModel: Model<any> | undefined,
		private completeSimpleFn: typeof completeSimple = completeSimple,
	) {}
	async route(context: ClassifierRoutingContext, availableModels: Model<any>[]): Promise<RoutingDecision | null> {
		if (!this.classifierModel) {
			return null;
		}

		if (!context.apiKey) {
			return null;
		}

		try {
			const startTime = Date.now();

			// Extract last few turns for context
			const historyWindow = context.context.messages.slice(-4);
			const currentRequest = context.context.messages[context.context.messages.length - 1];

			const prompt = `Context:\n${JSON.stringify(historyWindow)}\n\nCurrent Request:\n${JSON.stringify(currentRequest)}`;

			// Call classifier model
			const response = await this.completeSimpleFn(
				this.classifierModel,
				{
					systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
					messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
				},
				{ signal: context.signal, apiKey: context.apiKey },
			);

			const text = response.content.find((c) => c.type === "text")?.text;
			if (!text) {
				return null;
			}

			const result = parseStreamingJson<ClassifierResult>(text);
			if (!result || !result.classification) {
				return null;
			}

			if (result.classification !== "flash" && result.classification !== "pro") {
				return null;
			}

			const selectedModel = this.findModel(context.requestedModel, result.classification, availableModels);

			if (!selectedModel) {
				return null;
			}

			return {
				model: selectedModel,
				reasoning: result.reasoning || "No reasoning provided",
				latencyMs: Date.now() - startTime,
			};
		} catch (_error) {
			return null;
		}
	}

	private findModel(
		requestedModel: Model<any>,
		classification: "flash" | "pro",
		availableModels: Model<any>[],
	): Model<any> | undefined {
		const provider = requestedModel.provider;
		const isGoogle = provider === "google" || provider === "google-gemini-cli";

		const providerModels = availableModels.filter((m) => {
			if (m.id === "auto") return false;
			if (isGoogle) {
				return m.provider === "google" || m.provider === "google-gemini-cli";
			}
			return m.provider === provider;
		});

		if (providerModels.length === 0) return undefined;

		// Sort models by version descending (e.g. 3.1 > 3.0 > 2.5 > 2.0 > 1.5)
		// We extract the version number from the ID
		const getVersion = (id: string) => {
			const match = id.match(/gemini-(\d+\.?\d*)/i);
			return match ? Number.parseFloat(match[1]) : 0;
		};

		const sortedModels = [...providerModels].sort((a, b) => {
			// First prioritize same provider
			if (a.provider === provider && b.provider !== provider) return -1;
			if (a.provider !== provider && b.provider === provider) return 1;

			// Then sort by version descending
			return getVersion(b.id) - getVersion(a.id);
		});

		if (classification === "flash") {
			// Prefer flash models
			return (
				sortedModels.find((m) => m.id.toLowerCase().includes("flash")) ||
				sortedModels.find((m) => !m.id.toLowerCase().includes("pro")) ||
				sortedModels[0]
			);
		} else {
			// Prefer pro models
			return (
				sortedModels.find((m) => m.id.toLowerCase().includes("pro")) ||
				sortedModels.find((m) => !m.id.toLowerCase().includes("flash")) ||
				sortedModels[0]
			);
		}
	}
}
