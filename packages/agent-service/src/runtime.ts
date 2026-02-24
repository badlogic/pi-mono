import { randomUUID } from "node:crypto";
import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AgentSession, AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import { modelNotFoundError, sessionBusyError } from "./errors.js";
import type {
	RuntimeForkResult,
	RuntimeNavigateResult,
	RuntimeNewSessionResult,
	RuntimePromptResult,
	RuntimeState,
	RuntimeSwitchSessionResult,
	SessionEventEnvelope,
} from "./types.js";

export interface AvailableModel {
	provider: string;
	modelId: string;
}

export interface AgentSessionBackend {
	prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp"; source?: "rpc" }): Promise<void>;
	steer(text: string): Promise<void>;
	followUp(text: string): Promise<void>;
	abort(): Promise<void>;
	setModel(provider: string, modelId: string): Promise<void>;
	setThinkingLevel(level: ThinkingLevel): void;
	newSession(options?: { parentSession?: string }): Promise<boolean>;
	switchSession(sessionPath: string): Promise<boolean>;
	fork(entryId: string): Promise<{ selectedText: string; cancelled: boolean }>;
	navigateTree(options: {
		targetId: string;
		summarize?: boolean;
		customInstructions?: string;
		replaceInstructions?: boolean;
		label?: string;
	}): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntryId?: string }>;
	getState(): RuntimeState;
	getMessages(): AgentMessage[];
	getAvailableModels(): Promise<AvailableModel[]>;
	subscribe(listener: (event: AgentSessionEvent) => void): () => void;
	dispose(): void;
}

export class CodingAgentSessionBackend implements AgentSessionBackend {
	private readonly session: AgentSession;

	constructor(session: AgentSession) {
		this.session = session;
	}

	prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp"; source?: "rpc" }): Promise<void> {
		return this.session.prompt(text, options);
	}

	steer(text: string): Promise<void> {
		return this.session.steer(text);
	}

	followUp(text: string): Promise<void> {
		return this.session.followUp(text);
	}

	abort(): Promise<void> {
		return this.session.abort();
	}

	async setModel(provider: string, modelId: string): Promise<void> {
		const models = await this.session.modelRegistry.getAvailable();
		const model = models.find((candidate) => candidate.provider === provider && candidate.id === modelId);
		if (!model) {
			throw modelNotFoundError(provider, modelId);
		}
		await this.session.setModel(model);
	}

	setThinkingLevel(level: ThinkingLevel): void {
		this.session.setThinkingLevel(level);
	}

	async newSession(options?: { parentSession?: string }): Promise<boolean> {
		return this.session.newSession(options);
	}

	switchSession(sessionPath: string): Promise<boolean> {
		return this.session.switchSession(sessionPath);
	}

	fork(entryId: string): Promise<{ selectedText: string; cancelled: boolean }> {
		return this.session.fork(entryId);
	}

	async navigateTree(options: {
		targetId: string;
		summarize?: boolean;
		customInstructions?: string;
		replaceInstructions?: boolean;
		label?: string;
	}): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntryId?: string }> {
		const result = await this.session.navigateTree(options.targetId, {
			summarize: options.summarize,
			customInstructions: options.customInstructions,
			replaceInstructions: options.replaceInstructions,
			label: options.label,
		});
		return {
			editorText: result.editorText,
			cancelled: result.cancelled,
			aborted: result.aborted,
			summaryEntryId: result.summaryEntry?.id,
		};
	}

	getState(): RuntimeState {
		return {
			sessionId: this.session.sessionId,
			sessionFile: this.session.sessionFile,
			sessionName: this.session.sessionName,
			modelProvider: this.session.model?.provider,
			modelId: this.session.model?.id,
			thinkingLevel: this.session.thinkingLevel,
			isStreaming: this.session.isStreaming,
			isCompacting: this.session.isCompacting,
			pendingMessageCount: this.session.pendingMessageCount,
			messageCount: this.session.messages.length,
			isBusy: false,
		};
	}

	getMessages(): AgentMessage[] {
		return this.session.messages;
	}

	async getAvailableModels(): Promise<AvailableModel[]> {
		const models = await this.session.modelRegistry.getAvailable();
		return models.map((model) => ({ provider: model.provider, modelId: model.id }));
	}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		return this.session.subscribe(listener);
	}

	dispose(): void {
		this.session.dispose();
	}
}

export type RuntimeEventListener = (event: SessionEventEnvelope) => void;

export class AgentRuntime {
	readonly id: string;
	private readonly backend: AgentSessionBackend;
	private readonly listeners: Set<RuntimeEventListener> = new Set();
	private readonly unsubscribeBackend: () => void;
	private seq = 0;
	private runId = randomUUID();
	private activePrompt: Promise<void> | undefined;
	private abortInFlight: Promise<void> | undefined;

	constructor(id: string, backend: AgentSessionBackend) {
		this.id = id;
		this.backend = backend;
		this.unsubscribeBackend = this.backend.subscribe((event) => {
			this.emit(event);
		});
	}

	prompt(text: string, options?: { streamingBehavior?: "steer" | "followUp" }): RuntimePromptResult {
		if (this.activePrompt) {
			throw sessionBusyError();
		}

		const nextRunId = randomUUID();
		this.runId = nextRunId;

		const promptPromise = this.backend
			.prompt(text, {
				streamingBehavior: options?.streamingBehavior,
				source: "rpc",
			})
			.catch(() => {})
			.finally(() => {
				if (this.activePrompt === promptPromise) {
					this.activePrompt = undefined;
				}
			});

		this.activePrompt = promptPromise;
		return { runId: nextRunId };
	}

	steer(text: string): Promise<void> {
		return this.backend.steer(text);
	}

	followUp(text: string): Promise<void> {
		return this.backend.followUp(text);
	}

	async abort(): Promise<void> {
		if (this.abortInFlight) {
			await this.abortInFlight;
			return;
		}

		const currentAbort = this.backend.abort().finally(() => {
			if (this.abortInFlight === currentAbort) {
				this.abortInFlight = undefined;
			}
			this.activePrompt = undefined;
		});

		this.abortInFlight = currentAbort;
		await currentAbort;
	}

	async setModel(provider: string, modelId: string): Promise<void> {
		const available = await this.backend.getAvailableModels();
		const exists = available.some((model) => model.provider === provider && model.modelId === modelId);
		if (!exists) {
			throw modelNotFoundError(provider, modelId);
		}
		await this.backend.setModel(provider, modelId);
	}

	setThinkingLevel(level: ThinkingLevel): void {
		this.backend.setThinkingLevel(level);
	}

	async newSession(options?: { parentSession?: string }): Promise<RuntimeNewSessionResult> {
		const success = await this.backend.newSession(options);
		return { cancelled: !success };
	}

	async switchSession(sessionPath: string): Promise<RuntimeSwitchSessionResult> {
		const success = await this.backend.switchSession(sessionPath);
		return { cancelled: !success };
	}

	async fork(entryId: string): Promise<RuntimeForkResult> {
		const result = await this.backend.fork(entryId);
		return {
			selectedText: result.selectedText,
			cancelled: result.cancelled,
		};
	}

	async navigateTree(options: {
		targetId: string;
		summarize?: boolean;
		customInstructions?: string;
		replaceInstructions?: boolean;
		label?: string;
	}): Promise<RuntimeNavigateResult> {
		const result = await this.backend.navigateTree(options);
		return {
			editorText: result.editorText,
			cancelled: result.cancelled,
			aborted: result.aborted,
			summaryEntryId: result.summaryEntryId,
		};
	}

	subscribe(listener: RuntimeEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	getState(): RuntimeState {
		const base = this.backend.getState();
		return {
			...base,
			activeRunId: this.runId,
			isBusy: this.activePrompt !== undefined,
		};
	}

	getMessages(): AgentMessage[] {
		return this.backend.getMessages();
	}

	dispose(): void {
		this.unsubscribeBackend();
		this.listeners.clear();
		this.backend.dispose();
	}

	private emit(event: AgentSessionEvent): void {
		const envelope: SessionEventEnvelope = {
			seq: ++this.seq,
			sessionId: this.id,
			runId: this.runId,
			ts: new Date().toISOString(),
			event,
		};
		for (const listener of this.listeners) {
			listener(envelope);
		}
	}
}

export interface RuntimeFactoryInput {
	backend: AgentSessionBackend;
}

export function createRuntime(input: RuntimeFactoryInput): AgentRuntime {
	return new AgentRuntime(randomUUID(), input.backend);
}
