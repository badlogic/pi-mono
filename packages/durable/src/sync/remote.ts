import type { Context } from "@earendil-works/chord";
import { LOG_START } from "../storage/log.ts";
import type { Seq } from "../types.ts";

/**
 * A slot of a session's remote history: the batch of log records after `after`, up to `to`, uploaded by `device`. A
 * store creates each slot once and never replaces it, so the device whose upload creates it continues the session from
 * `after`, and a device that finds it taken by another one holds a different history.
 */
export type BatchInfo = {
	readonly after: Seq;
	readonly to: Seq;
	readonly device: string;
	/** Folding dropped its records into a snapshot; the slot stays taken. */
	readonly folded?: true;
};

/** What a remote store holds for one session. A snapshot is a complete log up to its sequence, folded from batches. */
export type RemoteListing = {
	readonly batches: readonly BatchInfo[];
	readonly snapshots: readonly Seq[];
};

export type PutBatchResult =
	| { readonly type: "created" }
	/** The slot is taken; by this device, after an upload whose response was lost, or by another one. */
	| { readonly type: "exists"; readonly to: Seq; readonly device: string };

/** The client's view of a remote store. Clients never delete or fold. */
export interface SessionSyncStore {
	/** Create the slot after `after` unless it exists. */
	putBatch(
		sessionId: string,
		after: Seq,
		to: Seq,
		device: string,
		body: Uint8Array,
		context: Context,
	): Promise<PutBatchResult>;
	/** A batch's records; `undefined` when its slot is folded or absent. */
	getBatch(sessionId: string, after: Seq, context: Context): Promise<Uint8Array | undefined>;
	getSnapshot(sessionId: string, to: Seq, context: Context): Promise<Uint8Array | undefined>;
	list(sessionId: string, context: Context): Promise<RemoteListing>;
}

/** The remote's own side: folding history into snapshots, which clients never do. */
export interface SessionSyncMaintenance extends SessionSyncStore {
	putSnapshot(sessionId: string, to: Seq, body: Uint8Array, context: Context): Promise<void>;
	/** Drop the records of these slots, keeping the slots taken so nobody can create them again. */
	foldBatches(sessionId: string, afters: readonly Seq[], context: Context): Promise<void>;
	deleteSnapshots(sessionId: string, snapshots: readonly Seq[], context: Context): Promise<void>;
}

/** What a copy replays to reach the remote's head. */
export type RemoteHistory = {
	/** The snapshot a restore starts from. */
	readonly snapshot?: Seq;
	/**
	 * The batches to replay in order. The first may start before the copy's head, when a pull stopped inside it; its
	 * records at or below the head are skipped.
	 */
	readonly batches: readonly BatchInfo[];
	/** Where replaying them ends. */
	readonly head: Seq;
};

/** The remote's history no longer continues from a copy's head, after folding: restore into a fresh storage. */
export class HistoryUnavailableError extends Error {
	constructor(head: Seq) {
		super(`The remote history does not continue from ${head}`);
		this.name = "HistoryUnavailableError";
	}
}

/**
 * The history a copy at `from` replays, or a restore without `from`. Slots are created once, so at most one batch
 * starts at each sequence and the history is a single chain.
 */
export function remoteHistory(listing: RemoteListing, from?: Seq): RemoteHistory {
	const chain = new Map(listing.batches.map((batch) => [batch.after, batch]));
	let snapshot: Seq | undefined;
	let at: Seq;
	const batches: BatchInfo[] = [];
	if (from === undefined || from === LOG_START) {
		snapshot = listing.snapshots.length === 0 ? undefined : (Math.max(...listing.snapshots) as Seq);
		at = snapshot ?? LOG_START;
	} else {
		at = from;
		// A pull that stopped inside a batch finishes it; only one batch can contain the head.
		const inside = listing.batches.find((batch) => batch.after < from && from < batch.to);
		if (inside !== undefined) {
			batches.push(inside);
			at = inside.to;
		}
	}
	for (let next = chain.get(at); next !== undefined; next = chain.get(at)) {
		batches.push(next);
		at = next.to;
	}
	return { ...(snapshot === undefined ? {} : { snapshot }), batches, head: at };
}

/** The furthest head the remote's history reaches. */
export function remoteHead(listing: RemoteListing): Seq {
	const chain = new Map(listing.batches.map((batch) => [batch.after, batch]));
	let at: Seq = LOG_START;
	for (let next = chain.get(at); next !== undefined; next = chain.get(at)) at = next.to;
	return at;
}
