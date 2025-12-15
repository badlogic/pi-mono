#!/usr/bin/env tsx

import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Api, KnownProvider, Model } from "../src/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, "..");

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

const COPILOT_STATIC_HEADERS = {
	"User-Agent": "GitHubCopilotChat/0.35.0",
	"Editor-Version": "vscode/1.105.1",
	"Editor-Plugin-Version": "copilot-chat/0.35.0",
	"Copilot-Integration-Id": "copilot-developer-cli",
	"Openai-Intent": "conversation-edits",
	"X-Initiator": "agent",
} as const;

function getCopilotTokenFromEnv(): string | null {
	return process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;
}

function isCopilotModelDeprecated(model: Record<string, unknown>): boolean {
	const deprecated = model.deprecated;
	if (deprecated === true) return true;
	if (model.is_deprecated === true) return true;
	if (model.status === "deprecated") return true;
	if (model.lifecycle === "deprecated") return true;
	return false;
}

/**
 * Models to exclude from Copilot - dated snapshots, legacy models, and unsupported versions.
 * Users should use the main model ID (e.g., "gpt-4o") instead of dated versions.
 */
const COPILOT_EXCLUDED_MODELS = new Set([
	// Dated GPT-4o snapshots - use "gpt-4o" instead
	"gpt-4o-2024-05-13",
	"gpt-4o-2024-08-06",
	"gpt-4o-2024-11-20",
	// Legacy GPT-3.5 and GPT-4 models
	"gpt-3.5-turbo",
	"gpt-3.5-turbo-0613",
	"gpt-4",
	"gpt-4-0613",
]);

function isCopilotModelExcluded(modelId: string): boolean {
	return COPILOT_EXCLUDED_MODELS.has(modelId);
}

function getCopilotApi(modelId: string, supportedEndpoints: string[] | null): Api {
	if (supportedEndpoints?.includes("/responses")) return "openai-responses";
	if (supportedEndpoints?.includes("/chat/completions")) return "openai-completions";

	const id = modelId.toLowerCase();
	if (id.includes("codex") || id.startsWith("o1") || id.startsWith("o3")) {
		return "openai-responses";
	}
	return "openai-completions";
}

async function fetchCopilotModels(githubToken: string): Promise<Model<any>[]> {
	try {
		console.log("Fetching models from GitHub Copilot API...");
		const response = await fetch("https://api.githubcopilot.com/models", {
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${githubToken}`,
				...COPILOT_STATIC_HEADERS,
			},
		});

		if (!response.ok) {
			const text = await response.text();
			console.warn(`Failed to fetch GitHub Copilot models: ${response.status} ${text}`);
			return [];
		}

		const data = (await response.json()) as unknown;
		const list =
			Array.isArray(data)
				? data
				: Array.isArray((data as any)?.data)
					? (data as any).data
					: Array.isArray((data as any)?.models)
						? (data as any).models
						: null;

		if (!Array.isArray(list)) {
			console.warn("Failed to parse GitHub Copilot models response");
			return [];
		}

		const models: Model<any>[] = [];

		for (const item of list) {
			if (!item || typeof item !== "object") continue;
			const model = item as Record<string, unknown>;

			const id = typeof model.id === "string" ? model.id : null;
			if (!id) continue;
			if (isCopilotModelDeprecated(model)) continue;
			if (isCopilotModelExcluded(id)) continue;

			const caps = model.capabilities;
			if (!caps || typeof caps !== "object") continue;
			const supports = (caps as Record<string, unknown>).supports;
			if (!supports || typeof supports !== "object") continue;

			const supportsToolCalls = (supports as Record<string, unknown>).tool_calls === true;
			if (!supportsToolCalls) continue;

			const supportsVision = (supports as Record<string, unknown>).vision === true;
			const input: ("text" | "image")[] = supportsVision ? ["text", "image"] : ["text"];

			const limits = (caps as Record<string, unknown>).limits;

			// Copilot exposes both:
			// - max_context_window_tokens: the model's full context window capability
			// - max_prompt_tokens: the maximum prompt tokens Copilot will accept
			// For pi's purposes (compaction, prompt sizing), the prompt limit is the effective context window.
			const contextWindow =
				limits && typeof limits === "object" && typeof (limits as any).max_prompt_tokens === "number"
					? (limits as any).max_prompt_tokens
					: limits && typeof limits === "object" && typeof (limits as any).max_context_window_tokens === "number"
						? (limits as any).max_context_window_tokens
						: 128000;
			const maxTokens =
				limits && typeof limits === "object" && typeof (limits as any).max_output_tokens === "number"
					? (limits as any).max_output_tokens
					: 8192;

			const supportedEndpoints = Array.isArray(model.supported_endpoints)
				? (model.supported_endpoints as unknown[]).filter((e): e is string => typeof e === "string")
				: null;

			const api = getCopilotApi(id, supportedEndpoints);

			const base: Model<any> = {
				id,
				name: id,
				api,
				provider: "github-copilot",
				baseUrl: "https://api.githubcopilot.com",
				reasoning: false,
				input,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
				},
				contextWindow,
				maxTokens,
				headers: { ...COPILOT_STATIC_HEADERS },
			};

			if (api === "openai-completions") {
				base.compat = {
					supportsStore: false,
					supportsDeveloperRole: false,
					supportsReasoningEffort: false,
				};
			}

			if (supportedEndpoints && !supportedEndpoints.includes("/chat/completions") && !supportedEndpoints.includes("/responses")) {
				continue;
			}

			models.push(base);
		}

		console.log(`Fetched ${models.length} tool-capable models from GitHub Copilot`);
		return models;
	} catch (error) {
		console.warn("Failed to fetch GitHub Copilot models:", error);
		return [];
	}
}

function getFallbackCopilotModels(): Model<any>[] {
	const fallback: Array<{ id: string; api: Api; input: ("text" | "image")[] }> = [
		{ id: "claude-opus-4.5", api: "openai-completions", input: ["text", "image"] },
		{ id: "claude-sonnet-4.5", api: "openai-completions", input: ["text", "image"] },
		{ id: "claude-haiku-4.5", api: "openai-completions", input: ["text", "image"] },
		{ id: "gemini-3-pro-preview", api: "openai-completions", input: ["text", "image"] },
		{ id: "grok-code-fast-1", api: "openai-completions", input: ["text"] },
		{ id: "gpt-5.2", api: "openai-responses", input: ["text", "image"] },
		{ id: "gpt-5.1-codex-max", api: "openai-responses", input: ["text", "image"] },
	];

	return fallback.map(({ id, api, input }) => {
		const model: Model<any> = {
			id,
			name: id,
			api,
			provider: "github-copilot",
			baseUrl: "https://api.githubcopilot.com",
			reasoning: false,
			input,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 128000,
			maxTokens: 8192,
			headers: { ...COPILOT_STATIC_HEADERS },
		};

		if (api === "openai-completions") {
			model.compat = {
				supportsStore: false,
				supportsDeveloperRole: false,
				supportsReasoningEffort: false,
			};
		}

		return model;
	});
}

async function fetchOpenRouterModels(): Promise<Model<any>[]> {
	try {
		console.log("Fetching models from OpenRouter API...");
		const response = await fetch("https://openrouter.ai/api/v1/models");
		const data = await response.json();

		const models: Model<any>[] = [];

		for (const model of data.data) {
			// Only include models that support tools
			if (!model.supported_parameters?.includes("tools")) continue;

			// Parse provider from model ID
			let provider: KnownProvider = "openrouter";
			let modelKey = model.id;

			modelKey = model.id; // Keep full ID for OpenRouter

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

			const normalizedModel: Model<any> = {
				id: modelKey,
				name: model.name,
				api: "openai-completions",
				baseUrl: "https://openrouter.ai/api/v1",
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
			};
			models.push(normalizedModel);
		}

		console.log(`Fetched ${models.length} tool-capable models from OpenRouter`);
		return models;
	} catch (error) {
		console.error("Failed to fetch OpenRouter models:", error);
		return [];
	}
}

async function loadModelsDevData(): Promise<Model<any>[]> {
	try {
		console.log("Fetching models from models.dev API...");
		const response = await fetch("https://models.dev/api.json");
		const data = await response.json();

		const models: Model<any>[] = [];

		// Process Anthropic models
		if (data.anthropic?.models) {
			for (const [modelId, model] of Object.entries(data.anthropic.models)) {
				const m = model as ModelsDevModel;
				if (m.tool_call !== true) continue;

				models.push({
					id: modelId,
					name: m.name || modelId,
					api: "anthropic-messages",
					provider: "anthropic",
					baseUrl: "https://api.anthropic.com",
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

		// Process Google models
		if (data.google?.models) {
			for (const [modelId, model] of Object.entries(data.google.models)) {
				const m = model as ModelsDevModel;
				if (m.tool_call !== true) continue;

				models.push({
					id: modelId,
					name: m.name || modelId,
					api: "google-generative-ai",
					provider: "google",
					baseUrl: "https://generativelanguage.googleapis.com/v1beta",
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

		// Process OpenAI models
		if (data.openai?.models) {
			for (const [modelId, model] of Object.entries(data.openai.models)) {
				const m = model as ModelsDevModel;
				if (m.tool_call !== true) continue;

				models.push({
					id: modelId,
					name: m.name || modelId,
					api: "openai-responses",
					provider: "openai",
					baseUrl: "https://api.openai.com/v1",
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

		// Process Groq models
		if (data.groq?.models) {
			for (const [modelId, model] of Object.entries(data.groq.models)) {
				const m = model as ModelsDevModel;
				if (m.tool_call !== true) continue;

				models.push({
					id: modelId,
					name: m.name || modelId,
					api: "openai-completions",
					provider: "groq",
					baseUrl: "https://api.groq.com/openai/v1",
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
					api: "openai-completions",
					provider: "cerebras",
					baseUrl: "https://api.cerebras.ai/v1",
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

		// Process xAi models
		if (data.xai?.models) {
			for (const [modelId, model] of Object.entries(data.xai.models)) {
				const m = model as ModelsDevModel;
				if (m.tool_call !== true) continue;

				models.push({
					id: modelId,
					name: m.name || modelId,
					api: "openai-completions",
					provider: "xai",
					baseUrl: "https://api.x.ai/v1",
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

		// Process xAi models
		if (data.zai?.models) {
			for (const [modelId, model] of Object.entries(data.zai.models)) {
				const m = model as ModelsDevModel;
				if (m.tool_call !== true) continue;

				models.push({
					id: modelId,
					name: m.name || modelId,
					api: "anthropic-messages",
					provider: "zai",
					baseUrl: "https://api.z.ai/api/anthropic",
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

		// Process Mistral models
		if (data.mistral?.models) {
			for (const [modelId, model] of Object.entries(data.mistral.models)) {
				const m = model as ModelsDevModel;
				if (m.tool_call !== true) continue;

				models.push({
					id: modelId,
					name: m.name || modelId,
					api: "openai-completions",
					provider: "mistral",
					baseUrl: "https://api.mistral.ai/v1",
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


		console.log(`Loaded ${models.length} tool-capable models from models.dev`);
		return models;
	} catch (error) {
		console.error("Failed to load models.dev data:", error);
		return [];
	}
}

async function generateModels() {
	// Fetch models from both sources
	// models.dev: Anthropic, Google, OpenAI, Groq, Cerebras
	// OpenRouter: xAI and other providers (excluding Anthropic, Google, OpenAI)
	const modelsDevModels = await loadModelsDevData();
	const openRouterModels = await fetchOpenRouterModels();

	// Combine models (models.dev has priority)
	const allModels = [...modelsDevModels, ...openRouterModels];

	const copilotToken = getCopilotTokenFromEnv();
	let copilotModels: Model<any>[] = [];
	if (copilotToken) {
		copilotModels = await fetchCopilotModels(copilotToken);
		if (copilotModels.length === 0) {
			console.warn("GitHub Copilot model fetch returned no models. Using fallback list.");
			copilotModels = getFallbackCopilotModels();
		}
	} else {
		console.warn("No Copilot token found (set COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN). Using fallback list.");
		copilotModels = getFallbackCopilotModels();
	}
	allModels.push(...copilotModels);

	// Fix incorrect cache pricing for Claude Opus 4.5 from models.dev
	// models.dev has 3x the correct pricing (1.5/18.75 instead of 0.5/6.25)
	const opus45 = allModels.find(m => m.provider === "anthropic" && m.id === "claude-opus-4-5");
	if (opus45) {
		opus45.cost.cacheRead = 0.5;
		opus45.cost.cacheWrite = 6.25;
	}

	// Add missing gpt models
	if (!allModels.some(m => m.provider === "openai" && m.id === "gpt-5-chat-latest")) {
		allModels.push({
			id: "gpt-5-chat-latest",
			name: "GPT-5 Chat Latest",
			api: "openai-responses",
			baseUrl: "https://api.openai.com/v1",
			provider: "openai",
			reasoning: false,
			input: ["text", "image"],
			cost: {
				input: 1.25,
				output: 10,
				cacheRead: 0.125,
				cacheWrite: 0,
			},
			contextWindow: 128000,
			maxTokens: 16384,
		});
	}

	if (!allModels.some(m => m.provider === "openai" && m.id === "gpt-5.1-codex")) {
		allModels.push({
			id: "gpt-5.1-codex",
			name: "GPT-5.1 Codex",
			api: "openai-responses",
			baseUrl: "https://api.openai.com/v1",
			provider: "openai",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 1.25,
				output: 5,
				cacheRead: 0.125,
				cacheWrite: 1.25,
			},
			contextWindow: 400000,
			maxTokens: 128000,
		});
	}

	if (!allModels.some(m => m.provider === "openai" && m.id === "gpt-5.1-codex-max")) {
		allModels.push({
			id: "gpt-5.1-codex-max",
			name: "GPT-5.1 Codex Max",
			api: "openai-responses",
			baseUrl: "https://api.openai.com/v1",
			provider: "openai",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 1.25,
				output: 10,
				cacheRead: 0.125,
				cacheWrite: 0,
			},
			contextWindow: 400000,
			maxTokens: 128000,
		});
	}

	// Add missing Grok models
	if (!allModels.some(m => m.provider === "xai" && m.id === "grok-code-fast-1")) {
		allModels.push({
			id: "grok-code-fast-1",
			name: "Grok Code Fast 1",
			api: "openai-completions",
			baseUrl: "https://api.x.ai/v1",
			provider: "xai",
			reasoning: false,
			input: ["text"],
			cost: {
				input: 0.2,
				output: 1.5,
				cacheRead: 0.02,
				cacheWrite: 0,
			},
			contextWindow: 32768,
			maxTokens: 8192,
		});
	}

	// Add missing OpenRouter model
	if (!allModels.some(m => m.provider === "openrouter" && m.id === "openrouter/auto")) {
		allModels.push({
			id: "openrouter/auto",
			name: "OpenRouter: Auto Router",
			api: "openai-completions",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai/api/v1",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				// we dont know about the costs because OpenRouter auto routes to different models
				// and then charges you for the underlying used model
				input:0,
				output:0,
				cacheRead:0,
				cacheWrite:0,
			},
			contextWindow: 2000000,
			maxTokens: 30000,
		});
	}

	// Group by provider and deduplicate by model ID
	const providers: Record<string, Record<string, Model<any>>> = {};
	for (const model of allModels) {
		if (!providers[model.provider]) {
			providers[model.provider] = {};
		}
		// Use model ID as key to automatically deduplicate
		// Only add if not already present (models.dev takes priority over OpenRouter)
		if (!providers[model.provider][model.id]) {
			providers[model.provider][model.id] = model;
		}
	}

	// Generate TypeScript file
	let output = `// This file is auto-generated by scripts/generate-models.ts
// Do not edit manually - run 'npm run generate-models' to update

import type { Model } from "./types.js";

export const MODELS = {
`;

	// Generate provider sections
	for (const [providerId, models] of Object.entries(providers)) {
		output += `\t${JSON.stringify(providerId)}: {\n`;

		for (const model of Object.values(models)) {
			output += `\t\t"${model.id}": {\n`;
			output += `\t\t\tid: "${model.id}",\n`;
			output += `\t\t\tname: "${model.name}",\n`;
			output += `\t\t\tapi: "${model.api}",\n`;
			output += `\t\t\tprovider: "${model.provider}",\n`;
			if (model.baseUrl) {
				output += `\t\t\tbaseUrl: "${model.baseUrl}",\n`;
			}
			if (model.headers) {
				output += `\t\t\theaders: ${JSON.stringify(model.headers)},\n`;
			}
			if (model.compat) {
				output += `			compat: ${JSON.stringify(model.compat)},
`;
			}
			output += `\t\t\treasoning: ${model.reasoning},\n`;
			output += `\t\t\tinput: [${model.input.map(i => `"${i}"`).join(", ")}],\n`;
			output += `\t\t\tcost: {\n`;
			output += `\t\t\t\tinput: ${model.cost.input},\n`;
			output += `\t\t\t\toutput: ${model.cost.output},\n`;
			output += `\t\t\t\tcacheRead: ${model.cost.cacheRead},\n`;
			output += `\t\t\t\tcacheWrite: ${model.cost.cacheWrite},\n`;
			output += `\t\t\t},\n`;
			output += `\t\t\tcontextWindow: ${model.contextWindow},\n`;
			output += `\t\t\tmaxTokens: ${model.maxTokens},\n`;
			output += `\t\t} satisfies Model<"${model.api}">,\n`;
		}

		output += `\t},\n`;
	}

	output += `} as const;
`;

	// Write file
	writeFileSync(join(packageRoot, "src/models.generated.ts"), output);
	console.log("Generated src/models.generated.ts");

	// Print statistics
	const totalModels = allModels.length;
	const reasoningModels = allModels.filter(m => m.reasoning).length;

	console.log(`\nModel Statistics:`);
	console.log(`  Total tool-capable models: ${totalModels}`);
	console.log(`  Reasoning-capable models: ${reasoningModels}`);

	for (const [provider, models] of Object.entries(providers)) {
		console.log(`  ${provider}: ${Object.keys(models).length} models`);
	}
}

// Run the generator
generateModels().catch(console.error);