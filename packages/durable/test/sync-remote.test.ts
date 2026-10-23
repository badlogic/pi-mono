import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { afterEach, describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../src/env/node.ts";
import { seqFromNumber } from "../src/ids.ts";
import { MemoryStorage } from "../src/storage/memory.ts";
import {
	type BatchInfo,
	decodeBatch,
	encodeBatch,
	FileSyncStateStore,
	FileSystemSyncRemote,
	FlushScheduler,
	foldSession,
	HistoryUnavailableError,
	isUrgentCommit,
	pullSession,
	remoteHead,
	remoteHistory,
	type SessionSyncMaintenance,
	type SyncState,
	type SyncStateStore,
	UnsyncedCommitsError,
	uploadSession,
} from "../src/sync/index.ts";
import type { CommitPublication, LogRecord, ReplayableStorage, Seq } from "../src/types.ts";
import { collect, entry, reads, seedBatches } from "./replay-support.ts";

const context = BACKGROUND_CONTEXT;
const SESSION = "session-1";
const directories: string[] = [];

afterEach(async () => {
	for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function remote(): Promise<FileSystemSyncRemote> {
	const directory = await mkdtemp(join(tmpdir(), "pi-durable-sync-"));
	directories.push(directory);
	return new FileSystemSyncRemote(new NodeExecutionEnv({ cwd: directory }), directory);
}

class MemoryState implements SyncStateStore {
	readonly states = new Map<string, SyncState>();
	async get(sessionId: string, _context: Context): Promise<SyncState | undefined> {
		return this.states.get(sessionId);
	}
	async set(sessionId: string, state: SyncState, _context: Context): Promise<void> {
		this.states.set(sessionId, state);
	}
}

/** One device with its copy of a session, which it continues as its own. */
function device(name: string, store: FileSystemSyncRemote, storage: ReplayableStorage = new MemoryStorage()) {
	const state = new MemoryState();
	return {
		name,
		storage,
		state,
		upload: (sessionId = SESSION) =>
			uploadSession({ sessionId, device: name, source: storage, store, state, context }),
		pull: (sessionId = SESSION) => pullSession({ sessionId, store, storage, state, context }),
	};
}

async function commitAll(storage: ReplayableStorage, batches: readonly (readonly unknown[])[]): Promise<void> {
	for (const batch of batches) await storage.commit(batch as never, () => {}, context);
}

const slot = (after: number, to: number, device: string): BatchInfo => ({
	after: seqFromNumber(after),
	to: seqFromNumber(to),
	device,
});

describe("batches", () => {
	it("round-trip through gzip JSON lines", async () => {
		const storage = new MemoryStorage();
		await commitAll(storage, seedBatches());
		const records = await collect(storage.log(undefined, context));
		const bytes = await encodeBatch(records);
		expect(bytes[0]).toBe(0x1f);
		expect(await decodeBatch(bytes)).toEqual(records);
	});
});

describe("remoteHistory", () => {
	const listing = {
		batches: [{ ...slot(0, 4, "a"), folded: true as const }, slot(4, 10, "a"), slot(10, 12, "b")],
		snapshots: [seqFromNumber(4)],
	};

	it("restores from the newest snapshot along the chain of slots", () => {
		expect(remoteHistory(listing)).toEqual({ snapshot: 4, batches: [slot(4, 10, "a"), slot(10, 12, "b")], head: 12 });
		expect(remoteHead(listing)).toBe(12);
		expect(remoteHistory({ batches: [], snapshots: [] })).toEqual({ batches: [], head: 0 });
	});

	it("continues a copy from its head, also from inside a batch", () => {
		expect(remoteHistory(listing, seqFromNumber(4))).toEqual({
			batches: [slot(4, 10, "a"), slot(10, 12, "b")],
			head: 12,
		});
		expect(remoteHistory(listing, seqFromNumber(7))).toEqual({
			batches: [slot(4, 10, "a"), slot(10, 12, "b")],
			head: 12,
		});
		expect(remoteHistory(listing, seqFromNumber(12))).toEqual({ batches: [], head: 12 });
	});
});

describe("syncing a session between devices", () => {
	it("uploads what was committed since the last upload, and nothing when nothing was", async () => {
		const store = await remote();
		const laptop = device("laptop", store);
		const batches = seedBatches();
		await commitAll(laptop.storage, batches.slice(0, 4));
		expect(await laptop.upload()).toEqual({ type: "uploaded", head: 4 });
		expect(await laptop.upload()).toEqual({ type: "idle" });
		await commitAll(laptop.storage, batches.slice(4));
		expect(await laptop.upload()).toEqual({ type: "uploaded", head: 10 });
		expect((await store.list(SESSION, context)).batches).toEqual([slot(0, 4, "laptop"), slot(4, 10, "laptop")]);
	});

	it("hands a session back and forth: each device continues it as its own", async () => {
		const store = await remote();
		const laptop = device("laptop", store);
		const phone = device("phone", store);
		const batches = seedBatches();
		await commitAll(laptop.storage, batches.slice(0, 5));
		await laptop.upload();

		expect(await phone.pull()).toBe(5);
		expect(await reads(phone.storage)).toEqual(await reads(laptop.storage));
		await commitAll(phone.storage, batches.slice(5, 7));
		expect(await phone.upload()).toEqual({ type: "uploaded", head: 7 });

		expect(await laptop.pull()).toBe(7);
		expect(await reads(laptop.storage)).toEqual(await reads(phone.storage));
		await commitAll(laptop.storage, batches.slice(7));
		expect(await laptop.upload()).toEqual({ type: "uploaded", head: 10 });
		expect(await phone.pull()).toBe(10);
		expect(await reads(phone.storage)).toEqual(await reads(laptop.storage));
		expect((await store.list(SESSION, context)).batches).toEqual([
			slot(0, 5, "laptop"),
			slot(5, 7, "phone"),
			slot(7, 10, "laptop"),
		]);
	});

	it("keeps a copy that only pulls in step", async () => {
		const store = await remote();
		const laptop = device("laptop", store);
		const viewer = device("viewer", store);
		for (const writes of seedBatches()) {
			await laptop.storage.commit(writes, () => {}, context);
			await laptop.upload();
			await viewer.pull();
		}
		expect(await reads(viewer.storage)).toEqual(await reads(laptop.storage));
		expect(await viewer.upload()).toEqual({ type: "idle" });
	});

	for (const [first, second] of [
		["phone", "laptop"],
		["laptop", "phone"],
	] as const) {
		it(`lets the ${first} keep the session when both continued it and the ${first} uploaded first`, async () => {
			const store = await remote();
			const devices = { laptop: device("laptop", store), phone: device("phone", store) };
			const batches = seedBatches();
			await commitAll(devices.laptop.storage, batches.slice(0, 5));
			await devices.laptop.upload();
			await devices.phone.pull();
			// Both continue from 5 without hearing from each other.
			await commitAll(devices.laptop.storage, batches.slice(5, 7));
			await commitAll(devices.phone.storage, [[entry(100)]]);

			const winner = devices[first];
			const loser = devices[second];
			expect((await winner.upload()).type).toBe("uploaded");
			// The loser's acknowledged uploads stay; only the commits nobody acknowledged are a different history.
			expect(await loser.upload()).toEqual({ type: "diverged", at: 5 });
			await expect(loser.pull()).rejects.toThrow(UnsyncedCommitsError);

			// The loser's copy becomes a new session, uploaded whole; the session restores fresh on that device.
			expect(await loser.upload("fork-1")).toEqual({ type: "uploaded", head: await loser.storage.head(context) });
			const fork = device(second, store);
			await fork.pull("fork-1");
			expect(await reads(fork.storage)).toEqual(await reads(loser.storage));
			const restored = device(second, store);
			await restored.pull();
			expect(await reads(restored.storage)).toEqual(await reads(winner.storage));
		});
	}

	it("goes on after an upload whose response was lost", async () => {
		const store = await remote();
		const laptop = device("laptop", store);
		const replica = device("replica", store);
		const batches = seedBatches();
		await commitAll(laptop.storage, batches.slice(0, 5));
		await laptop.upload();
		await commitAll(laptop.storage, batches.slice(5, 7));
		await laptop.upload();
		// The response of that upload was lost: the laptop still believes the remote is at 5.
		await laptop.state.set(SESSION, { syncedHead: seqFromNumber(5) }, context);
		await commitAll(laptop.storage, batches.slice(7));
		expect(await laptop.upload()).toEqual({ type: "uploaded", head: 10 });

		expect((await store.list(SESSION, context)).batches).toEqual([
			slot(0, 5, "laptop"),
			slot(5, 7, "laptop"),
			slot(7, 10, "laptop"),
		]);
		await replica.pull();
		expect(await reads(replica.storage)).toEqual(await reads(laptop.storage));
	});

	it("resumes a pull that stopped inside a batch", async () => {
		const store = await remote();
		const laptop = device("laptop", store);
		await commitAll(laptop.storage, seedBatches().slice(0, 3));
		await laptop.upload();
		await commitAll(laptop.storage, seedBatches().slice(3));
		await laptop.upload();

		const storage = new MemoryStorage();
		let replayed = 0;
		const failing = Object.assign(Object.create(storage) as MemoryStorage, {
			replay: async (record: LogRecord, replayContext: Context) => {
				if (++replayed === 5) throw new Error("connection lost");
				return storage.replay(record, replayContext);
			},
		});
		const viewer = device("viewer", store, failing);
		await expect(viewer.pull()).rejects.toThrow("connection lost");
		expect(await storage.head(context)).toBe(4);
		// The records past what it shares are the remote's, not its own: nothing to upload, and the pull resumes.
		expect(await viewer.upload()).toEqual({ type: "idle" });
		await viewer.pull();
		expect(await reads(storage)).toEqual(await reads(laptop.storage));
	});

	it("folds the history into a snapshot that restores the session, and keeps its slots taken", async () => {
		const store = await remote();
		const laptop = device("laptop", store);
		const stale = device("stale", store);
		const replica = device("replica", store);
		for (const [index, writes] of seedBatches().entries()) {
			await laptop.storage.commit(writes, () => {}, context);
			await laptop.upload();
			if (index === 3) await stale.pull();
		}
		expect(await foldSession({ sessionId: SESSION, store, context })).toBe(10);
		expect((await store.list(SESSION, context)).snapshots).toEqual([10]);

		await replica.pull();
		expect(await reads(replica.storage)).toEqual(await reads(laptop.storage));
		// A copy at 4 cannot continue through folded batches: it restores instead.
		await expect(stale.pull()).rejects.toThrow(HistoryUnavailableError);
		// Nor can it take a folded slot: its own commits from 4 on are a different history.
		await stale.storage.commit([entry(300)], () => {}, context);
		expect(await stale.upload()).toEqual({ type: "diverged", at: 4 });

		// Uploads go on after the fold, and the replica follows them; so does a second fold and a fresh restore.
		await commitAll(laptop.storage, [[entry(100)], [entry(101)]]);
		await laptop.upload();
		await laptop.storage.commit([entry(102)], () => {}, context);
		await laptop.upload();
		await replica.pull();
		expect(await reads(replica.storage)).toEqual(await reads(laptop.storage));
		expect(await foldSession({ sessionId: SESSION, store, context })).toBe(13);
		const restored = device("restored", store);
		await restored.pull();
		expect(await reads(restored.storage)).toEqual(await reads(laptop.storage));
	});

	it("reports a batch that vanished while folding", async () => {
		const store = await remote();
		const laptop = device("laptop", store);
		for (const writes of seedBatches().slice(0, 3)) {
			await laptop.storage.commit(writes, () => {}, context);
			await laptop.upload();
		}
		const vanishing: SessionSyncMaintenance = {
			putBatch: (...args) => store.putBatch(...args),
			putSnapshot: (...args) => store.putSnapshot(...args),
			getSnapshot: (...args) => store.getSnapshot(...args),
			foldBatches: (...args) => store.foldBatches(...args),
			deleteSnapshots: (...args) => store.deleteSnapshots(...args),
			list: (...args) => store.list(...args),
			sessions: (...args) => store.sessions(...args),
			putMeta: (...args) => store.putMeta(...args),
			getMeta: (...args) => store.getMeta(...args),
			getBatch: async () => undefined,
		};
		await expect(foldSession({ sessionId: SESSION, store: vanishing, context })).rejects.toThrow("vanished");
	});
});

describe("host pieces", () => {
	it("lists sessions and keeps the last metadata written", async () => {
		const store = await remote();
		expect(await store.sessions(context)).toEqual([]);
		const laptop = device("laptop", store);
		await laptop.storage.commit([entry(1)], () => {}, context);
		await laptop.upload("s2");
		await store.putMeta("s1", { title: "first" }, context);
		await store.putMeta("s1", { title: "renamed", origin: "laptop" }, context);
		expect(await store.sessions(context)).toEqual(["s1", "s2"]);
		expect(await store.getMeta("s1", context)).toEqual({ title: "renamed", origin: "laptop" });
		expect(await store.getMeta("s2", context)).toBeUndefined();
	});

	it("refuses session IDs that leave the root", async () => {
		const store = await remote();
		for (const id of ["..", "../x", "a/b", "", ".hidden"]) {
			await expect(store.list(id, context)).rejects.toThrow("Invalid session ID");
		}
	});

	it("keeps sync state in files", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-durable-sync-state-"));
		directories.push(directory);
		const state = new FileSyncStateStore(new NodeExecutionEnv({ cwd: directory }), join(directory, "sync"));
		expect(await state.get(SESSION, context)).toBeUndefined();
		await state.set(SESSION, { syncedHead: seqFromNumber(3), pulling: seqFromNumber(7) }, context);
		expect(await state.get(SESSION, context)).toEqual({ syncedHead: seqFromNumber(3), pulling: seqFromNumber(7) });
		await state.set(SESSION, { syncedHead: undefined }, context);
		expect(await state.get(SESSION, context)).toEqual({ syncedHead: undefined });
		await state.delete(SESSION, context);
		expect(await state.get(SESSION, context)).toBeUndefined();
	});
});

describe("FlushScheduler", () => {
	function clock() {
		let now = 0;
		const timers: { at: number; callback: () => void; armed: boolean }[] = [];
		return {
			now: () => now,
			setTimer: (callback: () => void, delayMs: number) => {
				const timer = { at: now + delayMs, callback, armed: true };
				timers.push(timer);
				return () => {
					timer.armed = false;
				};
			},
			/** Fire due timers at their own times, letting each callback's promises settle before the next. */
			async advance(ms: number) {
				const end = now + ms;
				while (true) {
					const next = timers.filter((item) => item.armed && item.at <= end).sort((a, b) => a.at - b.at)[0];
					if (next === undefined) break;
					now = next.at;
					next.armed = false;
					next.callback();
					await new Promise((resolve) => setTimeout(resolve, 0));
				}
				now = end;
			},
		};
	}

	it("flushes some time after a commit, sooner after an urgent one, once per window", async () => {
		const time = clock();
		const flushes: number[] = [];
		const scheduler = new FlushScheduler({
			...time,
			flush: async () => void flushes.push(time.now()),
			onError: (error) => {
				throw error;
			},
		});
		scheduler.notify(false);
		scheduler.notify(false);
		await time.advance(4000);
		expect(flushes).toEqual([]);
		scheduler.notify(true);
		await time.advance(200);
		expect(flushes).toEqual([4200]);
		await time.advance(5000);
		expect(flushes).toEqual([4200]);
		await scheduler.close();
		expect(flushes).toEqual([4200, 9200]);
	});

	it("keeps the urgency of commits that arrived during a flush", async () => {
		const time = clock();
		let release: () => void = () => {};
		const flushes: number[] = [];
		const scheduler = new FlushScheduler({
			...time,
			flush: () => {
				flushes.push(time.now());
				return new Promise<void>((resolve) => {
					release = resolve;
				});
			},
			onError: (error) => {
				throw error;
			},
		});
		scheduler.notify(false);
		await time.advance(5000);
		scheduler.notify(false);
		scheduler.notify(true);
		release();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await time.advance(200);
		expect(flushes).toEqual([5000, 5200]);
	});

	it("retries a failed flush with backoff until it succeeds, without another commit", async () => {
		const time = clock();
		const attempts: number[] = [];
		const errors: unknown[] = [];
		const scheduler = new FlushScheduler({
			...time,
			flush: async () => {
				attempts.push(time.now());
				if (attempts.length < 3) throw new Error("offline");
			},
			onError: (error) => errors.push(error),
		});
		scheduler.notify(true);
		await time.advance(5000);
		expect(attempts).toEqual([200, 1200, 3200]);
		expect(errors).toHaveLength(2);
		await time.advance(60_000);
		expect(attempts).toHaveLength(3);
	});

	it("marks commits with input, answers, or settled submissions as urgent", () => {
		const publication = (changes: CommitPublication["changes"]): CommitPublication => ({
			seq: seqFromNumber(1) as Seq,
			changes,
		});
		expect(
			isUrgentCommit(
				publication([{ type: "entry", value: { id: 1, conversationId: 1, kind: "pi.user" } }] as never),
			),
		).toBe(true);
		expect(isUrgentCommit(publication([entry(1)] as never))).toBe(false);
	});
});
