/**
 * Model providers - creates Vercel AI SDK model instances from model metadata.
 *
 * This module provides factory functions to create LanguageModelV1 instances
 * from the model metadata using the appropriate Vercel AI SDK provider.
 */

import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV2, LanguageModelV3 } from "@ai-sdk/provider";
import type { Api, ModelInfo } from "./ai-types.js";

type LanguageModel = LanguageModelV3 | LanguageModelV2;

/**
 * Create a Vercel AI SDK LanguageModel instance from model metadata.
 *
 * @param model - The model metadata
 * @param apiKey - The API key for authentication
 * @returns A LanguageModelV1 instance that can be used with streamText/generateText
 */
export function createLanguageModel(model: ModelInfo, apiKey: string): LanguageModel {
	switch (model.api) {
		case "anthropic-messages":
			return createAnthropicModel(model, apiKey);
		case "openai-completions":
		case "openai-responses":
			return createOpenAIModel(model, apiKey);
		case "bedrock-converse-stream":
			return createBedrockModel(model);
		case "google-generative-ai":
			return createGoogleModel(model, apiKey);
		case "google-vertex":
			return createVertexModel(model);
		case "azure-openai-responses":
			return createAzureModel(model, apiKey);
		default:
			// For unknown APIs, try OpenAI-compatible endpoint
			return createOpenAICompatibleModel(model, apiKey);
	}
}

function createAnthropicModel(model: ModelInfo, apiKey: string): LanguageModel {
	// Check if using OAuth token
	const isOAuth = apiKey.includes("sk-ant-oat");

	const provider = createAnthropic({
		apiKey: isOAuth ? undefined : apiKey,
		baseURL: model.baseUrl !== "https://api.anthropic.com" ? model.baseUrl : undefined,
		headers: isOAuth
			? {
					Authorization: `Bearer ${apiKey}`,
					"anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
					"user-agent": "claude-cli/2.1.2 (external, cli)",
					...model.headers,
				}
			: model.headers,
	});

	return provider(model.id);
}

function createOpenAIModel(model: ModelInfo, apiKey: string): LanguageModel {
	const provider = createOpenAI({
		apiKey,
		baseURL: model.baseUrl !== "https://api.openai.com/v1" ? model.baseUrl : undefined,
		headers: model.headers,
	});

	return provider(model.id);
}

function createBedrockModel(model: ModelInfo): LanguageModel {
	// Bedrock uses AWS credentials from environment, not API key
	// Extract region from baseUrl (e.g., https://bedrock-runtime.us-east-1.amazonaws.com)
	const regionMatch = model.baseUrl.match(/bedrock-runtime\.([^.]+)\.amazonaws\.com/);
	const region = regionMatch?.[1] ?? "us-east-1";

	const provider = createAmazonBedrock({
		region,
	});

	return provider(model.id);
}

function createGoogleModel(model: ModelInfo, apiKey: string): LanguageModel {
	const provider = createGoogleGenerativeAI({
		apiKey,
		baseURL: model.baseUrl !== "https://generativelanguage.googleapis.com/v1beta" ? model.baseUrl : undefined,
		headers: model.headers,
	});

	return provider(model.id);
}

function createVertexModel(model: ModelInfo): LanguageModel {
	// Vertex uses Google Cloud credentials from environment
	// Extract location and project from baseUrl
	// e.g., https://us-central1-aiplatform.googleapis.com/v1/projects/PROJECT/locations/LOCATION
	const match = model.baseUrl.match(
		/https:\/\/([^-]+)-aiplatform\.googleapis\.com\/v1\/projects\/([^/]+)\/locations\/([^/]+)/,
	);
	const location = match?.[1] ?? "us-central1";
	const project = match?.[2];

	const provider = createVertex({
		location,
		project,
	});

	return provider(model.id);
}

function createAzureModel(model: ModelInfo, apiKey: string): LanguageModel {
	// Azure OpenAI has a specific URL format
	// e.g., https://RESOURCE.openai.azure.com/openai/deployments/DEPLOYMENT
	const provider = createAzure({
		apiKey,
		baseURL: model.baseUrl,
		headers: model.headers,
	});

	return provider(model.id);
}

function createOpenAICompatibleModel(model: ModelInfo, apiKey: string): LanguageModel {
	// Use OpenAI provider for OpenAI-compatible endpoints (Ollama, LM Studio, etc.)
	const provider = createOpenAI({
		apiKey,
		baseURL: model.baseUrl,
		headers: model.headers,
	});

	return provider(model.id);
}

/**
 * Reset API provider state.
 * With Vercel AI SDK, provider instances are stateless and created fresh each time,
 * so this is a no-op provided for backward compatibility.
 */
export function resetApiProviders(): void {
	// No-op: Vercel AI SDK providers are stateless
}

/**
 * Get the appropriate API type for a provider.
 */
export function getDefaultApiForProvider(provider: string): Api {
	switch (provider) {
		case "anthropic":
			return "anthropic-messages";
		case "openai":
		case "xai":
		case "groq":
		case "cerebras":
		case "openrouter":
		case "vercel-ai-gateway":
		case "mistral":
		case "minimax":
		case "minimax-cn":
		case "huggingface":
			return "openai-completions";
		case "openai-codex":
		case "github-copilot":
			return "openai-responses";
		case "azure-openai-responses":
			return "azure-openai-responses";
		case "amazon-bedrock":
			return "bedrock-converse-stream";
		case "google":
		case "google-gemini-cli":
		case "google-antigravity":
			return "google-generative-ai";
		case "google-vertex":
			return "google-vertex";
		default:
			return "openai-completions"; // Default to OpenAI-compatible
	}
}
