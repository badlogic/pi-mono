// @mariozechner/pi-ai - Unified LLM API with automatic model discovery
// This package provides a common interface for working with multiple LLM providers

export const version = "0.5.8";

// Export generate API
export {
	generate,
	generateComplete,
	getApiKey,
	QueuedGenerateStream,
	registerApi,
	setApiKey,
} from "./generate.js";
// Export generated models data
export { PROVIDERS } from "./models.generated.js";
// Export model utilities
export {
	calculateCost,
	getModel,
	type KnownProvider,
	registerModel,
} from "./models.js";

// Legacy providers (to be deprecated)
export { AnthropicLLM } from "./providers/anthropic.js";
export { GoogleLLM } from "./providers/google.js";
export { OpenAICompletionsLLM } from "./providers/openai-completions.js";
export { OpenAIResponsesLLM } from "./providers/openai-responses.js";

// Export types
export type * from "./types.js";

// TODO: Remove these legacy exports once consumers are updated
export function createLLM(): never {
	throw new Error("createLLM is deprecated. Use generate() with getModel() instead.");
}
