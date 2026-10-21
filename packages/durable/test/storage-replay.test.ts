/// <reference lib="dom" />

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { IDBKeyRange as FakeIDBKeyRange, IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { seqFromNumber } from "../src/ids.ts";
import { IndexedDbStorage } from "../src/storage/indexeddb.ts";
import { openNodeJsonlStorage } from "../src/storage/jsonl/node.ts";
import { MemoryStorage } from "../src/storage/memory.ts";
import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { type LogRecord, type ReplayableStorage, ROOT_CONVERSATION_ID, type StorageWrite } from "../src/types.ts";
import {
	base,
	collect,
	create,
	delta,
	documentId,
	entry,
	entryId,
	latestDoc,
	reads,
	rewindableDoc,
	seed,
	seedBatches,
	task,
} from "./replay-support.ts";

Object.defineProperty(globalThis, "IDBKeyRange", { configurable: true, value: FakeIDBKeyRange });

const context = BACKGROUND_CONTEXT;

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "pi-durable-replay-"));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

type Backend = {
	readonly name: string;
	open(): Promise<{ readonly storage: ReplayableStorage; reopen(): Promise<ReplayableStorage> }>;
};

function track(storage: ReplayableStorage): ReplayableStorage {
	cleanups.push(() => storage.close(context).catch(() => {}));
	return storage;
}

const backends: readonly Backend[] = [
	{
		name: "memory",
		async open() {
			const storage = new MemoryStorage();
			return { storage, reopen: async () => storage };
		},
	},
	{
		name: "sqlite",
		async open() {
			const path = join(await temporaryDirectory(), "session.sqlite");
			let storage = track(await openNodeSqliteStorage(path));
			return {
				storage,
				reopen: async () => {
					await storage.close(context);
					storage = track(await openNodeSqliteStorage(path));
					return storage;
				},
			};
		},
	},
	{
		name: "jsonl",
		async open() {
			const directory = await temporaryDirectory();
			let storage = track(await openNodeJsonlStorage(directory, context));
			return {
				storage,
				reopen: async () => {
					await storage.close(context);
					storage = track(await openNodeJsonlStorage(directory, context));
					return storage;
				},
			};
		},
	},
	{
		name: "indexeddb",
		async open() {
			const indexedDB = new IDBFactory();
			let storage = track(await IndexedDbStorage.open("session", { indexedDB }));
			return {
				storage,
				reopen: async () => {
					await storage.close(context);
					storage = track(await IndexedDbStorage.open("session", { indexedDB }));
					return storage;
				},
			};
		},
	},
];

/** Bring `replica` up to `source` the way a sync flush does: the source's log after the replica's head. */
async function catchUp(source: ReplayableStorage, replica: ReplayableStorage): Promise<LogRecord[]> {
	const records = await collect(source.log(await replica.head(context), context));
	for (const record of records) await replica.replay(record, context);
	return records;
}

describe("log and replay", () => {
	for (const source of backends) {
		for (const target of backends) {
			it(`rebuilds ${source.name} in ${target.name} with the same reads`, async () => {
				const opened = await source.open();
				await seed(opened.storage);
				const reopened = await opened.reopen();
				const log = await collect(reopened.log(undefined, context));
				expect(log.at(-1)?.seq).toBe(await reopened.head(context));
				for (const record of log) {
					expect(record.writes.some((write) => (write as StorageWrite).type === "document.copy")).toBe(false);
				}

				const replica = (await target.open()).storage;
				for (const record of log) await replica.replay(record, context);
				expect(await reads(replica)).toEqual(await reads(reopened));
				// The replica mints past every replayed ID, as the source does.
				expect(await replica.mintId()).toBe(await reopened.mintId());
			});

			it(`catches ${target.name} up with ${source.name} after every commit`, async () => {
				const { storage } = await source.open();
				const replica = (await target.open()).storage;
				for (const batch of seedBatches()) {
					await storage.commit(batch, context);
					await catchUp(storage, replica);
					expect(await reads(replica)).toEqual(await reads(storage));
				}
			});
		}

		it(`catches up from ${source.name} at every pace, keeping only the surviving changes`, async () => {
			for (const every of [2, 3, 4]) {
				const { storage } = await source.open();
				const replica = new MemoryStorage();
				const batches = seedBatches();
				for (let index = 0; index < batches.length; index++) {
					await storage.commit(batches[index]!, context);
					if ((index + 1) % every === 0 || index === batches.length - 1) await catchUp(storage, replica);
				}
				expect(await reads(replica), `every ${every}`).toEqual(await reads(storage));
			}
		});
	}

	for (const backend of backends) {
		describe(backend.name, () => {
			it("logs nothing from an empty storage, and nothing after the head", async () => {
				const { storage } = await backend.open();
				expect(await storage.head(context)).toBeUndefined();
				expect(await collect(storage.log(undefined, context))).toEqual([]);
				await seed(storage);
				expect(await collect(storage.log(seqFromNumber(10), context))).toEqual([]);
			});

			it("rejects a log after a sequence past the head", async () => {
				const { storage } = await backend.open();
				await seed(storage);
				await expect(collect(storage.log(seqFromNumber(11), context))).rejects.toThrow("past the head");
			});

			it("logs each record at its own stamp and ends at the head", async () => {
				const { storage } = await backend.open();
				await storage.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], context);
				await storage.commit([{ type: "task", value: task(2, "pending") }], context);
				await storage.commit([entry(3)], context);
				await storage.commit([{ type: "task", value: task(2, "running") }], context);
				await storage.commit(
					[
						{ type: "task", value: task(4, "pending") },
						{ type: "task", value: task(4, "running") },
					],
					context,
				);
				await storage.commit([entry(5)], context);
				expect(await collect(storage.log(undefined, context))).toEqual([
					{ seq: 1, writes: [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }] },
					{ seq: 3, writes: [entry(3)] },
					{ seq: 4, writes: [{ type: "task", value: task(2, "running") }] },
					{ seq: 5, writes: [{ type: "task", value: task(4, "running") }] },
					{ seq: 6, writes: [entry(5)] },
				]);
				expect(await collect(storage.log(seqFromNumber(4), context))).toEqual([
					{ seq: 5, writes: [{ type: "task", value: task(4, "running") }] },
					{ seq: 6, writes: [entry(5)] },
				]);
				await storage.commit([{ type: "task", value: task(2, "terminal") }], context);
				expect(await collect(storage.log(seqFromNumber(6), context))).toEqual([
					{ seq: 7, writes: [{ type: "task", value: task(2, "terminal") }] },
				]);
			});

			it("logs only what followed the newest base of a current-only document", async () => {
				const { storage } = await backend.open();
				await storage.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], context);
				await storage.commit([create(latestDoc(2), { n: 0 })], context);
				await storage.commit([delta(2, "n", 1)], context);
				await storage.commit([delta(2, "n", 2)], context);
				await storage.commit([base(2, { n: 3 })], context);
				await storage.commit([delta(2, "n", 4)], context);
				expect(await collect(storage.log(seqFromNumber(2), context))).toEqual([
					{ seq: 5, writes: [base(2, { n: 3 })] },
					{ seq: 6, writes: [delta(2, "n", 4)] },
				]);
				// Created after the sequence with its base reclaimed: the placeholder, then what survived.
				expect(await collect(storage.log(seqFromNumber(1), context))).toEqual([
					{
						seq: 2,
						writes: [
							{
								type: "document.create",
								record: latestDoc(2),
								content: { kind: "base", version: 1, value: {} },
							},
						],
					},
					{ seq: 5, writes: [base(2, { n: 3 })] },
					{ seq: 6, writes: [delta(2, "n", 4)] },
				]);
			});

			it("replays at explicit sequences with gaps and continues after them", async () => {
				const { storage } = await backend.open();
				await storage.replay(
					{ seq: seqFromNumber(3), writes: [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }] },
					context,
				);
				await storage.replay({ seq: seqFromNumber(7), writes: [entry(9)] }, context);
				expect(await storage.head(context)).toBe(7);
				expect((await storage.entry(entryId(9), context))?.commitSeq).toBe(7);
				expect(await storage.mintId()).toBe(10);
				expect(await storage.commit([entry(10)], context)).toBe(8);
				await expect(storage.replay({ seq: seqFromNumber(8), writes: [entry(11)] }, context)).rejects.toThrow(
					"does not strictly increase",
				);
				expect(await storage.entry(entryId(11), context)).toBeUndefined();
			});

			it("refuses document copies in a log record", async () => {
				const { storage } = await backend.open();
				await storage.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], context);
				const copy = {
					type: "document.copy",
					record: latestDoc(3),
					source: { id: documentId(2), at: "current" },
				} as unknown as LogRecord["writes"][number];
				await expect(storage.replay({ seq: seqFromNumber(2), writes: [copy] }, context)).rejects.toThrow(
					"cannot contain a document copy",
				);
			});

			it("rejects a log that a commit interrupts", async () => {
				const { storage } = await backend.open();
				await seed(storage);
				const iterator = storage.log(undefined, context)[Symbol.asyncIterator]();
				await iterator.next();
				await storage.commit([entry(100)], context);
				await expect(async () => {
					while (!(await iterator.next()).done);
				}).rejects.toThrow("changed while its log was read");
			});
		});
	}

	it("streams a SQLite log across pages", async () => {
		const sqlite = backends.find((backend) => backend.name === "sqlite")!;
		const { storage } = await sqlite.open();
		await storage.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], context);
		await storage.commit([create(rewindableDoc(2), { n: 0 })], context);
		for (let id = 3; id < 1000; id += 2) await storage.commit([entry(id), delta(2, "n", id)], context);
		const log = await collect(storage.log(undefined, context));
		expect(log).toHaveLength(501);

		const replica = new MemoryStorage();
		for (const record of log) await replica.replay(record, context);
		expect(await reads(replica)).toEqual(await reads(storage));
		expect(await collect(storage.log(seqFromNumber(400), context))).toHaveLength(101);
	});
});
