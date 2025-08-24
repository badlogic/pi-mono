export interface LLMOptions {
	temperature?: number;
	maxTokens?: number;
	onText?: (text: string, complete: boolean) => void;
	onThinking?: (thinking: string, complete: boolean) => void;
	signal?: AbortSignal;
}

export interface LLM<T extends LLMOptions> {
	complete(request: Context, options?: T): Promise<AssistantMessage>;
}

export interface ModelInfo {
	id: string;
	name: string;
	provider: string;
	capabilities: {
		reasoning: boolean;
		toolCall: boolean;
		vision: boolean;
		audio?: boolean;
	};
	cost: {
		input: number; // per million tokens
		output: number; // per million tokens
		cacheRead?: number;
		cacheWrite?: number;
	};
	limits: {
		context: number;
		output: number;
	};
	knowledge?: string;
}

export interface UserMessage {
	role: "user";
	content: string;
}

export interface AssistantMessage {
	role: "assistant";
	thinking?: string;
	thinkingSignature?: string; // Leaky abstraction: needed for Anthropic
	content?: string;
	toolCalls?: {
		id: string;
		name: string;
		arguments: Record<string, any>;
	}[];
	model: string;
	usage: TokenUsage;

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
	| { type: "usage"; usage: TokenUsage }
	| { type: "done"; reason: StopReason; message: AssistantMessage }
	| { type: "error"; error: Error };

export interface ToolCall {
	id: string;
	name: string;
	arguments: Record<string, any>;
}

export interface TokenUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

export type StopReason = "stop" | "length" | "toolUse" | "safety" | "error";
