import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { describe, expect, it } from "vitest";
import { seqFromNumber } from "../src/ids.ts";
import { MemoryStorage } from "../src/storage/memory.ts";
import {
	compactRecords,
	decodeLogLines,
	encodeLogLine,
	LogFormatError,
	MemoryOutbox,
	type OutboxRecord,
	ReplicatingStorage,
} from "../src/sync/index.ts";
import { type LogRecord, ROOT_CONVERSATION_ID, type StorageWrite } from "../src/types.ts";
import { collect, create, delta, documentId, entry, latestDoc, reads, seed, task } from "./replay-support.ts";

const context = BACKGROUND_CONTEXT;

async function replayed(records: readonly LogRecord[]): Promise<MemoryStorage> {
	const storage = new MemoryStorage();
	for (const record of records) await storage.replay(record, context);
	return storage;
}

async function replicated(): Promise<{ readonly storage: ReplicatingStorage; readonly outbox: MemoryOutbox }> {
	const outbox = new MemoryOutbox();
	const storage = new ReplicatingStorage(new MemoryStorage(), outbox);
	await seed(storage);
	return { storage, outbox };
}

describe("ReplicatingStorage", () => {
	it("logs every commit so that replaying the log gives the same reads", async () => {
		const { storage, outbox } = await replicated();
		expect(outbox.records.map((record) => record.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(await reads(await replayed(outbox.records))).toEqual(await reads(storage));
	});

	it("logs fork copies as the creations they became", async () => {
		const { outbox } = await replicated();
		const fork = outbox.records.find((record) => record.seq === 6)!;
		const writes = fork.writes as readonly StorageWrite[];
		expect(writes.some((write) => write.type === "document.copy")).toBe(false);
		// The rewindable source as of seq 3, and the latest one as it was when the fork committed.
		expect(writes.filter((write) => write.type === "document.create")).toMatchObject([
			{ record: { id: 12 }, content: { kind: "base", version: 1, value: { a: 1, b: 1 } } },
			{ record: { id: 13 }, content: { kind: "base", version: 1, value: { x: 1 } } },
		]);
	});

	it("marks changes of current-only documents created earlier", async () => {
		const { outbox } = await replicated();
		const hints = Object.fromEntries(outbox.records.map((record) => [record.seq, record.currentOnly ?? []]));
		expect(hints).toMatchObject({ 3: [6], 4: [6], 7: [10], 8: [9, 10], 9: [13] });
		expect(hints[2]).toEqual([]);
	});

	it("does not log replayed records", async () => {
		const outbox = new MemoryOutbox();
		const storage = new ReplicatingStorage(new MemoryStorage(), outbox);
		await storage.replay(
			{ seq: seqFromNumber(1), writes: [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }] },
			context,
		);
		expect(outbox.records).toEqual([]);
		expect(await storage.commit([entry(2)], context)).toBe(2);
		expect(outbox.records.map((record) => record.seq)).toEqual([2]);
	});

	it("appends after the commit, so a rejected commit is never logged", async () => {
		const outbox = new MemoryOutbox();
		const storage = new ReplicatingStorage(new MemoryStorage(), outbox);
		await storage.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], context);
		await expect(
			storage.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], context),
		).rejects.toThrow("already belongs");
		expect(outbox.records).toHaveLength(1);
	});

	it("tells a listener about each record once it is in the outbox", async () => {
		const outbox = new MemoryOutbox();
		const seen: number[] = [];
		const storage = new ReplicatingStorage(new MemoryStorage(), outbox, {
			onRecord: (record) => seen.push(record.seq, outbox.records.length),
		});
		await storage.commit([{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }], context);
		expect(seen).toEqual([1, 1]);
	});
});

describe("compactRecords", () => {
	it("keeps the reads of every split of the log into batches", async () => {
		const { storage, outbox } = await replicated();
		const expected = await reads(storage);
		const records = outbox.records;
		for (let cut = 0; cut <= records.length; cut++) {
			const batches = [records.slice(0, cut), records.slice(cut)];
			const compacted = batches.flatMap((batch) => compactRecords(batch));
			expect(await reads(await replayed(compacted)), `cut at ${cut}`).toEqual(expected);
		}
	});

	it("keeps the reads when every record is its own batch, or the whole log is one", async () => {
		const { storage, outbox } = await replicated();
		const expected = await reads(storage);
		expect(await reads(await replayed(outbox.records.flatMap((record) => compactRecords([record]))))).toEqual(
			expected,
		);
		expect(await reads(await replayed(compactRecords(outbox.records)))).toEqual(expected);
	});

	it("compacts the export of a storage too", async () => {
		const { storage } = await replicated();
		const exported = await collect(storage.export(context));
		expect(await reads(await replayed(compactRecords(exported)))).toEqual(await reads(storage));
	});

	it("drops superseded task records and streaming deltas", async () => {
		const live = latestDoc(2);
		const records: OutboxRecord[] = [
			{
				seq: seqFromNumber(10),
				writes: [{ type: "task", value: task(5, "running") }, delta(2, "partial", "a")],
				currentOnly: [documentId(2)],
			},
			{ seq: seqFromNumber(11), writes: [delta(2, "partial", "ab")], currentOnly: [documentId(2)] },
			{ seq: seqFromNumber(12), writes: [entry(6)] },
			{
				seq: seqFromNumber(13),
				writes: [
					{ type: "task", value: task(5, "terminal") },
					{ type: "document.change", id: documentId(2), content: { kind: "base", version: 1, value: {} } },
				],
				currentOnly: [documentId(2)],
			},
			{ seq: seqFromNumber(14), writes: [delta(2, "partial", "c")], currentOnly: [documentId(2)] },
		];
		expect(compactRecords(records)).toEqual([
			{ seq: 12, writes: [entry(6)] },
			{
				seq: 13,
				writes: [
					{ type: "task", value: task(5, "terminal") },
					{ type: "document.change", id: documentId(2), content: { kind: "base", version: 1, value: {} } },
				],
				currentOnly: [documentId(2)],
			},
			{ seq: 14, writes: [delta(2, "partial", "c")], currentOnly: [documentId(2)] },
		]);
		// Without the hint the document's history is unknown, so its deltas stay.
		const unhinted = records.map(({ currentOnly: _currentOnly, ...record }) => record);
		expect(compactRecords(unhinted).flatMap((record) => record.writes)).toHaveLength(6);
		expect(live.history).toBe("latest");
	});

	it("keeps an empty last record so the batch ends where the run ended", () => {
		const records: OutboxRecord[] = [
			{ seq: seqFromNumber(3), writes: [{ type: "task", value: task(5, "pending") }] },
			{ seq: seqFromNumber(4), writes: [{ type: "task", value: task(5, "running") }] },
			{ seq: seqFromNumber(5), writes: [{ type: "task", value: task(5, "terminal") }] },
			{
				seq: seqFromNumber(6),
				writes: [create(latestDoc(7), { gone: true }), { type: "document.retire", id: documentId(7) }],
			},
			{ seq: seqFromNumber(7), writes: [{ type: "task", value: task(8, "pending") }] },
			{ seq: seqFromNumber(8), writes: [{ type: "task", value: task(8, "running") }] },
		];
		expect(compactRecords(records)).toEqual([
			{ seq: 5, writes: [{ type: "task", value: task(5, "terminal") }] },
			{
				seq: 6,
				writes: [
					{ type: "document.create", record: latestDoc(7), content: { kind: "base", version: 1, value: {} } },
					{ type: "document.retire", id: documentId(7) },
				],
			},
			{ seq: 8, writes: [{ type: "task", value: task(8, "running") }] },
		]);
		expect(compactRecords([records[0]!, { seq: seqFromNumber(4), writes: [] }])).toEqual([
			{ seq: 3, writes: [{ type: "task", value: task(5, "pending") }] },
			{ seq: 4, writes: [] },
		]);
	});
});

describe("log lines", () => {
	it("round-trips records with their hints", async () => {
		const { outbox } = await replicated();
		const text = outbox.records.map(encodeLogLine).join("");
		expect(decodeLogLines(text)).toEqual({ records: outbox.records, torn: 0 });
	});

	it("reports a torn last line instead of failing", () => {
		const line = encodeLogLine({ seq: seqFromNumber(1), writes: [entry(2)] });
		const torn = encodeLogLine({ seq: seqFromNumber(2), writes: [entry(3)] }).slice(0, 10);
		expect(decodeLogLines(line + torn)).toEqual({ records: [{ seq: 1, writes: [entry(2)] }], torn: 10 });
	});

	it("refuses unknown versions, unknown writes, and sequences that do not increase", () => {
		expect(() => decodeLogLines('{"v":2,"seq":1,"writes":[]}\n')).toThrow(LogFormatError);
		expect(() => decodeLogLines('{"v":1,"seq":1,"writes":[{"type":"document.copy"}]}\n')).toThrow(
			"unknown type document.copy",
		);
		expect(() => decodeLogLines('{"v":1,"seq":2,"writes":[]}\n{"v":1,"seq":2,"writes":[]}\n')).toThrow(
			"does not increase",
		);
		expect(() => decodeLogLines("not json\n")).toThrow("is not JSON");
		// The parser's own error says where and why.
		expect(() => decodeLogLines("not json\n")).toThrow(expect.objectContaining({ cause: expect.any(SyntaxError) }));
	});
});
