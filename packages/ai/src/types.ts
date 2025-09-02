export type KnownApi = "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";
export type Api = KnownApi | string;

export type KnownProvider = "anthropic" | "google" | "openai" | "xai" | "groq" | "cerebras" | "openrouter";
export type Provider = KnownProvider | string;

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

// The stream interface - what generate() returns
export interface GenerateStream extends AsyncIterable<AssistantMessageEvent> {
	// Get the final message (waits for streaming to complete)
	finalMessage(): Promise<AssistantMessage>;
}

// Base options all providers share
export interface GenerateOptions {
	temperature?: number;
	maxTokens?: number;
	signal?: AbortSignal;
	apiKey?: string;
}

// Unified options with reasoning (what public generate() accepts)
export interface GenerateOptionsUnified extends GenerateOptions {
	reasoning?: ReasoningEffort;
}

// Generic GenerateFunction with typed options
export type GenerateFunction<TOptions extends GenerateOptions = GenerateOptions> = (
	model: Model,
	context: Context,
	options: TOptions,
) => GenerateStream;

// Legacy LLM interface (to be removed)
export interface LLMOptions {
	temperature?: number;
	maxTokens?: number;
	onEvent?: (event: AssistantMessageEvent) => void;
	signal?: AbortSignal;
}

export interface LLM<T extends LLMOptions> {
	generate(request: Context, options?: T): Promise<AssistantMessage>;
	getModel(): Model;
	getApi(): string;
}

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
	error?: string | Error;
}

export interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: string;
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
	| { type: "text_start"; partial: AssistantMessage }
	| { type: "text_delta"; delta: string; partial: AssistantMessage }
	| { type: "text_end"; content: string; partial: AssistantMessage }
	| { type: "thinking_start"; partial: AssistantMessage }
	| { type: "thinking_delta"; delta: string; partial: AssistantMessage }
	| { type: "thinking_end"; content: string; partial: AssistantMessage }
	| { type: "toolCall"; toolCall: ToolCall; partial: AssistantMessage }
	| { type: "done"; reason: StopReason; message: AssistantMessage }
	| { type: "error"; error: string; partial: AssistantMessage };

// Model interface for the unified model system
export interface Model {
	id: string;
	name: string;
	api: Api;
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
