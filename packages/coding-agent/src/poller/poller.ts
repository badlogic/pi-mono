import type { Agent } from "@mariozechner/pi-agent-core";
import type { DatabaseAdapter } from "./db/database-adapter.js";
import type { IncomingMessage, PollerOptions, PollerSettings } from "./types.js";

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_BATCH_LIMIT = 25;
const DEFAULT_LEASE_MS = 120_000;
const DEFAULT_BACKOFF_INITIAL = 1000;
const DEFAULT_BACKOFF_FACTOR = 2;
const DEFAULT_BACKOFF_MAX = 30_000;
const DEFAULT_BACKOFF_THRESHOLD = 3;

type StatusChange = (count: number) => void;

export class Poller {
	private readonly agent: Agent;
	private readonly adapter: DatabaseAdapter;
	private readonly options: PollerOptions;
	private settings: Required<PollerSettings>;
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
	private onInboxChange?: StatusChange;

	constructor(agent: Agent, adapter: DatabaseAdapter, settings: PollerSettings, onInboxChange?: StatusChange) {
		this.agent = agent;
		this.adapter = adapter;
		this.settings = this.applyDefaults(settings);
		this.options = this.settings.options ?? {};
		this.backoffMs = this.settings.backoff.initialMs ?? DEFAULT_BACKOFF_INITIAL;
		this.onInboxChange = onInboxChange;
	}

	async init(): Promise<void> {
		await this.adapter.init();
	}

	start(): void {
		this.stopped = false;
		if (!this.settings.enabled) return;
		if (this.timer) return;
		this.scheduleNext(this.settings.pollIntervalMs);
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}

	setEnabled(enabled: boolean): void {
		this.settings.enabled = enabled;
		if (enabled) {
			this.start();
		} else {
			this.stop();
		}
	}

	setIntervalMs(ms: number): void {
		this.settings.pollIntervalMs = ms;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
			this.scheduleNext(ms);
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
			this.emitInboxChange();
		}
	}

	private applyDefaults(settings: PollerSettings): Required<PollerSettings> {
		return {
			enabled: settings.enabled ?? false,
			pollIntervalMs: settings.pollIntervalMs ?? DEFAULT_INTERVAL_MS,
			agentId: settings.agentId ?? "default-agent",
			batchLimit: settings.batchLimit ?? DEFAULT_BATCH_LIMIT,
			leaseMs: settings.leaseMs ?? DEFAULT_LEASE_MS,
			backoff: {
				initialMs: settings.backoff?.initialMs ?? DEFAULT_BACKOFF_INITIAL,
				factor: settings.backoff?.factor ?? DEFAULT_BACKOFF_FACTOR,
				maxMs: settings.backoff?.maxMs ?? DEFAULT_BACKOFF_MAX,
				failureThreshold: settings.backoff?.failureThreshold ?? DEFAULT_BACKOFF_THRESHOLD,
			},
			options: {
				lruDedupSize: settings.options?.lruDedupSize ?? 0,
				autoProcessNext: settings.options?.autoProcessNext ?? false,
			},
			backend: settings.backend ?? "http",
			http: settings.http ?? { baseUrl: "" },
			arango: settings.arango ?? {
				url: "",
				database: "",
				messagesCollection: "",
			},
		};
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
			if (this.agent.state.isStreaming) {
				return;
			}

			const queued = await this.adapter.fetchQueued(this.settings.agentId, this.settings.batchLimit);
			const leaseMs = this.settings.leaseMs;

			let claimed = 0;
			for (const msg of queued) {
				if (this.isDuplicate(msg.id)) {
					continue;
				}

				const leaseUntil = Date.now() + leaseMs;
				await this.adapter.claimMessage(msg.id, this.settings.agentId, leaseUntil);
				this.remember(msg.id);
				this.pending.push(msg);
				claimed += 1;
			}

			if (claimed > 0) {
				this.inboxCount += claimed;
				this.emitInboxChange();
				console.log(`[poller] Inbox: +${claimed} new item(s). Use /poll to list.`);
				void this.drainPending();
			}

			this.resetBackoff();
		} catch (error) {
			this.consecutiveFailures += 1;
			this.backoffMs = Math.min(
				this.backoffMs * (this.settings.backoff.factor ?? DEFAULT_BACKOFF_FACTOR),
				this.settings.backoff.maxMs ?? DEFAULT_BACKOFF_MAX,
			);
			nextDelay = this.backoffMs;
			const threshold = this.settings.backoff.failureThreshold ?? DEFAULT_BACKOFF_THRESHOLD;
			if (this.consecutiveFailures >= threshold && !this.degradedNotified) {
				console.log(
					`[poller] Degraded: backend unreachable. Backing off up to ${
						this.settings.backoff.maxMs ?? DEFAULT_BACKOFF_MAX
					}ms.`,
				);
				this.degradedNotified = true;
			}
			console.error(`[poller] Error while polling: ${error instanceof Error ? error.message : String(error)}`);
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
			while (!this.stopped && !this.agent.state.isStreaming && this.pending.length > 0) {
				const msg = this.pending.shift();
				if (!msg) break;
				try {
					await this.processMessage(msg);
				} catch (error) {
					console.error(
						`[poller] Failed to process message ${msg.id}: ${
							error instanceof Error ? error.message : String(error)
						}`,
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
			"- Inspect the payload or payload_ref",
			"- Perform the required action",
			"- Mark the message status via /poll ack|done|failed",
		].join("\n");

		if (!this.agent.state.model) {
			console.log("[poller] Skipping message because no model is selected.");
			return;
		}

		await this.agent.prompt(prompt);
	}

	private buildPayloadHint(msg: IncomingMessage): string {
		if (msg.payload_ref) {
			return `Payload reference: ${msg.payload_ref}`;
		}
		if (msg.payload !== undefined) {
			return "Payload inline JSON attached.";
		}
		return "No payload provided.";
	}

	private resetBackoff(): void {
		if (this.consecutiveFailures === 0 && !this.degradedNotified) return;
		if (this.degradedNotified) {
			console.log("[poller] Recovered: backend reachable again.");
		}
		this.degradedNotified = false;
		this.consecutiveFailures = 0;
		this.backoffMs = this.settings.backoff.initialMs ?? DEFAULT_BACKOFF_INITIAL;
	}

	private isDuplicate(id: string): boolean {
		const max = this.options.lruDedupSize ?? 0;
		if (max <= 0) return false;
		return this.dedupIds.includes(id);
	}

	private remember(id: string): void {
		const max = this.options.lruDedupSize ?? 0;
		if (max <= 0) return;
		this.dedupIds.push(id);
		if (this.dedupIds.length > max) {
			this.dedupIds.shift();
		}
	}

	private emitInboxChange(): void {
		if (this.onInboxChange) {
			this.onInboxChange(this.inboxCount);
		}
	}
}
