import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { GPU } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ModelConfig {
	gpuCount: number;
	gpuTypes?: string[];
	args: string[];
	env?: Record<string, string>;
	notes?: string;
}

interface ModelInfo {
	name: string;
	configs: ModelConfig[];
	notes?: string;
}

interface ModelsData {
	models: Record<string, ModelInfo>;
}

// Load models configuration - resolve relative to this file
const modelsJsonPath = join(__dirname, "models.json");
const modelsData: ModelsData = JSON.parse(readFileSync(modelsJsonPath, "utf-8"));

/**
 * Get the best configuration for a model based on available GPUs
 */
export const getModelConfig = (
	modelId: string,
	gpus: GPU[],
	requestedGpuCount: number,
): { args: string[]; env?: Record<string, string>; notes?: string } | null => {
	const modelInfo = modelsData.models[modelId];
	if (!modelInfo) {
		// Unknown model, no default config
		return null;
	}

	// Extract GPU type from the first GPU name (e.g., "NVIDIA H200" -> "H200")
	const gpuType = gpus[0]?.name?.replace("NVIDIA", "")?.trim()?.split(" ")[0] || "";

	// Find best matching config
	let bestConfig: ModelConfig | null = null;

	for (const config of modelInfo.configs) {
		// Check GPU count
		if (config.gpuCount !== requestedGpuCount) {
			continue;
		}

		// Check GPU type if specified
		if (config.gpuTypes && config.gpuTypes.length > 0) {
			const typeMatches = config.gpuTypes.some((type) => gpuType.includes(type) || type.includes(gpuType));
			if (!typeMatches) {
				continue;
			}
		}

		// This config matches
		bestConfig = config;
		break;
	}

	// If no exact match, try to find a config with just the right GPU count
	if (!bestConfig) {
		for (const config of modelInfo.configs) {
			if (config.gpuCount === requestedGpuCount) {
				bestConfig = config;
				break;
			}
		}
	}

	if (!bestConfig) {
		// No suitable config found
		return null;
	}

	return {
		args: [...bestConfig.args],
		env: bestConfig.env ? { ...bestConfig.env } : undefined,
		notes: bestConfig.notes || modelInfo.notes,
	};
};

/**
 * Check if a model is known
 */
export const isKnownModel = (modelId: string): boolean => {
	return modelId in modelsData.models;
};

/**
 * Get all known models
 */
export const getKnownModels = (): string[] => {
	return Object.keys(modelsData.models);
};

/**
 * Get model display name
 */
export const getModelName = (modelId: string): string => {
	return modelsData.models[modelId]?.name || modelId;
};
