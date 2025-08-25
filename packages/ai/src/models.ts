import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export interface ModelInfo {
	id: string;
	name: string;
	attachment?: boolean;
	reasoning?: boolean;
	temperature?: boolean;
	tool_call?: boolean;
	knowledge?: string;
	release_date?: string;
	last_updated?: string;
	modalities?: {
		input?: string[];
		output?: string[];
	};
	open_weights?: boolean;
	cost?: {
		input?: number;
		output?: number;
		cache_read?: number;
		cache_write?: number;
	};
	limit?: {
		context?: number;
		output?: number;
	};
	[key: string]: any;
}

export interface ProviderInfo {
	id: string;
	env?: string[];
	npm?: string;
	api?: string;
	name: string;
	doc?: string;
	models: Record<string, ModelInfo>;
}

export type ModelsData = Record<string, ProviderInfo>;

let cachedModels: ModelsData | null = null;

/**
 * Load models data from models.json
 * The file is loaded relative to this module's location
 */
export function loadModels(): ModelsData {
	if (cachedModels) {
		return cachedModels;
	}

	try {
		// Get the directory of this module
		const currentDir = dirname(fileURLToPath(import.meta.url));
		const modelsPath = join(currentDir, "models.json");

		const data = readFileSync(modelsPath, "utf-8");
		cachedModels = JSON.parse(data);
		return cachedModels!;
	} catch (error) {
		console.error("Failed to load models.json:", error);
		// Return empty providers object as fallback
		return {};
	}
}

/**
 * Get information about a specific model
 */
export function getModelInfo(modelId: string): ModelInfo | undefined {
	const data = loadModels();

	// Search through all providers
	for (const provider of Object.values(data)) {
		if (provider.models && provider.models[modelId]) {
			return provider.models[modelId];
		}
	}

	return undefined;
}

/**
 * Get all models for a specific provider
 */
export function getProviderModels(providerId: string): ModelInfo[] {
	const data = loadModels();
	const provider = data[providerId];

	if (!provider || !provider.models) {
		return [];
	}

	return Object.values(provider.models);
}

/**
 * Get provider information
 */
export function getProviderInfo(providerId: string): ProviderInfo | undefined {
	const data = loadModels();
	return data[providerId];
}

/**
 * Check if a model supports thinking/reasoning
 */
export function supportsThinking(modelId: string): boolean {
	const model = getModelInfo(modelId);
	return model?.reasoning === true;
}

/**
 * Check if a model supports tool calling
 */
export function supportsTools(modelId: string): boolean {
	const model = getModelInfo(modelId);
	return model?.tool_call === true;
}

/**
 * Get all available providers
 */
export function getAllProviders(): ProviderInfo[] {
	const data = loadModels();
	return Object.values(data);
}
