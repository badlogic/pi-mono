import type { FugueEvent } from "@fugue/shared";
import type { Pool } from "pg";

// ─── EventBus Interface ───────────────────────────────────────────────────────

export type EventHandler<T extends FugueEvent = FugueEvent> = (event: T) => void;

export interface EventBus {
	/**
	 * Publish an event. Delivery is fire-and-forget (no await needed by callers
	 * when using the in-memory implementation; pgmq implementation enqueues durably).
	 */
	publish(event: FugueEvent): Promise<void>;

	/**
	 * Subscribe to events. Returns an unsubscribe function.
	 * If `eventType` is omitted, the handler receives all events.
	 */
	subscribe(handler: EventHandler, eventType?: string): () => void;

	/**
	 * Drain all pending subscriptions (for graceful shutdown).
	 */
	close(): Promise<void>;
}

// ─── In-Memory Event Bus (unit tests + single-process use) ───────────────────

export class InMemoryEventBus implements EventBus {
	private readonly handlers: Map<string | null, Set<EventHandler>> = new Map();

	async publish(event: FugueEvent): Promise<void> {
		const specific = this.handlers.get(event.type) ?? new Set();
		const wildcard = this.handlers.get(null) ?? new Set();

		const all = [...specific, ...wildcard];
		await Promise.all(all.map((h) => h(event)));
	}

	subscribe(handler: EventHandler, eventType?: string): () => void {
		const key = eventType ?? null;
		if (!this.handlers.has(key)) {
			this.handlers.set(key, new Set());
		}
		this.handlers.get(key)!.add(handler);
		return () => {
			this.handlers.get(key)?.delete(handler);
		};
	}

	async close(): Promise<void> {
		this.handlers.clear();
	}
}

// ─── pgmq Event Bus (production — requires pgmq extension in Postgres) ────────

const QUEUE_NAME = "fugue_events";

/**
 * Durable event bus backed by pgmq (PostgreSQL Message Queue).
 * Events are enqueued with `pgmq.send()` and dequeued by background workers.
 *
 * pgmq provides:
 *  - At-least-once delivery
 *  - Visibility timeout for in-flight messages
 *  - Dead-letter queue on repeated failure
 *
 * To use: install pgmq extension (`CREATE EXTENSION pgmq`) and call `setup()` once.
 */
export class PgmqEventBus implements EventBus {
	private readonly pool: Pool;
	private readonly localBus: InMemoryEventBus;
	private pollTimer: NodeJS.Timeout | null = null;
	private closed = false;

	constructor(pool: Pool) {
		this.pool = pool;
		this.localBus = new InMemoryEventBus();
	}

	/**
	 * Create the pgmq queue if it does not exist. Call once on startup.
	 */
	async setup(): Promise<void> {
		const client = await this.pool.connect();
		try {
			await client.query(`SELECT pgmq.create($1)`, [QUEUE_NAME]);
		} catch (err: unknown) {
			// Queue already exists — pgmq.create is idempotent on newer versions
			// but may throw on older; ignore duplicate errors.
			const msg = String(err);
			if (!msg.includes("already exists") && !msg.includes("duplicate")) {
				throw err;
			}
		} finally {
			client.release();
		}
	}

	async publish(event: FugueEvent): Promise<void> {
		// Write to pgmq for durability; also deliver locally for same-process subscribers.
		const client = await this.pool.connect();
		try {
			await client.query(`SELECT pgmq.send($1, $2::jsonb)`, [QUEUE_NAME, JSON.stringify(event)]);
		} finally {
			client.release();
		}
		await this.localBus.publish(event);
	}

	subscribe(handler: EventHandler, eventType?: string): () => void {
		return this.localBus.subscribe(handler, eventType);
	}

	/**
	 * Start polling pgmq for events on the given interval (ms).
	 * This is used by worker processes that need to process events from the queue.
	 */
	startPolling(intervalMs = 500): void {
		if (this.pollTimer) return;
		const poll = async () => {
			if (this.closed) return;
			const client = await this.pool.connect();
			try {
				const res = await client.query<{ msg_id: string; message: FugueEvent }>(
					`SELECT msg_id, message FROM pgmq.read($1, 30, 10)`,
					[QUEUE_NAME],
				);
				for (const row of res.rows) {
					try {
						await this.localBus.publish(row.message);
						await client.query(`SELECT pgmq.delete($1, $2)`, [QUEUE_NAME, row.msg_id]);
					} catch {
						// Leave in queue for retry (visibility timeout will re-surface it)
					}
				}
			} finally {
				client.release();
			}
		};

		const run = async () => {
			await poll().catch(() => {});
			if (!this.closed) {
				this.pollTimer = setTimeout(run, intervalMs);
			}
		};
		this.pollTimer = setTimeout(run, 0);
	}

	async close(): Promise<void> {
		this.closed = true;
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}
		await this.localBus.close();
	}
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create an in-memory event bus (for tests or single-process MVP use).
 */
export function createInMemoryBus(): InMemoryEventBus {
	return new InMemoryEventBus();
}

/**
 * Create a pgmq-backed durable event bus (for production).
 */
export function createPgmqBus(pool: Pool): PgmqEventBus {
	return new PgmqEventBus(pool);
}
