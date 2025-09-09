import type { AssistantMessageEventStream } from "./event-stream";
import type { AnthropicOptions } from "./providers/anthropic";
import type { GoogleOptions } from "./providers/google";
import type { OpenAICompletionsOptions } from "./providers/openai-completions";
import type { OpenAIResponsesOptions } from "./providers/openai-responses";

export type { AssistantMessageEventStream } from "./event-stream";

export type Api = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";

export interface ApiOptionsMap {
	"anthropic-messages": AnthropicOptions;
	"openai-completions": OpenAICompletionsOptions;
	"openai-responses": OpenAIResponsesOptions;
	"google-generative-ai": GoogleOptions;
}

// Compile-time exhaustiveness check - this will fail if ApiOptionsMap doesn't have all KnownApi keys
type _CheckExhaustive = ApiOptionsMap extends Record<Api, GenerateOptions>
	? Record<Api, GenerateOptions> extends ApiOptionsMap
		? true
		: ["ApiOptionsMap is missing some KnownApi values", Exclude<Api, keyof ApiOptionsMap>]
	: ["ApiOptionsMap doesn't extend Record<KnownApi, GenerateOptions>"];
const _exhaustive: _CheckExhaustive = true;

// Helper type to get options for a specific API
export type OptionsForApi<TApi extends Api> = ApiOptionsMap[TApi];

export type KnownProvider = "anthropic" | "google" | "openai" | "xai" | "groq" | "cerebras" | "openrouter" | "zai";
export type Provider = KnownProvider | string;

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

// Base options all providers share
export interface GenerateOptions {
	temperature?: number;
	maxTokens?: number;
	signal?: AbortSignal;
	apiKey?: string;
}

// Unified options with reasoning (what public generate() accepts)
export interface SimpleGenerateOptions extends GenerateOptions {
	reasoning?: ReasoningEffort;
}

// Generic GenerateFunction with typed options
export type GenerateFunction<TApi extends Api> = (
	model: Model<TApi>,
	context: Context,
	options: OptionsForApi<TApi>,
) => AssistantMessageEventStream;

export interface TextContent {
	type: "text";
	text: string;
	textSignature?: string; // e.g., for OpenAI responses, the message ID
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
	thinkingSignature?: string; // e.g., for OpenAI responses, the reasoning item ID
}

export interface ImageContent {
	type: "image";
	data: string; // base64 encoded image data
	mimeType: string; // e.g., "image/jpeg", "image/png"
}

export interface ToolCall {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, any>;
}

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

export type StopReason = "stop" | "length" | "toolUse" | "safety" | "error";

export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
}

export interface AssistantMessage {
	role: "assistant";
	content: (TextContent | ThinkingContent | ToolCall)[];
	api: Api;
	provider: Provider;
	model: string;
	usage: Usage;
	stopReason: StopReason;
	error?: string;
}

export interface ToolResultMessage<TDetails = any> {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	output: string;
	details?: TDetails;
	isError: boolean;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export interface Tool {
	name: string;
	description: string;
	parameters: Record<string, any>; // JSON Schema
}

export interface Context {
	systemPrompt?: string;
	messages: Message[];
	tools?: Tool[];
}

export type AssistantMessageEvent =
	| { type: "start"; partial: AssistantMessage }
	| { type: "text_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
	| { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
	| { type: "done"; reason: StopReason; message: AssistantMessage }
	| { type: "error"; error: string; partial: AssistantMessage };

// Model interface for the unified model system
export interface Model<TApi extends Api> {
	id: string;
	name: string;
	api: TApi;
	provider: Provider;
	baseUrl: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: {
		input: number; // $/million tokens
		output: number; // $/million tokens
		cacheRead: number; // $/million tokens
		cacheWrite: number; // $/million tokens
	};
	contextWindow: number;
	maxTokens: number;
}
