import type { ImageContent, Message, QueuedMessage, TextContent } from "@mariozechner/pi-ai";
import { getModel } from "@mariozechner/pi-ai";
import type { AgentTransport } from "./transports/types.js";
import type { AgentEvent, AgentState, AppMessage, Attachment, ThinkingLevel } from "./types.js";

/**
 * Default message transformer: Keep only LLM-compatible messages, strip app-specific fields.
 * Converts attachments to proper content blocks (images → ImageContent, documents → TextContent).
 */
function defaultMessageTransformer(messages: AppMessage[]): Message[] {
	return messages
		.filter((m) => {
			// Only keep standard LLM message roles
			return m.role === "user" || m.role === "assistant" || m.role === "toolResult";
		})
		.map((m) => {
			if (m.role === "user") {
				const { attachments, ...rest } = m as any;

				// If no attachments, return as-is
				if (!attachments || attachments.length === 0) {
					return rest as Message;
				}

				// Convert attachments to content blocks
				const content = Array.isArray(rest.content) ? [...rest.content] : [{ type: "text", text: rest.content }];

				for (const attachment of attachments as Attachment[]) {
					// Add image blocks for image attachments
					if (attachment.type === "image") {
						content.push({
							type: "image",
							data: attachment.content,
							mimeType: attachment.mimeType,
						} as ImageContent);
					}
					// Add text blocks for documents with extracted text
					else if (attachment.type === "document" && attachment.extractedText) {
						content.push({
							type: "text",
							text: `\n\n[Document: ${attachment.fileName}]\n${attachment.extractedText}`,
							isDocument: true,
						} as TextContent);
					}
				}

				return { ...rest, content } as Message;
			}
			return m as Message;
		});
}

export interface AgentOptions {
	initialState?: Partial<AgentState>;
	transport: AgentTransport;
	// Transform app messages to LLM-compatible messages before sending to transport
	messageTransformer?: (messages: AppMessage[]) => Message[] | Promise<Message[]>;
}

export class Agent {
	private _state: AgentState = {
		systemPrompt: "",
		model: getModel("google", "gemini-2.5-flash-lite-preview-06-17"),
		thinkingLevel: "off",
		tools: [],
		messages: [],
		isStreaming: false,
		streamMessage: null,
		pendingToolCalls: new Set<string>(),
		error: undefined,
	};
	private listeners = new Set<(e: AgentEvent) => void>();
	private abortController?: AbortController;
	private transport: AgentTransport;
	private messageTransformer: (messages: AppMessage[]) => Message[] | Promise<Message[]>;
	private messageQueue: Array<QueuedMessage<AppMessage>> = [];

	constructor(opts: AgentOptions) {
		this._state = { ...this._state, ...opts.initialState };
		this.transport = opts.transport;
		this.messageTransformer = opts.messageTransformer || defaultMessageTransformer;
	}

	get state(): AgentState {
		return this._state;
	}

	subscribe(fn: (e: AgentEvent) => void): () => void {
		this.listeners.add(fn);
		fn({ type: "state-update", state: this._state });
		return () => this.listeners.delete(fn);
	}

	// State mutators
	setSystemPrompt(v: string) {
		this.patch({ systemPrompt: v });
	}

	setModel(m: typeof this._state.model) {
		this.patch({ model: m });
	}

	setThinkingLevel(l: ThinkingLevel) {
		this.patch({ thinkingLevel: l });
	}

	setTools(t: typeof this._state.tools) {
		this.patch({ tools: t });
	}

	replaceMessages(ms: AppMessage[]) {
		this.patch({ messages: ms.slice() });
	}

	appendMessage(m: AppMessage) {
		this.patch({ messages: [...this._state.messages, m] });
	}

	async queueMessage(m: AppMessage) {
		// Transform message and queue it for injection at next turn
		const transformed = await this.messageTransformer([m]);
		this.messageQueue.push({
			original: m,
			llm: transformed[0], // undefined if filtered out
		});
	}

	clearMessages() {
		this.patch({ messages: [] });
	}

	abort() {
		this.abortController?.abort();
	}

	async prompt(input: string, attachments?: Attachment[]) {
		const model = this._state.model;
		if (!model) {
			throw new Error("No model configured");
		}

		// Build user message with attachments
		const content: Array<TextContent | ImageContent> = [{ type: "text", text: input }];
		if (attachments?.length) {
			for (const a of attachments) {
				if (a.type === "image") {
					content.push({ type: "image", data: a.content, mimeType: a.mimeType });
				} else if (a.type === "document" && a.extractedText) {
					content.push({
						type: "text",
						text: `\n\n[Document: ${a.fileName}]\n${a.extractedText}`,
						isDocument: true,
					} as TextContent);
				}
			}
		}

		const userMessage: AppMessage = {
			role: "user",
			content,
			attachments: attachments?.length ? attachments : undefined,
			timestamp: Date.now(),
		};

		this.abortController = new AbortController();
		this.patch({ isStreaming: true, streamMessage: null, error: undefined });
		this.emit({ type: "started" });

		const reasoning =
			this._state.thinkingLevel === "off"
				? undefined
				: this._state.thinkingLevel === "minimal"
					? "low"
					: this._state.thinkingLevel;

		const cfg = {
			systemPrompt: this._state.systemPrompt,
			tools: this._state.tools,
			model,
			reasoning,
			getQueuedMessages: async <T>() => {
				// Return queued messages (they'll be added to state via message_end event)
				const queued = this.messageQueue.slice();
				this.messageQueue = [];
				return queued as QueuedMessage<T>[];
			},
		};

		try {
			let partial: Message | null = null;

			// Transform app messages to LLM-compatible messages (initial set)
			const llmMessages = await this.messageTransformer(this._state.messages);

			for await (const ev of this.transport.run(
				llmMessages,
				userMessage as Message,
				cfg,
				this.abortController.signal,
			)) {
				switch (ev.type) {
					case "message_start":
					case "message_update": {
						partial = ev.message;
						this.patch({ streamMessage: ev.message });
						break;
					}
					case "message_end": {
						partial = null;
						this.appendMessage(ev.message as AppMessage);
						this.patch({ streamMessage: null });
						break;
					}
					case "tool_execution_start": {
						const s = new Set(this._state.pendingToolCalls);
						s.add(ev.toolCallId);
						this.patch({ pendingToolCalls: s });
						break;
					}
					case "tool_execution_end": {
						const s = new Set(this._state.pendingToolCalls);
						s.delete(ev.toolCallId);
						this.patch({ pendingToolCalls: s });
						break;
					}
					case "agent_end": {
						this.patch({ streamMessage: null });
						break;
					}
				}
			}

			if (partial && partial.role === "assistant" && partial.content.length > 0) {
				const onlyEmpty = !partial.content.some(
					(c) =>
						(c.type === "thinking" && c.thinking.trim().length > 0) ||
						(c.type === "text" && c.text.trim().length > 0) ||
						(c.type === "toolCall" && c.name.trim().length > 0),
				);
				if (!onlyEmpty) {
					this.appendMessage(partial as AppMessage);
				} else {
					if (this.abortController?.signal.aborted) {
						throw new Error("Request was aborted");
					}
				}
			}
		} catch (err: any) {
			const msg: Message = {
				role: "assistant",
				content: [{ type: "text", text: "" }],
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
				stopReason: this.abortController?.signal.aborted ? "aborted" : "error",
				errorMessage: err?.message || String(err),
				timestamp: Date.now(),
			};
			this.appendMessage(msg as AppMessage);
			this.patch({ error: err?.message || String(err) });
		} finally {
			this.patch({ isStreaming: false, streamMessage: null, pendingToolCalls: new Set<string>() });
			this.abortController = undefined;
			this.emit({ type: "completed" });
		}
	}

	private patch(p: Partial<AgentState>): void {
		this._state = { ...this._state, ...p };
		this.emit({ type: "state-update", state: this._state });
	}

	private emit(e: AgentEvent) {
		for (const listener of this.listeners) {
			listener(e);
		}
	}
}
