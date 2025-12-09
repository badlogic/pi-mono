import type { AgentEvent, AgentTool, Message, Model, QueuedMessage } from "@mariozechner/pi-ai";

// The minimal configuration needed to run a turn.
export interface AgentRunConfig {
	systemPrompt: string;
	tools: AgentTool<any>[];
	model: Model<any>;
	reasoning?: "low" | "medium" | "high";
	getQueuedMessages?: <T>() => Promise<QueuedMessage<T>[]>;
}

// Events yielded by transports must match the @mariozechner/pi-ai prompt() events.
// We re-export the Message type above; consumers should use the upstream AgentEvent type.

export interface AgentTransport {
	/** Run with a new user message */
	run(
		messages: Message[],
		userMessage: Message,
		config: AgentRunConfig,
		signal?: AbortSignal,
	): AsyncIterable<AgentEvent>;

	/** Continue from current context (no new user message) */
	continue(messages: Message[], config: AgentRunConfig, signal?: AbortSignal): AsyncIterable<AgentEvent>;
}
