import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../../src/poller/db/database-adapter.js";
import { Poller } from "../../src/poller/poller.js";
import type { IncomingMessage, Logger, PollerSettings } from "../../src/poller/types.js";

class FakeAgent {
	state = {
		isStreaming: false,
		model: { provider: "test", id: "m", api: "openai-responses", reasoning: false },
	};
	prompts: string[] = [];
	async prompt(input: string): Promise<void> {
		this.prompts.push(input);
	}
}

class FakeAdapter implements DatabaseAdapter {
	public queued: IncomingMessage[] = [];
	public claimed: Array<{ id: string; agentId: string; leaseUntil: number }> = [];
	public statuses: Array<{ id: string; status: "acked" | "done" | "failed" }> = [];
	async init(): Promise<void> {}
	async fetchQueued(): Promise<IncomingMessage[]> {
		return this.queued;
	}
	async claimMessage(id: string, agentId: string, leaseUntilMs: number): Promise<void> {
		this.claimed.push({ id, agentId, leaseUntil: leaseUntilMs });
	}
	async updateStatus(id: string, status: "acked" | "done" | "failed"): Promise<void> {
		this.statuses.push({ id, status });
	}
	async listInbox(): Promise<IncomingMessage[]> {
		return this.queued;
	}
}

function makeLogger(): Logger & {
	info: ReturnType<typeof vi.fn>;
	warn: ReturnType<typeof vi.fn>;
	error: ReturnType<typeof vi.fn>;
} {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

function defaultSettings(): PollerSettings {
	return {
		enabled: true,
		pollIntervalMs: 10,
		agentId: "agent",
		batchLimit: 10,
		leaseMs: 1000,
		backoff: { initialMs: 5, factor: 2, maxMs: 50, failureThreshold: 3 },
		options: { lruDedupSize: 10, autoProcessNext: false },
	};
}

function makeMessage(id: string): IncomingMessage {
	return {
		id,
		to_agent: "agent",
		from_agent: "sender",
		type: "task",
		status: "queued",
	};
}

describe("Poller", () => {
	let agent: FakeAgent;
	let adapter: FakeAdapter;
	let settings: PollerSettings;
	let logger: Logger;

	beforeEach(() => {
		agent = new FakeAgent();
		adapter = new FakeAdapter();
		settings = defaultSettings();
		logger = makeLogger();
	});

	it("claims and enqueues when idle", async () => {
		adapter.queued = [makeMessage("1")];
		const poller = new Poller(agent as any, adapter, settings, logger);
		await poller.init();

		await (poller as any).tick();

		expect(adapter.claimed).toHaveLength(1);
		expect(agent.prompts).toHaveLength(1);
		expect(poller.getInboxCount()).toBe(1);
	});

	it("skips when streaming", async () => {
		agent.state.isStreaming = true;
		adapter.queued = [makeMessage("1")];
		const poller = new Poller(agent as any, adapter, settings, logger);
		await poller.init();

		await (poller as any).tick();

		expect(adapter.claimed).toHaveLength(0);
		expect(agent.prompts).toHaveLength(0);
	});

	it("deduplicates ids when lru enabled", async () => {
		settings.options!.lruDedupSize = 1;
		adapter.queued = [makeMessage("1"), makeMessage("1")];
		const poller = new Poller(agent as any, adapter, settings, logger);
		await poller.init();

		await (poller as any).tick();

		expect(adapter.claimed).toHaveLength(1);
	});

	it("updates status and decrements inbox count", async () => {
		adapter.queued = [makeMessage("1")];
		const poller = new Poller(agent as any, adapter, settings, logger);
		await poller.init();
		await (poller as any).tick();
		expect(poller.getInboxCount()).toBe(1);

		await poller.updateStatus("1", "done");
		expect(adapter.statuses).toEqual([{ id: "1", status: "done" }]);
		expect(poller.getInboxCount()).toBe(0);
	});

	it("emits inboxIncrement events for claims and acks", async () => {
		const deltas: number[] = [];
		adapter.queued = [makeMessage("1")];
		const poller = new Poller(agent as any, adapter, settings, logger);
		poller.events.on("inboxIncrement", (delta) => deltas.push(delta));
		await poller.init();

		await (poller as any).tick();
		await poller.updateStatus("1", "acked");

		expect(deltas).toContain(1);
		expect(deltas).toContain(-1);
	});

	it("applies backoff and logs degraded after repeated failures", async () => {
		const failingAdapter: DatabaseAdapter = {
			init: async () => {},
			fetchQueued: async () => {
				throw new Error("db down");
			},
			claimMessage: async () => {},
			updateStatus: async () => {},
			listInbox: async () => [],
		};
		const poller = new Poller(agent as any, failingAdapter, settings, logger);
		await poller.init();

		await (poller as any).tick();
		await (poller as any).tick();
		await (poller as any).tick();

		const warns = (logger as ReturnType<typeof makeLogger>).warn.mock.calls.map((args) => args[0] as string);
		expect(warns.some((msg) => msg.includes("degraded after"))).toBe(true);
	});
});
