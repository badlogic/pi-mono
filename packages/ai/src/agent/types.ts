import type { Static, TSchema } from "@sinclair/typebox";
import type {
	AssistantMessage,
	AssistantMessageEvent,
	ImageContent,
	Message,
	Model,
	SimpleStreamOptions,
	TextContent,
	Tool,
	ToolResultMessage,
} from "../types.js";

export interface AgentToolResult<T> {
	// Content blocks supporting text and images
	content: (TextContent | ImageContent)[];
	// Details to be displayed in a UI or logged
	details: T;
}

// Callback for streaming tool execution updates
export type AgentToolUpdateCallback<T = any> = (partialResult: AgentToolResult<T>) => void;

// AgentTool extends Tool but adds the execute function
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
	// A human-readable label for the tool to be displayed in UI
	label: string;
	execute: (
		toolCallId: string,
		params: Static<TParameters>,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TDetails>,
	) => Promise<AgentToolResult<TDetails>>;
}

// AgentContext is like Context but uses AgentTool
export interface AgentContext {
	systemPrompt: string;
	messages: Message[];
	tools?: AgentTool<any>[];
}

// Event types
export type AgentEvent =
	// Emitted when the agent starts. An agent can emit multiple turns
	| { type: "agent_start" }
	// Emitted when a turn starts. A turn can emit an optional user message (initial prompt), an assistant message (response) and multiple tool result messages
	| { type: "turn_start" }
	// Emitted when a user, assistant or tool result message starts
	| { type: "message_start"; message: Message }
	// Emitted when an asssitant messages is updated due to streaming
	| { type: "message_update"; assistantMessageEvent: AssistantMessageEvent; message: AssistantMessage }
	// Emitted when a user, assistant or tool result message is complete
	| { type: "message_end"; message: Message }
	// Emitted when a tool execution starts
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
	// Emitted when a tool execution produces output (streaming)
	| {
			type: "tool_execution_update";
			toolCallId: string;
			toolName: string;
			args: any;
			partialResult: AgentToolResult<any>;
	  }
	// Emitted when a tool execution completes
	| {
			type: "tool_execution_end";
			toolCallId: string;
			toolName: string;
			result: AgentToolResult<any>;
			isError: boolean;
	  }
	// Emitted when a full turn completes
	| { type: "turn_end"; message: AssistantMessage; toolResults: ToolResultMessage[] }
	// Emitted when the agent has completed all its turns. All messages from every turn are
	// contained in messages, which can be appended to the context
	| { type: "agent_end"; messages: AgentContext["messages"] };

// Queued message with optional LLM representation
export interface QueuedMessage<TApp = Message> {
	original: TApp; // Original message for UI events
	llm?: Message; // Optional transformed message for loop context (undefined if filtered)
}

// Configuration for agent loop execution
export interface AgentLoopConfig extends SimpleStreamOptions {
	model: Model<any>;

	/**
	 * Optional hook to resolve an API key dynamically for each LLM call.
	 *
	 * This is useful for short-lived OAuth tokens (e.g. GitHub Copilot) that may
	 * expire during long-running tool execution phases.
	 *
	 * The agent loop will call this before each assistant response and pass the
	 * returned value as `apiKey` to `streamSimple()` (or a custom `streamFn`).
	 *
	 * If it returns `undefined`, the loop falls back to `config.apiKey`, and then
	 * to `streamSimple()`'s own provider key lookup (setApiKey/env vars).
	 */
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;

	preprocessor?: (messages: AgentContext["messages"], abortSignal?: AbortSignal) => Promise<AgentContext["messages"]>;
	getQueuedMessages?: <T>() => Promise<QueuedMessage<T>[]>;
}
