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

// Provider detection based on base URL
function detectProvider(baseURL?: string): "openai" | "gemini" | "groq" | "anthropic" | "openrouter" | "other" {
	if (!baseURL) return "openai";
	if (baseURL.includes("api.openai.com")) return "openai";
	if (baseURL.includes("generativelanguage.googleapis.com")) return "gemini";
	if (baseURL.includes("api.groq.com")) return "groq";
	if (baseURL.includes("api.anthropic.com")) return "anthropic";
	if (baseURL.includes("openrouter.ai")) return "openrouter";
	return "other";
}

// Parse provider-specific reasoning from message content
function parseReasoningFromMessage(message: any, baseURL?: string): { cleanContent: string; reasoningTexts: string[] } {
	const provider = detectProvider(baseURL);
	const reasoningTexts: string[] = [];
	let cleanContent = message.content || "";

	switch (provider) {
		case "gemini":
			// Gemini returns thinking in <thought> tags
			if (cleanContent.includes("<thought>")) {
				const thoughtMatches = cleanContent.matchAll(/<thought>([\s\S]*?)<\/thought>/g);
				for (const match of thoughtMatches) {
					reasoningTexts.push(match[1].trim());
				}
				// Remove all thought tags from the response
				cleanContent = cleanContent.replace(/<thought>[\s\S]*?<\/thought>/g, "").trim();
			}
			break;

		case "groq":
			// Groq returns reasoning in a separate field when reasoning_format is "parsed"
			if (message.reasoning) {
				reasoningTexts.push(message.reasoning);
			}
			break;

		case "openrouter":
			// OpenRouter returns reasoning in message.reasoning field
			if (message.reasoning) {
				reasoningTexts.push(message.reasoning);
			}
			break;

		default:
			// Other providers don't embed reasoning in message content
			break;
	}

	return { cleanContent, reasoningTexts };
}

// Adjust request options based on provider-specific requirements
function adjustRequestForProvider(
	requestOptions: any,
	api: "completions" | "responses",
	baseURL?: string,
	supportsReasoning?: boolean,
): any {
	const provider = detectProvider(baseURL);

	// Handle provider-specific adjustments
	switch (provider) {
		case "gemini":
			if (api === "completions" && supportsReasoning && requestOptions.reasoning_effort) {
				// Gemini needs extra_body for thinking content
				// Can't use both reasoning_effort and thinking_config
				const budget =
					requestOptions.reasoning_effort === "low"
						? 1024
						: requestOptions.reasoning_effort === "medium"
							? 8192
							: 24576;

				requestOptions.extra_body = {
					google: {
						thinking_config: {
							thinking_budget: budget,
							include_thoughts: true,
						},
					},
				};
				// Remove reasoning_effort when using thinking_config
				delete requestOptions.reasoning_effort;
			}
			break;

		case "groq":
			if (api === "responses" && requestOptions.reasoning) {
				// Groq responses API doesn't support reasoning.summary
				delete requestOptions.reasoning.summary;
			} else if (api === "completions" && supportsReasoning && requestOptions.reasoning_effort) {
				// Groq Chat Completions uses reasoning_format instead of reasoning_effort alone
				requestOptions.reasoning_format = "parsed";
				// Keep reasoning_effort for Groq
			}
			break;

		case "anthropic":
			// Anthropic's OpenAI compatibility has its own quirks
			// But thinking content isn't available via OpenAI compat layer
			break;

		case "openrouter":
			// OpenRouter uses a unified reasoning parameter format
			if (api === "completions" && supportsReasoning && requestOptions.reasoning_effort) {
				// Convert reasoning_effort to OpenRouter's reasoning format
				requestOptions.reasoning = {
					effort:
						requestOptions.reasoning_effort === "low"
							? "low"
							: requestOptions.reasoning_effort === "minimal"
								? "low"
								: requestOptions.reasoning_effort === "medium"
									? "medium"
									: "high",
				};
				delete requestOptions.reasoning_effort;
			}
			break;

		default:
			// OpenAI and others use standard format
			break;
	}

	return requestOptions;
}

async function checkReasoningSupport(
	client: OpenAI,
	model: string,
	api: "completions" | "responses",
	baseURL?: string,
): Promise<boolean> {
	// Check cache first
	const cacheKey = model;
	const cached = modelReasoningSupport.get(cacheKey);
	if (cached && cached[api] !== undefined) {
		return cached[api]!;
	}

	let supportsReasoning = false;
	const provider = detectProvider(baseURL);

	if (api === "responses") {
		// Try a minimal request with reasoning parameter for Responses API
		try {
			const testRequest: any = {
				model,
				input: "test",
				max_output_tokens: 1024,
				reasoning: {
					effort: "low", // Use low instead of minimal to ensure we get summaries
				},
			};
			await client.responses.create(testRequest);
			supportsReasoning = true;
		} catch (error) {
			supportsReasoning = false;
		}
	} else {
		// For Chat Completions API, try with reasoning parameter
		try {
			const testRequest: any = {
				model,
				messages: [{ role: "user", content: "test" }],
				max_completion_tokens: 1024,
			};

			// Add provider-specific reasoning parameters
			if (provider === "gemini") {
				// Gemini uses extra_body for thinking
				testRequest.extra_body = {
					google: {
						thinking_config: {
							thinking_budget: 100, // Minimum viable budget for test
							include_thoughts: true,
						},
					},
				};
			} else if (provider === "groq") {
				// Groq uses both reasoning_format and reasoning_effort
				testRequest.reasoning_format = "parsed";
				testRequest.reasoning_effort = "low";
			} else {
				// Others use reasoning_effort
				testRequest.reasoning_effort = "minimal";
			}

			await client.chat.completions.create(testRequest);
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
	baseURL?: string,
): Promise<void> {
	let conversationDone = false;

	while (!conversationDone) {
		// Check if we've been interrupted
		if (signal?.aborted) {
			await eventReceiver?.on({ type: "interrupted" });
			throw new Error("Interrupted");
		}

		// Build request options
		let requestOptions: any = {
			model,
			input: messages,
			tools: toolsForResponses as any,
			tool_choice: "auto",
			parallel_tool_calls: true,
			max_output_tokens: 2000, // TODO make configurable
			...(supportsReasoning && {
				reasoning: {
					effort: "minimal", // Use minimal effort for responses API
					summary: "detailed", // Request detailed reasoning summaries
				},
			}),
		};

		// Apply provider-specific adjustments
		requestOptions = adjustRequestForProvider(requestOptions, "responses", baseURL, supportsReasoning);

		const response = await client.responses.create(requestOptions, { signal });

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
	baseURL?: string,
): Promise<void> {
	let assistantResponded = false;

	while (!assistantResponded) {
		if (signal?.aborted) {
			await eventReceiver?.on({ type: "interrupted" });
			throw new Error("Interrupted");
		}

		// Build request options
		let requestOptions: any = {
			model,
			messages,
			tools: toolsForChat,
			tool_choice: "auto",
			max_completion_tokens: 2000, // TODO make configurable
			...(supportsReasoning && {
				reasoning_effort: "low", // Use low effort for completions API
			}),
		};

		// Apply provider-specific adjustments
		requestOptions = adjustRequestForProvider(requestOptions, "completions", baseURL, supportsReasoning);

		const response = await client.chat.completions.create(requestOptions, { signal });

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
			// Parse provider-specific reasoning from message
			const { cleanContent, reasoningTexts } = parseReasoningFromMessage(message, baseURL);

			// Emit reasoning events if any
			for (const reasoning of reasoningTexts) {
				await eventReceiver?.on({ type: "reasoning", text: reasoning });
			}

			// Emit the cleaned assistant message
			await eventReceiver?.on({ type: "assistant_message", text: cleanContent });
			const finalMsg = { role: "assistant", content: cleanContent };
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
	private supportsReasoning: boolean | null = null;

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
			await this.comboReceiver.on({ type: "assistant_start" });

			// Check reasoning support only once per agent instance
			if (this.supportsReasoning === null) {
				this.supportsReasoning = await checkReasoningSupport(
					this.client,
					this.config.model,
					this.config.api,
					this.config.baseURL,
				);
			}

			if (this.config.api === "responses") {
				await callModelResponsesApi(
					this.client,
					this.config.model,
					this.messages,
					this.abortController.signal,
					this.comboReceiver,
					this.supportsReasoning,
					this.config.baseURL,
				);
			} else {
				await callModelChatCompletionsApi(
					this.client,
					this.config.model,
					this.messages,
					this.abortController.signal,
					this.comboReceiver,
					this.supportsReasoning,
					this.config.baseURL,
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
