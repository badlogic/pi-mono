import type { Context } from "@earendil-works/chord";
import { isCurrentOnly } from "../storage/export.ts";
import type {
	ConversationId,
	DocumentId,
	EntryId,
	Id,
	LogRecord,
	LogWrite,
	ReplayableStorage,
	Seq,
	Storage,
	StorageWrite,
} from "../types.ts";
import type { OutboxRecord } from "./log.ts";

/** Where committed records wait for upload. Appends happen one at a time, in commit order. */
export interface Outbox {
	append(record: OutboxRecord, context: Context): Promise<void>;
}

export type ReplicatingStorageOptions = {
	/** Called after each record is in the outbox, on the Session line: must not block. A flush scheduler listens here. */
	readonly onRecord?: (record: OutboxRecord) => void;
};

/**
 * A storage that appends every committed batch to an outbox after it commits, as a log record.
 *
 * Fork copies are resolved into the creations they become before the commit, so the log never needs a copy's
 * source. Records replayed through `replay()` came from elsewhere, such as a pull-back, and are not logged again.
 * Wrapping the storage rather than observing the Session also logs what the Session writes straight to storage, such
 * as the tasks a close stops.
 *
 * The append follows the commit: a commit that fails has no defined outcome and must not reach the log. A crash
 * between the two leaves the storage ahead of the outbox, which the host detects on open by comparing heads.
 */
export class ReplicatingStorage implements ReplayableStorage {
	readonly inner: ReplayableStorage;
	readonly #outbox: Outbox;
	readonly #onRecord: ((record: OutboxRecord) => void) | undefined;
	/** History of documents seen so far, so a change knows whether it may be compacted away later. */
	readonly #currentOnly = new Map<DocumentId, boolean>();

	constructor(inner: ReplayableStorage, outbox: Outbox, options: ReplicatingStorageOptions = {}) {
		this.inner = inner;
		this.#outbox = outbox;
		this.#onRecord = options.onRecord;
	}

	async commit(writes: readonly StorageWrite[], context: Context): Promise<Seq> {
		const logged = await this.#resolveCopies(writes, context);
		const currentOnly = await this.#currentOnlyChanges(logged, context);
		const seq = await this.inner.commit(writes, context);
		for (const write of logged) {
			if (write.type === "document.create") this.#currentOnly.set(write.record.id, isCurrentOnly(write.record));
			else if (write.type === "document.retire") this.#currentOnly.delete(write.id);
		}
		const record: OutboxRecord = { seq, writes: logged, ...(currentOnly.length === 0 ? {} : { currentOnly }) };
		await this.#outbox.append(record, context);
		this.#onRecord?.(record);
		return seq;
	}

	/** Write records that came from elsewhere; they are not logged again. */
	replay(record: LogRecord, context: Context): Promise<void> {
		return this.inner.replay(record, context);
	}

	head(context: Context): Promise<Seq | undefined> {
		return this.inner.head(context);
	}

	export(context: Context): AsyncIterable<LogRecord> {
		return this.inner.export(context);
	}

	async #resolveCopies(writes: readonly StorageWrite[], context: Context): Promise<LogWrite[]> {
		const resolved: LogWrite[] = [];
		for (const write of writes) {
			if (write.type !== "document.copy") {
				resolved.push(write);
				continue;
			}
			// The Session line is held and a batch may not change a copy's source, so this reads what the commit copies.
			const source = await this.inner.document(write.source.id, write.source.at, context);
			if (source === undefined) throw new Error(`Fork source document ${write.source.id} cannot be read`);
			resolved.push({
				type: "document.create",
				record: write.record,
				content: { kind: "base", version: source.version, value: source.value },
			});
		}
		return resolved;
	}

	/** Current-only documents this batch changes or retires without creating them. */
	async #currentOnlyChanges(writes: readonly LogWrite[], context: Context): Promise<DocumentId[]> {
		const created = new Set<DocumentId>();
		for (const write of writes) if (write.type === "document.create") created.add(write.record.id);
		const ids: DocumentId[] = [];
		for (const write of writes) {
			if (write.type !== "document.change" && write.type !== "document.retire") continue;
			if (created.has(write.id) || ids.includes(write.id)) continue;
			let currentOnly = this.#currentOnly.get(write.id);
			if (currentOnly === undefined) {
				// The document is alive before this commit; its record says what history it keeps. Read once per document.
				const stored = await this.inner.document(write.id, "current", context);
				if (stored === undefined) continue;
				currentOnly = isCurrentOnly(stored.record);
				this.#currentOnly.set(write.id, currentOnly);
			}
			if (currentOnly) ids.push(write.id);
		}
		return ids;
	}

	mintId<I extends Id<string>>(): Promise<I> {
		return this.inner.mintId<I>();
	}
	conversation: Storage["conversation"] = (id, context) => this.inner.conversation(id, context);
	scanConversations: Storage["scanConversations"] = (query, limit, cursor, context) =>
		this.inner.scanConversations(query, limit, cursor, context);
	entry(id: EntryId, context: Context): ReturnType<Storage["entry"]>;
	entry(conversationId: ConversationId, id: EntryId, context: Context): ReturnType<Storage["entry"]>;
	entry(idOrConversationId: EntryId | ConversationId, idOrContext: EntryId | Context, context?: Context) {
		return context === undefined
			? this.inner.entry(idOrConversationId as EntryId, idOrContext as Context)
			: this.inner.entry(idOrConversationId as ConversationId, idOrContext as EntryId, context);
	}
	findLatestHeadMarker: Storage["findLatestHeadMarker"] = (conversationId, atOrBefore, context) =>
		this.inner.findLatestHeadMarker(conversationId, atOrBefore, context);
	scanEntries: Storage["scanEntries"] = (query, limit, cursor, context) =>
		this.inner.scanEntries(query, limit, cursor, context);
	task: Storage["task"] = (id, context) => this.inner.task(id, context);
	scanTasks: Storage["scanTasks"] = (query, limit, cursor, context) =>
		this.inner.scanTasks(query, limit, cursor, context);
	submission: Storage["submission"] = (id, context) => this.inner.submission(id, context);
	scanSubmissions: Storage["scanSubmissions"] = (query, limit, cursor, context) =>
		this.inner.scanSubmissions(query, limit, cursor, context);
	submissionByRequest: Storage["submissionByRequest"] = (conversationId, requestId, context) =>
		this.inner.submissionByRequest(conversationId, requestId, context);
	findDocument: Storage["findDocument"] = (address, at, context) => this.inner.findDocument(address, at, context);
	document: Storage["document"] = (id, at, context) => this.inner.document(id, at, context);
	scanDocuments: Storage["scanDocuments"] = (query, limit, cursor, context) =>
		this.inner.scanDocuments(query, limit, cursor, context);
	close: Storage["close"] = (context) => this.inner.close(context);
}

/** An outbox in memory, for tests and hosts that persist records themselves. */
export class MemoryOutbox implements Outbox {
	readonly records: OutboxRecord[] = [];

	async append(record: OutboxRecord, _context: Context): Promise<void> {
		this.records.push(record);
	}
}
