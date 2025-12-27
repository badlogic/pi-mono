import type { AgentEvent, AgentTool, Message, Model, QueuedMessage, ReasoningEffort } from "@mariozechner/pi-ai";

/**
 * The minimal configuration needed to run an agent turn.
 */
export interface AgentRunConfig {
	systemPrompt: string;
	tools: AgentTool<any>[];
	model: Model<any>;
	reasoning?: ReasoningEffort;
	getQueuedMessages?: <T>() => Promise<QueuedMessage<T>[]>;
}

/**
 * Transport interface for executing agent turns.
 * Transports handle the communication with LLM providers,
 * abstracting away the details of API calls, proxies, etc.
 *
 * Events yielded must match the @mariozechner/pi-ai AgentEvent types.
 */
export interface AgentTransport {
	/** Run with a new user message */
	run(
		messages: Message[],
		userMessage: Message,
		config: AgentRunConfig,
		signal?: AbortSignal,
	): AsyncIterable<AgentEvent>;

	/** Continue from current context (no new user message) */
	continue(
		messages: Message[],
		config: AgentRunConfig,
		signal?: AbortSignal,
		emitLastMessage?: boolean,
	): AsyncIterable<AgentEvent>;
}
