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
	api: string;
	provider: string;
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
	| { type: "start"; model: string; provider: string }
	| { type: "text_start" }
	| { type: "text_delta"; content: string; delta: string }
	| { type: "text_end"; content: string }
	| { type: "thinking_start" }
	| { type: "thinking_delta"; content: string; delta: string }
	| { type: "thinking_end"; content: string }
	| { type: "toolCall"; toolCall: ToolCall }
	| { type: "done"; reason: StopReason; message: AssistantMessage }
	| { type: "error"; error: string };

// Model interface for the unified model system
export interface Model {
	id: string;
	name: string;
	provider: string;
	baseUrl?: string;
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
