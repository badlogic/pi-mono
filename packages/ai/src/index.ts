// @mariozechner/ai - Unified API for OpenAI, Anthropic, and Google Gemini
// This package provides a common interface for working with multiple LLM providers

export const version = "0.5.8";

// Export generated models data
export { PROVIDERS } from "./models.generated.js";

// Export models utilities and types
export {
	type AnthropicModel,
	type CerebrasModel,
	createLLM,
	type GoogleModel,
	type GroqModel,
	type Model,
	type OpenAIModel,
	type OpenRouterModel,
	PROVIDER_CONFIG,
	type ProviderModels,
	type ProviderToLLM,
	type XAIModel,
} from "./models.js";

// Export providers
export { AnthropicLLM } from "./providers/anthropic.js";
export { GoogleLLM } from "./providers/google.js";
export { OpenAICompletionsLLM } from "./providers/openai-completions.js";
export { OpenAIResponsesLLM } from "./providers/openai-responses.js";

// Export types
export type * from "./types.js";
