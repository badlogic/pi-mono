import { PROVIDERS } from "./models.generated.js";
import { AnthropicLLM } from "./providers/anthropic.js";
import { GoogleLLM } from "./providers/gemini.js";
import { OpenAICompletionsLLM } from "./providers/openai-completions.js";
import { OpenAIResponsesLLM } from "./providers/openai-responses.js";
import type { Model } from "./types.js";

// Provider configuration with factory functions
export const PROVIDER_CONFIG = {
	google: {
		envKey: "GEMINI_API_KEY",
		create: (model: string, apiKey: string) => new GoogleLLM(model, apiKey),
	},
	openai: {
		envKey: "OPENAI_API_KEY",
		create: (model: string, apiKey: string) => new OpenAIResponsesLLM(model, apiKey),
	},
	anthropic: {
		envKey: "ANTHROPIC_API_KEY",
		create: (model: string, apiKey: string) => new AnthropicLLM(model, apiKey),
	},
	xai: {
		envKey: "XAI_API_KEY",
		create: (model: string, apiKey: string) => new OpenAICompletionsLLM(model, apiKey, "https://api.x.ai/v1"),
	},
	groq: {
		envKey: "GROQ_API_KEY",
		create: (model: string, apiKey: string) =>
			new OpenAICompletionsLLM(model, apiKey, "https://api.groq.com/openai/v1"),
	},
	cerebras: {
		envKey: "CEREBRAS_API_KEY",
		create: (model: string, apiKey: string) => new OpenAICompletionsLLM(model, apiKey, "https://api.cerebras.ai/v1"),
	},
	openrouter: {
		envKey: "OPENROUTER_API_KEY",
		create: (model: string, apiKey: string) =>
			new OpenAICompletionsLLM(model, apiKey, "https://openrouter.ai/api/v1"),
	},
} as const;

// Type mapping from provider to LLM implementation
export type ProviderToLLM = {
	google: GoogleLLM;
	openai: OpenAIResponsesLLM;
	anthropic: AnthropicLLM;
	xai: OpenAICompletionsLLM;
	groq: OpenAICompletionsLLM;
	cerebras: OpenAICompletionsLLM;
	openrouter: OpenAICompletionsLLM;
};

// Extract model types for each provider
export type GoogleModel = keyof typeof PROVIDERS.google.models;
export type OpenAIModel = keyof typeof PROVIDERS.openai.models;
export type AnthropicModel = keyof typeof PROVIDERS.anthropic.models;
export type XAIModel = keyof typeof PROVIDERS.xai.models;
export type GroqModel = keyof typeof PROVIDERS.groq.models;
export type CerebrasModel = keyof typeof PROVIDERS.cerebras.models;
export type OpenRouterModel = keyof typeof PROVIDERS.openrouter.models;

// Map providers to their model types
export type ProviderModels = {
	google: GoogleModel;
	openai: OpenAIModel;
	anthropic: AnthropicModel;
	xai: XAIModel;
	groq: GroqModel;
	cerebras: CerebrasModel;
	openrouter: OpenRouterModel;
};

// Single generic factory function
export function createLLM<P extends keyof typeof PROVIDERS, M extends keyof (typeof PROVIDERS)[P]["models"]>(
	provider: P,
	model: M,
	apiKey?: string,
): ProviderToLLM[P] {
	const config = PROVIDER_CONFIG[provider as keyof typeof PROVIDER_CONFIG];
	if (!config) throw new Error(`Unknown provider: ${provider}`);

	const providerData = PROVIDERS[provider];
	if (!providerData) throw new Error(`Unknown provider: ${provider}`);

	// Type-safe model lookup
	const models = providerData.models as Record<string, Model>;
	const modelData = models[model as string];
	if (!modelData) throw new Error(`Unknown model: ${String(model)} for provider ${provider}`);

	const key = apiKey || process.env[config.envKey];
	if (!key) throw new Error(`No API key provided for ${provider}. Set ${config.envKey} or pass apiKey.`);

	return config.create(model as string, key) as ProviderToLLM[P];
}

// Re-export Model type for convenience
export type { Model };
