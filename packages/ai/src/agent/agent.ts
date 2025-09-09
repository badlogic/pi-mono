import { EventStream } from "../event-stream";
import { streamSimple } from "../generate.js";
import type {
	AssistantMessage,
	Context,
	Message,
	Model,
	SimpleGenerateOptions,
	ToolResultMessage,
	UserMessage,
} from "../types.js";
import type { AgentContext, AgentTool, AgentToolResult } from "./types";

// Event types
export type AgentEvent =
	| { type: "message_start"; message: Message }
	| { type: "message_update"; message: AssistantMessage }
	| { type: "message_complete"; message: Message }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
	| {
			type: "tool_execution_complete";
			toolCallId: string;
			toolName: string;
			result: AgentToolResult<any> | string;
			isError: boolean;
	  }
	| { type: "turn_complete"; messages: AgentContext["messages"] };

// Configuration for prompt execution
export interface PromptConfig {
	model: Model<any>;
	apiKey: string;
	enableThinking?: boolean;
	preprocessor?: (messages: AgentContext["messages"], abortSignal?: AbortSignal) => Promise<AgentContext["messages"]>;
}

// Main prompt function - returns a stream of events
export function prompt(
	context: AgentContext,
	config: PromptConfig,
	prompt: UserMessage,
	signal?: AbortSignal,
): EventStream<AgentEvent, AgentContext["messages"]> {
	const stream = new EventStream<AgentEvent, AgentContext["messages"]>(
		(event) => event.type === "turn_complete",
		(event) => (event.type === "turn_complete" ? event.messages : []),
	);

	// Run the prompt async
	(async () => {
		try {
			// Track new messages generated during this prompt
			const newMessages: AgentContext["messages"] = [];

			// Create user message
			const messages = [...context.messages, prompt];
			newMessages.push(prompt);

			stream.push({ type: "message_start", message: prompt });
			stream.push({ type: "message_complete", message: prompt });

			// Update context with new messages
			const currentContext: AgentContext = {
				...context,
				messages,
			};

			// Keep looping while we have tool calls
			let hasMoreToolCalls = true;
			while (hasMoreToolCalls) {
				// Stream assistant response
				const assistantMessage = await streamAssistantResponse(currentContext, config, signal, stream);
				newMessages.push(assistantMessage);

				// Check for tool calls
				const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
				hasMoreToolCalls = toolCalls.length > 0;

				if (hasMoreToolCalls) {
					// Execute tool calls
					const toolResults = await executeToolCalls(currentContext.tools, assistantMessage, signal, stream);
					newMessages.push(...toolResults);

					// Add tool results to context
					currentContext.messages = [...currentContext.messages, ...toolResults];
				}
			}

			stream.push({ type: "turn_complete", messages: newMessages });
		} catch (error) {
			// End stream on error
			stream.end([]);
			throw error;
		}
	})();

	return stream;
}

// Helper functions
async function streamAssistantResponse(
	context: AgentContext,
	config: PromptConfig,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentContext["messages"]>,
): Promise<AssistantMessage> {
	// Convert AgentContext to Context for streamSimple
	// Use a copy of messages to avoid mutating the original context
	const processedMessages = config.preprocessor
		? await config.preprocessor(context.messages, signal)
		: [...context.messages];
	const processedContext: Context = {
		systemPrompt: context.systemPrompt,
		messages: [...processedMessages].map((m) => {
			if (m.role === "toolResult") {
				const { details, ...rest } = m;
				return rest;
			} else {
				return m;
			}
		}),
		tools: context.tools, // AgentTool extends Tool, so this works
	};

	const options: SimpleGenerateOptions = {
		apiKey: config.apiKey,
		signal,
	};

	if (config.model.reasoning && config.enableThinking) {
		options.reasoning = "medium";
	}

	const response = await streamSimple(config.model, processedContext, options);

	let partialMessage: AssistantMessage | null = null;
	let addedPartial = false;

	for await (const event of response) {
		switch (event.type) {
			case "start":
				partialMessage = event.partial;
				context.messages.push(partialMessage);
				addedPartial = true;
				stream.push({ type: "message_start", message: { ...partialMessage } });
				break;

			case "text_start":
			case "text_delta":
			case "thinking_start":
			case "thinking_delta":
			case "toolcall_start":
			case "toolcall_delta":
				if (partialMessage) {
					partialMessage = event.partial;
					context.messages[context.messages.length - 1] = partialMessage;
					stream.push({ type: "message_update", message: { ...partialMessage } });
				}
				break;

			case "done":
			case "error": {
				const finalMessage = await response.result();
				if (addedPartial) {
					context.messages[context.messages.length - 1] = finalMessage;
				} else {
					context.messages.push(finalMessage);
				}
				stream.push({ type: "message_complete", message: finalMessage });
				return finalMessage;
			}
		}
	}

	return await response.result();
}

async function executeToolCalls<T>(
	tools: AgentTool<T>[] | undefined,
	assistantMessage: AssistantMessage,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, Message[]>,
): Promise<ToolResultMessage<T>[]> {
	const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
	const results: ToolResultMessage<any>[] = [];

	for (const toolCall of toolCalls) {
		const tool = tools?.find((t) => t.name === toolCall.name);

		stream.push({
			type: "tool_execution_start",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.arguments,
		});

		let resultOrError: AgentToolResult<T> | string;
		let isError = false;

		try {
			if (!tool) throw new Error(`Tool ${toolCall.name} not found`);
			resultOrError = await tool.execute(toolCall.arguments, toolCall.id, signal);
		} catch (e) {
			resultOrError = `Error: ${e instanceof Error ? e.message : String(e)}`;
			isError = true;
		}

		stream.push({
			type: "tool_execution_complete",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			result: resultOrError,
			isError,
		});

		const toolResultMessage: ToolResultMessage<T> = {
			role: "toolResult",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			output: typeof resultOrError === "string" ? resultOrError : resultOrError.output,
			details: typeof resultOrError === "string" ? ({} as T) : resultOrError.details,
			isError,
		};

		results.push(toolResultMessage);
		stream.push({ type: "message_start", message: toolResultMessage });
		stream.push({ type: "message_complete", message: toolResultMessage });
	}

	return results;
}
