import type OpenAI from "openai";
import { AzureOpenAI } from "openai";
import { getEnvApiKey } from "../env-api-keys.js";
import { supportsXhigh } from "../models.js";
import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	OpenAICompletionsCompat,
	SimpleStreamOptions,
	StreamFunction,
	StreamOptions,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import {
	convertMessages,
	convertTools,
	hasToolHistory,
	processCompletionsStream,
} from "./openai-completions-shared.js";
import { buildBaseOptions, clampReasoning } from "./simple-options.js";

const DEFAULT_AZURE_API_VERSION = "v1";

function parseDeploymentNameMap(value: string | undefined): Map<string, string> {
	const map = new Map<string, string>();
	if (!value) return map;
	for (const entry of value.split(",")) {
		const trimmed = entry.trim();
		if (!trimmed) continue;
		const [modelId, deploymentName] = trimmed.split("=", 2);
		if (!modelId || !deploymentName) continue;
		map.set(modelId.trim(), deploymentName.trim());
	}
	return map;
}

function resolveDeploymentName(
	model: Model<"azure-openai-completions">,
	options?: AzureOpenAICompletionsOptions,
): string {
	if (options?.azureDeploymentName) {
		return options.azureDeploymentName;
	}
	const mappedDeployment = parseDeploymentNameMap(process.env.AZURE_OPENAI_DEPLOYMENT_NAME_MAP).get(model.id);
	return mappedDeployment || model.id;
}

export interface AzureOpenAICompletionsOptions extends StreamOptions {
	toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
	reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
	azureApiVersion?: string;
	azureResourceName?: string;
	azureBaseUrl?: string;
	azureDeploymentName?: string;
}

export const streamAzureOpenAICompletions: StreamFunction<"azure-openai-completions", AzureOpenAICompletionsOptions> = (
	model: Model<"azure-openai-completions">,
	context: Context,
	options?: AzureOpenAICompletionsOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const deploymentName = resolveDeploymentName(model, options);

		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "azure-openai-completions" as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
			const client = createClient(model, apiKey, options);
			const compat = getCompat(model);
			let params = buildParams(model, context, options, deploymentName, compat);
			const nextParams = await options?.onPayload?.(params, model);
			if (nextParams !== undefined) {
				params = nextParams as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;
			}
			const openaiStream = await client.chat.completions.create(params, { signal: options?.signal });
			stream.push({ type: "start", partial: output });

			await processCompletionsStream(openaiStream, output, stream, model);

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unknown error occurred");
			}

			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) delete (block as any).index;
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

export const streamSimpleAzureOpenAICompletions: StreamFunction<"azure-openai-completions", SimpleStreamOptions> = (
	model: Model<"azure-openai-completions">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}

	const base = buildBaseOptions(model, options, apiKey);
	const reasoningEffort = supportsXhigh(model) ? options?.reasoning : clampReasoning(options?.reasoning);
	const toolChoice = (options as AzureOpenAICompletionsOptions | undefined)?.toolChoice;

	return streamAzureOpenAICompletions(model, context, {
		...base,
		reasoningEffort,
		toolChoice,
	} satisfies AzureOpenAICompletionsOptions);
};

function normalizeAzureBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, "");
}

function buildDefaultBaseUrl(resourceName: string): string {
	return `https://${resourceName}.openai.azure.com/openai/v1`;
}

function resolveAzureConfig(
	model: Model<"azure-openai-completions">,
	options?: AzureOpenAICompletionsOptions,
): { baseUrl: string; apiVersion: string } {
	const apiVersion = options?.azureApiVersion || process.env.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_API_VERSION;

	const baseUrl = options?.azureBaseUrl?.trim() || process.env.AZURE_OPENAI_BASE_URL?.trim() || undefined;
	const resourceName = options?.azureResourceName || process.env.AZURE_OPENAI_RESOURCE_NAME;

	let resolvedBaseUrl = baseUrl;

	if (!resolvedBaseUrl && resourceName) {
		resolvedBaseUrl = buildDefaultBaseUrl(resourceName);
	}

	if (!resolvedBaseUrl && model.baseUrl) {
		resolvedBaseUrl = model.baseUrl;
	}

	if (!resolvedBaseUrl) {
		throw new Error(
			"Azure OpenAI base URL is required. Set AZURE_OPENAI_BASE_URL or AZURE_OPENAI_RESOURCE_NAME, or pass azureBaseUrl, azureResourceName, or model.baseUrl.",
		);
	}

	return {
		baseUrl: normalizeAzureBaseUrl(resolvedBaseUrl),
		apiVersion,
	};
}

function createClient(
	model: Model<"azure-openai-completions">,
	apiKey: string,
	options?: AzureOpenAICompletionsOptions,
) {
	if (!apiKey) {
		if (!process.env.AZURE_OPENAI_API_KEY) {
			throw new Error(
				"Azure OpenAI API key is required. Set AZURE_OPENAI_API_KEY environment variable or pass it as an argument.",
			);
		}
		apiKey = process.env.AZURE_OPENAI_API_KEY;
	}

	const headers = { ...model.headers };

	if (options?.headers) {
		Object.assign(headers, options.headers);
	}

	const { baseUrl, apiVersion } = resolveAzureConfig(model, options);

	return new AzureOpenAI({
		apiKey,
		apiVersion,
		dangerouslyAllowBrowser: true,
		defaultHeaders: headers,
		baseURL: baseUrl,
	});
}

function buildParams(
	model: Model<"azure-openai-completions">,
	context: Context,
	options: AzureOpenAICompletionsOptions | undefined,
	deploymentName: string,
	compat: Required<OpenAICompletionsCompat>,
) {
	// convertMessages expects Model<"openai-completions"> but the message format is identical
	const messages = convertMessages(model as unknown as Model<"openai-completions">, context, compat);

	const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
		model: deploymentName,
		messages,
		stream: true,
	};

	if (compat.supportsUsageInStreaming !== false) {
		(params as any).stream_options = { include_usage: true };
	}

	if (options?.maxTokens) {
		params.max_completion_tokens = options.maxTokens;
	}

	if (options?.temperature !== undefined) {
		params.temperature = options.temperature;
	}

	if (context.tools) {
		params.tools = convertTools(context.tools, compat);
	} else if (hasToolHistory(context.messages)) {
		params.tools = [];
	}

	if (options?.toolChoice) {
		params.tool_choice = options.toolChoice;
	}

	if (options?.reasoningEffort && model.reasoning && compat.supportsReasoningEffort) {
		(params as any).reasoning_effort = options.reasoningEffort;
	}

	return params;
}

/**
 * Get resolved compatibility settings for Azure OpenAI.
 * Azure OpenAI follows the standard OpenAI format closely.
 */
function getCompat(model: Model<"azure-openai-completions">): Required<OpenAICompletionsCompat> {
	const defaults: Required<OpenAICompletionsCompat> = {
		supportsStore: false,
		supportsDeveloperRole: true,
		supportsReasoningEffort: true,
		reasoningEffortMap: {},
		supportsUsageInStreaming: true,
		maxTokensField: "max_completion_tokens",
		requiresToolResultName: false,
		requiresAssistantAfterToolResult: false,
		requiresThinkingAsText: false,
		thinkingFormat: "openai",
		openRouterRouting: {},
		vercelGatewayRouting: {},
		supportsStrictMode: true,
	};

	if (!model.compat) return defaults;

	return {
		supportsStore: model.compat.supportsStore ?? defaults.supportsStore,
		supportsDeveloperRole: model.compat.supportsDeveloperRole ?? defaults.supportsDeveloperRole,
		supportsReasoningEffort: model.compat.supportsReasoningEffort ?? defaults.supportsReasoningEffort,
		reasoningEffortMap: model.compat.reasoningEffortMap ?? defaults.reasoningEffortMap,
		supportsUsageInStreaming: model.compat.supportsUsageInStreaming ?? defaults.supportsUsageInStreaming,
		maxTokensField: model.compat.maxTokensField ?? defaults.maxTokensField,
		requiresToolResultName: model.compat.requiresToolResultName ?? defaults.requiresToolResultName,
		requiresAssistantAfterToolResult:
			model.compat.requiresAssistantAfterToolResult ?? defaults.requiresAssistantAfterToolResult,
		requiresThinkingAsText: model.compat.requiresThinkingAsText ?? defaults.requiresThinkingAsText,
		thinkingFormat: model.compat.thinkingFormat ?? defaults.thinkingFormat,
		openRouterRouting: model.compat.openRouterRouting ?? defaults.openRouterRouting,
		vercelGatewayRouting: model.compat.vercelGatewayRouting ?? defaults.vercelGatewayRouting,
		supportsStrictMode: model.compat.supportsStrictMode ?? defaults.supportsStrictMode,
	};
}
