// @mariozechner/ai - Unified API for OpenAI, Anthropic, and Google Gemini
// This package provides a common interface for working with multiple LLM providers

export const version = "0.5.8";

// Export models utilities
export {
	getAllProviders,
	getModelInfo,
	getProviderInfo,
	getProviderModels,
	loadModels,
	type ModelInfo,
	type ModelsData,
	type ProviderInfo,
	supportsThinking,
	supportsTools,
} from "./models.js";

// Export providers
export { AnthropicLLM } from "./providers/anthropic.js";
export { GeminiLLM } from "./providers/gemini.js";
export { OpenAICompletionsLLM } from "./providers/openai-completions.js";
export { OpenAIResponsesLLM } from "./providers/openai-responses.js";
// Export types
export type * from "./types.js";
