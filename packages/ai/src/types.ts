export interface LLMOptions {
	temperature?: number;
	maxTokens?: number;
	onText?: (text: string, complete: boolean) => void;
	onThinking?: (thinking: string, complete: boolean) => void;
	signal?: AbortSignal;
}

export interface LLM<T extends LLMOptions> {
	complete(request: Context, options?: T): Promise<AssistantMessage>;
	getModel(): Model;
}

export interface TextContent {
	type: "text";
	text: string;
}

export interface ImageContent {
	type: "image";
	data: string; // base64 encoded image data
	mimeType: string; // e.g., "image/jpeg", "image/png"
}

export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
}

export interface AssistantMessage {
	role: "assistant";
	thinking?: string;
	// Leaky abstraction: provider specific, does not translate to other providers
	thinkingSignature?: string;
	content?: string;
	toolCalls?: {
		id: string;
		name: string;
		arguments: Record<string, any>;
	}[];
	provider: string;
	model: string;
	usage: Usage;

	stopReason: StopReason;
	error?: string | Error;
}

export interface ToolResultMessage {
	role: "toolResult";
	content: string;
	toolCallId: string;
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

export type Event =
	| { type: "start"; model: string; provider: string }
	| { type: "text"; content: string; delta: string }
	| { type: "thinking"; content: string; delta: string }
	| { type: "toolCall"; toolCall: ToolCall }
	| { type: "usage"; usage: Usage }
	| { type: "done"; reason: StopReason; message: AssistantMessage }
	| { type: "error"; error: Error };

export interface ToolCall {
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
