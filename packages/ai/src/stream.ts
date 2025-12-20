import { ThinkingLevel } from "@google/genai";
import { supportsXhigh } from "./models.js";
import { type AnthropicOptions, streamAnthropic } from "./providers/anthropic.js";
import { type GoogleOptions, streamGoogle } from "./providers/google.js";
import {
	type GoogleCloudCodeAssistOptions,
	streamGoogleCloudCodeAssist,
} from "./providers/google-cloud-code-assist.js";
import { type OpenAICompletionsOptions, streamOpenAICompletions } from "./providers/openai-completions.js";
import { type OpenAIResponsesOptions, streamOpenAIResponses } from "./providers/openai-responses.js";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	KnownProvider,
	Model,
	OptionsForApi,
	ReasoningEffort,
	SimpleStreamOptions,
} from "./types.js";

const apiKeys: Map<string, string> = new Map();

export function setApiKey(provider: KnownProvider, key: string): void;
export function setApiKey(provider: string, key: string): void;
export function setApiKey(provider: any, key: string): void {
	apiKeys.set(provider, key);
}

export function getApiKey(provider: KnownProvider): string | undefined;
export function getApiKey(provider: string): string | undefined;
export function getApiKey(provider: any): string | undefined {
	// Check explicit keys first
	const key = apiKeys.get(provider);
	if (key) return key;

	// Fall back to environment variables
	if (provider === "github-copilot") {
		return process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
	}

	const envMap: Record<string, string> = {
		openai: "OPENAI_API_KEY",
		anthropic: "ANTHROPIC_API_KEY",
		google: "GEMINI_API_KEY",
		groq: "GROQ_API_KEY",
		cerebras: "CEREBRAS_API_KEY",
		xai: "XAI_API_KEY",
		openrouter: "OPENROUTER_API_KEY",
		zai: "ZAI_API_KEY",
		mistral: "MISTRAL_API_KEY",
	};

	const envVar = envMap[provider];
	return envVar ? process.env[envVar] : undefined;
}

export function stream<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: OptionsForApi<TApi>,
): AssistantMessageEventStream {
	const apiKey = options?.apiKey || getApiKey(model.provider);
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}
	const providerOptions = { ...options, apiKey };

	const api: Api = model.api;
	switch (api) {
		case "anthropic-messages":
			return streamAnthropic(model as Model<"anthropic-messages">, context, providerOptions);

		case "openai-completions":
			return streamOpenAICompletions(model as Model<"openai-completions">, context, providerOptions as any);

		case "openai-responses":
			return streamOpenAIResponses(model as Model<"openai-responses">, context, providerOptions as any);

		case "google-generative-ai":
			return streamGoogle(model as Model<"google-generative-ai">, context, providerOptions);

		case "google-cloud-code-assist":
			return streamGoogleCloudCodeAssist(
				model as Model<"google-cloud-code-assist">,
				context,
				providerOptions as GoogleCloudCodeAssistOptions,
			);

		default: {
			// This should never be reached if all Api cases are handled
			const _exhaustive: never = api;
			throw new Error(`Unhandled API: ${_exhaustive}`);
		}
	}
}

export async function complete<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: OptionsForApi<TApi>,
): Promise<AssistantMessage> {
	const s = stream(model, context, options);
	return s.result();
}

export function streamSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const apiKey = options?.apiKey || getApiKey(model.provider);
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}

	const providerOptions = mapOptionsForApi(model, options, apiKey);
	return stream(model, context, providerOptions);
}

export async function completeSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
	const s = streamSimple(model, context, options);
	return s.result();
}

function mapOptionsForApi<TApi extends Api>(
	model: Model<TApi>,
	options?: SimpleStreamOptions,
	apiKey?: string,
): OptionsForApi<TApi> {
	const base = {
		temperature: options?.temperature,
		maxTokens: options?.maxTokens || Math.min(model.maxTokens, 32000),
		signal: options?.signal,
		apiKey: apiKey || options?.apiKey,
	};

	// Helper to clamp xhigh to high for providers that don't support it
	const clampReasoning = (effort: ReasoningEffort | undefined) => (effort === "xhigh" ? "high" : effort);

	switch (model.api) {
		case "anthropic-messages": {
			// Explicitly disable thinking when reasoning is not specified
			if (!options?.reasoning) {
				return { ...base, thinkingEnabled: false } satisfies AnthropicOptions;
			}

			const anthropicBudgets = {
				minimal: 1024,
				low: 2048,
				medium: 8192,
				high: 16384,
			};

			return {
				...base,
				thinkingEnabled: true,
				thinkingBudgetTokens: anthropicBudgets[clampReasoning(options.reasoning)!],
			} satisfies AnthropicOptions;
		}

		case "openai-completions":
			return {
				...base,
				reasoningEffort: supportsXhigh(model) ? options?.reasoning : clampReasoning(options?.reasoning),
			} satisfies OpenAICompletionsOptions;

		case "openai-responses":
			return {
				...base,
				reasoningEffort: supportsXhigh(model) ? options?.reasoning : clampReasoning(options?.reasoning),
			} satisfies OpenAIResponsesOptions;

		case "google-generative-ai": {
			// Explicitly disable thinking when reasoning is not specified
			// This is needed because Gemini has "dynamic thinking" enabled by default
			if (!options?.reasoning) {
				return { ...base, thinking: { enabled: false } } satisfies GoogleOptions;
			}

			const googleModel = model as Model<"google-generative-ai">;
			const effort = clampReasoning(options.reasoning)!;

			// Gemini 3 models use thinkingLevel exclusively instead of thinkingBudget.
			// https://ai.google.dev/gemini-api/docs/thinking#set-budget
			if (isGemini3ProModel(googleModel) || isGemini3FlashModel(googleModel)) {
				return {
					...base,
					thinking: {
						enabled: true,
						level: getGemini3ThinkingLevel(effort, googleModel),
					},
				} satisfies GoogleOptions;
			}

			return {
				...base,
				thinking: {
					enabled: true,
					budgetTokens: getGoogleBudget(googleModel, effort),
				},
			} satisfies GoogleOptions;
		}

		case "google-cloud-code-assist": {
			// Cloud Code Assist uses thinking budget tokens like Gemini 2.5
			if (!options?.reasoning) {
				return { ...base, thinking: { enabled: false } } satisfies GoogleCloudCodeAssistOptions;
			}

			const effort = clampReasoning(options.reasoning)!;
			const budgets: Record<ClampedReasoningEffort, number> = {
				minimal: 1024,
				low: 2048,
				medium: 8192,
				high: 16384,
			};

			return {
				...base,
				thinking: {
					enabled: true,
					budgetTokens: budgets[effort],
				},
			} satisfies GoogleCloudCodeAssistOptions;
		}

		default: {
			// Exhaustiveness check
			const _exhaustive: never = model.api;
			throw new Error(`Unhandled API in mapOptionsForApi: ${_exhaustive}`);
		}
	}
}

type ClampedReasoningEffort = Exclude<ReasoningEffort, "xhigh">;

function isGemini3ProModel(model: Model<"google-generative-ai">): boolean {
	// Covers gemini-3-pro, gemini-3-pro-preview, and possible other prefixed ids in the future
	return model.id.includes("3-pro");
}

function isGemini3FlashModel(model: Model<"google-generative-ai">): boolean {
	// Covers gemini-3-flash, gemini-3-flash-preview, and possible other prefixed ids in the future
	return model.id.includes("3-flash");
}

function getGemini3ThinkingLevel(effort: ClampedReasoningEffort, model: Model<"google-generative-ai">): ThinkingLevel {
	if (isGemini3ProModel(model)) {
		// Gemini 3 Pro only supports LOW/HIGH (for now)
		switch (effort) {
			case "minimal":
			case "low":
				return ThinkingLevel.LOW;
			case "medium":
			case "high":
				return ThinkingLevel.HIGH;
		}
	}
	// Gemini 3 Flash supports all four levels
	switch (effort) {
		case "minimal":
			return ThinkingLevel.MINIMAL;
		case "low":
			return ThinkingLevel.LOW;
		case "medium":
			return ThinkingLevel.MEDIUM;
		case "high":
			return ThinkingLevel.HIGH;
	}
}

function getGoogleBudget(model: Model<"google-generative-ai">, effort: ClampedReasoningEffort): number {
	// See https://ai.google.dev/gemini-api/docs/thinking#set-budget
	if (model.id.includes("2.5-pro")) {
		const budgets: Record<ClampedReasoningEffort, number> = {
			minimal: 128,
			low: 2048,
			medium: 8192,
			high: 32768,
		};
		return budgets[effort];
	}

	if (model.id.includes("2.5-flash")) {
		// Covers 2.5-flash-lite as well
		const budgets: Record<ClampedReasoningEffort, number> = {
			minimal: 128,
			low: 2048,
			medium: 8192,
			high: 24576,
		};
		return budgets[effort];
	}

	// Unknown model - use dynamic
	return -1;
}
