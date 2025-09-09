import type { Message, Tool } from "../types.js";

export interface AgentToolResult<T> {
	// Output of the tool to be given to the LLM in ToolResultMessage.content
	output: string;
	// Details to be displayed in a UI or loggedty
	details: T;
}

// AgentTool extends Tool but adds the execute function
export interface AgentTool<TDetails> extends Tool {
	// A human-readable label for the tool to be displayed in UI
	label: string;
	execute: (params: any, toolCallId: string, signal?: AbortSignal) => Promise<AgentToolResult<TDetails>>;
}

// AgentContext is like Context but uses AgentTool
export interface AgentContext {
	systemPrompt: string;
	messages: Message[];
	tools?: AgentTool<any>[];
}
