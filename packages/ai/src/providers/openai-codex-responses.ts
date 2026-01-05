import { getEnvApiKey } from "../stream.js";
import type { Context, Model, StopReason, StreamOptions } from "../types.js";
import { getChatgptAccountIdFromAccessToken } from "../utils/openai-account-id.js";
import { CODEX_BASE_URL, OPENAI_HEADER_VALUES, OPENAI_HEADERS, URL_PATHS } from "./openai-codex/constants.js";
import { getCodexInstructions } from "./openai-codex/prompts/codex.js";
import {
	type CodexRequestOptions,
	normalizeModel,
	type RequestBody,
	transformRequestBody,
} from "./openai-codex/request-transformer.js";
import { parseCodexError, parseCodexSseStream } from "./openai-codex/response-handler.js";
import { convertMessages, convertTools } from "./openai-responses/conversion.js";
import type { ResponsesEngineEvent } from "./openai-responses/engine.js";
import { createResponsesStreamFunction, type ResponsesDriver } from "./openai-responses/factory.js";

export interface OpenAICodexResponsesOptions extends StreamOptions {
	reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
	reasoningSummary?: "auto" | "concise" | "detailed" | "off" | "on" | null;
	textVerbosity?: "low" | "medium" | "high";
	include?: string[];
	codexMode?: boolean;
}

const CODEX_DEBUG = process.env.PI_CODEX_DEBUG === "1" || process.env.PI_CODEX_DEBUG === "true";

type CodexRawSseEvent = Record<string, unknown>;

type OutputItemAddedEvent = Extract<ResponsesEngineEvent, { type: "response.output_item.added" }>;

type OutputItemDoneEvent = Extract<ResponsesEngineEvent, { type: "response.output_item.done" }>;

type ReasoningSummaryPartAddedEvent = Extract<ResponsesEngineEvent, { type: "response.reasoning_summary_part.added" }>;

type ContentPartAddedEvent = Extract<ResponsesEngineEvent, { type: "response.content_part.added" }>;

type CompletedEvent = Extract<ResponsesEngineEvent, { type: "response.completed" }>;

type DoneEvent = Extract<ResponsesEngineEvent, { type: "response.done" }>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function adaptCodexSseEvent(raw: CodexRawSseEvent): ResponsesEngineEvent | null {
	const type = typeof raw.type === "string" ? raw.type : "";
	if (!type) return null;

	switch (type) {
		case "response.output_item.added": {
			if (!isRecord(raw.item)) return null;
			return { type, item: raw.item as unknown as OutputItemAddedEvent["item"] };
		}

		case "response.output_item.done": {
			if (!isRecord(raw.item)) return null;
			return { type, item: raw.item as unknown as OutputItemDoneEvent["item"] };
		}

		case "response.reasoning_summary_part.added": {
			if (!isRecord(raw.part) || typeof raw.part.text !== "string") return null;
			return { type, part: raw.part as unknown as ReasoningSummaryPartAddedEvent["part"] };
		}

		case "response.reasoning_summary_text.delta":
		case "response.output_text.delta":
		case "response.refusal.delta":
		case "response.function_call_arguments.delta": {
			return { type, delta: typeof raw.delta === "string" ? raw.delta : "" };
		}

		case "response.reasoning_summary_part.done": {
			return { type };
		}

		case "response.content_part.added": {
			if (!isRecord(raw.part)) return null;
			return { type, part: raw.part as unknown as ContentPartAddedEvent["part"] };
		}

		case "response.completed": {
			return { type, response: raw.response as unknown as CompletedEvent["response"] };
		}

		case "response.done": {
			return { type, response: raw.response as unknown as DoneEvent["response"] };
		}

		case "response.failed": {
			return { type };
		}

		case "error": {
			return {
				type,
				code: typeof raw.code === "string" ? raw.code : undefined,
				message: typeof raw.message === "string" ? raw.message : undefined,
			};
		}

		default: {
			return { type, ...raw };
		}
	}
}

async function* codexResponsesEvents(response: Response): AsyncGenerator<ResponsesEngineEvent> {
	for await (const rawEvent of parseCodexSseStream(response)) {
		const engineEvent = adaptCodexSseEvent(rawEvent);
		if (engineEvent) {
			yield engineEvent;
			continue;
		}

		const type = typeof rawEvent.type === "string" ? rawEvent.type : "";
		if (!type) continue;
		yield rawEvent as unknown as ResponsesEngineEvent;
	}
}

const driver: ResponsesDriver<"openai-codex-responses"> = {
	api: "openai-codex-responses",
	unknownErrorMessage: "An unknown error occurred",
	mapStopReason: (status: unknown) => mapStopReason(typeof status === "string" ? status : undefined),
	createEventStream: async (model: Model<"openai-codex-responses">, context: Context, options) => {
		const apiKey = options.apiKey || getEnvApiKey(model.provider) || "";
		if (!apiKey) {
			throw new Error(`No API key for provider: ${model.provider}`);
		}

		const accountId = getChatgptAccountIdFromAccessToken(apiKey);
		if (!accountId) {
			throw new Error("Failed to extract accountId from token");
		}

		const baseUrl = model.baseUrl || CODEX_BASE_URL;
		const baseWithSlash = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
		const url = rewriteUrlForCodex(new URL(URL_PATHS.RESPONSES.slice(1), baseWithSlash).toString());

		const messages = convertMessages(model, context);
		const params: RequestBody = {
			model: model.id,
			input: messages,
			stream: true,
		};
		if (options?.maxTokens) {
			params.max_output_tokens = options.maxTokens;
		}

		if (options?.temperature !== undefined) {
			params.temperature = options.temperature;
		}

		if (context.tools) {
			params.tools = convertTools(context.tools);
		}

		const normalizedModel = normalizeModel(params.model);
		const codexInstructions = await getCodexInstructions(normalizedModel);

		const codexOptions: CodexRequestOptions = {
			reasoningEffort: options?.reasoningEffort,
			reasoningSummary: options?.reasoningSummary ?? undefined,
			textVerbosity: options?.textVerbosity,
			include: options?.include,
		};

		const transformedBody = await transformRequestBody(
			params,
			codexInstructions,
			codexOptions,
			options?.codexMode ?? true,
			context.systemPrompt,
		);

		const headers = createCodexHeaders(model.headers, accountId, apiKey, transformedBody.prompt_cache_key);
		logCodexDebug("codex request", {
			url,
			model: params.model,
			headers: redactHeaders(headers),
		});

		const response = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(transformedBody),
			signal: options.signal,
		});

		logCodexDebug("codex response", {
			url: response.url,
			status: response.status,
			statusText: response.statusText,
			contentType: response.headers.get("content-type") || null,
			cfRay: response.headers.get("cf-ray") || null,
		});

		if (!response.ok) {
			const info = await parseCodexError(response);
			throw new Error(info.friendlyMessage || info.message);
		}

		if (!response.body) {
			throw new Error("No response body");
		}

		return codexResponsesEvents(response);
	},
};

export const streamOpenAICodexResponses = createResponsesStreamFunction(driver);

function createCodexHeaders(
	initHeaders: Record<string, string> | undefined,
	accountId: string,
	accessToken: string,
	promptCacheKey?: string,
): Headers {
	const headers = new Headers(initHeaders ?? {});
	headers.delete("x-api-key");
	headers.set("Authorization", `Bearer ${accessToken}`);
	headers.set(OPENAI_HEADERS.ACCOUNT_ID, accountId);
	headers.set(OPENAI_HEADERS.BETA, OPENAI_HEADER_VALUES.BETA_RESPONSES);
	headers.set(OPENAI_HEADERS.ORIGINATOR, OPENAI_HEADER_VALUES.ORIGINATOR_CODEX);

	if (promptCacheKey) {
		headers.set(OPENAI_HEADERS.CONVERSATION_ID, promptCacheKey);
		headers.set(OPENAI_HEADERS.SESSION_ID, promptCacheKey);
	} else {
		headers.delete(OPENAI_HEADERS.CONVERSATION_ID);
		headers.delete(OPENAI_HEADERS.SESSION_ID);
	}

	headers.set("accept", "text/event-stream");
	headers.set("content-type", "application/json");
	return headers;
}

function logCodexDebug(message: string, details?: Record<string, unknown>): void {
	if (!CODEX_DEBUG) return;
	if (details) {
		console.error(`[codex] ${message}`, details);
		return;
	}
	console.error(`[codex] ${message}`);
}

function redactHeaders(headers: Headers): Record<string, string> {
	const redacted: Record<string, string> = {};
	for (const [key, value] of headers.entries()) {
		const lower = key.toLowerCase();
		if (lower === "authorization") {
			redacted[key] = "Bearer [redacted]";
			continue;
		}
		if (
			lower.includes("account") ||
			lower.includes("session") ||
			lower.includes("conversation") ||
			lower === "cookie"
		) {
			redacted[key] = "[redacted]";
			continue;
		}
		redacted[key] = value;
	}
	return redacted;
}

function rewriteUrlForCodex(url: string): string {
	return url.replace(URL_PATHS.RESPONSES, URL_PATHS.CODEX_RESPONSES);
}
function mapStopReason(status: string | undefined): StopReason {
	if (!status) return "stop";
	switch (status) {
		case "completed":
			return "stop";
		case "incomplete":
			return "length";
		case "failed":
		case "cancelled":
			return "error";
		case "in_progress":
		case "queued":
			return "stop";
		default:
			return "stop";
	}
}
