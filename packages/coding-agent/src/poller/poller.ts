import type { Agent } from "@mariozechner/pi-agent-core";
import type { DatabaseAdapter } from "./db/database-adapter.js";
import type { IncomingMessage, Logger, PollerEvents, PollerOptions, PollerSettings } from "./types.js";

const DEFAULT_BATCH_LIMIT = 25;
const DEFAULT_LEASE_MS = 120_000;

class SimpleEvents implements PollerEvents {
	private listeners: { inboxIncrement: Array<(delta: number) => void> } = { inboxIncrement: [] };
	on(event: "inboxIncrement", listener: (delta: number) => void): void {
		this.listeners[event].push(listener);
	}
	emit(event: "inboxIncrement", delta: number): void {
		for (const fn of this.listeners[event]) fn(delta);
	}
}

export class Poller {
	private readonly agent: Agent;
	private readonly adapter: DatabaseAdapter;
	private readonly options: PollerOptions;
	private readonly logger: Logger;
	private readonly eventsImpl = new SimpleEvents();

	private timer: NodeJS.Timeout | null = null;
	private running = false;
	private stopped = false;
	private consecutiveFailures = 0;
	private backoffMs: number;
	private degradedNotified = false;
	private inboxCount = 0;

	private readonly dedupIds: string[] = [];
	private readonly pending: IncomingMessage[] = [];
	private processing = false;

	constructor(agent: Agent, adapter: DatabaseAdapter, settings: PollerSettings, logger: Logger) {
		this.agent = agent;
		this.adapter = adapter;
		this.settings = settings;
		this.logger = logger;
		this.options = settings.options ?? {};
		this.backoffMs = settings.backoff.initialMs;
	}

	private settings: PollerSettings;

	get events(): PollerEvents {
		return this.eventsImpl;
	}

	async init(): Promise<void> {
		await this.adapter.init();
	}

	start(): void {
		this.stopped = false;
		if (!this.settings.enabled) return;
		if (this.timer) return;
		this.scheduleNext(this.settings.pollIntervalMs);
		this.logger.info("[poller] started");
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
			this.logger.info("[poller] stopped");
		}
	}

	setEnabled(enabled: boolean): void {
		this.settings.enabled = enabled;
		enabled ? this.start() : this.stop();
	}

	setIntervalMs(ms: number): void {
		this.settings.pollIntervalMs = ms;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
			this.scheduleNext(ms);
			this.logger.info(`[poller] interval set to ${ms}ms`);
		}
	}

	isEnabled(): boolean {
		return this.settings.enabled;
	}

	getInboxCount(): number {
		return this.inboxCount;
	}

	async listInbox(limit = 50): Promise<IncomingMessage[]> {
		return this.adapter.listInbox(this.settings.agentId, limit);
	}

	async updateStatus(id: string, status: "acked" | "done" | "failed"): Promise<void> {
		await this.adapter.updateStatus(id, status);
		if (status === "acked" || status === "done") {
			this.inboxCount = Math.max(0, this.inboxCount - 1);
			this.eventsImpl.emit("inboxIncrement", -1);
		}
		this.logger.info(`[poller] status ${status} for ${id} (inbox=${this.inboxCount})`);
	}

	private isIdle(): boolean {
		type AgentLike = { state?: { isStreaming?: boolean } };
		const agentLike = this.agent as unknown as AgentLike;
		return !agentLike.state?.isStreaming;
	}

	private scheduleNext(delayMs: number): void {
		if (this.stopped) return;
		this.timer = setTimeout(() => void this.tick(), delayMs);
	}

	private async tick(): Promise<void> {
		if (this.running || this.stopped || !this.settings.enabled) return;
		this.running = true;
		let nextDelay = this.settings.pollIntervalMs;

		try {
			if (!this.isIdle()) return;

			const queued = await this.adapter.fetchQueued(
				this.settings.agentId,
				this.settings.batchLimit ?? DEFAULT_BATCH_LIMIT,
			);
			if (!queued.length) {
				this.resetBackoff();
				return;
			}

			const leaseMs = this.settings.leaseMs ?? DEFAULT_LEASE_MS;
			let claimed = 0;

			for (const msg of queued) {
				if (this.isDuplicate(msg.id)) continue;
				const leaseUntil = Date.now() + leaseMs;
				try {
					await this.adapter.claimMessage(msg.id, this.settings.agentId, leaseUntil);
				} catch (err) {
					this.logger.warn(`[poller] claim failed for ${msg.id}: ${(err as Error).message}`);
					continue;
				}
				this.remember(msg.id);
				this.pending.push(msg);
				claimed += 1;
			}

			if (claimed > 0) {
				this.inboxCount += claimed;
				this.eventsImpl.emit("inboxIncrement", claimed);
				this.logger.info(`[poller] Inbox: +${claimed} (total ${this.inboxCount})`);
				void this.drainPending();
			}

			this.resetBackoff();
		} catch (error) {
			const err = error as Error;
			this.handleFailure(err);
			nextDelay = this.backoffMs;
		} finally {
			this.running = false;
			if (!this.stopped) {
				this.scheduleNext(nextDelay);
			}
		}
	}

	private async drainPending(): Promise<void> {
		if (this.processing) return;
		this.processing = true;
		try {
			while (!this.stopped && this.isIdle() && this.pending.length > 0) {
				const msg = this.pending.shift();
				if (!msg) break;
				try {
					await this.processMessage(msg);
				} catch (err) {
					this.logger.warn(
						`[poller] Failed to process message ${msg.id}: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			}
		} finally {
			this.processing = false;
		}
	}

	private async processMessage(msg: IncomingMessage): Promise<void> {
		const title = `Incoming ${msg.type} from ${msg.from_agent}`;
		const correlation = msg.correlation_id ? ` (corr=${msg.correlation_id})` : "";
		const payloadHint = this.buildPayloadHint(msg);
		const prompt = [
			`[System] ${title}${correlation}`,
			payloadHint,
			"Instructions:",
			"- Review payload",
			"- Perform the required action",
			"- Mark status via /poll ack|done|failed",
		].join("\n");

		if (!this.agent.state.model) {
			this.logger.warn("[poller] Skipping message because no model is selected.");
			return;
		}

		await this.agent.prompt(prompt);
	}

	private buildPayloadHint(msg: IncomingMessage): string {
		if (msg.payload_ref) return `Payload reference: ${msg.payload_ref}`;
		if (msg.payload !== undefined) return "Inline payload present.";
		return "No payload provided.";
	}

	private isDuplicate(id: string): boolean {
		const max = this.options.lruDedupSize ?? 0;
		return max > 0 && this.dedupIds.includes(id);
	}

	private remember(id: string): void {
		const max = this.options.lruDedupSize ?? 0;
		if (max <= 0) return;
		this.dedupIds.push(id);
		if (this.dedupIds.length > max) {
			this.dedupIds.shift();
		}
	}

	private handleFailure(err: Error): void {
		this.consecutiveFailures += 1;
		this.backoffMs = Math.min(this.backoffMs * this.settings.backoff.factor, this.settings.backoff.maxMs);
		if (this.consecutiveFailures >= this.settings.backoff.failureThreshold && !this.degradedNotified) {
			this.logger.warn(
				`[poller] degraded after ${this.consecutiveFailures} failures; backing off to ${this.backoffMs}ms`,
			);
			this.degradedNotified = true;
		}
		this.logger.warn(`[poller] tick failure: ${err.message}`);
	}

	private resetBackoff(): void {
		if (this.consecutiveFailures === 0 && !this.degradedNotified) return;
		this.consecutiveFailures = 0;
		this.backoffMs = this.settings.backoff.initialMs;
		if (this.degradedNotified) {
			this.logger.info("[poller] recovered (backend reachable)");
			this.degradedNotified = false;
		}
	}
}
