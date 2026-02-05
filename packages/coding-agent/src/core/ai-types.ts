/**
 * AI types for the coding agent.
 *
 * This module provides type definitions that bridge between the application's
 * data model and the Vercel AI SDK. It re-exports Vercel types where appropriate
 * and provides custom types for features not covered by the SDK.
 */

import type { LanguageModelV2, LanguageModelV3 } from "@ai-sdk/provider";

// Re-export Vercel AI SDK types
export type LanguageModel = LanguageModelV3 | LanguageModelV2;
export type {
	AssistantModelMessage,
	ModelMessage,
	SystemModelMessage,
	ToolModelMessage,
	UserModelMessage,
} from "@ai-sdk/provider-utils";

// ============================================================================
// Provider and API Types
// ============================================================================

/** Known API backends */
export type KnownApi =
	| "openai-completions"
	| "openai-responses"
	| "azure-openai-responses"
	| "openai-codex-responses"
	| "anthropic-messages"
	| "bedrock-converse-stream"
	| "google-generative-ai"
	| "google-gemini-cli"
	| "google-vertex";

export type Api = KnownApi | (string & {});

/** Known providers */
export type KnownProvider =
	| "amazon-bedrock"
	| "anthropic"
	| "google"
	| "google-gemini-cli"
	| "google-antigravity"
	| "google-vertex"
	| "openai"
	| "azure-openai-responses"
	| "openai-codex"
	| "github-copilot"
	| "xai"
	| "groq"
	| "cerebras"
	| "openrouter"
	| "vercel-ai-gateway"
	| "zai"
	| "mistral"
	| "minimax"
	| "minimax-cn"
	| "huggingface"
	| "opencode"
	| "kimi-coding";

export type Provider = KnownProvider | string;

// ============================================================================
// Thinking/Reasoning Types
// ============================================================================

/** Thinking/reasoning level for models that support it */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** Token budgets for each thinking level (token-based providers only) */
export interface ThinkingBudgets {
	minimal?: number;
	low?: number;
	medium?: number;
	high?: number;
}

// ============================================================================
// Content Types
// ============================================================================

export interface TextContent {
	type: "text";
	text: string;
	textSignature?: string;
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
	thinkingSignature?: string;
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
	arguments: Record<string, unknown>;
	thoughtSignature?: string;
}

// ============================================================================
// Usage and Cost Types
// ============================================================================

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

// ============================================================================
// Message Types
// ============================================================================

export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	timestamp: number;
}

export interface AssistantMessage {
	role: "assistant";
	content: (TextContent | ThinkingContent | ToolCall)[];
	api: Api;
	provider: Provider;
	model: string;
	usage: Usage;
	stopReason: StopReason;
	errorMessage?: string;
	timestamp: number;
}

export interface ToolResultMessage<TDetails = unknown> {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[];
	details?: TDetails;
	isError: boolean;
	timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

// ============================================================================
// Tool Types
// ============================================================================

/**
 * Tool definition.
 * TParameters can be a Zod schema (z.ZodType) or TypeBox schema (TSchema).
 * During migration, both are supported. Use Zod for new tools.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Tool<TParameters = any> {
	name: string;
	description: string;
	parameters: TParameters;
}

export interface Context {
	systemPrompt?: string;
	messages: Message[];
	tools?: Tool[];
}

// ============================================================================
// Streaming Event Types
// ============================================================================

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
	| { type: "done"; reason: Extract<StopReason, "stop" | "length" | "toolUse">; message: AssistantMessage }
	| { type: "error"; reason: Extract<StopReason, "aborted" | "error">; error: AssistantMessage };

// ============================================================================
// Model Types
// ============================================================================

/** Compatibility settings for OpenAI-compatible completions APIs */
export interface OpenAICompletionsCompat {
	supportsStore?: boolean;
	supportsDeveloperRole?: boolean;
	supportsReasoningEffort?: boolean;
	supportsUsageInStreaming?: boolean;
	maxTokensField?: "max_completion_tokens" | "max_tokens";
	requiresToolResultName?: boolean;
	requiresAssistantAfterToolResult?: boolean;
	requiresThinkingAsText?: boolean;
	requiresMistralToolIds?: boolean;
	thinkingFormat?: "openai" | "zai" | "qwen";
	openRouterRouting?: OpenRouterRouting;
	vercelGatewayRouting?: VercelGatewayRouting;
	supportsStrictMode?: boolean;
}

/** Compatibility settings for OpenAI Responses APIs */
export interface OpenAIResponsesCompat {
	// Reserved for future use
}

/** OpenRouter provider routing preferences */
export interface OpenRouterRouting {
	only?: string[];
	order?: string[];
}

/** Vercel AI Gateway routing preferences */
export interface VercelGatewayRouting {
	only?: string[];
	order?: string[];
}

/**
 * Model metadata containing static information about a model.
 * This is separate from the LanguageModel instance which is used for inference.
 */
export interface ModelInfo<TApi extends Api = Api> {
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
	headers?: Record<string, string>;
	compat?: TApi extends "openai-completions"
		? OpenAICompletionsCompat
		: TApi extends "openai-responses"
			? OpenAIResponsesCompat
			: never;
}

/**
 * Combined model type that includes both metadata and the language model instance.
 * The `model` field is lazy-loaded to avoid creating provider instances until needed.
 */
export interface Model<TApi extends Api = Api> extends ModelInfo<TApi> {
	/** Get the Vercel AI SDK LanguageModel instance for this model */
	getLanguageModel?: (apiKey?: string) => LanguageModel;
}

// ============================================================================
// Agent Types
// ============================================================================

/** Tool result from agent execution */
export interface AgentToolResult<T = unknown> {
	content: (TextContent | ImageContent)[];
	details: T;
}

/** Callback for streaming tool execution updates */
export type AgentToolUpdateCallback<T = unknown> = (partialResult: AgentToolResult<T>) => void;

/**
 * Agent tool extends Tool with execution function.
 * TParameters can be a Zod schema or TypeBox schema.
 * During migration, both are supported. Use Zod for new tools.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AgentTool<TParameters = any, TDetails = unknown> extends Tool<TParameters> {
	label: string;
	execute: (
		toolCallId: string,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		params: any,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TDetails>,
	) => Promise<AgentToolResult<TDetails>>;
}

/** Extensible interface for custom app messages */
export interface CustomAgentMessages {
	// Empty by default - apps extend via declaration merging
}

/** Agent message: union of LLM messages + custom messages */
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

/** Agent state */
export interface AgentState {
	systemPrompt: string;
	model: Model;
	thinkingLevel: ThinkingLevel;
	tools: AgentTool[];
	messages: AgentMessage[];
	isStreaming: boolean;
	streamMessage: AgentMessage | null;
	pendingToolCalls: Set<string>;
	error?: string;
}

/** Events emitted by the Agent for UI updates */
export type AgentEvent =
	| { type: "agent_start" }
	| { type: "agent_end"; messages: AgentMessage[] }
	| { type: "turn_start" }
	| { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
	| { type: "message_start"; message: AgentMessage }
	| { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
	| { type: "message_end"; message: AgentMessage }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
	| { type: "tool_execution_update"; toolCallId: string; toolName: string; args: unknown; partialResult: unknown }
	| { type: "tool_execution_end"; toolCallId: string; toolName: string; result: unknown; isError: boolean };

// ============================================================================
// Stream Options
// ============================================================================

export type CacheRetention = "none" | "short" | "long";

export interface StreamOptions {
	temperature?: number;
	maxTokens?: number;
	signal?: AbortSignal;
	apiKey?: string;
	cacheRetention?: CacheRetention;
	sessionId?: string;
	onPayload?: (payload: unknown) => void;
	headers?: Record<string, string>;
	maxRetryDelayMs?: number;
}

export type ProviderStreamOptions = StreamOptions & Record<string, unknown>;

export interface SimpleStreamOptions extends StreamOptions {
	reasoning?: ThinkingLevel;
	thinkingBudgets?: ThinkingBudgets;
}

// ============================================================================
// Utility Functions
// ============================================================================

/** Calculate cost based on usage and model pricing */
export function calculateCost(model: ModelInfo, usage: Usage): Usage["cost"] {
	usage.cost.input = (model.cost.input / 1_000_000) * usage.input;
	usage.cost.output = (model.cost.output / 1_000_000) * usage.output;
	usage.cost.cacheRead = (model.cost.cacheRead / 1_000_000) * usage.cacheRead;
	usage.cost.cacheWrite = (model.cost.cacheWrite / 1_000_000) * usage.cacheWrite;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
	return usage.cost;
}

/** Check if two models are equal by comparing id and provider */
export function modelsAreEqual(a: ModelInfo | null | undefined, b: ModelInfo | null | undefined): boolean {
	if (!a || !b) return false;
	return a.id === b.id && a.provider === b.provider;
}

/** Models that support xhigh thinking level */
const XHIGH_MODELS = new Set(["gpt-5.1-codex-max", "gpt-5.2", "gpt-5.2-codex"]);

/** Check if a model supports xhigh thinking level */
export function supportsXhigh(model: ModelInfo): boolean {
	return XHIGH_MODELS.has(model.id);
}

/** Create empty usage object */
export function createEmptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

// ============================================================================
// Event Stream Types
// ============================================================================

/** Generic event stream class for async iteration */
export class EventStream<T, R = T> implements AsyncIterable<T> {
	private queue: T[] = [];
	private waiting: ((value: IteratorResult<T>) => void)[] = [];
	private done = false;
	private finalResultPromise: Promise<R>;
	private resolveFinalResult!: (result: R) => void;

	constructor(
		private isComplete: (event: T) => boolean,
		private extractResult: (event: T) => R,
	) {
		this.finalResultPromise = new Promise((resolve) => {
			this.resolveFinalResult = resolve;
		});
	}

	push(event: T): void {
		if (this.done) return;

		if (this.isComplete(event)) {
			this.done = true;
			this.resolveFinalResult(this.extractResult(event));
		}

		// Deliver to waiting consumer or queue it
		const waiter = this.waiting.shift();
		if (waiter) {
			waiter({ value: event, done: false });
		} else {
			this.queue.push(event);
		}
	}

	end(result?: R): void {
		this.done = true;
		if (result !== undefined) {
			this.resolveFinalResult(result);
		}
		// Notify all waiting consumers that we're done
		while (this.waiting.length > 0) {
			const waiter = this.waiting.shift()!;
			waiter({ value: undefined as never, done: true });
		}
	}

	async *[Symbol.asyncIterator](): AsyncIterator<T> {
		while (true) {
			if (this.queue.length > 0) {
				yield this.queue.shift()!;
			} else if (this.done) {
				return;
			} else {
				const result = await new Promise<IteratorResult<T>>((resolve) => this.waiting.push(resolve));
				if (result.done) return;
				yield result.value;
			}
		}
	}

	result(): Promise<R> {
		return this.finalResultPromise;
	}
}

/** Event stream for assistant message events */
export class AssistantMessageEventStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") {
					return event.message;
				} else if (event.type === "error") {
					return event.error;
				}
				throw new Error("Unexpected event type for final result");
			},
		);
	}
}

/** Factory function for AssistantMessageEventStream (for use in extensions) */
export function createAssistantMessageEventStream(): AssistantMessageEventStream {
	return new AssistantMessageEventStream();
}

// ============================================================================
// OAuth Types
// ============================================================================

export interface OAuthCredentials {
	refresh: string;
	access: string;
	expires: number;
	[key: string]: unknown;
}

export interface OAuthAuthInfo {
	url: string;
	instructions?: string;
}

export interface OAuthPrompt {
	message: string;
	placeholder?: string;
	allowEmpty?: boolean;
}

export interface OAuthLoginCallbacks {
	onAuth: (info: OAuthAuthInfo) => void;
	onPrompt: (prompt: OAuthPrompt) => Promise<string>;
	onProgress?: (message: string) => void;
	onManualCodeInput?: () => Promise<string>;
	signal?: AbortSignal;
}

// ============================================================================
// TypeBox Helpers
// ============================================================================

import { type TUnsafe, Type } from "@sinclair/typebox";

/**
 * Creates a string enum schema compatible with Google's API and other providers
 * that don't support anyOf/const patterns.
 *
 * @example
 * const OperationSchema = StringEnum(["add", "subtract", "multiply", "divide"], {
 *   description: "The operation to perform"
 * });
 *
 * type Operation = Static<typeof OperationSchema>; // "add" | "subtract" | "multiply" | "divide"
 */
export function StringEnum<T extends readonly string[]>(
	values: T,
	options?: { description?: string; default?: T[number] },
): TUnsafe<T[number]> {
	return Type.Unsafe<T[number]>({
		type: "string",
		enum: values as unknown as string[],
		...(options?.description && { description: options.description }),
		...(options?.default && { default: options.default }),
	});
}
