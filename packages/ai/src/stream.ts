import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { supportsXhigh } from "./models.js";
import { type BedrockOptions, streamBedrock } from "./providers/amazon-bedrock.js";
import { type AnthropicOptions, streamAnthropic } from "./providers/anthropic.js";
import { type GoogleOptions, streamGoogle } from "./providers/google.js";
import {
	type GoogleGeminiCliOptions,
	type GoogleThinkingLevel,
	streamGoogleGeminiCli,
} from "./providers/google-gemini-cli.js";
import { type GoogleVertexOptions, streamGoogleVertex } from "./providers/google-vertex.js";
import { type OpenAICodexResponsesOptions, streamOpenAICodexResponses } from "./providers/openai-codex-responses.js";
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
	SimpleStreamOptions,
	ThinkingBudgets,
	ThinkingLevel,
} from "./types.js";

let cachedVertexAdcCredentialsExists: boolean | null = null;

function hasVertexAdcCredentials(): boolean {
	if (cachedVertexAdcCredentialsExists === null) {
		// Check GOOGLE_APPLICATION_CREDENTIALS env var first (standard way)
		const gacPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
		if (gacPath) {
			cachedVertexAdcCredentialsExists = existsSync(gacPath);
		} else {
			// Fall back to default ADC path (lazy evaluation)
			cachedVertexAdcCredentialsExists = existsSync(
				join(homedir(), ".config", "gcloud", "application_default_credentials.json"),
			);
		}
	}
	return cachedVertexAdcCredentialsExists;
}

/**
 * Get API key for provider from known environment variables, e.g. OPENAI_API_KEY.
 *
 * Will not return API keys for providers that require OAuth tokens.
 */
export function getEnvApiKey(provider: KnownProvider): string | undefined;
export function getEnvApiKey(provider: string): string | undefined;
export function getEnvApiKey(provider: any): string | undefined {
	// Fall back to environment variables
	if (provider === "github-copilot") {
		return process.env.COPILOT_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
	}

	// ANTHROPIC_OAUTH_TOKEN takes precedence over ANTHROPIC_API_KEY
	if (provider === "anthropic") {
		return process.env.ANTHROPIC_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY;
	}

	// Vertex AI uses Application Default Credentials, not API keys.
	// Auth is configured via `gcloud auth application-default login`.
	if (provider === "google-vertex") {
		const hasCredentials = hasVertexAdcCredentials();
		const hasProject = !!(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT);
		const hasLocation = !!process.env.GOOGLE_CLOUD_LOCATION;

		if (hasCredentials && hasProject && hasLocation) {
			return "<authenticated>";
		}
	}

	if (provider === "amazon-bedrock") {
		// Amazon Bedrock supports multiple credential sources:
		// 1. AWS_PROFILE - named profile from ~/.aws/credentials
		// 2. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY - standard IAM keys
		// 3. AWS_BEARER_TOKEN_BEDROCK - Bedrock API keys (bearer token)
		if (
			process.env.AWS_PROFILE ||
			(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ||
			process.env.AWS_BEARER_TOKEN_BEDROCK
		) {
			return "<authenticated>";
		}
	}

	const envMap: Record<string, string> = {
		openai: "OPENAI_API_KEY",
		google: "GEMINI_API_KEY",
		groq: "GROQ_API_KEY",
		cerebras: "CEREBRAS_API_KEY",
		xai: "XAI_API_KEY",
		openrouter: "OPENROUTER_API_KEY",
		"vercel-ai-gateway": "AI_GATEWAY_API_KEY",
		zai: "ZAI_API_KEY",
		mistral: "MISTRAL_API_KEY",
		minimax: "MINIMAX_API_KEY",
		"minimax-cn": "MINIMAX_CN_API_KEY",
		opencode: "OPENCODE_API_KEY",
	};

	const envVar = envMap[provider];
	return envVar ? process.env[envVar] : undefined;
}

export function stream<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: OptionsForApi<TApi>,
): AssistantMessageEventStream {
	// Vertex AI uses Application Default Credentials, not API keys
	if (model.api === "google-vertex") {
		return streamGoogleVertex(model as Model<"google-vertex">, context, options as GoogleVertexOptions);
	} else if (model.api === "bedrock-converse-stream") {
		// Bedrock doesn't have any API keys instead it sources credentials from standard AWS env variables or from given AWS profile.
		return streamBedrock(model as Model<"bedrock-converse-stream">, context, (options || {}) as BedrockOptions);
	}

	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
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

		case "openai-codex-responses":
			return streamOpenAICodexResponses(model as Model<"openai-codex-responses">, context, providerOptions as any);

		case "google-generative-ai":
			return streamGoogle(model as Model<"google-generative-ai">, context, providerOptions);

		case "google-gemini-cli":
			return streamGoogleGeminiCli(
				model as Model<"google-gemini-cli">,
				context,
				providerOptions as GoogleGeminiCliOptions,
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
	// Vertex AI uses Application Default Credentials, not API keys
	if (model.api === "google-vertex") {
		const providerOptions = mapOptionsForApi(model, options, undefined);
		return stream(model, context, providerOptions);
	} else if (model.api === "bedrock-converse-stream") {
		// Bedrock doesn't have any API keys instead it sources credentials from standard AWS env variables or from given AWS profile.
		const providerOptions = mapOptionsForApi(model, options, undefined);
		return stream(model, context, providerOptions);
	}

	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
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
		sessionId: options?.sessionId,
	};

	// Helper to clamp xhigh to high for providers that don't support it
	const clampReasoning = (effort: ThinkingLevel | undefined) => (effort === "xhigh" ? "high" : effort);

	/**
	 * Adjust maxTokens to account for thinking budget.
	 * APIs like Anthropic and Bedrock require max_tokens > thinking.budget_tokens.
	 * Returns { adjustedMaxTokens, adjustedThinkingBudget }
	 */
	const adjustMaxTokensForThinking = (
		baseMaxTokens: number,
		modelMaxTokens: number,
		reasoningLevel: ThinkingLevel,
		customBudgets?: ThinkingBudgets,
	): { maxTokens: number; thinkingBudget: number } => {
		const defaultBudgets: ThinkingBudgets = {
			minimal: 1024,
			low: 2048,
			medium: 8192,
			high: 16384,
		};
		const budgets = { ...defaultBudgets, ...customBudgets };

		const minOutputTokens = 1024;
		const level = clampReasoning(reasoningLevel)!;
		let thinkingBudget = budgets[level]!;
		// Caller's maxTokens is the desired output; add thinking budget on top, capped at model limit
		const maxTokens = Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);

		// If not enough room for thinking + output, reduce thinking budget
		if (maxTokens <= thinkingBudget) {
			thinkingBudget = Math.max(0, maxTokens - minOutputTokens);
		}

		return { maxTokens, thinkingBudget };
	};

	switch (model.api) {
		case "anthropic-messages": {
			// Explicitly disable thinking when reasoning is not specified
			if (!options?.reasoning) {
				return { ...base, thinkingEnabled: false } satisfies AnthropicOptions;
			}

			// Claude requires max_tokens > thinking.budget_tokens
			// So we need to ensure maxTokens accounts for both thinking and output
			const adjusted = adjustMaxTokensForThinking(
				base.maxTokens || 0,
				model.maxTokens,
				options.reasoning,
				options?.thinkingBudgets,
			);

			return {
				...base,
				maxTokens: adjusted.maxTokens,
				thinkingEnabled: true,
				thinkingBudgetTokens: adjusted.thinkingBudget,
			} satisfies AnthropicOptions;
		}

		case "bedrock-converse-stream": {
			// Explicitly disable thinking when reasoning is not specified
			if (!options?.reasoning) {
				return { ...base, reasoning: undefined } satisfies BedrockOptions;
			}

			// Claude requires max_tokens > thinking.budget_tokens (same as Anthropic direct API)
			// So we need to ensure maxTokens accounts for both thinking and output
			if (model.id.includes("anthropic.claude") || model.id.includes("anthropic/claude")) {
				const adjusted = adjustMaxTokensForThinking(
					base.maxTokens || 0,
					model.maxTokens,
					options.reasoning,
					options?.thinkingBudgets,
				);

				return {
					...base,
					maxTokens: adjusted.maxTokens,
					reasoning: options.reasoning,
					thinkingBudgets: {
						...(options?.thinkingBudgets || {}),
						[clampReasoning(options.reasoning)!]: adjusted.thinkingBudget,
					},
				} satisfies BedrockOptions;
			}

			// Non-Claude models - pass through
			return {
				...base,
				reasoning: options?.reasoning,
				thinkingBudgets: options?.thinkingBudgets,
			} satisfies BedrockOptions;
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

		case "openai-codex-responses":
			return {
				...base,
				reasoningEffort: supportsXhigh(model) ? options?.reasoning : clampReasoning(options?.reasoning),
			} satisfies OpenAICodexResponsesOptions;

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
					budgetTokens: getGoogleBudget(googleModel, effort, options?.thinkingBudgets),
				},
			} satisfies GoogleOptions;
		}

		case "google-gemini-cli": {
			if (!options?.reasoning) {
				return { ...base, thinking: { enabled: false } } satisfies GoogleGeminiCliOptions;
			}

			const effort = clampReasoning(options.reasoning)!;

			// Gemini 3 models use thinkingLevel instead of thinkingBudget
			if (model.id.includes("3-pro") || model.id.includes("3-flash")) {
				return {
					...base,
					thinking: {
						enabled: true,
						level: getGeminiCliThinkingLevel(effort, model.id),
					},
				} satisfies GoogleGeminiCliOptions;
			}

			// Models using thinkingBudget (Gemini 2.x, Claude via Antigravity)
			// Claude requires max_tokens > thinking.budget_tokens
			// So we need to ensure maxTokens accounts for both thinking and output
			const defaultBudgets: ThinkingBudgets = {
				minimal: 1024,
				low: 2048,
				medium: 8192,
				high: 16384,
			};
			const budgets = { ...defaultBudgets, ...options?.thinkingBudgets };

			const minOutputTokens = 1024;
			let thinkingBudget = budgets[effort]!;
			// Caller's maxTokens is the desired output; add thinking budget on top, capped at model limit
			const maxTokens = Math.min((base.maxTokens || 0) + thinkingBudget, model.maxTokens);

			// If not enough room for thinking + output, reduce thinking budget
			if (maxTokens <= thinkingBudget) {
				thinkingBudget = Math.max(0, maxTokens - minOutputTokens);
			}

			return {
				...base,
				maxTokens,
				thinking: {
					enabled: true,
					budgetTokens: thinkingBudget,
				},
			} satisfies GoogleGeminiCliOptions;
		}

		case "google-vertex": {
			// Explicitly disable thinking when reasoning is not specified
			if (!options?.reasoning) {
				return { ...base, thinking: { enabled: false } } satisfies GoogleVertexOptions;
			}

			const vertexModel = model as Model<"google-vertex">;
			const effort = clampReasoning(options.reasoning)!;
			const geminiModel = vertexModel as unknown as Model<"google-generative-ai">;

			if (isGemini3ProModel(geminiModel) || isGemini3FlashModel(geminiModel)) {
				return {
					...base,
					thinking: {
						enabled: true,
						level: getGemini3ThinkingLevel(effort, geminiModel),
					},
				} satisfies GoogleVertexOptions;
			}

			return {
				...base,
				thinking: {
					enabled: true,
					budgetTokens: getGoogleBudget(geminiModel, effort, options?.thinkingBudgets),
				},
			} satisfies GoogleVertexOptions;
		}

		default: {
			// Exhaustiveness check
			const _exhaustive: never = model.api;
			throw new Error(`Unhandled API in mapOptionsForApi: ${_exhaustive}`);
		}
	}
}

type ClampedThinkingLevel = Exclude<ThinkingLevel, "xhigh">;

function isGemini3ProModel(model: Model<"google-generative-ai">): boolean {
	// Covers gemini-3-pro, gemini-3-pro-preview, and possible other prefixed ids in the future
	return model.id.includes("3-pro");
}

function isGemini3FlashModel(model: Model<"google-generative-ai">): boolean {
	// Covers gemini-3-flash, gemini-3-flash-preview, and possible other prefixed ids in the future
	return model.id.includes("3-flash");
}

function getGemini3ThinkingLevel(
	effort: ClampedThinkingLevel,
	model: Model<"google-generative-ai">,
): GoogleThinkingLevel {
	if (isGemini3ProModel(model)) {
		// Gemini 3 Pro only supports LOW/HIGH (for now)
		switch (effort) {
			case "minimal":
			case "low":
				return "LOW";
			case "medium":
			case "high":
				return "HIGH";
		}
	}
	// Gemini 3 Flash supports all four levels
	switch (effort) {
		case "minimal":
			return "MINIMAL";
		case "low":
			return "LOW";
		case "medium":
			return "MEDIUM";
		case "high":
			return "HIGH";
	}
}

function getGeminiCliThinkingLevel(effort: ClampedThinkingLevel, modelId: string): GoogleThinkingLevel {
	if (modelId.includes("3-pro")) {
		// Gemini 3 Pro only supports LOW/HIGH (for now)
		switch (effort) {
			case "minimal":
			case "low":
				return "LOW";
			case "medium":
			case "high":
				return "HIGH";
		}
	}
	// Gemini 3 Flash supports all four levels
	switch (effort) {
		case "minimal":
			return "MINIMAL";
		case "low":
			return "LOW";
		case "medium":
			return "MEDIUM";
		case "high":
			return "HIGH";
	}
}

function getGoogleBudget(
	model: Model<"google-generative-ai">,
	effort: ClampedThinkingLevel,
	customBudgets?: ThinkingBudgets,
): number {
	// Custom budgets take precedence if provided for this level
	if (customBudgets?.[effort] !== undefined) {
		return customBudgets[effort]!;
	}

	// See https://ai.google.dev/gemini-api/docs/thinking#set-budget
	if (model.id.includes("2.5-pro")) {
		const budgets: Record<ClampedThinkingLevel, number> = {
			minimal: 128,
			low: 2048,
			medium: 8192,
			high: 32768,
		};
		return budgets[effort];
	}

	if (model.id.includes("2.5-flash")) {
		// Covers 2.5-flash-lite as well
		const budgets: Record<ClampedThinkingLevel, number> = {
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
