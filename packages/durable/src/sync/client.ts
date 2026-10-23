import type { Context } from "@earendil-works/chord";
import { LogInterruptedError } from "../errors.ts";
import { LOG_START } from "../storage/log.ts";
import type { CommitPublication, LogRecord, ReplayableStorage, Seq } from "../types.ts";
import { decodeBatch, encodeBatch } from "./batch.ts";
import { compactRecords } from "./compact.ts";
import {
	HistoryUnavailableError,
	remoteHead,
	remoteHistory,
	type SessionSyncMaintenance,
	type SessionSyncStore,
} from "./remote.ts";

/**
 * What a host keeps for each copy of a session it syncs: the last sequence the copy shares with the remote. Commits
 * after it are the copy's own and not uploaded yet. When this is lost, a copy without commits of its own takes the
 * remote's head; one with commits finds out by uploading.
 */
export type SyncState = {
	readonly syncedHead: Seq | undefined;
	/**
	 * Set while a pull replays a batch or snapshot ending here: a local head up to it holds the remote's records, not
	 * the copy's own, even when the pull stopped partway.
	 */
	readonly pulling?: Seq;
};

/** The last sequence a copy shares with the remote, counting records an interrupted pull replayed. */
function sharedHead(state: SyncState | undefined, local: Seq | undefined): Seq | undefined {
	if (state?.pulling !== undefined && local !== undefined && local <= state.pulling) return local;
	return state?.syncedHead;
}

export interface SyncStateStore {
	get(sessionId: string, context: Context): Promise<SyncState | undefined>;
	set(sessionId: string, state: SyncState, context: Context): Promise<void>;
}

/** Where the log comes from: the storage, or a host's proxy to the process that owns it. */
export type LogSource = Pick<ReplayableStorage, "log" | "head">;

/** Read the log after `after`, again when a commit interrupts it. */
export async function readLog(
	source: LogSource,
	after: Seq | undefined,
	context: Context,
	attempts = 5,
): Promise<LogRecord[]> {
	for (let attempt = 1; ; attempt++) {
		const records: LogRecord[] = [];
		try {
			for await (const record of source.log(after, context)) records.push(record);
			return records;
		} catch (error) {
			if (!(error instanceof LogInterruptedError) || attempt >= attempts) throw error;
		}
	}
}

export type UploadResult =
	| { readonly type: "uploaded"; readonly head: Seq }
	/** Nothing was committed since the last upload. */
	| { readonly type: "idle" }
	/**
	 * Another device continued the session from `at` first. This copy's commits after `at` are a different history:
	 * the host renames the copy to a new session (forked from this one at `at`) and uploads it there, and the session
	 * itself restores into a fresh storage.
	 */
	| { readonly type: "diverged"; readonly at: Seq }
	/**
	 * The copy lost commits it had uploaded, for example to a power loss: its head is below `syncedHead`. Its next
	 * commits would reuse their sequences, so nothing is uploaded. Pull what it lost before the copy commits again; a pull
	 * replays from the local head.
	 */
	| { readonly type: "behind"; readonly head: Seq | undefined; readonly syncedHead: Seq };

/**
 * Upload what this copy committed since it last shared the remote's history. Every device continues a session as its
 * own; whichever creates the slot first continues the session, so an upload that is acknowledged stays.
 *
 * A slot this device created already is an upload whose response was lost: the remote has the history up to its end,
 * and the upload goes on from there.
 */
export async function uploadSession(options: {
	readonly sessionId: string;
	readonly device: string;
	readonly source: LogSource;
	readonly store: SessionSyncStore;
	readonly state: SyncStateStore;
	readonly context: Context;
}): Promise<UploadResult> {
	const { sessionId, device, source, store, state, context } = options;
	let synced = sharedHead(await state.get(sessionId, context), await source.head(context));
	while (true) {
		// Read again on every pass: a slot this device already holds may end past what the copy still has.
		const head = await source.head(context);
		if (synced !== undefined && (head ?? LOG_START) < synced) return { type: "behind", head, syncedHead: synced };
		const records = await readLog(source, synced, context);
		if (records.length === 0) return { type: "idle" };
		const after = synced ?? LOG_START;
		const to = records.at(-1)!.seq;
		const result = await store.putBatch(sessionId, after, to, device, await encodeBatch(records), context);
		// A history that does not end at `after` is another one too: the remote never held this copy's past `after`.
		if (result.type === "not_head") return { type: "diverged", at: after };
		if (result.type === "exists" && result.device !== device) return { type: "diverged", at: after };
		synced = result.type === "created" ? to : result.to;
		await state.set(sessionId, { syncedHead: synced }, context);
		if (result.type === "created") return { type: "uploaded", head: to };
	}
}

/** This copy has commits it has not uploaded: upload them first, which may find that the copy diverged. */
export class UnsyncedCommitsError extends Error {
	constructor(sessionId: string, localHead: Seq, syncedHead: Seq | undefined) {
		super(
			`This copy of session ${sessionId} is at ${localHead}, past what it shares with the remote (${syncedHead ?? 0})`,
		);
		this.name = "UnsyncedCommitsError";
	}
}

/**
 * Replay what the remote has after the local head into `storage`; into an empty storage, that restores the session.
 * A pull that stopped inside a batch resumes it. No Harness may have the storage open: its memory would be behind.
 *
 * A copy with commits it has not uploaded rejects with `UnsyncedCommitsError` instead of getting the remote's records
 * spliced onto its own. A copy whose history folding removed rejects with `HistoryUnavailableError` and restores into
 * a fresh storage.
 */
export async function pullSession(options: {
	readonly sessionId: string;
	readonly store: SessionSyncStore;
	readonly storage: ReplayableStorage;
	readonly state: SyncStateStore;
	readonly context: Context;
}): Promise<Seq | undefined> {
	const { sessionId, store, storage, state, context } = options;
	const listing = await store.list(sessionId, context);
	const local = await storage.head(context);
	const synced = sharedHead(await state.get(sessionId, context), local);
	if (local !== undefined && local > (synced ?? LOG_START)) throw new UnsyncedCommitsError(sessionId, local, synced);
	const history = remoteHistory(listing, local);
	const bodies: { readonly to: Seq; read(): Promise<Uint8Array | undefined> }[] = [];
	if (history.snapshot !== undefined) {
		const snapshot = history.snapshot;
		bodies.push({ to: snapshot, read: () => store.getSnapshot(sessionId, snapshot, context) });
	}
	for (const batch of history.batches) {
		bodies.push({ to: batch.to, read: () => store.getBatch(sessionId, batch.after, context) });
	}
	for (const body of bodies) {
		const bytes = await body.read();
		const at = await storage.head(context);
		if (bytes === undefined) throw new HistoryUnavailableError(at ?? LOG_START);
		await state.set(sessionId, { syncedHead: at, pulling: body.to }, context);
		for (const record of await decodeBatch(bytes)) {
			if (record.seq > (at ?? LOG_START)) await storage.replay(record, context);
		}
		await state.set(sessionId, { syncedHead: await storage.head(context) }, context);
	}
	const head = await storage.head(context);
	if ((head ?? LOG_START) < remoteHead(listing)) throw new HistoryUnavailableError(head ?? LOG_START);
	await state.set(sessionId, { syncedHead: head }, context);
	return head;
}

/**
 * Fold a session's history into one snapshot: drop the records of the batches it covers, keeping their slots taken,
 * and delete older snapshots. The remote runs this, not clients. The rules of `compactRecords()` need no storage,
 * since a log holds no document copies.
 */
export async function foldSession(options: {
	readonly sessionId: string;
	readonly store: SessionSyncMaintenance;
	readonly context: Context;
}): Promise<Seq | undefined> {
	const { sessionId, store, context } = options;
	const listing = await store.list(sessionId, context);
	const history = remoteHistory(listing);
	if (history.batches.length + (history.snapshot === undefined ? 0 : 1) < 2) return undefined;
	const records: LogRecord[] = [];
	const read = async (bytes: Uint8Array | undefined, what: string) => {
		// Only the remote folds, and it folds one session at a time: what it just listed cannot be gone.
		if (bytes === undefined) throw new Error(`${what} of session ${sessionId} vanished while folding`);
		records.push(...(await decodeBatch(bytes)));
	};
	if (history.snapshot !== undefined) {
		await read(await store.getSnapshot(sessionId, history.snapshot, context), `Snapshot ${history.snapshot}`);
	}
	for (const batch of history.batches) {
		await read(await store.getBatch(sessionId, batch.after, context), `Batch after ${batch.after}`);
	}
	await store.putSnapshot(sessionId, history.head, await encodeBatch(compactRecords(records)), context);
	await store.foldBatches(
		sessionId,
		history.batches.map((batch) => batch.after),
		context,
	);
	await store.deleteSnapshots(
		sessionId,
		listing.snapshots.filter((snapshot) => snapshot < history.head),
		context,
	);
	return history.head;
}

/** Whether a commit should reach the remote soon: what the user typed, a finished answer, a settled submission. */
export function isUrgentCommit(publication: CommitPublication): boolean {
	return publication.changes.some(
		(change) =>
			(change.type === "entry" && (change.value.kind === "pi.user" || change.value.kind === "pi.assistant")) ||
			(change.type === "submission" && (change.value.status === "done" || change.value.status === "unanswered")),
	);
}

export type FlushSchedulerOptions = {
	readonly flush: () => Promise<unknown>;
	/** Arms a timer and returns its disarm. */
	readonly setTimer: (callback: () => void, delayMs: number) => () => void;
	readonly now: () => number;
	/** A failed flush; the scheduler retries it with backoff. */
	readonly onError: (error: unknown) => void;
	/** Delay of an ordinary flush after a commit. Default 5 seconds. */
	readonly intervalMs?: number;
	/** Delay of a flush after an urgent commit. Default 200 milliseconds. */
	readonly urgentMs?: number;
	/** First retry delay after a failed flush, doubling up to `maxRetryMs`. Default 1 second. */
	readonly retryMs?: number;
	/** Default 1 minute. */
	readonly maxRetryMs?: number;
};

/**
 * Decides when to flush: some time after a commit, sooner after an urgent one, one flush at a time. Commits that arrive
 * during a flush keep their urgency and schedule the next one when it ends. A failed flush is retried with backoff
 * until one succeeds, so the last commits of a turn do not wait for the next commit.
 */
export class FlushScheduler {
	readonly #options: FlushSchedulerOptions;
	#due: number | undefined;
	#disarm: (() => void) | undefined;
	#running: Promise<void> | undefined;
	/** When the commits that arrived during a flush want the next one. */
	#pendingDue: number | undefined;
	#failures = 0;
	#closed = false;

	constructor(options: FlushSchedulerOptions) {
		this.#options = options;
	}

	/** A commit landed. */
	notify(urgent: boolean): void {
		if (this.#closed) return;
		const due = this.#options.now() + (urgent ? (this.#options.urgentMs ?? 200) : (this.#options.intervalMs ?? 5000));
		if (this.#running !== undefined) {
			this.#pendingDue = Math.min(this.#pendingDue ?? due, due);
			return;
		}
		this.#arm(due);
	}

	/** Flush now, after a flush underway, and stop scheduling. A failure rejects. */
	async close(): Promise<void> {
		this.#closed = true;
		this.#disarm?.();
		this.#disarm = undefined;
		this.#due = undefined;
		await this.#running;
		await this.#options.flush();
	}

	#arm(due: number): void {
		if (this.#due !== undefined && this.#due <= due) return;
		this.#disarm?.();
		this.#due = due;
		this.#disarm = this.#options.setTimer(() => void this.#run(), Math.max(0, due - this.#options.now()));
	}

	#run(): Promise<void> {
		this.#disarm = undefined;
		this.#due = undefined;
		this.#running = (async () => {
			let retry: number | undefined;
			try {
				await this.#options.flush();
				this.#failures = 0;
			} catch (error) {
				this.#options.onError(error);
				const delay = (this.#options.retryMs ?? 1000) * 2 ** this.#failures;
				this.#failures++;
				retry = this.#options.now() + Math.min(delay, this.#options.maxRetryMs ?? 60_000);
			} finally {
				this.#running = undefined;
			}
			if (this.#closed) return;
			const pending = this.#pendingDue;
			this.#pendingDue = undefined;
			// A retry waits for its backoff even when commits arrived: they flush with it.
			const due = retry ?? pending;
			if (due !== undefined) this.#arm(due);
		})();
		return this.#running;
	}
}
