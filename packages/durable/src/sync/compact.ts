import { isCurrentOnly, RECLAIMED_BASE } from "../storage/export.ts";
import type { DocumentId, Id, LogWrite } from "../types.ts";
import type { OutboxRecord } from "./log.ts";

/** Whether a document keeps only its newest base; `undefined` when unknown, which keeps all of its content. */
export type CurrentOnlyLookup = (id: DocumentId) => boolean | undefined;

type Position = { readonly record: number; readonly write: number };

const before = (a: Position, b: Position): boolean =>
	a.record < b.record || (a.record === b.record && a.write < b.write);

type DocumentWrites = {
	create?: Position;
	/** Content writes in order: the creation's base and every change. */
	content: { readonly position: Position; readonly base: boolean }[];
	retired: boolean;
};

/**
 * Compact a run of consecutive records into the records that replay to the same reads:
 *
 * - entries and conversations stay;
 * - of each task and submission only the last record stays, at the sequence that wrote it;
 * - a current-only document loses content before its newest base in the run, and all of it when the run retires it;
 *   a creation whose base is dropped keeps an empty placeholder base, as export writes it;
 * - rewindable and unknown documents keep everything;
 * - records left without writes are dropped, except the last, which marks where the run ends.
 *
 * Pure: the same rules compact one flush, merge pending batches offline, and fold uploaded batches remotely.
 */
export function compactRecords(
	records: readonly OutboxRecord[],
	lookup: CurrentOnlyLookup = () => undefined,
): OutboxRecord[] {
	if (records.length === 0) return [];
	const currentOnly = new Map<DocumentId, boolean>();
	const lastRecord = new Map<Id<string>, Position>();
	const documents = new Map<DocumentId, DocumentWrites>();
	const documentWrites = (id: DocumentId): DocumentWrites => {
		let writes = documents.get(id);
		if (writes === undefined) {
			writes = { content: [], retired: false };
			documents.set(id, writes);
		}
		return writes;
	};

	records.forEach((record, recordIndex) => {
		for (const id of record.currentOnly ?? []) currentOnly.set(id, true);
		record.writes.forEach((write, writeIndex) => {
			const position = { record: recordIndex, write: writeIndex };
			switch (write.type) {
				case "task":
				case "submission":
					lastRecord.set(write.value.id, position);
					break;
				case "document.create": {
					currentOnly.set(write.record.id, isCurrentOnly(write.record));
					const writes = documentWrites(write.record.id);
					writes.create = position;
					writes.content.push({ position, base: true });
					break;
				}
				case "document.change":
					documentWrites(write.id).content.push({ position, base: write.content.kind === "base" });
					break;
				case "document.retire":
					documentWrites(write.id).retired = true;
					break;
				case "conversation":
				case "entry":
					break;
			}
		});
	});

	/** Content positions to drop, and creations whose base becomes the placeholder. */
	const dropped = new Set<string>();
	const placeholders = new Set<string>();
	const key = (position: Position): string => `${position.record}:${position.write}`;
	for (const [id, writes] of documents) {
		if (!(currentOnly.get(id) ?? lookup(id) ?? false)) continue;
		let keepFrom: Position | undefined;
		if (!writes.retired) {
			for (const content of writes.content) if (content.base) keepFrom = content.position;
			// Without a base in the run, its deltas build on content before the run.
			if (keepFrom === undefined) continue;
		}
		for (const content of writes.content) {
			if (keepFrom !== undefined && !before(content.position, keepFrom)) continue;
			if (writes.create !== undefined && key(content.position) === key(writes.create)) {
				placeholders.add(key(content.position));
			} else {
				dropped.add(key(content.position));
			}
		}
	}

	const compacted: OutboxRecord[] = [];
	records.forEach((record, recordIndex) => {
		const writes: LogWrite[] = [];
		record.writes.forEach((write, writeIndex) => {
			const position = { record: recordIndex, write: writeIndex };
			const positionKey = key(position);
			if (write.type === "task" || write.type === "submission") {
				const last = lastRecord.get(write.value.id)!;
				if (last.record !== recordIndex || last.write !== writeIndex) return;
			}
			if (dropped.has(positionKey)) return;
			if (write.type === "document.create" && placeholders.has(positionKey)) {
				writes.push({ type: "document.create", record: write.record, content: RECLAIMED_BASE });
				return;
			}
			writes.push(write);
		});
		const last = recordIndex === records.length - 1;
		if (writes.length === 0 && !last) return;
		const hints = (record.currentOnly ?? []).filter((id) =>
			writes.some(
				(write) => (write.type === "document.change" || write.type === "document.retire") && write.id === id,
			),
		);
		compacted.push({ seq: record.seq, writes, ...(hints.length === 0 ? {} : { currentOnly: hints }) });
	});
	return compacted;
}
