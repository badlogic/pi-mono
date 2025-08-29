#!/usr/bin/env tsx

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

interface ModelsDevModel {
	id: string;
	name: string;
	tool_call?: boolean;
	reasoning?: boolean;
	limit?: {
		context?: number;
		output?: number;
	};
	cost?: {
		input?: number;
		output?: number;
		cache_read?: number;
		cache_write?: number;
	};
	modalities?: {
		input?: string[];
	};
}

interface NormalizedModel {
	id: string;
	name: string;
	provider: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	contextWindow: number;
	maxTokens: number;
}

async function fetchOpenRouterModels(): Promise<NormalizedModel[]> {
	try {
		console.log("🌐 Fetching models from OpenRouter API...");
		const response = await fetch("https://openrouter.ai/api/v1/models");
		const data = await response.json();

		const models: NormalizedModel[] = [];

		for (const model of data.data) {
			// Only include models that support tools
			if (!model.supported_parameters?.includes("tools")) continue;

			// Parse provider from model ID
			const [providerPrefix] = model.id.split("/");
			let provider = "";
			let modelKey = model.id;

			// Map provider prefixes to our provider names
			if (model.id.startsWith("google/")) {
				provider = "google";
				modelKey = model.id.replace("google/", "");
			} else if (model.id.startsWith("openai/")) {
				provider = "openai";
				modelKey = model.id.replace("openai/", "");
			} else if (model.id.startsWith("anthropic/")) {
				provider = "anthropic";
				modelKey = model.id.replace("anthropic/", "");
			} else if (model.id.startsWith("x-ai/")) {
				provider = "xai";
				modelKey = model.id.replace("x-ai/", "");
			} else {
				// All other models go through OpenRouter
				provider = "openrouter";
				modelKey = model.id; // Keep full ID for OpenRouter
			}

			// Skip if not one of our supported providers
			if (!["google", "openai", "anthropic", "xai", "openrouter"].includes(provider)) {
				continue;
			}

			// Parse input modalities
			const input: ("text" | "image")[] = ["text"];
			if (model.architecture?.modality?.includes("image")) {
				input.push("image");
			}

			// Convert pricing from $/token to $/million tokens
			const inputCost = parseFloat(model.pricing?.prompt || "0") * 1_000_000;
			const outputCost = parseFloat(model.pricing?.completion || "0") * 1_000_000;
			const cacheReadCost = parseFloat(model.pricing?.input_cache_read || "0") * 1_000_000;
			const cacheWriteCost = parseFloat(model.pricing?.input_cache_write || "0") * 1_000_000;

			models.push({
				id: modelKey,
				name: model.name,
				provider,
				reasoning: model.supported_parameters?.includes("reasoning") || false,
				input,
				cost: {
					input: inputCost,
					output: outputCost,
					cacheRead: cacheReadCost,
					cacheWrite: cacheWriteCost,
				},
				contextWindow: model.context_length || 4096,
				maxTokens: model.top_provider?.max_completion_tokens || 4096,
			});
		}

		console.log(`✅ Fetched ${models.length} tool-capable models from OpenRouter`);
		return models;
	} catch (error) {
		console.error("❌ Failed to fetch OpenRouter models:", error);
		return [];
	}
}

function loadModelsDevData(): NormalizedModel[] {
	try {
		console.log("📁 Loading models from models.json...");
		const data = JSON.parse(readFileSync(join(process.cwd(), "src/models.json"), "utf-8"));

		const models: NormalizedModel[] = [];

		// Process Groq models
		if (data.groq?.models) {
			for (const [modelId, model] of Object.entries(data.groq.models)) {
				const m = model as ModelsDevModel;
				if (m.tool_call !== true) continue;

				models.push({
					id: modelId,
					name: m.name || modelId,
					provider: "groq",
					reasoning: m.reasoning === true,
					input: m.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
					cost: {
						input: m.cost?.input || 0,
						output: m.cost?.output || 0,
						cacheRead: m.cost?.cache_read || 0,
						cacheWrite: m.cost?.cache_write || 0,
					},
					contextWindow: m.limit?.context || 4096,
					maxTokens: m.limit?.output || 4096,
				});
			}
		}

		// Process Cerebras models
		if (data.cerebras?.models) {
			for (const [modelId, model] of Object.entries(data.cerebras.models)) {
				const m = model as ModelsDevModel;
				if (m.tool_call !== true) continue;

				models.push({
					id: modelId,
					name: m.name || modelId,
					provider: "cerebras",
					reasoning: m.reasoning === true,
					input: m.modalities?.input?.includes("image") ? ["text", "image"] : ["text"],
					cost: {
						input: m.cost?.input || 0,
						output: m.cost?.output || 0,
						cacheRead: m.cost?.cache_read || 0,
						cacheWrite: m.cost?.cache_write || 0,
					},
					contextWindow: m.limit?.context || 4096,
					maxTokens: m.limit?.output || 4096,
				});
			}
		}

		console.log(`✅ Loaded ${models.length} tool-capable models from models.dev`);
		return models;
	} catch (error) {
		console.error("❌ Failed to load models.dev data:", error);
		return [];
	}
}

async function generateModels() {
	// Fetch all models
	const openRouterModels = await fetchOpenRouterModels();
	const modelsDevModels = loadModelsDevData();

	// Combine models (models.dev takes priority for Groq/Cerebras)
	const allModels = [...modelsDevModels, ...openRouterModels];

	// Group by provider
	const providers: Record<string, NormalizedModel[]> = {};
	for (const model of allModels) {
		if (!providers[model.provider]) {
			providers[model.provider] = [];
		}
		providers[model.provider].push(model);
	}

	// Generate TypeScript file
	let output = `// This file is auto-generated by scripts/generate-models.ts
// Do not edit manually - run 'npm run generate-models' to update

import type { Model } from "./types.js";

export const PROVIDERS = {
`;

	// Generate provider sections
	for (const [providerId, models] of Object.entries(providers)) {
		output += `\t${providerId}: {\n`;
		output += `\t\tmodels: {\n`;

		for (const model of models) {
			output += `\t\t\t"${model.id}": {\n`;
			output += `\t\t\t\tid: "${model.id}",\n`;
			output += `\t\t\t\tname: "${model.name}",\n`;
			output += `\t\t\t\tprovider: "${model.provider}",\n`;
			output += `\t\t\t\treasoning: ${model.reasoning},\n`;
			output += `\t\t\t\tinput: ${JSON.stringify(model.input)},\n`;
			output += `\t\t\t\tcost: {\n`;
			output += `\t\t\t\t\tinput: ${model.cost.input},\n`;
			output += `\t\t\t\t\toutput: ${model.cost.output},\n`;
			output += `\t\t\t\t\tcacheRead: ${model.cost.cacheRead},\n`;
			output += `\t\t\t\t\tcacheWrite: ${model.cost.cacheWrite},\n`;
			output += `\t\t\t\t},\n`;
			output += `\t\t\t\tcontextWindow: ${model.contextWindow},\n`;
			output += `\t\t\t\tmaxTokens: ${model.maxTokens},\n`;
			output += `\t\t\t} satisfies Model,\n`;
		}

		output += `\t\t}\n`;
		output += `\t},\n`;
	}

	output += `} as const;

// Helper type to extract models for each provider
export type ProviderModels = {
	[K in keyof typeof PROVIDERS]: typeof PROVIDERS[K]["models"]
};
`;

	// Write file
	writeFileSync(join(process.cwd(), "src/models.generated.ts"), output);
	console.log("✅ Generated src/models.generated.ts");

	// Print statistics
	const totalModels = allModels.length;
	const reasoningModels = allModels.filter(m => m.reasoning).length;

	console.log(`\n📊 Model Statistics:`);
	console.log(`  Total tool-capable models: ${totalModels}`);
	console.log(`  Reasoning-capable models: ${reasoningModels}`);

	for (const [provider, models] of Object.entries(providers)) {
		console.log(`  ${provider}: ${models.length} models`);
	}
}

// Run the generator
generateModels().catch(console.error);