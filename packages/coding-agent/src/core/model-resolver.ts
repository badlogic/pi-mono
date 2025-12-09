/**
 * Model resolution, scoping, and initial selection
 */

import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Api, KnownProvider, Model } from "@mariozechner/pi-ai";
import chalk from "chalk";
import { isValidThinkingLevel } from "../cli/args.js";
import { findModel, getApiKeyForModel, getAvailableModels } from "./model-config.js";
import type { SettingsManager } from "./settings-manager.js";

/** Default model IDs for each known provider */
export const defaultModelPerProvider: Record<KnownProvider, string> = {
	anthropic: "claude-sonnet-4-5",
	openai: "gpt-5.1-codex",
	google: "gemini-2.5-pro",
	openrouter: "openai/gpt-5.1-codex",
	xai: "grok-4-fast-non-reasoning",
	groq: "openai/gpt-oss-120b",
	cerebras: "zai-glm-4.6",
	zai: "glm-4.6",
};

export interface ScopedModel {
	model: Model<Api>;
	thinkingLevel: ThinkingLevel;
}

/**
 * Resolve model patterns to actual Model objects with optional thinking levels
 * Format: "pattern:level" where :level is optional
 * For each pattern, finds all matching models and picks the best version:
 * 1. Prefer alias (e.g., claude-sonnet-4-5) over dated versions (claude-sonnet-4-5-20250929)
 * 2. If no alias, pick the latest dated version
 */
export async function resolveModelScope(patterns: string[]): Promise<ScopedModel[]> {
	const { models: availableModels, error } = await getAvailableModels();

	if (error) {
		console.warn(chalk.yellow(`Warning: Error loading models: ${error}`));
		return [];
	}

	const scopedModels: ScopedModel[] = [];

	for (const pattern of patterns) {
		// Parse pattern:level format
		const parts = pattern.split(":");
		const modelPattern = parts[0];
		let thinkingLevel: ThinkingLevel = "off";

		if (parts.length > 1) {
			const level = parts[1];
			if (isValidThinkingLevel(level)) {
				thinkingLevel = level;
			} else {
				console.warn(
					chalk.yellow(`Warning: Invalid thinking level "${level}" in pattern "${pattern}". Using "off" instead.`),
				);
			}
		}

		// Check for provider/modelId format (provider is everything before the first /)
		const slashIndex = modelPattern.indexOf("/");
		if (slashIndex !== -1) {
			const provider = modelPattern.substring(0, slashIndex);
			const modelId = modelPattern.substring(slashIndex + 1);
			const providerMatch = availableModels.find(
				(m) => m.provider.toLowerCase() === provider.toLowerCase() && m.id.toLowerCase() === modelId.toLowerCase(),
			);
			if (providerMatch) {
				if (
					!scopedModels.find(
						(sm) => sm.model.id === providerMatch.id && sm.model.provider === providerMatch.provider,
					)
				) {
					scopedModels.push({ model: providerMatch, thinkingLevel });
				}
				continue;
			}
			// No exact provider/model match - fall through to other matching
		}

		// Check for exact ID match (case-insensitive)
		const exactMatch = availableModels.find((m) => m.id.toLowerCase() === modelPattern.toLowerCase());
		if (exactMatch) {
			// Exact match found - use it directly
			if (!scopedModels.find((sm) => sm.model.id === exactMatch.id && sm.model.provider === exactMatch.provider)) {
				scopedModels.push({ model: exactMatch, thinkingLevel });
			}
			continue;
		}

		// No exact match - fall back to partial matching
		const matches = availableModels.filter(
			(m) =>
				m.id.toLowerCase().includes(modelPattern.toLowerCase()) ||
				m.name?.toLowerCase().includes(modelPattern.toLowerCase()),
		);

		if (matches.length === 0) {
			console.warn(chalk.yellow(`Warning: No models match pattern "${modelPattern}"`));
			continue;
		}

		// Helper to check if a model ID looks like an alias (no date suffix)
		// Dates are typically in format: -20241022 or -20250929
		const isAlias = (id: string): boolean => {
			// Check if ID ends with -latest
			if (id.endsWith("-latest")) return true;

			// Check if ID ends with a date pattern (-YYYYMMDD)
			const datePattern = /-\d{8}$/;
			return !datePattern.test(id);
		};

		// Separate into aliases and dated versions
		const aliases = matches.filter((m) => isAlias(m.id));
		const datedVersions = matches.filter((m) => !isAlias(m.id));

		let bestMatch: Model<Api>;

		if (aliases.length > 0) {
			// Prefer alias - if multiple aliases, pick the one that sorts highest
			aliases.sort((a, b) => b.id.localeCompare(a.id));
			bestMatch = aliases[0];
		} else {
			// No alias found, pick latest dated version
			datedVersions.sort((a, b) => b.id.localeCompare(a.id));
			bestMatch = datedVersions[0];
		}

		// Avoid duplicates
		if (!scopedModels.find((sm) => sm.model.id === bestMatch.id && sm.model.provider === bestMatch.provider)) {
			scopedModels.push({ model: bestMatch, thinkingLevel });
		}
	}

	return scopedModels;
}

export interface InitialModelResult {
	model: Model<Api> | null;
	thinkingLevel: ThinkingLevel;
	fallbackMessage: string | null;
}

/**
 * Find the initial model to use based on priority:
 * 1. CLI args (provider + model)
 * 2. First model from scoped models (if not continuing/resuming)
 * 3. Restored from session (if continuing/resuming)
 * 4. Saved default from settings
 * 5. First available model with valid API key
 */
export async function findInitialModel(options: {
	cliProvider?: string;
	cliModel?: string;
	scopedModels: ScopedModel[];
	isContinuing: boolean;
	settingsManager: SettingsManager;
}): Promise<InitialModelResult> {
	const { cliProvider, cliModel, scopedModels, isContinuing, settingsManager } = options;

	let model: Model<Api> | null = null;
	let thinkingLevel: ThinkingLevel = "off";

	// 1. CLI args take priority
	if (cliProvider && cliModel) {
		const { model: found, error } = findModel(cliProvider, cliModel);
		if (error) {
			console.error(chalk.red(error));
			process.exit(1);
		}
		if (!found) {
			console.error(chalk.red(`Model ${cliProvider}/${cliModel} not found`));
			process.exit(1);
		}
		return { model: found, thinkingLevel: "off", fallbackMessage: null };
	}

	// 2. Use first model from scoped models (skip if continuing/resuming)
	if (scopedModels.length > 0 && !isContinuing) {
		return {
			model: scopedModels[0].model,
			thinkingLevel: scopedModels[0].thinkingLevel,
			fallbackMessage: null,
		};
	}

	// 3. Try saved default from settings
	const defaultProvider = settingsManager.getDefaultProvider();
	const defaultModelId = settingsManager.getDefaultModel();
	if (defaultProvider && defaultModelId) {
		const { model: found, error } = findModel(defaultProvider, defaultModelId);
		if (error) {
			console.error(chalk.red(error));
			process.exit(1);
		}
		if (found) {
			model = found;
			// Also load saved thinking level
			const savedThinking = settingsManager.getDefaultThinkingLevel();
			if (savedThinking) {
				thinkingLevel = savedThinking;
			}
			return { model, thinkingLevel, fallbackMessage: null };
		}
	}

	// 4. Try first available model with valid API key
	const { models: availableModels, error } = await getAvailableModels();

	if (error) {
		console.error(chalk.red(error));
		process.exit(1);
	}

	if (availableModels.length > 0) {
		// Try to find a default model from known providers
		for (const provider of Object.keys(defaultModelPerProvider) as KnownProvider[]) {
			const defaultId = defaultModelPerProvider[provider];
			const match = availableModels.find((m) => m.provider === provider && m.id === defaultId);
			if (match) {
				return { model: match, thinkingLevel: "off", fallbackMessage: null };
			}
		}

		// If no default found, use first available
		return { model: availableModels[0], thinkingLevel: "off", fallbackMessage: null };
	}

	// 5. No model found
	return { model: null, thinkingLevel: "off", fallbackMessage: null };
}

/**
 * Restore model from session, with fallback to available models
 */
export async function restoreModelFromSession(
	savedProvider: string,
	savedModelId: string,
	currentModel: Model<Api> | null,
	shouldPrintMessages: boolean,
): Promise<{ model: Model<Api> | null; fallbackMessage: string | null }> {
	const { model: restoredModel, error } = findModel(savedProvider, savedModelId);

	if (error) {
		console.error(chalk.red(error));
		process.exit(1);
	}

	// Check if restored model exists and has a valid API key
	const hasApiKey = restoredModel ? !!(await getApiKeyForModel(restoredModel)) : false;

	if (restoredModel && hasApiKey) {
		if (shouldPrintMessages) {
			console.log(chalk.dim(`Restored model: ${savedProvider}/${savedModelId}`));
		}
		return { model: restoredModel, fallbackMessage: null };
	}

	// Model not found or no API key - fall back
	const reason = !restoredModel ? "model no longer exists" : "no API key available";

	if (shouldPrintMessages) {
		console.error(chalk.yellow(`Warning: Could not restore model ${savedProvider}/${savedModelId} (${reason}).`));
	}

	// If we already have a model, use it as fallback
	if (currentModel) {
		if (shouldPrintMessages) {
			console.log(chalk.dim(`Falling back to: ${currentModel.provider}/${currentModel.id}`));
		}
		return {
			model: currentModel,
			fallbackMessage: `Could not restore model ${savedProvider}/${savedModelId} (${reason}). Using ${currentModel.provider}/${currentModel.id}.`,
		};
	}

	// Try to find any available model
	const { models: availableModels, error: availableError } = await getAvailableModels();
	if (availableError) {
		console.error(chalk.red(availableError));
		process.exit(1);
	}

	if (availableModels.length > 0) {
		// Try to find a default model from known providers
		let fallbackModel: Model<Api> | null = null;
		for (const provider of Object.keys(defaultModelPerProvider) as KnownProvider[]) {
			const defaultId = defaultModelPerProvider[provider];
			const match = availableModels.find((m) => m.provider === provider && m.id === defaultId);
			if (match) {
				fallbackModel = match;
				break;
			}
		}

		// If no default found, use first available
		if (!fallbackModel) {
			fallbackModel = availableModels[0];
		}

		if (shouldPrintMessages) {
			console.log(chalk.dim(`Falling back to: ${fallbackModel.provider}/${fallbackModel.id}`));
		}

		return {
			model: fallbackModel,
			fallbackMessage: `Could not restore model ${savedProvider}/${savedModelId} (${reason}). Using ${fallbackModel.provider}/${fallbackModel.id}.`,
		};
	}

	// No models available
	return { model: null, fallbackMessage: null };
}
