import OpenAI from "openai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import { getEnvApiKey } from "../stream.js";
import type { Context, Model, StopReason, StreamOptions } from "../types.js";
import { convertMessages, convertTools } from "./openai-responses/conversion.js";
import { applyCopilotResponsesHeaders } from "./openai-responses/copilot-headers.js";
import type { ResponsesEngineEvent } from "./openai-responses/engine.js";
import { createResponsesStreamFunction, type ResponsesDriver } from "./openai-responses/factory.js";

// OpenAI Responses-specific options
export interface OpenAIResponsesOptions extends StreamOptions {
	reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
	reasoningSummary?: "auto" | "detailed" | "concise" | null;
}

const driver: ResponsesDriver<"openai-responses"> = {
	api: "openai-responses",
	unknownErrorMessage: "An unknown error occurred",
	mapStopReason: (status: unknown) => mapStopReason(status as OpenAI.Responses.ResponseStatus | undefined),
	createEventStream: async (model, context, options) => {
		const apiKey = options.apiKey || getEnvApiKey(model.provider) || "";
		const client = createClient(model, context, apiKey);
		const params = buildParams(model, context, options);
		const openaiStream = await client.responses.create(params, { signal: options.signal });
		return openaiStream as unknown as AsyncIterable<ResponsesEngineEvent>;
	},
};

/**
 * Generate function for OpenAI Responses API
 */
export const streamOpenAIResponses = createResponsesStreamFunction(driver);

function createClient(model: Model<"openai-responses">, context: Context, apiKey?: string) {
	if (!apiKey) {
		if (!process.env.OPENAI_API_KEY) {
			throw new Error(
				"OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it as an argument.",
			);
		}
		apiKey = process.env.OPENAI_API_KEY;
	}

	const headers = { ...model.headers };
	if (model.provider === "github-copilot") {
		applyCopilotResponsesHeaders(headers, context);
	}

	return new OpenAI({
		apiKey,
		baseURL: model.baseUrl,
		dangerouslyAllowBrowser: true,
		defaultHeaders: headers,
	});
}

function buildParams(model: Model<"openai-responses">, context: Context, options?: OpenAIResponsesOptions) {
	const messages = convertMessages(model, context);

	const params: ResponseCreateParamsStreaming = {
		model: model.id,
		input: messages,
		stream: true,
	};

	if (options?.maxTokens) {
		params.max_output_tokens = options?.maxTokens;
	}

	if (options?.temperature !== undefined) {
		params.temperature = options?.temperature;
	}

	if (context.tools) {
		params.tools = convertTools(context.tools);
	}

	if (model.reasoning) {
		if (options?.reasoningEffort || options?.reasoningSummary) {
			params.reasoning = {
				effort: options?.reasoningEffort || "medium",
				summary: options?.reasoningSummary || "auto",
			};
			params.include = ["reasoning.encrypted_content"];
		} else {
			if (model.name.startsWith("gpt-5")) {
				// Jesus Christ, see https://community.openai.com/t/need-reasoning-false-option-for-gpt-5/1351588/7
				messages.push({
					role: "developer",
					content: [
						{
							type: "input_text",
							text: "# Juice: 0 !important",
						},
					],
				});
			}
		}
	}

	return params;
}

function mapStopReason(status: OpenAI.Responses.ResponseStatus | undefined): StopReason {
	if (!status) return "stop";
	switch (status) {
		case "completed":
			return "stop";
		case "incomplete":
			return "length";
		case "failed":
		case "cancelled":
			return "error";
		// These two are wonky ...
		case "in_progress":
		case "queued":
			return "stop";
		default: {
			const _exhaustive: never = status;
			throw new Error(`Unhandled stop reason: ${_exhaustive}`);
		}
	}
}
