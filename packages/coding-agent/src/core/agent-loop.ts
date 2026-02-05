/**
 * Agent loop that uses Vercel AI SDK's streamText for LLM calls.
 *
 * This module implements the agent loop pattern with:
 * - Multi-step tool calling via streamText with stepCountIs
 * - Streaming events for UI updates
 * - Support for steering and follow-up message queues
 * - Transform context hooks for extensions
 */

import { jsonSchema, type ModelMessage, tool as sdkTool, stepCountIs, streamText, type ToolSet } from "ai";
import type { z } from "zod";
import {
	type AgentEvent,
	type AgentMessage,
	type AgentTool,
	type AgentToolResult,
	type AssistantMessage,
	type AssistantMessageEvent,
	calculateCost,
	createEmptyUsage,
	EventStream,
	type Message,
	type Model,
	type SimpleStreamOptions,
	type TextContent,
	type ThinkingContent,
	type ThinkingLevel,
	type ToolCall,
	type ToolResultMessage,
} from "./ai-types.js";
import { createLanguageModel } from "./model-providers.js";

// ============================================================================
// Types
// ============================================================================

/** Agent context for a conversation */
export interface AgentContext {
	systemPrompt: string;
	messages: AgentMessage[];
	tools: AgentTool[];
}

/** Configuration for the agent loop */
export interface AgentLoopConfig {
	model: Model;
	reasoning?: ThinkingLevel;
	sessionId?: string;
	thinkingBudgets?: SimpleStreamOptions["thinkingBudgets"];
	maxRetryDelayMs?: number;
	apiKey?: string;

	/** Converts AgentMessage[] to Message[] for LLM */
	convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

	/** Optional transform applied to context before convertToLlm */
	transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

	/** Dynamic API key resolution */
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;

	/** Get steering messages to inject mid-conversation */
	getSteeringMessages?: () => Promise<AgentMessage[]>;

	/** Get follow-up messages after agent would stop */
	getFollowUpMessages?: () => Promise<AgentMessage[]>;
}

// ============================================================================
// Agent Loop
// ============================================================================

/**
 * Start an agent loop with new prompt messages.
 */
export function agentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
): EventStream<AgentEvent, AgentMessage[]> {
	const stream = createAgentStream();

	(async () => {
		const newMessages: AgentMessage[] = [...prompts];
		const currentContext: AgentContext = {
			...context,
			messages: [...context.messages, ...prompts],
		};

		stream.push({ type: "agent_start" });
		stream.push({ type: "turn_start" });

		for (const prompt of prompts) {
			stream.push({ type: "message_start", message: prompt });
			stream.push({ type: "message_end", message: prompt });
		}

		await runLoop(currentContext, newMessages, config, signal, stream);
	})();

	return stream;
}

/**
 * Continue an agent loop from existing context.
 */
export function agentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
): EventStream<AgentEvent, AgentMessage[]> {
	if (context.messages.length === 0) {
		throw new Error("Cannot continue: no messages in context");
	}

	if (context.messages[context.messages.length - 1].role === "assistant") {
		throw new Error("Cannot continue from message role: assistant");
	}

	const stream = createAgentStream();

	(async () => {
		const newMessages: AgentMessage[] = [];
		const currentContext: AgentContext = { ...context };

		stream.push({ type: "agent_start" });
		stream.push({ type: "turn_start" });

		await runLoop(currentContext, newMessages, config, signal, stream);
	})();

	return stream;
}

function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
	return new EventStream<AgentEvent, AgentMessage[]>(
		(event: AgentEvent) => event.type === "agent_end",
		(event: AgentEvent) => (event.type === "agent_end" ? event.messages : []),
	);
}

// ============================================================================
// Main Loop
// ============================================================================

async function runLoop(
	currentContext: AgentContext,
	newMessages: AgentMessage[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
): Promise<void> {
	let firstTurn = true;
	let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

	// Outer loop: continues when queued follow-up messages arrive
	while (true) {
		let hasMoreToolCalls = true;
		let steeringAfterTools: AgentMessage[] | null = null;

		// Inner loop: process tool calls and steering messages
		while (hasMoreToolCalls || pendingMessages.length > 0) {
			if (!firstTurn) {
				stream.push({ type: "turn_start" });
			} else {
				firstTurn = false;
			}

			// Process pending messages
			if (pendingMessages.length > 0) {
				for (const message of pendingMessages) {
					stream.push({ type: "message_start", message });
					stream.push({ type: "message_end", message });
					currentContext.messages.push(message);
					newMessages.push(message);
				}
				pendingMessages = [];
			}

			// Stream assistant response with tool execution
			const { assistantMessage, toolResults, steeringMessages } = await streamAssistantWithTools(
				currentContext,
				config,
				signal,
				stream,
			);

			newMessages.push(assistantMessage);

			if (assistantMessage.stopReason === "error" || assistantMessage.stopReason === "aborted") {
				stream.push({ type: "turn_end", message: assistantMessage, toolResults: [] });
				stream.push({ type: "agent_end", messages: newMessages });
				stream.end(newMessages);
				return;
			}

			// Add tool results to context
			for (const result of toolResults) {
				newMessages.push(result);
			}

			// Check if there are more tool calls
			hasMoreToolCalls = toolResults.length > 0;
			steeringAfterTools = steeringMessages ?? null;

			stream.push({ type: "turn_end", message: assistantMessage, toolResults });

			// Get steering messages after turn completes
			if (steeringAfterTools && steeringAfterTools.length > 0) {
				pendingMessages = steeringAfterTools;
				steeringAfterTools = null;
			} else {
				pendingMessages = (await config.getSteeringMessages?.()) || [];
			}
		}

		// Check for follow-up messages
		const followUpMessages = (await config.getFollowUpMessages?.()) || [];
		if (followUpMessages.length > 0) {
			pendingMessages = followUpMessages;
			continue;
		}

		break;
	}

	stream.push({ type: "agent_end", messages: newMessages });
	stream.end(newMessages);
}

// ============================================================================
// Stream Assistant with Tool Execution
// ============================================================================

interface StreamResult {
	assistantMessage: AssistantMessage;
	toolResults: ToolResultMessage[];
	steeringMessages?: AgentMessage[];
}

async function streamAssistantWithTools(
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
): Promise<StreamResult> {
	// Apply context transform if configured
	let messages = context.messages;
	if (config.transformContext) {
		messages = await config.transformContext(messages, signal);
	}

	// Convert to LLM-compatible messages
	const llmMessages = await config.convertToLlm(messages);

	// Resolve API key
	const apiKey = (config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;
	if (!apiKey) {
		throw new Error(`No API key available for provider: ${config.model.provider}`);
	}

	// Create language model instance
	const languageModel = createLanguageModel(config.model, apiKey);

	// Convert AgentTools to Vercel AI SDK tools
	const sdkTools: ToolSet = {};
	const toolResultsMap = new Map<string, ToolResultMessage>();
	let steeringMessages: AgentMessage[] | undefined;

	for (const agentTool of context.tools) {
		// Convert TypeBox/Zod schema to Vercel SDK format
		const inputSchema = convertToSdkSchema(agentTool.parameters);

		sdkTools[agentTool.name] = sdkTool({
			description: agentTool.description,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			inputSchema: inputSchema as any,
			execute: async (
				params: unknown,
				{ abortSignal, toolCallId }: { abortSignal?: AbortSignal; toolCallId: string },
			) => {
				stream.push({
					type: "tool_execution_start",
					toolCallId,
					toolName: agentTool.name,
					args: params,
				});

				let result: AgentToolResult;
				let isError = false;

				try {
					result = await agentTool.execute(toolCallId, params, abortSignal, (partialResult) => {
						stream.push({
							type: "tool_execution_update",
							toolCallId,
							toolName: agentTool.name,
							args: params,
							partialResult,
						});
					});
				} catch (e) {
					result = {
						content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
						details: {},
					};
					isError = true;
				}

				stream.push({
					type: "tool_execution_end",
					toolCallId,
					toolName: agentTool.name,
					result,
					isError,
				});

				const toolResultMessage: ToolResultMessage = {
					role: "toolResult",
					toolCallId,
					toolName: agentTool.name,
					content: result.content,
					details: result.details,
					isError,
					timestamp: Date.now(),
				};

				toolResultsMap.set(toolCallId, toolResultMessage);

				stream.push({ type: "message_start", message: toolResultMessage });
				stream.push({ type: "message_end", message: toolResultMessage });

				// Check for steering messages after tool execution
				if (config.getSteeringMessages) {
					const steering = await config.getSteeringMessages();
					if (steering.length > 0) {
						steeringMessages = steering;
					}
				}

				// Return text content for Vercel SDK
				return result.content
					.filter((c): c is TextContent => c.type === "text")
					.map((c) => c.text)
					.join("\n");
			},
		});
	}

	// Build partial assistant message for streaming updates
	const partialMessage: AssistantMessage = {
		role: "assistant",
		content: [],
		api: config.model.api,
		provider: config.model.provider,
		model: config.model.id,
		usage: createEmptyUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};

	// Track content indices
	const textIndex = -1;
	const thinkingIndex = -1;
	const toolCallIndices = new Map<string, number>();

	// Emit start event
	stream.push({ type: "message_start", message: { ...partialMessage } });

	try {
		const result = streamText({
			model: languageModel,
			system: context.systemPrompt,
			messages: convertMessagesToVercelFormat(llmMessages),
			tools: Object.keys(sdkTools).length > 0 ? sdkTools : undefined,
			stopWhen: stepCountIs(10), // Allow up to 10 tool call steps
			abortSignal: signal,
			onChunk: ({ chunk }) => {
				handleStreamChunk(chunk, partialMessage, stream, { textIndex, thinkingIndex, toolCallIndices });
			},
			onStepFinish: ({ usage }) => {
				// Update usage from step
				if (usage) {
					partialMessage.usage.input += usage.inputTokens || 0;
					partialMessage.usage.output += usage.outputTokens || 0;
					partialMessage.usage.totalTokens += (usage.inputTokens || 0) + (usage.outputTokens || 0);
				}
			},
		});

		// Wait for completion
		const finalResult = await result;
		const finishReason = await finalResult.finishReason;

		// Update final message
		partialMessage.stopReason = finishReason === "tool-calls" ? "toolUse" : "stop";

		// Calculate cost
		calculateCost(config.model, partialMessage.usage);

		// Update context with final message
		context.messages.push(partialMessage);

		// Emit end event
		stream.push({ type: "message_end", message: partialMessage });

		return {
			assistantMessage: partialMessage,
			toolResults: Array.from(toolResultsMap.values()),
			steeringMessages,
		};
	} catch (error) {
		// Handle errors
		partialMessage.stopReason = signal?.aborted ? "aborted" : "error";
		partialMessage.errorMessage = error instanceof Error ? error.message : String(error);

		context.messages.push(partialMessage);
		stream.push({ type: "message_end", message: partialMessage });

		return {
			assistantMessage: partialMessage,
			toolResults: Array.from(toolResultsMap.values()),
			steeringMessages,
		};
	}
}

// ============================================================================
// Stream Chunk Handling
// ============================================================================

interface ContentIndices {
	textIndex: number;
	thinkingIndex: number;
	toolCallIndices: Map<string, number>;
}

function handleStreamChunk(
	chunk: { type: string; [key: string]: unknown },
	partialMessage: AssistantMessage,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	indices: ContentIndices,
): void {
	switch (chunk.type) {
		case "text": {
			const text = chunk.text as string;
			if (indices.textIndex < 0) {
				// Start new text content
				indices.textIndex = partialMessage.content.length;
				partialMessage.content.push({ type: "text", text: "" });

				const event: AssistantMessageEvent = {
					type: "text_start",
					contentIndex: indices.textIndex,
					partial: { ...partialMessage },
				};
				stream.push({ type: "message_update", message: { ...partialMessage }, assistantMessageEvent: event });
			}

			// Update text content
			const textContent = partialMessage.content[indices.textIndex] as TextContent;
			textContent.text += text;

			const deltaEvent: AssistantMessageEvent = {
				type: "text_delta",
				contentIndex: indices.textIndex,
				delta: text,
				partial: { ...partialMessage },
			};
			stream.push({ type: "message_update", message: { ...partialMessage }, assistantMessageEvent: deltaEvent });
			break;
		}

		case "reasoning": {
			const thinking = chunk.text as string;
			if (indices.thinkingIndex < 0) {
				// Start new thinking content
				indices.thinkingIndex = partialMessage.content.length;
				partialMessage.content.push({ type: "thinking", thinking: "" });

				const event: AssistantMessageEvent = {
					type: "thinking_start",
					contentIndex: indices.thinkingIndex,
					partial: { ...partialMessage },
				};
				stream.push({ type: "message_update", message: { ...partialMessage }, assistantMessageEvent: event });
			}

			// Update thinking content
			const thinkingContent = partialMessage.content[indices.thinkingIndex] as ThinkingContent;
			thinkingContent.thinking += thinking;

			const deltaEvent: AssistantMessageEvent = {
				type: "thinking_delta",
				contentIndex: indices.thinkingIndex,
				delta: thinking,
				partial: { ...partialMessage },
			};
			stream.push({ type: "message_update", message: { ...partialMessage }, assistantMessageEvent: deltaEvent });
			break;
		}

		case "tool-call": {
			const toolCallId = chunk.toolCallId as string;
			const toolName = chunk.toolName as string;
			const input = chunk.input as Record<string, unknown>;

			let contentIndex = indices.toolCallIndices.get(toolCallId);
			if (contentIndex === undefined) {
				// Start new tool call content
				contentIndex = partialMessage.content.length;
				indices.toolCallIndices.set(toolCallId, contentIndex);

				const toolCall: ToolCall = {
					type: "toolCall",
					id: toolCallId,
					name: toolName,
					arguments: input,
				};
				partialMessage.content.push(toolCall);

				const event: AssistantMessageEvent = {
					type: "toolcall_start",
					contentIndex,
					partial: { ...partialMessage },
				};
				stream.push({ type: "message_update", message: { ...partialMessage }, assistantMessageEvent: event });
			}

			// Tool call complete
			const endEvent: AssistantMessageEvent = {
				type: "toolcall_end",
				contentIndex,
				toolCall: partialMessage.content[contentIndex] as ToolCall,
				partial: { ...partialMessage },
			};
			stream.push({ type: "message_update", message: { ...partialMessage }, assistantMessageEvent: endEvent });
			break;
		}
	}
}

// ============================================================================
// Schema Conversion
// ============================================================================

/**
 * Check if a schema is a TypeBox schema.
 * TypeBox schemas have a "type" property that is a string (like "object", "string", etc.)
 * and a "properties" property for object schemas.
 */
function isTypeBoxSchema(schema: unknown): boolean {
	if (schema === null || typeof schema !== "object") return false;
	const s = schema as Record<string, unknown>;
	// TypeBox object schemas have type="object" and properties
	return s.type === "object" && typeof s.properties === "object";
}

/**
 * Convert a TypeBox or Zod schema to Vercel AI SDK schema format.
 * TypeBox schemas are converted via jsonSchema(), Zod schemas are passed through.
 */
function convertToSdkSchema(schema: unknown) {
	// If it's a Zod schema (has ~standard property from Zod v4), pass through
	if (schema !== null && typeof schema === "object" && "~standard" in schema) {
		return schema as z.ZodType;
	}

	// If it's a TypeBox schema, convert to JSON schema
	if (isTypeBoxSchema(schema)) {
		// TypeBox schemas are already JSON Schema compatible
		// Remove TypeBox-specific properties that aren't valid JSON Schema
		const jsonSchemaObj = { ...(schema as Record<string, unknown>) };
		delete jsonSchemaObj.static;
		delete jsonSchemaObj[Symbol.for("TypeBox.Kind") as unknown as string];
		return jsonSchema(jsonSchemaObj);
	}

	// Fallback: assume it's already a valid SDK schema
	return schema;
}

// ============================================================================
// Message Conversion
// ============================================================================

/**
 * Convert our Message[] format to Vercel AI SDK's format.
 */
function convertMessagesToVercelFormat(messages: Message[]): ModelMessage[] {
	const result: ModelMessage[] = [];

	for (const msg of messages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				result.push({ role: "user", content: msg.content });
			} else {
				// Convert content array to Vercel format
				const parts = msg.content.map((c) => {
					if (c.type === "text") {
						return { type: "text" as const, text: c.text };
					} else if (c.type === "image") {
						return {
							type: "image" as const,
							image: c.data,
							mimeType: c.mimeType,
						};
					}
					return { type: "text" as const, text: "" };
				});
				result.push({ role: "user", content: parts });
			}
		} else if (msg.role === "assistant") {
			// Extract text content
			const textParts = msg.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("");

			// Extract tool calls
			const toolCalls = msg.content
				.filter((c): c is ToolCall => c.type === "toolCall")
				.map((tc) => ({
					type: "tool-call" as const,
					toolCallId: tc.id,
					toolName: tc.name,
					input: tc.arguments,
				}));

			if (toolCalls.length > 0) {
				const content: Array<
					| { type: "text"; text: string }
					| { type: "tool-call"; toolCallId: string; toolName: string; input: Record<string, unknown> }
				> = [];
				if (textParts) {
					content.push({ type: "text" as const, text: textParts });
				}
				content.push(...toolCalls);
				result.push({ role: "assistant", content });
			} else {
				result.push({ role: "assistant", content: textParts });
			}
		} else if (msg.role === "toolResult") {
			// Convert tool result to Vercel format
			const textContent = msg.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("\n");

			result.push({
				role: "tool",
				content: [
					{
						type: "tool-result" as const,
						toolCallId: msg.toolCallId,
						toolName: msg.toolName,
						output: { type: "text" as const, value: textContent },
					},
				],
			});
		}
	}

	return result;
}
