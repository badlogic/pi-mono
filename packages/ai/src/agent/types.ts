import type { ZodSchema, z } from "zod";
import type {
	AssistantMessage,
	AssistantMessageEvent,
	Message,
	Model,
	SimpleStreamOptions,
	Tool,
	ToolResultMessage,
} from "../types.js";

export interface AgentToolResult<T> {
	// Output of the tool to be given to the LLM in ToolResultMessage.content
	output: string;
	// Details to be displayed in a UI or loggedty
	details: T;
}

// AgentTool extends Tool but adds the execute function
export interface AgentTool<TParameters extends ZodSchema = ZodSchema, TDetails = any> extends Tool<TParameters> {
	// A human-readable label for the tool to be displayed in UI
	label: string;
	execute: (
		toolCallId: string,
		params: z.infer<TParameters>,
		signal?: AbortSignal,
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
	// Emitted when a tool execution completes
	| {
			type: "tool_execution_end";
			toolCallId: string;
			toolName: string;
			result: AgentToolResult<any> | string;
			isError: boolean;
	  }
	// Emitted when a full turn completes
	| { type: "turn_end"; assistantMessage: AssistantMessage; toolResults: ToolResultMessage[] }
	// Emitted when the agent has completed all its turns. All messages from every turn are
	// contained in messages, which can be appended to the context
	| { type: "agent_end"; messages: AgentContext["messages"] };

// Configuration for prompt execution
export interface PromptConfig extends SimpleStreamOptions {
	model: Model<any>;
	preprocessor?: (messages: AgentContext["messages"], abortSignal?: AbortSignal) => Promise<AgentContext["messages"]>;
}
