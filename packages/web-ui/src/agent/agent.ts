import type { Context } from "@mariozechner/pi-ai";
import {
	type AgentTool,
	type AssistantMessage as AssistantMessageType,
	getModel,
	type ImageContent,
	type Message,
	type Model,
	type TextContent,
} from "@mariozechner/pi-ai";
import type { AppMessage } from "../components/Messages.js";
import type { Attachment } from "../utils/attachment-utils.js";
import type { AgentRunConfig, AgentTransport } from "./transports/types.js";
import type { DebugLogEntry } from "./types.js";

// Default transformer: Keep only LLM-compatible messages, strip app-specific fields
function defaultMessageTransformer(messages: AppMessage[]): Message[] {
	return messages
		.filter((m) => {
			// Only keep standard LLM message roles
			return m.role === "user" || m.role === "assistant" || m.role === "toolResult";
		})
		.map((m) => {
			if (m.role === "user") {
				// Strip attachments field (app-specific)
				const { attachments, ...rest } = m as any;
				return rest as Message;
			}
			return m as Message;
		});
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high";

export interface AgentState {
	systemPrompt: string;
	model: Model<any>;
	thinkingLevel: ThinkingLevel;
	tools: AgentTool<any>[];
	messages: AppMessage[];
	isStreaming: boolean;
	streamMessage: Message | null;
	pendingToolCalls: Set<string>;
	error?: string;
}

export type AgentEvent =
	| { type: "state-update"; state: AgentState }
	| { type: "error-no-model" }
	| { type: "error-no-api-key"; provider: string };

export interface AgentOptions {
	initialState?: Partial<AgentState>;
	debugListener?: (entry: DebugLogEntry) => void;
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
	private debugListener?: (entry: DebugLogEntry) => void;
	private messageTransformer: (messages: AppMessage[]) => Message[] | Promise<Message[]>;

	constructor(opts: AgentOptions) {
		this._state = { ...this._state, ...opts.initialState };
		this.debugListener = opts.debugListener;
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

	// Mutators
	setSystemPrompt(v: string) {
		this.patch({ systemPrompt: v });
	}
	setModel(m: Model<any>) {
		this.patch({ model: m });
	}
	setThinkingLevel(l: ThinkingLevel) {
		this.patch({ thinkingLevel: l });
	}
	setTools(t: AgentTool<any>[]) {
		this.patch({ tools: t });
	}
	replaceMessages(ms: AppMessage[]) {
		this.patch({ messages: ms.slice() });
	}
	appendMessage(m: AppMessage) {
		this.patch({ messages: [...this._state.messages, m] });
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
			this.emit({ type: "error-no-model" });
			return;
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
		};

		this.abortController = new AbortController();
		this.patch({ isStreaming: true, streamMessage: null, error: undefined });

		const reasoning =
			this._state.thinkingLevel === "off"
				? undefined
				: this._state.thinkingLevel === "minimal"
					? "low"
					: this._state.thinkingLevel;
		const cfg: AgentRunConfig = {
			systemPrompt: this._state.systemPrompt,
			tools: this._state.tools,
			model,
			reasoning,
		};

		try {
			let partial: Message | null = null;
			let turnDebug: DebugLogEntry | null = null;
			let turnStart = 0;

			// Transform app messages to LLM-compatible messages
			const llmMessages = await this.messageTransformer(this._state.messages);

			for await (const ev of this.transport.run(
				llmMessages,
				userMessage as Message,
				cfg,
				this.abortController.signal,
			)) {
				switch (ev.type) {
					case "turn_start": {
						turnStart = performance.now();
						// Build request context snapshot (use transformed messages)
						const ctx: Context = {
							systemPrompt: this._state.systemPrompt,
							messages: [...llmMessages],
							tools: this._state.tools,
						};
						turnDebug = {
							timestamp: new Date().toISOString(),
							request: {
								provider: cfg.model.provider,
								model: cfg.model.id,
								context: { ...ctx },
							},
							sseEvents: [],
						};
						break;
					}
					case "message_start":
					case "message_update": {
						partial = ev.message;
						// Collect SSE-like events for debug (drop heavy partial)
						if (ev.type === "message_update" && ev.assistantMessageEvent && turnDebug) {
							const copy: any = { ...ev.assistantMessageEvent };
							if (copy && "partial" in copy) delete copy.partial;
							turnDebug.sseEvents.push(JSON.stringify(copy));
							if (!turnDebug.ttft) turnDebug.ttft = performance.now() - turnStart;
						}
						this.patch({ streamMessage: ev.message });
						break;
					}
					case "message_end": {
						partial = null;
						this.appendMessage(ev.message as AppMessage);
						this.patch({ streamMessage: null });
						if (turnDebug) {
							if (ev.message.role !== "assistant" && ev.message.role !== "toolResult") {
								turnDebug.request.context.messages.push(ev.message);
							}
							if (ev.message.role === "assistant") turnDebug.response = ev.message as any;
						}
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
					case "turn_end": {
						// finalize current turn
						if (turnDebug) {
							turnDebug.totalTime = performance.now() - turnStart;
							this.debugListener?.(turnDebug);
							turnDebug = null;
						}
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
			if (String(err?.message || err) === "no-api-key") {
				this.emit({ type: "error-no-api-key", provider: model.provider });
			} else {
				const msg: AssistantMessageType = {
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
				};
				this.appendMessage(msg as AppMessage);
				this.patch({ error: err?.message || String(err) });
			}
		} finally {
			this.patch({ isStreaming: false, streamMessage: null, pendingToolCalls: new Set<string>() });
			this.abortController = undefined;
		}
		{
			const { systemPrompt, model, messages } = this._state;
			console.log("final state:", { systemPrompt, model, messages });
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
