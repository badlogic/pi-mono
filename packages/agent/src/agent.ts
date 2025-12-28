/**
 * Agent class that uses the agent-loop directly.
 * No transport abstraction - calls streamSimple via the loop.
 */

import {
	getModel,
	type ImageContent,
	type Message,
	type Model,
	type ReasoningEffort,
	streamSimple,
	type TextContent,
} from "@mariozechner/pi-ai";
import { agentLoop, agentLoopContinue } from "./agent-loop.js";
import type {
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentState,
	AgentTool,
	StreamFn,
	ThinkingLevel,
} from "./types.js";

/**
 * Default convertToLlm: Keep only LLM-compatible messages, convert attachments.
 */
function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
	return messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult");
}

export interface AgentOptions {
	initialState?: Partial<AgentState>;

	/**
	 * Converts AgentMessage[] to LLM-compatible Message[] before each LLM call.
	 * Default filters to user/assistant/toolResult and converts attachments.
	 */
	convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

	/**
	 * Optional transform applied to context before convertToLlm.
	 * Use for context pruning, injecting external context, etc.
	 */
	transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

	/**
	 * Queue mode: "all" = send all queued messages at once, "one-at-a-time" = one per turn
	 */
	queueMode?: "all" | "one-at-a-time";

	/**
	 * Custom stream function (for proxy backends, etc.). Default uses streamSimple.
	 */
	streamFn?: StreamFn;

	/**
	 * Resolves an API key dynamically for each LLM call.
	 * Useful for expiring tokens (e.g., GitHub Copilot OAuth).
	 */
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
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
	private convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
	private transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
	private messageQueue: AgentMessage[] = [];
	private queueMode: "all" | "one-at-a-time";
	public streamFn: StreamFn;
	public getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	private runningPrompt?: Promise<void>;
	private resolveRunningPrompt?: () => void;

	constructor(opts: AgentOptions = {}) {
		this._state = { ...this._state, ...opts.initialState };
		this.convertToLlm = opts.convertToLlm || defaultConvertToLlm;
		this.transformContext = opts.transformContext;
		this.queueMode = opts.queueMode || "one-at-a-time";
		this.streamFn = opts.streamFn || streamSimple;
		this.getApiKey = opts.getApiKey;
	}

	get state(): AgentState {
		return this._state;
	}

	subscribe(fn: (e: AgentEvent) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	// State mutators
	setSystemPrompt(v: string) {
		this._state.systemPrompt = v;
	}

	setModel(m: Model<any>) {
		this._state.model = m;
	}

	setThinkingLevel(l: ThinkingLevel) {
		this._state.thinkingLevel = l;
	}

	setQueueMode(mode: "all" | "one-at-a-time") {
		this.queueMode = mode;
	}

	getQueueMode(): "all" | "one-at-a-time" {
		return this.queueMode;
	}

	setTools(t: AgentTool<any>[]) {
		this._state.tools = t;
	}

	replaceMessages(ms: AgentMessage[]) {
		this._state.messages = ms.slice();
	}

	appendMessage(m: AgentMessage) {
		this._state.messages = [...this._state.messages, m];
	}

	queueMessage(m: AgentMessage) {
		this.messageQueue.push(m);
	}

	clearMessageQueue() {
		this.messageQueue = [];
	}

	clearMessages() {
		this._state.messages = [];
	}

	abort() {
		this.abortController?.abort();
	}

	waitForIdle(): Promise<void> {
		return this.runningPrompt ?? Promise.resolve();
	}

	reset() {
		this._state.messages = [];
		this._state.isStreaming = false;
		this._state.streamMessage = null;
		this._state.pendingToolCalls = new Set<string>();
		this._state.error = undefined;
		this.messageQueue = [];
	}

	/** Send a prompt with an AgentMessage */
	async prompt(message: AgentMessage): Promise<void>;
	async prompt(input: string, images?: ImageContent[]): Promise<void>;
	async prompt(input: string | AgentMessage, images?: ImageContent[]) {
		const model = this._state.model;
		if (!model) throw new Error("No model configured");

		let userMessage: AgentMessage;

		if (typeof input === "string") {
			const content: Array<TextContent | ImageContent> = [{ type: "text", text: input }];
			if (images && images.length > 0) {
				content.push(...images);
			}
			userMessage = {
				role: "user",
				content,
				timestamp: Date.now(),
			};
		} else {
			userMessage = input;
		}

		await this._runLoop(userMessage);
	}

	/** Continue from current context (for retry after overflow) */
	async continue() {
		const messages = this._state.messages;
		if (messages.length === 0) {
			throw new Error("No messages to continue from");
		}
		if (messages[messages.length - 1].role === "assistant") {
			throw new Error("Cannot continue from message role: assistant");
		}

		await this._runLoop(undefined);
	}

	/**
	 * Run the agent loop.
	 * If userMessage is provided, starts a new conversation turn.
	 * Otherwise, continues from existing context.
	 */
	private async _runLoop(userMessage?: AgentMessage) {
		const model = this._state.model;
		if (!model) throw new Error("No model configured");

		this.runningPrompt = new Promise<void>((resolve) => {
			this.resolveRunningPrompt = resolve;
		});

		this.abortController = new AbortController();
		this._state.isStreaming = true;
		this._state.streamMessage = null;
		this._state.error = undefined;

		const reasoning: ReasoningEffort | undefined =
			this._state.thinkingLevel === "off"
				? undefined
				: this._state.thinkingLevel === "minimal"
					? "low"
					: (this._state.thinkingLevel as ReasoningEffort);

		const context: AgentContext = {
			systemPrompt: this._state.systemPrompt,
			messages: this._state.messages.slice(),
			tools: this._state.tools,
		};

		const config: AgentLoopConfig = {
			model,
			reasoning,
			convertToLlm: this.convertToLlm,
			transformContext: this.transformContext,
			getApiKey: this.getApiKey,
			getQueuedMessages: async () => {
				if (this.queueMode === "one-at-a-time") {
					if (this.messageQueue.length > 0) {
						const first = this.messageQueue[0];
						this.messageQueue = this.messageQueue.slice(1);
						return [first];
					}
					return [];
				} else {
					const queued = this.messageQueue.slice();
					this.messageQueue = [];
					return queued;
				}
			},
		};

		let partial: AgentMessage | null = null;

		try {
			const stream = userMessage
				? agentLoop(userMessage, context, config, this.abortController.signal, this.streamFn)
				: agentLoopContinue(context, config, this.abortController.signal, this.streamFn);

			for await (const event of stream) {
				// Update internal state based on events
				switch (event.type) {
					case "message_start":
						partial = event.message;
						this._state.streamMessage = event.message;
						break;

					case "message_update":
						partial = event.message;
						this._state.streamMessage = event.message;
						break;

					case "message_end":
						partial = null;
						this._state.streamMessage = null;
						this.appendMessage(event.message);
						break;

					case "tool_execution_start": {
						const s = new Set(this._state.pendingToolCalls);
						s.add(event.toolCallId);
						this._state.pendingToolCalls = s;
						break;
					}

					case "tool_execution_end": {
						const s = new Set(this._state.pendingToolCalls);
						s.delete(event.toolCallId);
						this._state.pendingToolCalls = s;
						break;
					}

					case "turn_end":
						if (event.message.role === "assistant" && (event.message as any).errorMessage) {
							this._state.error = (event.message as any).errorMessage;
						}
						break;

					case "agent_end":
						this._state.isStreaming = false;
						this._state.streamMessage = null;
						break;
				}

				// Emit to listeners
				this.emit(event);
			}

			// Handle any remaining partial message
			if (partial && partial.role === "assistant" && partial.content.length > 0) {
				const onlyEmpty = !partial.content.some(
					(c) =>
						(c.type === "thinking" && c.thinking.trim().length > 0) ||
						(c.type === "text" && c.text.trim().length > 0) ||
						(c.type === "toolCall" && c.name.trim().length > 0),
				);
				if (!onlyEmpty) {
					this.appendMessage(partial);
				} else {
					if (this.abortController?.signal.aborted) {
						throw new Error("Request was aborted");
					}
				}
			}
		} catch (err: any) {
			const errorMsg: AgentMessage = {
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
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: this.abortController?.signal.aborted ? "aborted" : "error",
				errorMessage: err?.message || String(err),
				timestamp: Date.now(),
			} as AgentMessage;

			this.appendMessage(errorMsg);
			this._state.error = err?.message || String(err);
			this.emit({ type: "agent_end", messages: [errorMsg] });
		} finally {
			this._state.isStreaming = false;
			this._state.streamMessage = null;
			this._state.pendingToolCalls = new Set<string>();
			this.abortController = undefined;
			this.resolveRunningPrompt?.();
			this.runningPrompt = undefined;
			this.resolveRunningPrompt = undefined;
		}
	}

	private emit(e: AgentEvent) {
		for (const listener of this.listeners) {
			listener(e);
		}
	}
}
