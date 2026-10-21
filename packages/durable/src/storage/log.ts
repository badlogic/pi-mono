import { seqFromNumber } from "../ids.ts";
import type {
	DocumentContent,
	DocumentCreate,
	DocumentId,
	DocumentRecord,
	LogRecord,
	LogWrite,
	Seq,
	StorageWrite,
} from "../types.ts";

/** Whether a document keeps only its newest base: session, task, and `history: "latest"` conversation documents. */
export const isCurrentOnly = (record: DocumentCreate | DocumentRecord): boolean =>
	record.scope.kind !== "conversation" || record.history === "latest";

/** Reject a log record holding a fork copy: a log carries copies as the creations they became. */
export function assertLogRecord(record: LogRecord): void {
	if (record.writes.some((write) => (write as StorageWrite).type === "document.copy")) {
		throw new Error("A log record cannot contain a document copy");
	}
}

/**
 * One write of a log at the sequence that stamped it. Sequence 0 marks a record stored before stamps existed; it
 * belongs to the first record of a complete log.
 */
export type SequencedWrite = { readonly seq: Seq; readonly write: LogWrite };

/** A stored revision of a document with the sequence that wrote it. */
export type StoredRevision = DocumentContent & { readonly seq: Seq };

/** The sequence before every commit: `log(undefined)` reads what follows it, which is everything. */
export const LOG_START = seqFromNumber(0);

/**
 * Content of a document creation whose own base was reclaimed: a current-only document keeps only its newest base,
 * and nothing reads its content before that base. Logs, compaction, and JSONL recovery write it.
 */
export const RECLAIMED_BASE: Extract<DocumentContent, { readonly kind: "base" }> = Object.freeze({
	kind: "base",
	version: 1,
	value: Object.freeze({}),
});

/** The creation record a document was committed with. */
export function documentCreate(record: DocumentRecord): DocumentCreate {
	const { createdAt: _createdAt, retiredAt: _retiredAt, ...create } = record;
	return create as DocumentCreate;
}

/**
 * The creation of a document at `createdAt`, carrying the base stored with it, or a placeholder when that base was
 * reclaimed. `atCreation` is the stored revision at `createdAt`, if any.
 */
export function creationWrite(record: DocumentRecord, atCreation: StoredRevision | undefined): SequencedWrite {
	if (atCreation !== undefined && atCreation.kind !== "base") {
		throw new Error(`Document ${record.id} has a delta at its creation`);
	}
	const content: Extract<DocumentContent, { readonly kind: "base" }> =
		atCreation === undefined
			? RECLAIMED_BASE
			: { kind: "base", version: atCreation.version, value: atCreation.value };
	return { seq: record.createdAt, write: { type: "document.create", record: documentCreate(record), content } };
}

/** A stored revision after the creation, as the change that wrote it. */
export function revisionWrite(id: DocumentId, revision: StoredRevision): SequencedWrite {
	const content: DocumentContent =
		revision.kind === "base"
			? { kind: "base", version: revision.version, value: revision.value }
			: { kind: "delta", version: revision.version, ops: revision.ops };
	return { seq: revision.seq, write: { type: "document.change", id, content } };
}

/**
 * The writes of one document after `after`, unordered: its creation when that came later, every retained revision
 * after `after` except the one stored with the creation, and its retirement when that came later.
 */
export function documentWrites(
	record: DocumentRecord,
	revisions: readonly StoredRevision[],
	after: Seq,
): SequencedWrite[] {
	const writes: SequencedWrite[] = [];
	if (record.createdAt > after) {
		writes.push(
			creationWrite(
				record,
				revisions.find((revision) => revision.seq === record.createdAt),
			),
		);
	}
	for (const revision of revisions) {
		if (revision.seq > after && revision.seq !== record.createdAt) writes.push(revisionWrite(record.id, revision));
	}
	if (record.retiredAt !== undefined && record.retiredAt > after) {
		writes.push({ seq: record.retiredAt, write: { type: "document.retire", id: record.id } });
	}
	return writes;
}

/** Writes sorted by sequence, keeping the given order within one sequence. */
export function sortBySeq(writes: SequencedWrite[]): SequencedWrite[] {
	return writes.sort((a, b) => a.seq - b.seq);
}

/**
 * Group sequence-ordered streams of the writes after `after` into log records, ending with a record at `head`, empty
 * when nothing else is there, so a log read after `head` follows on. Writes at sequence 0 join the first record.
 *
 * Nothing follows a head at or before `after`. An `after` past the head means the caller holds commits this storage
 * does not have.
 */
export async function* groupLog(
	head: Seq | undefined,
	after: Seq,
	streams: readonly AsyncIterable<SequencedWrite>[],
): AsyncGenerator<LogRecord> {
	if ((head ?? LOG_START) < after) throw new Error(`Log requested after ${after}, past the head ${head ?? "(none)"}`);
	if (head === undefined || head === after) return;
	const cursors = streams.map((stream) => stream[Symbol.asyncIterator]());
	const current: (SequencedWrite | undefined)[] = [];
	for (const cursor of cursors) current.push(await advance(cursor));

	let first: LogWrite[] | undefined = [];
	let last: Seq | undefined;
	while (true) {
		let seq: Seq | undefined;
		for (const item of current) if (item !== undefined && (seq === undefined || item.seq < seq)) seq = item.seq;
		if (seq === undefined) break;
		if (seq > head) throw new Error(`Logged write at ${seq} is past the head ${head}`);
		const writes: LogWrite[] = first ?? [];
		for (let index = 0; index < cursors.length; index++) {
			while (current[index]?.seq === seq) {
				writes.push(current[index]!.write);
				current[index] = await advance(cursors[index]!);
			}
		}
		if (seq === LOG_START) continue;
		first = undefined;
		yield { seq, writes };
		last = seq;
	}
	if (last !== head) yield { seq: head, writes: first ?? [] };
}

async function advance(cursor: AsyncIterator<SequencedWrite>): Promise<SequencedWrite | undefined> {
	const next = await cursor.next();
	if (next.done) return undefined;
	return next.value;
}

/** Iterate an array as a stream. */
export async function* streamOf<T>(items: Iterable<T>): AsyncGenerator<T> {
	yield* items;
}
