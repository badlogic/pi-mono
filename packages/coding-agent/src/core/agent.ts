/**
 * Agent class that wraps the agent-loop for state management.
 *
 * This class provides:
 * - State management for conversation history
 * - Event subscription for UI updates
 * - Message queuing (steering and follow-up)
 * - Abort handling
 */

import { type AgentContext, type AgentLoopConfig, agentLoop, agentLoopContinue } from "./agent-loop.js";
import type {
	AgentEvent,
	AgentMessage,
	AgentState,
	AgentTool,
	ImageContent,
	Message,
	Model,
	TextContent,
	ThinkingBudgets,
	ThinkingLevel,
} from "./ai-types.js";
import { getModel } from "./models.js";

/**
 * Default convertToLlm: Keep only LLM-compatible messages.
 */
function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
	return messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult") as Message[];
}

export interface AgentOptions {
	initialState?: Partial<AgentState>;

	/**
	 * Converts AgentMessage[] to LLM-compatible Message[] before each LLM call.
	 */
	convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

	/**
	 * Optional transform applied to context before convertToLlm.
	 */
	transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

	/**
	 * Steering mode: "all" = send all at once, "one-at-a-time" = one per turn
	 */
	steeringMode?: "all" | "one-at-a-time";

	/**
	 * Follow-up mode: "all" = send all at once, "one-at-a-time" = one per turn
	 */
	followUpMode?: "all" | "one-at-a-time";

	/**
	 * Optional session identifier.
	 */
	sessionId?: string;

	/**
	 * Dynamic API key resolution.
	 */
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;

	/**
	 * Custom token budgets for thinking levels.
	 */
	thinkingBudgets?: ThinkingBudgets;

	/**
	 * Maximum delay in milliseconds for server-requested retries.
	 */
	maxRetryDelayMs?: number;
}

export class Agent {
	private _state: AgentState = {
		systemPrompt: "",
		model: getModel("google", "gemini-2.5-flash-lite-preview-06-17")!,
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
	private steeringQueue: AgentMessage[] = [];
	private followUpQueue: AgentMessage[] = [];
	private steeringMode: "all" | "one-at-a-time";
	private followUpMode: "all" | "one-at-a-time";
	private _sessionId?: string;
	public getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	private runningPrompt?: Promise<void>;
	private resolveRunningPrompt?: () => void;
	private _thinkingBudgets?: ThinkingBudgets;
	private _maxRetryDelayMs?: number;

	constructor(opts: AgentOptions = {}) {
		if (opts.initialState) {
			this._state = { ...this._state, ...opts.initialState };
		}
		this.convertToLlm = opts.convertToLlm || defaultConvertToLlm;
		this.transformContext = opts.transformContext;
		this.steeringMode = opts.steeringMode || "one-at-a-time";
		this.followUpMode = opts.followUpMode || "one-at-a-time";
		this._sessionId = opts.sessionId;
		this.getApiKey = opts.getApiKey;
		this._thinkingBudgets = opts.thinkingBudgets;
		this._maxRetryDelayMs = opts.maxRetryDelayMs;
	}

	get sessionId(): string | undefined {
		return this._sessionId;
	}

	set sessionId(value: string | undefined) {
		this._sessionId = value;
	}

	get thinkingBudgets(): ThinkingBudgets | undefined {
		return this._thinkingBudgets;
	}

	set thinkingBudgets(value: ThinkingBudgets | undefined) {
		this._thinkingBudgets = value;
	}

	get maxRetryDelayMs(): number | undefined {
		return this._maxRetryDelayMs;
	}

	set maxRetryDelayMs(value: number | undefined) {
		this._maxRetryDelayMs = value;
	}

	get state(): AgentState {
		return this._state;
	}

	subscribe(fn: (e: AgentEvent) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	// State mutators
	setSystemPrompt(v: string): void {
		this._state.systemPrompt = v;
	}

	setModel(m: Model): void {
		this._state.model = m;
	}

	setThinkingLevel(l: ThinkingLevel): void {
		this._state.thinkingLevel = l;
	}

	setSteeringMode(mode: "all" | "one-at-a-time"): void {
		this.steeringMode = mode;
	}

	getSteeringMode(): "all" | "one-at-a-time" {
		return this.steeringMode;
	}

	setFollowUpMode(mode: "all" | "one-at-a-time"): void {
		this.followUpMode = mode;
	}

	getFollowUpMode(): "all" | "one-at-a-time" {
		return this.followUpMode;
	}

	setTools(t: AgentTool[]): void {
		this._state.tools = t;
	}

	replaceMessages(ms: AgentMessage[]): void {
		this._state.messages = ms.slice();
	}

	appendMessage(m: AgentMessage): void {
		this._state.messages = [...this._state.messages, m];
	}

	/**
	 * Queue a steering message to interrupt the agent mid-run.
	 */
	steer(m: AgentMessage): void {
		this.steeringQueue.push(m);
	}

	/**
	 * Queue a follow-up message to be processed after the agent finishes.
	 */
	followUp(m: AgentMessage): void {
		this.followUpQueue.push(m);
	}

	clearSteeringQueue(): void {
		this.steeringQueue = [];
	}

	clearFollowUpQueue(): void {
		this.followUpQueue = [];
	}

	clearAllQueues(): void {
		this.steeringQueue = [];
		this.followUpQueue = [];
	}

	clearMessages(): void {
		this._state.messages = [];
	}

	abort(): void {
		this.abortController?.abort();
	}

	waitForIdle(): Promise<void> {
		return this.runningPrompt ?? Promise.resolve();
	}

	reset(): void {
		this._state.messages = [];
		this._state.isStreaming = false;
		this._state.streamMessage = null;
		this._state.pendingToolCalls = new Set<string>();
		this._state.error = undefined;
		this.steeringQueue = [];
		this.followUpQueue = [];
	}

	/** Send a prompt with an AgentMessage */
	async prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
	async prompt(input: string, images?: ImageContent[]): Promise<void>;
	async prompt(input: string | AgentMessage | AgentMessage[], images?: ImageContent[]): Promise<void> {
		if (this._state.isStreaming) {
			throw new Error(
				"Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.",
			);
		}

		const model = this._state.model;
		if (!model) throw new Error("No model configured");

		let msgs: AgentMessage[];

		if (Array.isArray(input)) {
			msgs = input;
		} else if (typeof input === "string") {
			const content: Array<TextContent | ImageContent> = [{ type: "text", text: input }];
			if (images && images.length > 0) {
				content.push(...images);
			}
			msgs = [
				{
					role: "user",
					content,
					timestamp: Date.now(),
				},
			];
		} else {
			msgs = [input];
		}

		await this._runLoop(msgs);
	}

	/** Continue from current context (for retry after overflow) */
	async continue(): Promise<void> {
		if (this._state.isStreaming) {
			throw new Error("Agent is already processing. Wait for completion before continuing.");
		}

		const messages = this._state.messages;
		if (messages.length === 0) {
			throw new Error("No messages to continue from");
		}
		if (messages[messages.length - 1].role === "assistant") {
			throw new Error("Cannot continue from message role: assistant");
		}

		await this._runLoop(undefined);
	}

	private async _runLoop(messages?: AgentMessage[]): Promise<void> {
		const model = this._state.model;
		if (!model) throw new Error("No model configured");

		this.runningPrompt = new Promise<void>((resolve) => {
			this.resolveRunningPrompt = resolve;
		});

		this.abortController = new AbortController();
		this._state.isStreaming = true;
		this._state.streamMessage = null;
		this._state.error = undefined;

		const reasoning = this._state.thinkingLevel === "off" ? undefined : this._state.thinkingLevel;

		const context: AgentContext = {
			systemPrompt: this._state.systemPrompt,
			messages: this._state.messages.slice(),
			tools: this._state.tools,
		};

		const config: AgentLoopConfig = {
			model,
			reasoning,
			sessionId: this._sessionId,
			thinkingBudgets: this._thinkingBudgets,
			maxRetryDelayMs: this._maxRetryDelayMs,
			convertToLlm: this.convertToLlm,
			transformContext: this.transformContext,
			getApiKey: this.getApiKey,
			getSteeringMessages: async () => {
				if (this.steeringMode === "one-at-a-time") {
					if (this.steeringQueue.length > 0) {
						const first = this.steeringQueue[0];
						this.steeringQueue = this.steeringQueue.slice(1);
						return [first];
					}
					return [];
				} else {
					const steering = this.steeringQueue.slice();
					this.steeringQueue = [];
					return steering;
				}
			},
			getFollowUpMessages: async () => {
				if (this.followUpMode === "one-at-a-time") {
					if (this.followUpQueue.length > 0) {
						const first = this.followUpQueue[0];
						this.followUpQueue = this.followUpQueue.slice(1);
						return [first];
					}
					return [];
				} else {
					const followUp = this.followUpQueue.slice();
					this.followUpQueue = [];
					return followUp;
				}
			},
		};

		let partial: AgentMessage | null = null;

		try {
			const stream = messages
				? agentLoop(messages, context, config, this.abortController.signal)
				: agentLoopContinue(context, config, this.abortController.signal);

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
						if (event.message.role === "assistant" && (event.message as { errorMessage?: string }).errorMessage) {
							this._state.error = (event.message as { errorMessage?: string }).errorMessage;
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
			if (partial && partial.role === "assistant" && Array.isArray(partial.content) && partial.content.length > 0) {
				const onlyEmpty = !partial.content.some(
					(c: { type: string; thinking?: string; text?: string; name?: string }) =>
						(c.type === "thinking" && c.thinking?.trim().length) ||
						(c.type === "text" && c.text?.trim().length) ||
						(c.type === "toolCall" && c.name?.trim().length),
				);
				if (!onlyEmpty) {
					this.appendMessage(partial);
				} else {
					if (this.abortController?.signal.aborted) {
						throw new Error("Request was aborted");
					}
				}
			}
		} catch (err: unknown) {
			const error = err as Error;
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
				errorMessage: error?.message || String(err),
				timestamp: Date.now(),
			};

			this.appendMessage(errorMsg);
			this._state.error = error?.message || String(err);
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

	private emit(e: AgentEvent): void {
		for (const listener of this.listeners) {
			listener(e);
		}
	}
}
