import type {
	AgentContext,
	Api,
	AssistantMessage,
	AssistantMessageEvent,
	Context,
	Message,
	Model,
	PromptConfig,
	SimpleStreamOptions,
	ToolCall,
	UserMessage,
} from "@mariozechner/pi-ai";
import { agentLoop } from "@mariozechner/pi-ai";
import { AssistantMessageEventStream } from "@mariozechner/pi-ai/dist/utils/event-stream.js";
import { parseStreamingJson } from "@mariozechner/pi-ai/dist/utils/json-parse.js";
import { clearAuthToken, getAuthToken } from "../../utils/auth-token.js";
import { i18n } from "../../utils/i18n.js";
import type { ProxyAssistantMessageEvent } from "./proxy-types.js";
import type { AgentRunConfig, AgentTransport } from "./types.js";

/**
 * Stream function that proxies through a server instead of calling providers directly.
 * The server strips the partial field from delta events to reduce bandwidth.
 * We reconstruct the partial message client-side.
 */
function streamSimpleProxy(
	model: Model<any>,
	context: Context,
	options: SimpleStreamOptions & { authToken: string },
	proxyUrl: string,
): AssistantMessageEventStream {
	const stream = new AssistantMessageEventStream();

	(async () => {
		// Initialize the partial message that we'll build up from events
		const partial: AssistantMessage = {
			role: "assistant",
			stopReason: "stop",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		};

		let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

		// Set up abort handler to cancel the reader
		const abortHandler = () => {
			if (reader) {
				reader.cancel("Request aborted by user").catch(() => {});
			}
		};

		if (options.signal) {
			options.signal.addEventListener("abort", abortHandler);
		}

		try {
			const response = await fetch(`${proxyUrl}/api/stream`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${options.authToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model,
					context,
					options: {
						temperature: options.temperature,
						maxTokens: options.maxTokens,
						reasoning: options.reasoning,
						// Don't send apiKey or signal - those are added server-side
					},
				}),
				signal: options.signal,
			});

			if (!response.ok) {
				let errorMessage = `Proxy error: ${response.status} ${response.statusText}`;
				try {
					const errorData = await response.json();
					if (errorData.error) {
						errorMessage = `Proxy error: ${errorData.error}`;
					}
				} catch {
					// Couldn't parse error response, use default message
				}
				throw new Error(errorMessage);
			}

			// Parse SSE stream
			reader = response.body!.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				// Check if aborted after reading
				if (options.signal?.aborted) {
					throw new Error("Request aborted by user");
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const data = line.slice(6).trim();
						if (data) {
							const proxyEvent = JSON.parse(data) as ProxyAssistantMessageEvent;
							let event: AssistantMessageEvent | undefined;

							// Handle different event types
							// Server sends events with partial for non-delta events,
							// and without partial for delta events
							switch (proxyEvent.type) {
								case "start":
									event = { type: "start", partial };
									break;

								case "text_start":
									partial.content[proxyEvent.contentIndex] = {
										type: "text",
										text: "",
									};
									event = { type: "text_start", contentIndex: proxyEvent.contentIndex, partial };
									break;

								case "text_delta": {
									const content = partial.content[proxyEvent.contentIndex];
									if (content?.type === "text") {
										content.text += proxyEvent.delta;
										event = {
											type: "text_delta",
											contentIndex: proxyEvent.contentIndex,
											delta: proxyEvent.delta,
											partial,
										};
									} else {
										throw new Error("Received text_delta for non-text content");
									}
									break;
								}
								case "text_end": {
									const content = partial.content[proxyEvent.contentIndex];
									if (content?.type === "text") {
										content.textSignature = proxyEvent.contentSignature;
										event = {
											type: "text_end",
											contentIndex: proxyEvent.contentIndex,
											content: content.text,
											partial,
										};
									} else {
										throw new Error("Received text_end for non-text content");
									}
									break;
								}

								case "thinking_start":
									partial.content[proxyEvent.contentIndex] = {
										type: "thinking",
										thinking: "",
									};
									event = { type: "thinking_start", contentIndex: proxyEvent.contentIndex, partial };
									break;

								case "thinking_delta": {
									const content = partial.content[proxyEvent.contentIndex];
									if (content?.type === "thinking") {
										content.thinking += proxyEvent.delta;
										event = {
											type: "thinking_delta",
											contentIndex: proxyEvent.contentIndex,
											delta: proxyEvent.delta,
											partial,
										};
									} else {
										throw new Error("Received thinking_delta for non-thinking content");
									}
									break;
								}

								case "thinking_end": {
									const content = partial.content[proxyEvent.contentIndex];
									if (content?.type === "thinking") {
										content.thinkingSignature = proxyEvent.contentSignature;
										event = {
											type: "thinking_end",
											contentIndex: proxyEvent.contentIndex,
											content: content.thinking,
											partial,
										};
									} else {
										throw new Error("Received thinking_end for non-thinking content");
									}
									break;
								}

								case "toolcall_start":
									partial.content[proxyEvent.contentIndex] = {
										type: "toolCall",
										id: proxyEvent.id,
										name: proxyEvent.toolName,
										arguments: {},
										partialJson: "",
									} satisfies ToolCall & { partialJson: string } as ToolCall;
									event = { type: "toolcall_start", contentIndex: proxyEvent.contentIndex, partial };
									break;

								case "toolcall_delta": {
									const content = partial.content[proxyEvent.contentIndex];
									if (content?.type === "toolCall") {
										(content as any).partialJson += proxyEvent.delta;
										content.arguments = parseStreamingJson((content as any).partialJson) || {};
										event = {
											type: "toolcall_delta",
											contentIndex: proxyEvent.contentIndex,
											delta: proxyEvent.delta,
											partial,
										};
										partial.content[proxyEvent.contentIndex] = { ...content }; // Trigger reactivity
									} else {
										throw new Error("Received toolcall_delta for non-toolCall content");
									}
									break;
								}

								case "toolcall_end": {
									const content = partial.content[proxyEvent.contentIndex];
									if (content?.type === "toolCall") {
										delete (content as any).partialJson;
										event = {
											type: "toolcall_end",
											contentIndex: proxyEvent.contentIndex,
											toolCall: content,
											partial,
										};
									}
									break;
								}

								case "done":
									partial.stopReason = proxyEvent.reason;
									partial.usage = proxyEvent.usage;
									event = { type: "done", reason: proxyEvent.reason, message: partial };
									break;

								case "error":
									partial.stopReason = proxyEvent.reason;
									partial.errorMessage = proxyEvent.errorMessage;
									partial.usage = proxyEvent.usage;
									event = { type: "error", reason: proxyEvent.reason, error: partial };
									break;

								default: {
									// Exhaustive check
									const _exhaustiveCheck: never = proxyEvent;
									console.warn(`Unhandled event type: ${(proxyEvent as any).type}`);
									break;
								}
							}

							// Push the event to stream
							if (event) {
								stream.push(event);
							} else {
								throw new Error("Failed to create event from proxy event");
							}
						}
					}
				}
			}

			// Check if aborted after reading
			if (options.signal?.aborted) {
				throw new Error("Request aborted by user");
			}

			stream.end();
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (errorMessage.toLowerCase().includes("proxy") && errorMessage.includes("Unauthorized")) {
				clearAuthToken();
			}
			partial.stopReason = options.signal?.aborted ? "aborted" : "error";
			partial.errorMessage = errorMessage;
			stream.push({
				type: "error",
				reason: partial.stopReason,
				error: partial,
			} satisfies AssistantMessageEvent);
			stream.end();
		} finally {
			// Clean up abort handler
			if (options.signal) {
				options.signal.removeEventListener("abort", abortHandler);
			}
		}
	})();

	return stream;
}

// Proxy transport executes the turn using a remote proxy server
/**
 * Transport that uses an app server with user authentication tokens.
 * The server manages user accounts and proxies requests to LLM providers.
 */
export class AppTransport implements AgentTransport {
	// Hardcoded proxy URL for now - will be made configurable later
	private readonly proxyUrl = "https://genai.mariozechner.at";

	async *run(messages: Message[], userMessage: Message, cfg: AgentRunConfig, signal?: AbortSignal) {
		const authToken = await getAuthToken();
		if (!authToken) {
			throw new Error(i18n("Auth token is required for proxy transport"));
		}

		// Use proxy - no local API key needed
		const streamFn = <TApi extends Api>(model: Model<TApi>, context: Context, options?: SimpleStreamOptions) => {
			return streamSimpleProxy(
				model,
				context,
				{
					...options,
					authToken,
				},
				this.proxyUrl,
			);
		};

		// Messages are already LLM-compatible (filtered by Agent)
		const context: AgentContext = {
			systemPrompt: cfg.systemPrompt,
			messages,
			tools: cfg.tools,
		};

		const pc: PromptConfig = {
			model: cfg.model,
			reasoning: cfg.reasoning,
		};

		// Yield events from the upstream agentLoop iterator
		// Pass streamFn as the 5th parameter to use proxy
		for await (const ev of agentLoop(userMessage as unknown as UserMessage, context, pc, signal, streamFn as any)) {
			yield ev;
		}
	}
}
