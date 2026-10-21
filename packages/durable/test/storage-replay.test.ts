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
import { collect, create, delta, documentId, entry, entryId, latestDoc, reads, seed, task } from "./replay-support.ts";

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

describe("export and replay", () => {
	for (const source of backends) {
		for (const target of backends) {
			it(`replays ${source.name} into ${target.name} with the same reads`, async () => {
				const opened = await source.open();
				await seed(opened.storage);
				const reopened = await opened.reopen();
				const log = await collect(reopened.export(context));
				expect(log.at(-1)?.seq).toBe(await reopened.head(context));
				for (const record of log) {
					expect(record.writes.some((write) => (write as StorageWrite).type === "document.copy")).toBe(false);
				}

				const replica = (await target.open()).storage;
				for (const record of log) await replica.replay(record, context);
				expect(await reads(replica)).toEqual(await reads(reopened));
			});
		}
	}

	for (const backend of backends) {
		describe(backend.name, () => {
			it("exports nothing from an empty storage", async () => {
				const { storage } = await backend.open();
				expect(await storage.head(context)).toBeUndefined();
				expect(await collect(storage.export(context))).toEqual([]);
			});

			it("puts records without a sequence into the first record and ends at the head", async () => {
				const { storage } = await backend.open();
				await storage.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], context);
				await storage.commit([{ type: "task", value: task(2, "pending") }], context);
				expect(await collect(storage.export(context))).toEqual([
					{
						seq: 2,
						writes: [
							{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } },
							{ type: "task", value: task(2, "pending") },
						],
					},
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

			it("rejects an export that a commit interrupts", async () => {
				const { storage } = await backend.open();
				await seed(storage);
				const iterator = storage.export(context)[Symbol.asyncIterator]();
				await iterator.next();
				await storage.commit([entry(100)], context);
				await expect(async () => {
					while (!(await iterator.next()).done);
				}).rejects.toThrow("changed during export");
			});
		});
	}

	it("streams a SQLite export across pages", async () => {
		const sqlite = backends.find((backend) => backend.name === "sqlite")!;
		const { storage } = await sqlite.open();
		await storage.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], context);
		await storage.commit([create(latestDoc(2), { n: 0 })], context);
		for (let id = 3; id < 1000; id += 2) await storage.commit([entry(id), delta(2, "n", id)], context);
		const log = await collect(storage.export(context));
		// The conversation has no sequence; it joins the first record, at the document's creation.
		expect(log).toHaveLength(500);

		const replica = new MemoryStorage();
		for (const record of log) await replica.replay(record, context);
		expect(await reads(replica)).toEqual(await reads(storage));
	});
});
