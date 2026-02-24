import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import type { AgentSessionBackend, AvailableModel } from "../src/runtime.js";
import type { RuntimeState } from "../src/types.js";

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

export class TestBackend implements AgentSessionBackend {
	private listeners: Set<(event: AgentSessionEvent) => void> = new Set();
	private promptDeferred: { promise: Promise<void>; resolve: () => void } | undefined;
	private abortDeferred: { promise: Promise<void>; resolve: () => void } | undefined;

	readonly steerCalls: string[] = [];
	readonly followUpCalls: string[] = [];
	readonly modelCalls: Array<{ provider: string; modelId: string }> = [];
	readonly switchCalls: string[] = [];
	readonly forkCalls: string[] = [];
	readonly navigateCalls: string[] = [];
	readonly messages: AgentMessage[] = [];

	state: RuntimeState = {
		sessionId: "session-local",
		sessionFile: "/tmp/session.jsonl",
		sessionName: "test-session",
		modelProvider: "openai",
		modelId: "gpt-test",
		thinkingLevel: "medium",
		isStreaming: false,
		isCompacting: false,
		pendingMessageCount: 0,
		messageCount: 0,
		isBusy: false,
	};

	availableModels: AvailableModel[] = [{ provider: "openai", modelId: "gpt-test" }];
	newSessionResult = true;
	switchSessionResult = true;
	forkResult = { selectedText: "forked", cancelled: false };
	navigateResult = { editorText: "editor", cancelled: false, aborted: false, summaryEntryId: "sum-1" };
	abortCallCount = 0;

	prompt(_text: string): Promise<void> {
		this.state.isStreaming = true;
		this.emit({ type: "agent_start" });
		this.promptDeferred = createDeferred();
		return this.promptDeferred.promise.then(() => {
			this.state.isStreaming = false;
			this.emit({ type: "agent_end", messages: [] });
		});
	}

	completePrompt(): void {
		if (this.promptDeferred) {
			this.promptDeferred.resolve();
			this.promptDeferred = undefined;
		}
	}

	steer(text: string): Promise<void> {
		this.steerCalls.push(text);
		return Promise.resolve();
	}

	followUp(text: string): Promise<void> {
		this.followUpCalls.push(text);
		return Promise.resolve();
	}

	abort(): Promise<void> {
		this.abortCallCount += 1;
		if (!this.abortDeferred) {
			this.abortDeferred = createDeferred();
		}
		return this.abortDeferred.promise.then(() => {
			this.completePrompt();
		});
	}

	completeAbort(): void {
		if (this.abortDeferred) {
			this.abortDeferred.resolve();
			this.abortDeferred = undefined;
		}
	}

	setModel(provider: string, modelId: string): Promise<void> {
		this.modelCalls.push({ provider, modelId });
		this.state.modelProvider = provider;
		this.state.modelId = modelId;
		return Promise.resolve();
	}

	setThinkingLevel(level: ThinkingLevel): void {
		this.state.thinkingLevel = level;
	}

	newSession(): Promise<boolean> {
		return Promise.resolve(this.newSessionResult);
	}

	switchSession(sessionPath: string): Promise<boolean> {
		this.switchCalls.push(sessionPath);
		return Promise.resolve(this.switchSessionResult);
	}

	fork(entryId: string): Promise<{ selectedText: string; cancelled: boolean }> {
		this.forkCalls.push(entryId);
		return Promise.resolve(this.forkResult);
	}

	navigateTree(options: {
		targetId: string;
		summarize?: boolean;
		customInstructions?: string;
		replaceInstructions?: boolean;
		label?: string;
	}): Promise<{ editorText?: string; cancelled: boolean; aborted?: boolean; summaryEntryId?: string }> {
		this.navigateCalls.push(options.targetId);
		return Promise.resolve(this.navigateResult);
	}

	getState(): RuntimeState {
		return { ...this.state };
	}

	getMessages(): AgentMessage[] {
		return [...this.messages];
	}

	getAvailableModels(): Promise<AvailableModel[]> {
		return Promise.resolve([...this.availableModels]);
	}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	dispose(): void {}

	emit(event: AgentSessionEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}
