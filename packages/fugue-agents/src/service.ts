import type { EventBus } from "@fugue/events";
import type { DrizzleDb } from "@fugue/graph";
import { type RunnerOptions, runAgent } from "./runner.js";

// ─── AgentService ─────────────────────────────────────────────────────────────

/**
 * Manages in-flight agent runs.
 *
 * Each spawned agent gets an AbortController so it can be cancelled.
 * The service tracks running agents and cleans up on completion.
 */
export class AgentService {
	private readonly running = new Map<string, AbortController>();

	constructor(
		private readonly db: DrizzleDb,
		private readonly bus: EventBus,
		private readonly options: RunnerOptions = {},
	) {}

	/**
	 * Start an agent run asynchronously.
	 * Returns immediately; the agent runs in the background.
	 * No-op if the agent is already running.
	 */
	start(agentId: string): void {
		if (this.running.has(agentId)) return;

		const controller = new AbortController();
		this.running.set(agentId, controller);

		runAgent(agentId, this.db, this.bus, controller.signal, this.options).finally(() => {
			this.running.delete(agentId);
		});
	}

	/**
	 * Abort a running agent. No-op if not running.
	 * The status will be updated to 'aborted' by the runner on signal receipt.
	 */
	abort(agentId: string): void {
		const controller = this.running.get(agentId);
		if (controller) controller.abort();
	}

	/** True if the agent is currently executing. */
	isRunning(agentId: string): boolean {
		return this.running.has(agentId);
	}

	/** IDs of all currently running agents. */
	runningIds(): string[] {
		return Array.from(this.running.keys());
	}

	/** Abort all running agents (e.g., on server shutdown). */
	abortAll(): void {
		for (const controller of this.running.values()) controller.abort();
		this.running.clear();
	}
}
