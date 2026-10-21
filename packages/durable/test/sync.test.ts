import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { describe, expect, it } from "vitest";
import { seqFromNumber } from "../src/ids.ts";
import { MemoryStorage } from "../src/storage/memory.ts";
import { compactRecords, decodeLogLines, encodeLogLine, LogFormatError } from "../src/sync/index.ts";
import type { LogRecord, StorageWrite } from "../src/types.ts";
import { collect, create, delta, documentId, entry, latestDoc, reads, seedBatches, task } from "./replay-support.ts";

const context = BACKGROUND_CONTEXT;

async function replayed(records: readonly LogRecord[]): Promise<MemoryStorage> {
	const storage = new MemoryStorage();
	for (const record of records) await storage.replay(record, context);
	return storage;
}

/**
 * Commit `batches` and read the storage's log after each one, as a flush after every commit would upload it; with
 * `snapshotAfter`, the first that many commits are read as one complete log instead.
 */
async function uploaded(
	batches: readonly (readonly StorageWrite[])[],
	snapshotAfter = 0,
): Promise<{ readonly storage: MemoryStorage; readonly snapshot: LogRecord[]; readonly records: LogRecord[] }> {
	const storage = new MemoryStorage();
	for (const batch of batches.slice(0, snapshotAfter)) await storage.commit(batch, context);
	const snapshot = await collect(storage.log(undefined, context));
	const records: LogRecord[] = [];
	for (const batch of batches.slice(snapshotAfter)) {
		const head = await storage.head(context);
		await storage.commit(batch, context);
		records.push(...(await collect(storage.log(head, context))));
	}
	return { storage, snapshot, records };
}

describe("compactRecords", () => {
	it("folds a snapshot and the batches after it into one that replays to the same reads, at every split", async () => {
		const batches = seedBatches();
		for (let split = 0; split <= batches.length; split++) {
			const { storage, snapshot, records } = await uploaded(batches, split);
			const folded = compactRecords([...snapshot, ...records]);
			expect(await reads(await replayed(folded)), `split at ${split}`).toEqual(await reads(storage));
			expect(folded.at(-1)?.seq).toBe(await storage.head(context));
		}
	});

	it("keeps the reads of every run of uploaded batches", async () => {
		const { storage, records } = await uploaded(seedBatches());
		const expected = await reads(storage);
		for (let cut = 0; cut <= records.length; cut++) {
			const compacted = [records.slice(0, cut), records.slice(cut)].flatMap((run) => compactRecords(run));
			expect(await reads(await replayed(compacted)), `cut at ${cut}`).toEqual(expected);
		}
	});

	it("leaves a storage's complete log as it is", async () => {
		const { storage } = await uploaded(seedBatches());
		const log = await collect(storage.log(undefined, context));
		expect(compactRecords(log)).toEqual(log);
	});

	it("drops superseded task records and document content before a newer base", () => {
		const records: LogRecord[] = [
			{ seq: seqFromNumber(10), writes: [{ type: "task", value: task(5, "running") }, delta(2, "partial", "a")] },
			{ seq: seqFromNumber(11), writes: [delta(2, "partial", "ab")] },
			{ seq: seqFromNumber(12), writes: [entry(6)] },
			{
				seq: seqFromNumber(13),
				writes: [
					{ type: "task", value: task(5, "terminal") },
					{ type: "document.change", id: documentId(2), content: { kind: "base", version: 1, value: {} } },
				],
			},
			{ seq: seqFromNumber(14), writes: [delta(2, "partial", "c")] },
		];
		// Document 2 was created before the run; the lookup says it is current-only, like pi.live.
		expect(compactRecords(records, (id) => (id === documentId(2) ? true : undefined))).toEqual([
			{ seq: 12, writes: [entry(6)] },
			{
				seq: 13,
				writes: [
					{ type: "task", value: task(5, "terminal") },
					{ type: "document.change", id: documentId(2), content: { kind: "base", version: 1, value: {} } },
				],
			},
			{ seq: 14, writes: [delta(2, "partial", "c")] },
		]);
		// Without the lookup its history is unknown, so its content stays.
		expect(compactRecords(records).flatMap((record) => record.writes)).toHaveLength(6);
	});

	it("keeps an empty last record so the batch ends where the run ended", () => {
		const records: LogRecord[] = [
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
	it("round-trips records", async () => {
		const { records } = await uploaded(seedBatches());
		const text = records.map(encodeLogLine).join("");
		expect(decodeLogLines(text)).toEqual({ records, torn: 0 });
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
