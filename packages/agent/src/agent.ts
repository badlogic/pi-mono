import OpenAI from "openai";
import type { ResponseFunctionToolCallOutputItem } from "openai/resources/responses/responses.mjs";
import type { SessionManager } from "./session-manager.js";
import { executeTool, toolsForChat, toolsForResponses } from "./tools/tools.js";

export type AgentEvent =
	| { type: "session_start"; sessionId: string; model: string; api: string; baseURL: string; systemPrompt: string }
	| { type: "assistant_start" }
	| { type: "reasoning"; text: string }
	| { type: "tool_call"; toolCallId: string; name: string; args: string }
	| { type: "tool_result"; toolCallId: string; result: string; isError: boolean }
	| { type: "assistant_message"; text: string }
	| { type: "error"; message: string }
	| { type: "user_message"; text: string }
	| { type: "interrupted" }
	| {
			type: "token_usage";
			inputTokens: number;
			outputTokens: number;
			totalTokens: number;
			cacheReadTokens: number;
			cacheWriteTokens: number;
			reasoningTokens: number;
	  };

export interface AgentEventReceiver {
	on(event: AgentEvent): Promise<void>;
}

export interface AgentConfig {
	apiKey: string;
	baseURL: string;
	model: string;
	api: "completions" | "responses";
	systemPrompt: string;
}

export interface ToolCall {
	name: string;
	arguments: string;
	id: string;
}

// Cache for model reasoning support detection per API type
const modelReasoningSupport = new Map<string, { completions?: boolean; responses?: boolean }>();

async function checkReasoningSupport(
	client: OpenAI,
	model: string,
	api: "completions" | "responses",
): Promise<boolean> {
	// Check cache first
	const cacheKey = model;
	const cached = modelReasoningSupport.get(cacheKey);
	if (cached && cached[api] !== undefined) {
		return cached[api]!;
	}

	let supportsReasoning = false;

	if (api === "responses") {
		// Try a minimal request with reasoning parameter for Responses API
		try {
			await client.responses.create({
				model,
				input: "test",
				max_output_tokens: 1024,
				reasoning: {
					effort: "low", // Use low instead of minimal to ensure we get summaries
				},
			});
			supportsReasoning = true;
		} catch (error) {
			supportsReasoning = false;
		}
	} else {
		// For Chat Completions API, try with reasoning_effort parameter
		try {
			await client.chat.completions.create({
				model,
				messages: [{ role: "user", content: "test" }],
				max_completion_tokens: 1,
				reasoning_effort: "minimal",
			});
			supportsReasoning = true;
		} catch (error) {
			supportsReasoning = false;
		}
	}

	// Update cache
	const existing = modelReasoningSupport.get(cacheKey) || {};
	existing[api] = supportsReasoning;
	modelReasoningSupport.set(cacheKey, existing);

	return supportsReasoning;
}

export async function callModelResponsesApi(
	client: OpenAI,
	model: string,
	messages: any[],
	signal?: AbortSignal,
	eventReceiver?: AgentEventReceiver,
	supportsReasoning?: boolean,
): Promise<void> {
	await eventReceiver?.on({ type: "assistant_start" });

	// Use provided reasoning support or detect it
	if (supportsReasoning === undefined) {
		supportsReasoning = await checkReasoningSupport(client, model, "responses");
	}

	let conversationDone = false;

	while (!conversationDone) {
		// Check if we've been interrupted
		if (signal?.aborted) {
			await eventReceiver?.on({ type: "interrupted" });
			throw new Error("Interrupted");
		}

		const response = await client.responses.create(
			{
				model,
				input: messages,
				tools: toolsForResponses as any,
				tool_choice: "auto",
				parallel_tool_calls: true,
				max_output_tokens: 2000, // TODO make configurable
				...(supportsReasoning && {
					reasoning: {
						effort: "medium", // Use auto reasoning effort
						summary: "auto", // Request reasoning summaries
					},
				}),
			},
			{ signal },
		);

		// Report token usage if available (responses API format)
		if (response.usage) {
			const usage = response.usage;
			eventReceiver?.on({
				type: "token_usage",
				inputTokens: usage.input_tokens || 0,
				outputTokens: usage.output_tokens || 0,
				totalTokens: usage.total_tokens || 0,
				cacheReadTokens: usage.input_tokens_details?.cached_tokens || 0,
				cacheWriteTokens: 0, // Not available in API
				reasoningTokens: usage.output_tokens_details?.reasoning_tokens || 0,
			});
		}

		const output = response.output;
		if (!output) break;

		for (const item of output) {
			// gpt-oss vLLM quirk: need to remove type from "message" events
			if (item.id === "message") {
				const { type, ...message } = item;
				messages.push(item);
			} else {
				messages.push(item);
			}

			switch (item.type) {
				case "reasoning": {
					// Handle both content (o1/o3) and summary (gpt-5) formats
					const reasoningItems = item.content || item.summary || [];
					for (const content of reasoningItems) {
						if (content.type === "reasoning_text" || content.type === "summary_text") {
							await eventReceiver?.on({ type: "reasoning", text: content.text });
						}
					}
					break;
				}

				case "message": {
					for (const content of item.content || []) {
						if (content.type === "output_text") {
							await eventReceiver?.on({ type: "assistant_message", text: content.text });
						} else if (content.type === "refusal") {
							await eventReceiver?.on({ type: "error", message: `Refusal: ${content.refusal}` });
						}
						conversationDone = true;
					}
					break;
				}

				case "function_call": {
					if (signal?.aborted) {
						await eventReceiver?.on({ type: "interrupted" });
						throw new Error("Interrupted");
					}

					try {
						await eventReceiver?.on({
							type: "tool_call",
							toolCallId: item.call_id || "",
							name: item.name,
							args: item.arguments,
						});
						const result = await executeTool(item.name, item.arguments, signal);
						await eventReceiver?.on({
							type: "tool_result",
							toolCallId: item.call_id || "",
							result,
							isError: false,
						});

						// Add tool result to messages
						const toolResultMsg = {
							type: "function_call_output",
							call_id: item.call_id,
							output: result,
						} as ResponseFunctionToolCallOutputItem;
						messages.push(toolResultMsg);
					} catch (e: any) {
						await eventReceiver?.on({
							type: "tool_result",
							toolCallId: item.call_id || "",
							result: e.message,
							isError: true,
						});
						const errorMsg = {
							type: "function_call_output",
							call_id: item.id,
							output: e.message,
							isError: true,
						};
						messages.push(errorMsg);
					}
					break;
				}

				default: {
					eventReceiver?.on({ type: "error", message: `Unknown output type in LLM response: ${item.type}` });
					break;
				}
			}
		}
	}
}

export async function callModelChatCompletionsApi(
	client: OpenAI,
	model: string,
	messages: any[],
	signal?: AbortSignal,
	eventReceiver?: AgentEventReceiver,
	supportsReasoning?: boolean,
): Promise<void> {
	await eventReceiver?.on({ type: "assistant_start" });

	// Use provided reasoning support or detect it
	if (supportsReasoning === undefined) {
		supportsReasoning = await checkReasoningSupport(client, model, "completions");
	}

	let assistantResponded = false;

	while (!assistantResponded) {
		if (signal?.aborted) {
			await eventReceiver?.on({ type: "interrupted" });
			throw new Error("Interrupted");
		}

		const response = await client.chat.completions.create(
			{
				model,
				messages,
				tools: toolsForChat,
				tool_choice: "auto",
				max_completion_tokens: 2000, // TODO make configurable
				...(supportsReasoning && {
					reasoning_effort: "medium",
				}),
			},
			{ signal },
		);

		const message = response.choices[0].message;

		// Report token usage if available
		if (response.usage) {
			const usage = response.usage;
			await eventReceiver?.on({
				type: "token_usage",
				inputTokens: usage.prompt_tokens || 0,
				outputTokens: usage.completion_tokens || 0,
				totalTokens: usage.total_tokens || 0,
				cacheReadTokens: usage.prompt_tokens_details?.cached_tokens || 0,
				cacheWriteTokens: 0, // Not available in API
				reasoningTokens: usage.completion_tokens_details?.reasoning_tokens || 0,
			});
		}

		if (message.tool_calls && message.tool_calls.length > 0) {
			// Add assistant message with tool calls to history
			const assistantMsg: any = {
				role: "assistant",
				content: message.content || null,
				tool_calls: message.tool_calls,
			};
			messages.push(assistantMsg);

			// Display and execute each tool call
			for (const toolCall of message.tool_calls) {
				// Check if interrupted before executing tool
				if (signal?.aborted) {
					await eventReceiver?.on({ type: "interrupted" });
					throw new Error("Interrupted");
				}

				try {
					const funcName = toolCall.type === "function" ? toolCall.function.name : toolCall.custom.name;
					const funcArgs = toolCall.type === "function" ? toolCall.function.arguments : toolCall.custom.input;

					await eventReceiver?.on({ type: "tool_call", toolCallId: toolCall.id, name: funcName, args: funcArgs });
					const result = await executeTool(funcName, funcArgs, signal);
					await eventReceiver?.on({ type: "tool_result", toolCallId: toolCall.id, result, isError: false });

					// Add tool result to messages
					const toolMsg = {
						role: "tool",
						tool_call_id: toolCall.id,
						content: result,
					};
					messages.push(toolMsg);
				} catch (e: any) {
					eventReceiver?.on({ type: "tool_result", toolCallId: toolCall.id, result: e.message, isError: true });
					const errorMsg = {
						role: "tool",
						tool_call_id: toolCall.id,
						content: e.message,
					};
					messages.push(errorMsg);
				}
			}
		} else if (message.content) {
			// Final assistant response
			eventReceiver?.on({ type: "assistant_message", text: message.content });
			const finalMsg = { role: "assistant", content: message.content };
			messages.push(finalMsg);
			assistantResponded = true;
		}
	}
}

export class Agent {
	private client: OpenAI;
	public readonly config: AgentConfig;
	private messages: any[] = [];
	private renderer?: AgentEventReceiver;
	private sessionManager?: SessionManager;
	private comboReceiver: AgentEventReceiver;
	private abortController: AbortController | null = null;
	private supportsReasoningResponses: boolean | null = null; // Cache reasoning support for responses API
	private supportsReasoningCompletions: boolean | null = null; // Cache reasoning support for completions API

	constructor(config: AgentConfig, renderer?: AgentEventReceiver, sessionManager?: SessionManager) {
		this.config = config;
		this.client = new OpenAI({
			apiKey: config.apiKey,
			baseURL: config.baseURL,
		});

		// Use provided renderer or default to console
		this.renderer = renderer;
		this.sessionManager = sessionManager;

		this.comboReceiver = {
			on: async (event: AgentEvent): Promise<void> => {
				await this.renderer?.on(event);
				await this.sessionManager?.on(event);
			},
		};

		// Initialize with system prompt if provided
		if (config.systemPrompt) {
			this.messages.push({ role: "system", content: config.systemPrompt });
		}

		// Start session logging if we have a session manager
		if (sessionManager) {
			sessionManager.startSession(this.config);

			// Emit session_start event
			this.comboReceiver.on({
				type: "session_start",
				sessionId: sessionManager.getSessionId(),
				model: config.model,
				api: config.api,
				baseURL: config.baseURL,
				systemPrompt: config.systemPrompt,
			});
		}
	}

	async ask(userMessage: string): Promise<void> {
		// Render user message through the event system
		this.comboReceiver.on({ type: "user_message", text: userMessage });

		// Add user message
		const userMsg = { role: "user", content: userMessage };
		this.messages.push(userMsg);

		// Create a new AbortController for this chat session
		this.abortController = new AbortController();

		try {
			if (this.config.api === "responses") {
				// Check reasoning support only once per agent instance
				if (this.supportsReasoningResponses === null) {
					this.supportsReasoningResponses = await checkReasoningSupport(
						this.client,
						this.config.model,
						"responses",
					);
				}

				await callModelResponsesApi(
					this.client,
					this.config.model,
					this.messages,
					this.abortController.signal,
					this.comboReceiver,
					this.supportsReasoningResponses,
				);
			} else {
				// Check reasoning support for completions API
				if (this.supportsReasoningCompletions === null) {
					this.supportsReasoningCompletions = await checkReasoningSupport(
						this.client,
						this.config.model,
						"completions",
					);
				}

				await callModelChatCompletionsApi(
					this.client,
					this.config.model,
					this.messages,
					this.abortController.signal,
					this.comboReceiver,
					this.supportsReasoningCompletions,
				);
			}
		} catch (e) {
			// Check if this was an interruption
			const errorMessage = e instanceof Error ? e.message : String(e);
			if (errorMessage === "Interrupted" || this.abortController.signal.aborted) {
				return;
			}
			throw e;
		} finally {
			this.abortController = null;
		}
	}

	interrupt(): void {
		this.abortController?.abort();
	}

	setEvents(events: AgentEvent[]): void {
		// Reconstruct messages from events based on API type
		this.messages = [];

		if (this.config.api === "responses") {
			// Responses API format
			if (this.config.systemPrompt) {
				this.messages.push({
					type: "system",
					content: [{ type: "system_text", text: this.config.systemPrompt }],
				});
			}

			for (const event of events) {
				switch (event.type) {
					case "user_message":
						this.messages.push({
							type: "user",
							content: [{ type: "input_text", text: event.text }],
						});
						break;

					case "reasoning":
						// Add reasoning message
						this.messages.push({
							type: "reasoning",
							content: [{ type: "reasoning_text", text: event.text }],
						});
						break;

					case "tool_call":
						// Add function call
						this.messages.push({
							type: "function_call",
							id: event.toolCallId,
							name: event.name,
							arguments: event.args,
						});
						break;

					case "tool_result":
						// Add function result
						this.messages.push({
							type: "function_call_output",
							call_id: event.toolCallId,
							output: event.result,
						});
						break;

					case "assistant_message":
						// Add final message
						this.messages.push({
							type: "message",
							content: [{ type: "output_text", text: event.text }],
						});
						break;
				}
			}
		} else {
			// Chat Completions API format
			if (this.config.systemPrompt) {
				this.messages.push({ role: "system", content: this.config.systemPrompt });
			}

			// Track tool calls in progress
			let pendingToolCalls: any[] = [];

			for (const event of events) {
				switch (event.type) {
					case "user_message":
						this.messages.push({ role: "user", content: event.text });
						break;

					case "assistant_start":
						// Reset pending tool calls for new assistant response
						pendingToolCalls = [];
						break;

					case "tool_call":
						// Accumulate tool calls
						pendingToolCalls.push({
							id: event.toolCallId,
							type: "function",
							function: {
								name: event.name,
								arguments: event.args,
							},
						});
						break;

					case "tool_result":
						// When we see the first tool result, add the assistant message with all tool calls
						if (pendingToolCalls.length > 0) {
							this.messages.push({
								role: "assistant",
								content: null,
								tool_calls: pendingToolCalls,
							});
							pendingToolCalls = [];
						}
						// Add the tool result
						this.messages.push({
							role: "tool",
							tool_call_id: event.toolCallId,
							content: event.result,
						});
						break;

					case "assistant_message":
						// Final assistant response (no tool calls)
						this.messages.push({ role: "assistant", content: event.text });
						break;

					// Skip other event types (thinking, error, interrupted, token_usage)
				}
			}
		}
	}
}
