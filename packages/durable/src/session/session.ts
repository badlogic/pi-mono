import { type Context, type JsonValue, Watch } from "@earendil-works/chord";
import { awaitWithContext, BACKGROUND_CONTEXT, withoutAbortSignal } from "@earendil-works/chord/context";
import { type Op, track } from "@earendil-works/chord/delta";
import {
	type AnyDocToken,
	addressId,
	checkRecordScope,
	checkRecordVersion,
	materializeDocument,
	resolveAddress,
} from "../documents.ts";
import { ReadOnlySession, SessionFailed, StorageRequestError } from "../errors.ts";
import { idFromNumber } from "../ids.ts";
import { hostTimers, type Timers } from "../timers.ts";
import type {
	CommitChange,
	CommitPublication,
	ConversationDocFamilyToken,
	ConversationDocToken,
	ConversationId,
	ConversationQuery,
	ConversationRecord,
	Cursor,
	DocumentAddress,
	DocumentCommitChange,
	DocumentId,
	DocumentPoint,
	DocumentQuery,
	DocumentRecord,
	DocumentWatch,
	EntryId,
	EntryQuery,
	EntryRecord,
	Id,
	JsonObject,
	Page,
	ReportInfo,
	RewindableConversationDocFamilyToken,
	RewindableConversationDocToken,
	Seq,
	Session,
	SessionDocFamilyToken,
	SessionDocToken,
	SessionEnd,
	SetTimer,
	Storage,
	StorageWrite,
	StoredDocument,
	SubmissionId,
	SubmissionQuery,
	SubmissionRecord,
	TaskDocFamilyToken,
	TaskDocToken,
	TaskId,
	TaskQuery,
	TaskRecord,
	Tx,
} from "../types.ts";
import { type LoadedDocument, Transaction, type TransactionHost, type TransactionScope } from "./transaction.ts";

/** What a document watch observes: the committed value of its incarnation, `null` once it retired. */
type ObservedDocumentValue = Readonly<JsonObject> | null;

/** The default source of a report: a listener, which never fails what ran it. */
const LISTENER: ReportInfo = { type: "listener_error" };

/**
 * Open a Session kernel over one storage backend. `now` is the wall clock for task times; default `Date.now`.
 * `setTimer` arms the timers that evict idle documents; default `setTimeout` (see `HarnessOptions.setTimer`). The first
 * error a Storage method throws fails the Session (`SessionFailed`); see `SessionImpl`.
 */
export function createSession(
	storage: Storage,
	options?: { readonly now?: () => number; readonly documentRetentionMs?: number; readonly setTimer?: SetTimer },
): Session {
	const retention = options?.documentRetentionMs;
	return new SessionImpl(
		storage,
		options?.now,
		retention === undefined ? undefined : () => retention,
		options?.setTimer,
	);
}

/** Default document retention: ten minutes, as for kept contexts. */
let defaultRetention = 600_000;

/** Internal, for tests: the retention of every Session that keeps the default, as a suite run with eviction at once. */
export function setDefaultDocumentRetention(ms: number): void {
	defaultRetention = ms;
}

/**
 * A retention as given, when it is a number of milliseconds, `0` or more (`Infinity` keeps documents); otherwise the
 * default.
 */
export function documentRetention(ms: number | undefined): number {
	return typeof ms === "number" && ms >= 0 ? ms : defaultRetention;
}

/**
 * Session kernel: one mutation line, the loaded document tracker cache, and committed publication.
 *
 * The cache is bounded by use: a document with no watch attached leaves it once it was not read or
 * written for the retention period, and the next access loads it from Storage. Eviction runs as a job on the mutation
 * line, so no transaction ever holds a tracker that leaves.
 *
 * Only committed state is observable. Every commit callback, preparation, Storage settlement, adoption, and
 * publication enqueue runs while the line is held; listeners run later.
 *
 * Storage failures are final. Every Storage call goes through one guard: the first error a Storage method throws, other
 * than for a cancelled caller, fails the Session, as does a commit it cannot adopt. That call gets the error; every later
 * call and every Storage call still underway gets `SessionFailed`; close listeners run at once with the error, and the
 * Session then closes itself, Storage included, and `closed` settles. Nothing retries: transient errors are the
 * Storage's to retry. Reopening recovers from what was committed.
 */
export class SessionImpl implements Session {
	readonly #storage: Storage;
	readonly #documents = new Map<string, LoadedDocument>();
	/** Cached documents with no observer attached, by address, oldest use first, with the time of that use. */
	readonly #idleDocuments = new Map<string, number>();
	/** Observers attached per document incarnation (record ID); a cached incarnation with any is never evicted. */
	readonly #attachedDocuments = new Map<DocumentId, number>();
	readonly #clock: () => number;
	readonly #documentRetentionMs: () => number;
	/** Refuse every commit with writes (`HarnessOptions.readOnly`). */
	readonly #readOnly: boolean;
	readonly #timers: Timers;
	/** The pending eviction: a timer for the oldest idle document, or a line job when the retention is 0. */
	#documentSweep: { readonly at: number; disarm: (() => void) | undefined } | undefined;
	#sweepJobs = 0;
	/** Set once the host declined a background timer: then none is kept, and the end of each commit evicts what expired. */
	#documentTimersUnavailable = false;
	readonly #commitListeners = new Set<(publication: CommitPublication, context: Context) => void>();
	/** The Session's own listeners, such as its scheduler's: they keep memory in step with storage, so a throw fails it. */
	readonly #internalListeners = new Set<(publication: CommitPublication, context: Context) => void>();
	readonly #closeListeners = new Set<() => void>();
	readonly #host: TransactionHost;
	#tail: Promise<void> = Promise.resolve();
	#closing: Promise<void> | undefined;
	#failure: { readonly error: unknown } | undefined;
	/** Set when close reaches the backend: calls that fail from then on fail because it closes. */
	readonly #failed = Promise.withResolvers<never>();
	readonly #closed = Promise.withResolvers<SessionEnd>();

	get closed(): Promise<SessionEnd> {
		return this.#closed.promise;
	}

	/** Internal: the error that failed the Session, if one did. */
	get failure(): { readonly error: unknown } | undefined {
		return this.#failure;
	}

	/** Internal: rejects with `SessionFailed` the moment the Session fails, before work underway has ended; never resolves. */
	get failed(): Promise<never> {
		return this.#failed.promise;
	}

	constructor(
		storage: Storage,
		now: () => number = Date.now,
		documentRetentionMs: () => number | undefined = () => undefined,
		setTimer?: SetTimer,
		readOnly = false,
	) {
		// Waits race it; none has to.
		this.#failed.promise.catch(() => {});
		this.#readOnly = readOnly;
		this.#storage = new GuardedStorage(storage, this);
		this.#timers = hostTimers(setTimer, (error) => this.report(error, { type: "host_error", callback: "setTimer" }));
		// Cache bookkeeping must never change the outcome of the operation it follows: a clock or a retention setting
		// that throws counts as now, and as the default.
		this.#clock = () => {
			try {
				return now();
			} catch {
				return Date.now();
			}
		};
		this.#documentRetentionMs = () => {
			try {
				return documentRetention(documentRetentionMs());
			} catch {
				return documentRetention(undefined);
			}
		};
		this.#host = {
			storage: this.#storage,
			now,
			cached: (id) => {
				const cached = this.#documents.get(id);
				if (cached !== undefined) this.#touchDocument(id);
				return cached;
			},
			load: (definition, addressId, address, context) => this.#loadDocument(definition, addressId, address, context),
			install: (document) => {
				this.#documents.set(document.addressId, document);
				this.#touchDocument(document.addressId);
			},
			evict: (id, recordId) => {
				if (this.#documents.get(id)?.record.id === recordId) this.#dropDocument(id);
			},
			conversationCreated: (tx, record) => this.conversationCreated(tx, record),
		};
	}

	/** The Storage behind the failure guard; every component reads and writes through it. */
	protected get storage(): Storage {
		return this.#storage;
	}

	commit<T>(change: (tx: Tx) => T | Promise<T>, context: Context): Promise<T> {
		return this.commitWith(change, context);
	}

	/**
	 * Internal: fail the Session with `error`, the first wins, and report it once. Admission ends, and close listeners run
	 * now; they read the error from `failure`. The Storage guard calls this; the Harness also calls it for a throw in its
	 * scheduler's own commits.
	 */
	fail(error: unknown, context?: Context): void {
		if (this.#failure !== undefined) return;
		this.#failure = { error };
		this.#failed.reject(new SessionFailed(error));
		// Seal first, so a report handler that calls back finds the Session failed. Closing runs the close listeners
		// synchronously; a failing backend close is the caller's to see, and here nobody waits.
		this.close(BACKGROUND_CONTEXT).catch(() => {});
		this.report(error, { type: "session_failed" }, context);
	}

	/**
	 * Internal commit exposing the concrete transaction and its internal operations, such as the reserved-ID root
	 * bootstrap and task replacement. `scope` sets the default `tx.createTask()` conversation and the task attributed to
	 * appended entries.
	 */
	commitWith<T>(change: (tx: Transaction) => T | Promise<T>, context: Context, scope?: TransactionScope): Promise<T> {
		try {
			this.assertUsable();
		} catch (error) {
			return Promise.reject(error);
		}
		return this.#enqueue(() => this.#runCommit(change, context, scope));
	}

	/** Internal: run a read-only job on the mutation line so multi-read derivations observe one committed state. */
	readOnLine<T>(job: () => Promise<T>): Promise<T> {
		try {
			this.assertUsable();
		} catch (error) {
			return Promise.reject(error);
		}
		return this.#enqueue(async () => {
			this.#assertHealthy();
			return job();
		});
	}

	/**
	 * Internal: a conversation document's current incarnation and value, for a job already running on the line (see
	 * `readOnLine()`). Absent documents are `undefined`.
	 */
	async conversationDocumentOnLine(
		token: ConversationDocToken<JsonObject>,
		conversationId: ConversationId,
		context: Context,
	): Promise<{ readonly record: DocumentRecord; readonly version: number; readonly value: JsonObject } | undefined> {
		const definition = token.definition;
		const resolved = resolveAddress(definition, [conversationId, context]);
		const loaded = await this.#loadDocument(definition, resolved.id, resolved.address, context);
		if (loaded === undefined) return undefined;
		checkRecordScope(definition, loaded.record);
		checkRecordVersion(definition, loaded.record, loaded.storedVersion);
		return { record: loaded.record, version: loaded.valueVersion, value: loaded.tracker.value };
	}

	snapshot<T extends JsonObject>(token: SessionDocToken<T>, context: Context): Promise<Readonly<T> | undefined>;
	snapshot<T extends JsonObject>(
		token: ConversationDocToken<T>,
		conversationId: ConversationId,
		context: Context,
	): Promise<Readonly<T> | undefined>;
	snapshot<T extends JsonObject>(
		token: TaskDocToken<T>,
		taskId: TaskId,
		context: Context,
	): Promise<Readonly<T> | undefined>;
	snapshot<T extends JsonObject, I extends JsonValue>(
		token: SessionDocFamilyToken<T, I>,
		key: string,
		context: Context,
	): Promise<Readonly<T> | undefined>;
	snapshot<T extends JsonObject, I extends JsonValue>(
		token: ConversationDocFamilyToken<T, I>,
		conversationId: ConversationId,
		key: string,
		context: Context,
	): Promise<Readonly<T> | undefined>;
	snapshot<T extends JsonObject, I extends JsonValue>(
		token: TaskDocFamilyToken<T, I>,
		taskId: TaskId,
		key: string,
		context: Context,
	): Promise<Readonly<T> | undefined>;
	async snapshot(token: AnyDocToken, ...args: readonly unknown[]): Promise<JsonObject | undefined> {
		this.assertUsable();
		const definition = token.definition;
		const resolved = resolveAddress(definition, args);
		const context = args[resolved.nextArgument] as Context;
		const cached = this.#documents.get(resolved.id);
		if (cached?.valueVersion === definition.version) this.#touchDocument(resolved.id);
		const loaded =
			cached?.valueVersion === definition.version
				? cached
				: await this.#enqueue(async () => {
						this.#assertHealthy();
						return this.#loadDocument(definition, resolved.id, resolved.address, context);
					});
		if (loaded === undefined) return undefined;
		checkRecordScope(definition, loaded.record);
		checkRecordVersion(definition, loaded.record, loaded.storedVersion);
		return loaded.tracker.value;
	}

	watchDoc<T extends JsonObject>(token: SessionDocToken<T>, context: Context): Promise<DocumentWatch<T> | undefined>;
	watchDoc<T extends JsonObject>(
		token: ConversationDocToken<T>,
		conversationId: ConversationId,
		context: Context,
	): Promise<DocumentWatch<T> | undefined>;
	watchDoc<T extends JsonObject>(
		token: TaskDocToken<T>,
		taskId: TaskId,
		context: Context,
	): Promise<DocumentWatch<T> | undefined>;
	watchDoc<T extends JsonObject, I extends JsonValue>(
		token: SessionDocFamilyToken<T, I>,
		key: string,
		context: Context,
	): Promise<DocumentWatch<T> | undefined>;
	watchDoc<T extends JsonObject, I extends JsonValue>(
		token: ConversationDocFamilyToken<T, I>,
		conversationId: ConversationId,
		key: string,
		context: Context,
	): Promise<DocumentWatch<T> | undefined>;
	watchDoc<T extends JsonObject, I extends JsonValue>(
		token: TaskDocFamilyToken<T, I>,
		taskId: TaskId,
		key: string,
		context: Context,
	): Promise<DocumentWatch<T> | undefined>;
	async watchDoc(token: AnyDocToken, ...args: readonly unknown[]): Promise<DocumentWatch<JsonObject> | undefined> {
		this.assertUsable();
		const definition = token.definition;
		const resolved = resolveAddress(definition, args);
		const context = args[resolved.nextArgument] as Context;
		const signal = context.abortSignal;
		let cancelled = signal?.aborted ?? false;
		const markCancelled = (): void => {
			cancelled = true;
		};
		signal?.addEventListener("abort", markCancelled, { once: true });
		try {
			const watch = await this.#enqueue(async () => {
				this.#assertHealthy();
				if (cancelled) throw cancellationError(signal!);
				const loaded = await this.#loadDocument(definition, resolved.id, resolved.address, context);
				if (cancelled) throw cancellationError(signal!);
				if (loaded === undefined) return undefined;
				return this.#attachDocument(definition, loaded);
			});
			if (watch === undefined) return undefined;
			if (cancelled) {
				watch.cancel();
				throw cancellationError(signal!);
			}
			if (signal !== undefined) watch.observeCancellation(signal);
			return watch as DocumentWatch<JsonObject>;
		} finally {
			signal?.removeEventListener("abort", markCancelled);
		}
	}

	snapshotAsOf<T extends JsonObject>(
		token: RewindableConversationDocToken<T>,
		conversationId: ConversationId,
		at: EntryId,
		context: Context,
	): Promise<Readonly<T> | undefined>;
	snapshotAsOf<T extends JsonObject, I extends JsonValue>(
		token: RewindableConversationDocFamilyToken<T, I>,
		conversationId: ConversationId,
		key: string,
		at: EntryId,
		context: Context,
	): Promise<Readonly<T> | undefined>;
	async snapshotAsOf(token: AnyDocToken, ...args: readonly unknown[]): Promise<JsonObject | undefined> {
		this.assertUsable();
		const definition = token.definition;
		const resolved = resolveAddress(definition, args);
		if (resolved.address.scope.kind !== "conversation") {
			throw new TypeError("Session.snapshotAsOf() requires a conversation document");
		}
		const conversationId = resolved.address.scope.conversationId;
		const atValue = args[resolved.nextArgument];
		if (typeof atValue !== "number" || !Number.isSafeInteger(atValue)) {
			throw new TypeError("Session.snapshotAsOf() requires an entry ID");
		}
		const at = idFromNumber<EntryId>(atValue);
		const context = args[resolved.nextArgument + 1] as Context;
		return this.#enqueue(async () => {
			this.#assertHealthy();
			const storedEntry = await this.#storage.entry(conversationId, at, context);
			if (storedEntry === undefined) {
				throw new Error(`Entry ${at} is not visible from conversation ${conversationId}`);
			}
			const address: DocumentAddress = {
				...resolved.address,
				scope: { kind: "conversation", conversationId: storedEntry.entry.conversationId },
			};
			const record = await this.#storage.findDocument(address, storedEntry.commitSeq, context);
			if (record === undefined) return undefined;
			const stored = await this.#storage.document(record.id, storedEntry.commitSeq, context);
			if (stored === undefined) {
				throw new Error(`Historical document ${record.id} (${record.kind}) cannot be read`);
			}
			return materializeDocument(definition, stored);
		});
	}

	close(context: Context): Promise<void> {
		if (this.#closing === undefined) {
			const cleanup = withoutAbortSignal(context);
			// Seal admission before anything else runs, then stop observers; admitted work settles before Storage closes.
			this.#closing = Promise.resolve()
				.then(() => this.beforeClose())
				.then(() =>
					this.#enqueue(async () => {
						this.#commitListeners.clear();
						this.#internalListeners.clear();
						this.#documents.clear();
						this.#idleDocuments.clear();
						this.#attachedDocuments.clear();
						try {
							await this.#storage.close(cleanup);
						} catch (error) {
							// A Storage that cannot close is a failed one; an earlier failure stays the cause.
							if (this.#failure === undefined) {
								this.#failure = { error };
								this.report(error, { type: "session_failed" });
							}
							throw error;
						}
					}),
				)
				.finally(() => {
					const failure = this.#failure;
					this.#closed.resolve(
						failure === undefined ? { reason: "closed" } : { reason: "failed", error: failure.error },
					);
				});
			this.#notifyClose();
		}
		return awaitWithContext(this.#closing, context);
	}

	/** Run the close listeners once, each on its own: one that fails is reported, and the rest still run. */
	#notifyClose(): void {
		this.#documentSweep?.disarm?.();
		this.#documentSweep = undefined;
		const listeners = [...this.#closeListeners];
		this.#closeListeners.clear();
		for (const listener of listeners) contained(listener, (error) => this.report(error));
	}

	/**
	 * Internal: the Session's failure, and errors of listeners, which never fail what ran them; `info` defaults to a
	 * listener. A plain Session drops them.
	 */
	report(_error: unknown, _info: ReportInfo = LISTENER, _context?: Context): void {}

	/**
	 * Runs inside every transaction that creates or forks a conversation, after the conversation record is staged. A
	 * plain Session stages nothing; a Harness stages its built-in documents.
	 */
	protected conversationCreated(_tx: Transaction, _record: ConversationRecord): Promise<void> {
		return Promise.resolve();
	}

	/**
	 * Internal, for `beforeClose()`: on the line, after every commit admitted before the seal has settled, write what
	 * `writes()` returns then straight to Storage. Nothing is published, since the Session is closing; a failed Session
	 * writes nothing.
	 */
	protected writeAtClose(writes: () => readonly StorageWrite[]): Promise<void> {
		return this.#enqueue(async () => {
			if (this.#failure !== undefined) return;
			const batch = writes();
			if (batch.length > 0) await this.#storage.commit(batch, () => {}, BACKGROUND_CONTEXT);
		});
	}

	/** Runs after close seals admission and before the line closes Storage; must not reject. */
	protected beforeClose(): Promise<void> {
		return Promise.resolve();
	}

	/** Register a synchronous post-adoption listener. It must not block or call Session operations; a throw is reported. */
	subscribeCommits(listener: (publication: CommitPublication, context: Context) => void): () => void {
		this.assertUsable();
		this.#commitListeners.add(listener);
		return () => this.#commitListeners.delete(listener);
	}

	/**
	 * Internal: `subscribeCommits()` for the Session's own components, whose state follows each commit. A throw leaves
	 * that state behind storage, so it fails the Session instead of being reported. They run before host listeners.
	 */
	observeCommits(listener: (publication: CommitPublication, context: Context) => void): () => void {
		this.assertUsable();
		this.#internalListeners.add(listener);
		return () => this.#internalListeners.delete(listener);
	}

	/**
	 * Register a listener called synchronously when close begins, also when a failure closes the Session (`failure` is
	 * then set). It must not block or call Session operations; a throw is reported.
	 */
	subscribeClose(listener: () => void): () => void {
		this.assertUsable();
		this.#closeListeners.add(listener);
		return () => this.#closeListeners.delete(listener);
	}

	/** Drop every loaded tracker on the mutation line; later access cold-loads from Storage. */
	unloadDocuments(): Promise<void> {
		return this.#enqueue(async () => {
			this.#documents.clear();
			this.#idleDocuments.clear();
		});
	}

	/**
	 * Internal, for tests: how many documents the cache holds, how many are idle, how many incarnations are pinned, and how
	 * many sweep jobs were queued on the line so far.
	 */
	get documentCacheSizes(): {
		readonly cached: number;
		readonly idle: number;
		readonly attached: number;
		readonly sweeps: number;
	} {
		return {
			cached: this.#documents.size,
			idle: this.#idleDocuments.size,
			attached: this.#attachedDocuments.size,
			sweeps: this.#sweepJobs,
		};
	}

	/** Note a use of a cached document: an unattached one becomes the newest idle one, and an eviction is scheduled. */
	#touchDocument(addressId: string): void {
		const cached = this.#documents.get(addressId);
		if (cached === undefined || this.#attachedDocuments.has(cached.record.id)) return;
		const now = this.#clock();
		const since = this.#idleDocuments.get(addressId);
		// A hot document moves to the back at most once per granule, a tenth of the retention up to 1 s: it may then leave
		// up to a granule early, which costs a reload, while a commit-heavy workload skips the reordering.
		if (since !== undefined && now - since < Math.min(1_000, this.#documentRetentionMs() / 10)) return;
		this.#idleDocuments.delete(addressId);
		this.#idleDocuments.set(addressId, now);
		// A pending sweep for the oldest document comes first unless the retention was shortened since; then it moves up.
		if (this.#documentSweep === undefined || this.#documentSweep.at > now + this.#documentRetentionMs()) {
			this.#scheduleDocumentSweep();
		}
	}

	#dropDocument(addressId: string): void {
		this.#documents.delete(addressId);
		this.#idleDocuments.delete(addressId);
	}

	/**
	 * Schedule the eviction of the oldest idle document: on the line at once when the retention is 0, otherwise when it
	 * expires, by a background timer (`HarnessOptions.setTimer`), which never keeps the process alive. Where the host
	 * declines it, as the default does in Cloudflare Workers, none is kept: the end of each commit evicts what expired.
	 */
	#scheduleDocumentSweep(): void {
		if (this.#closing !== undefined) return;
		const oldest = this.#idleDocuments.values().next();
		if (oldest.done === true) return;
		const at = oldest.value + this.#documentRetentionMs();
		if (this.#documentSweep !== undefined && this.#documentSweep.at <= at) return;
		this.#documentSweep?.disarm?.();
		// The pending sweep stays set until its job runs, so touches while the line is busy queue no more.
		const sweep: { readonly at: number; disarm: (() => void) | undefined } = { at, disarm: undefined };
		const run = (): void => {
			this.#sweepJobs++;
			this.#enqueue(async () => {
				if (this.#documentSweep === sweep) this.#documentSweep = undefined;
				if (this.#closing === undefined) this.#sweepDocuments();
			}).catch(() => {});
		};
		const delay = at - this.#clock();
		this.#documentSweep = sweep;
		if (delay <= 0) {
			queueMicrotask(run);
			return;
		}
		if (this.#documentTimersUnavailable) {
			this.#documentSweep = undefined;
			return;
		}
		// A timer that fires early sweeps nothing and arms the next one.
		const disarm = this.#timers.background(run, delay);
		if (disarm === undefined) {
			this.#documentTimersUnavailable = true;
			this.#documentSweep = undefined;
			return;
		}
		sweep.disarm = disarm;
	}

	/** On the line: evict the idle documents whose retention passed, oldest first, then schedule the next eviction. */
	#sweepDocuments(): void {
		const expired = this.#clock() - this.#documentRetentionMs();
		for (const [addressId, since] of this.#idleDocuments) {
			if (since > expired) break;
			this.#dropDocument(addressId);
		}
		this.#scheduleDocumentSweep();
	}

	/** Pin a cached incarnation for one observer; the returned release unpins it once, idle again after the last. */
	#pinDocument(addressId: string, recordId: DocumentId): () => void {
		this.#attachedDocuments.set(recordId, (this.#attachedDocuments.get(recordId) ?? 0) + 1);
		this.#idleDocuments.delete(addressId);
		let pinned = true;
		return () => {
			if (!pinned) return;
			pinned = false;
			const count = (this.#attachedDocuments.get(recordId) ?? 1) - 1;
			if (count > 0) {
				this.#attachedDocuments.set(recordId, count);
				return;
			}
			this.#attachedDocuments.delete(recordId);
			if (this.#documents.get(addressId)?.record.id === recordId) this.#touchDocument(addressId);
		};
	}

	async #runCommit<T>(
		change: (tx: Transaction) => T | Promise<T>,
		context: Context,
		scope?: TransactionScope,
	): Promise<T> {
		this.#assertHealthy();
		context.abortSignal?.throwIfAborted();
		const tx = new Transaction(this.#host, context, scope);
		let result: T;
		try {
			result = await change(tx);
			// A callback that caught a failed read must not commit, nor succeed as if it had.
			this.#assertHealthy();
		} catch (error) {
			await tx.settleFailure();
			this.#sweepDocuments();
			throw error;
		}
		let writes: readonly StorageWrite[];
		try {
			writes = await tx.settleSuccess();
		} catch (error) {
			// Settlement aborted every change already.
			this.#sweepDocuments();
			throw error;
		}
		if (writes.length === 0) {
			tx.discard();
			this.#sweepDocuments();
			return result;
		}
		if (this.#readOnly) {
			// Refused before Storage: the Session stays healthy, and the caller sees why.
			tx.discard();
			this.#sweepDocuments();
			throw new ReadOnlySession("a commit with writes");
		}
		// Storage adopts the batch synchronously once it is durable, before its next commit; a throw here would reach
		// Storage, so the callback keeps its own error.
		let adoption: { readonly documents: DocumentCommitChange[] } | { readonly error: unknown } | undefined;
		const adopt = (committed: Seq): void => {
			try {
				adoption = { documents: tx.adopt(committed) };
			} catch (error) {
				adoption = { error };
			}
		};
		let seq: Seq;
		try {
			// Once admitted, caller cancellation does not interrupt Storage settlement.
			seq = await this.#storage.commit(writes, adopt, withoutAbortSignal(context));
		} catch (error) {
			// The guard has failed the Session. A rejection after adoption leaves nothing staged to discard.
			if (adoption === undefined) tx.discard();
			throw error;
		}
		if (adoption === undefined) {
			const error = new Error("Storage committed without adopting the batch");
			this.fail(error);
			throw error;
		}
		if ("error" in adoption) {
			// Storage already committed; a failed adoption leaves memory behind durable state.
			this.fail(adoption.error);
			throw adoption.error;
		}
		const documents = adoption.documents;
		for (const document of documents) this.#touchDocument(addressId(document.record));
		this.#publish(seq, writes, documents, context);
		this.#sweepDocuments();
		return result;
	}

	#publish(
		seq: Seq,
		writes: readonly StorageWrite[],
		documents: readonly DocumentCommitChange[],
		context: Context,
	): void {
		const changes: CommitChange[] | undefined =
			this.#commitListeners.size > 0 || this.#internalListeners.size > 0 ? [] : undefined;
		for (const write of writes) {
			switch (write.type) {
				case "entry":
					context.telemetry.addEvent("pi.durable.entry", {
						"entry.id": write.value.id,
						"entry.kind": write.value.kind,
					});
					changes?.push(write);
					break;
				case "submission":
					if (write.value.status === "done" || write.value.status === "unanswered") {
						context.telemetry.addEvent("pi.durable.submission", {
							"submission.id": write.value.id,
							status: write.value.status,
							"answer.entry_id": write.value.answer,
						});
					}
					changes?.push(write);
					break;
				case "conversation":
				case "task":
					changes?.push(write);
			}
		}
		if (changes === undefined) return;
		for (const document of documents) changes.push(document);
		const publication: CommitPublication = { seq, changes };
		// The commit is durable: a failing listener neither fails the commit nor skips the others.
		for (const listener of [...this.#internalListeners]) {
			contained(
				() => listener(publication, context),
				(error) => this.fail(error, context),
			);
		}
		for (const listener of [...this.#commitListeners]) {
			contained(
				() => listener(publication, context),
				(error) => this.report(error, LISTENER, context),
			);
		}
	}

	/**
	 * Attach a watch to one committed incarnation: check the definition, then forward this incarnation's committed
	 * changes, its retirement, and close. The watch's detach removes both subscriptions.
	 */
	#attachDocument(definition: AnyDocToken["definition"], loaded: LoadedDocument): Watch<ObservedDocumentValue> {
		checkRecordScope(definition, loaded.record);
		checkRecordVersion(definition, loaded.record, loaded.storedVersion);
		let unsubscribeCommit = (): void => {};
		let unsubscribeClose = (): void => {};
		// Attached, the incarnation stays cached; once its last observer detaches, or it retires, it is idle again.
		const unpin = this.#pinDocument(loaded.addressId, loaded.record.id);
		const detach = (): void => {
			unsubscribeCommit();
			unsubscribeClose();
			unpin();
		};
		const observer = new Watch<ObservedDocumentValue>(loaded.tracker.value, detach, (error) => this.report(error));
		const observed = { version: loaded.valueVersion };
		unsubscribeCommit = this.observeCommits((publication, context) => {
			for (const change of publication.changes) {
				if (change.type !== "document" || change.record.id !== loaded.record.id) continue;
				if (change.value === null) {
					// A retired incarnation never changes again: its watch delivers the retirement but pins nothing.
					unpin();
					observer.retire(context);
					continue;
				}
				const ops = observedOperations(observed, change);
				// A migration-only base changes nothing for an observer of the new version.
				if (ops.length === 0) continue;
				observer.advance(change.value, ops, context);
			}
		});
		unsubscribeClose = this.subscribeClose(() => observer.end(this.#failure));
		return observer;
	}

	async #loadDocument(
		definition: AnyDocToken["definition"],
		addressId: string,
		address: DocumentAddress,
		context: Context,
	): Promise<LoadedDocument | undefined> {
		const cached = this.#documents.get(addressId);
		// A tracker serves only tokens of the version its value was materialized for; others reload from Storage.
		if (cached?.valueVersion === definition.version) {
			this.#touchDocument(addressId);
			return cached;
		}
		if (cached !== undefined) this.#dropDocument(addressId);
		const record = await this.#storage.findDocument(address, "current", context);
		if (record === undefined) return undefined;
		const stored = await this.#storage.document(record.id, "current", context);
		if (stored === undefined) throw new Error(`Current document ${record.id} (${record.kind}) cannot be read`);
		const value = materializeDocument(definition, stored);
		const loaded: LoadedDocument = {
			addressId,
			record: stored.record,
			storedVersion: stored.version,
			valueVersion: definition.version,
			deltasSinceBase: stored.deltasSinceBase,
			tracker: track(value),
		};
		this.#documents.set(addressId, loaded);
		this.#touchDocument(addressId);
		return loaded;
	}

	#enqueue<T>(job: () => Promise<T>): Promise<T> {
		const run = this.#tail.then(job);
		this.#tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}

	/** Internal: throw `SessionFailed` when failed, else an error when closing. */
	assertUsable(): void {
		this.#assertHealthy();
		if (this.#closing !== undefined) throw new Error("Session is closed");
	}

	#assertHealthy(): void {
		if (this.#failure !== undefined) throw new SessionFailed(this.#failure.error);
	}
}

/**
 * Run a host callback that must not fail its caller: a throw, or a promise it returns that rejects, goes to `onError`,
 * which is not awaited.
 */
export function contained(callback: () => unknown, onError: (error: unknown) => void): void {
	try {
		const result = callback();
		// Any thenable, also a promise from another realm; `Promise.resolve` adopts it with handlers of its own.
		if (typeof (result as { then?: unknown } | null)?.then === "function") Promise.resolve(result).catch(onError);
	} catch (error) {
		onError(error);
	}
}

/**
 * Operations an observer applies for one committed change. An observer hydrated under another definition version holds
 * a differently shaped value, so it receives the new value as a root replacement instead of operations for that shape.
 */
function observedOperations(
	observed: { version: number },
	change: Extract<DocumentCommitChange, { readonly type: "document" }>,
): readonly Op[] {
	if (change.version === observed.version) return change.ops;
	observed.version = change.version!;
	return [["r", change.value]];
}

function cancellationError(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError");
}

/** What the guard needs of its Session: the failure so far, and how to fail it. */
type FailureLatch = {
	readonly failure: { readonly error: unknown } | undefined;
	fail(error: unknown): void;
};

/**
 * The Session's Storage behind its failure guard; every component of the Session reads and writes through it. Before a
 * call, a failed Session gets `SessionFailed` without reaching the backend. A call that throws fails the Session and
 * rethrows the backend's error, unless it is a `StorageRequestError` or a read whose caller's context was aborted:
 * neither says the Storage is broken.
 * `close()` always reaches the backend, so a failed Session still closes it.
 */
class GuardedStorage implements Storage {
	readonly #storage: Storage;
	readonly #latch: FailureLatch;
	/** Backend calls underway, also those off the Session line, which close waits for before it closes the backend. */
	readonly #underway = new Set<Promise<unknown>>();
	#closing = false;

	constructor(storage: Storage, latch: FailureLatch) {
		this.#storage = storage;
		this.#latch = latch;
	}

	/** Never exempt, whatever it throws: once admitted, whether a failed batch committed is unknown. */
	commit(writes: readonly StorageWrite[], adopt: (seq: Seq) => void, context: Context): Promise<Seq> {
		return this.#call(undefined, () => this.#storage.commit(writes, adopt, context));
	}

	mintId<I extends Id<string>>(): Promise<I> {
		return this.#call(undefined, () => this.#storage.mintId<I>());
	}

	conversation(id: ConversationId, context: Context): Promise<ConversationRecord | undefined> {
		return this.#call(context, () => this.#storage.conversation(id, context));
	}

	scanConversations(
		query: ConversationQuery,
		limit: number,
		cursor: Cursor | undefined,
		context: Context,
	): Promise<Page<ConversationRecord, Cursor>> {
		return this.#call(context, () => this.#storage.scanConversations(query, limit, cursor, context));
	}

	entry(id: EntryId, context: Context): Promise<{ readonly entry: EntryRecord; readonly commitSeq: Seq } | undefined>;
	entry(
		conversationId: ConversationId,
		id: EntryId,
		context: Context,
	): Promise<{ readonly entry: EntryRecord; readonly commitSeq: Seq } | undefined>;
	entry(
		first: EntryId | ConversationId,
		second: EntryId | Context,
		third?: Context,
	): Promise<{ readonly entry: EntryRecord; readonly commitSeq: Seq } | undefined> {
		if (third === undefined) {
			const context = second as Context;
			return this.#call(context, () => this.#storage.entry(first as EntryId, context));
		}
		return this.#call(third, () => this.#storage.entry(first as ConversationId, second as EntryId, third));
	}

	findLatestHeadMarker(
		conversationId: ConversationId,
		atOrBeforeEntryId: EntryId | undefined,
		context: Context,
	): Promise<(EntryRecord & { readonly head: EntryId }) | undefined> {
		return this.#call(context, () => this.#storage.findLatestHeadMarker(conversationId, atOrBeforeEntryId, context));
	}

	scanEntries(
		query: EntryQuery,
		limit: number,
		cursor: Cursor | undefined,
		context: Context,
	): Promise<Page<EntryRecord, Cursor>> {
		return this.#call(context, () => this.#storage.scanEntries(query, limit, cursor, context));
	}

	task(id: TaskId, context: Context): Promise<TaskRecord<JsonValue, JsonValue, JsonValue> | undefined> {
		return this.#call(context, () => this.#storage.task(id, context));
	}

	scanTasks(
		query: TaskQuery,
		limit: number,
		cursor: Cursor | undefined,
		context: Context,
	): Promise<Page<TaskRecord<JsonValue, JsonValue, JsonValue>, Cursor>> {
		return this.#call(context, () => this.#storage.scanTasks(query, limit, cursor, context));
	}

	submission(id: SubmissionId, context: Context): Promise<SubmissionRecord | undefined> {
		return this.#call(context, () => this.#storage.submission(id, context));
	}

	scanSubmissions(
		query: SubmissionQuery,
		limit: number,
		cursor: Cursor | undefined,
		context: Context,
	): Promise<Page<SubmissionRecord, Cursor>> {
		return this.#call(context, () => this.#storage.scanSubmissions(query, limit, cursor, context));
	}

	submissionByRequest(
		conversationId: ConversationId,
		requestId: string,
		context: Context,
	): Promise<SubmissionRecord | undefined> {
		return this.#call(context, () => this.#storage.submissionByRequest(conversationId, requestId, context));
	}

	findDocument(address: DocumentAddress, at: DocumentPoint, context: Context): Promise<DocumentRecord | undefined> {
		return this.#call(context, () => this.#storage.findDocument(address, at, context));
	}

	document(id: DocumentId, at: DocumentPoint, context: Context): Promise<StoredDocument | undefined> {
		return this.#call(context, () => this.#storage.document(id, at, context));
	}

	scanDocuments(
		query: DocumentQuery,
		limit: number,
		cursor: Cursor | undefined,
		context: Context,
	): Promise<Page<DocumentRecord, Cursor>> {
		return this.#call(context, () => this.#storage.scanDocuments(query, limit, cursor, context));
	}

	/**
	 * Close the backend once every call underway has settled, so none outlives it or fails after `closed` settles. New
	 * calls are refused from here on: a paged read must not start its next page while the backend closes.
	 */
	async close(context: Context): Promise<void> {
		this.#closing = true;
		await Promise.allSettled([...this.#underway]);
		return this.#storage.close(context);
	}

	/**
	 * Run one backend call under the guard. `read` is a read's context; `commit()` and `mintId()` pass none, so nothing
	 * exempts their errors: once a batch is admitted, whether it committed is unknown. A call still underway when another
	 * fails the Session ends with `SessionFailed` too, whatever it returns: nothing it read or wrote is used.
	 */
	async #call<T>(read: Context | undefined, run: () => Promise<T>): Promise<T> {
		this.#assertHealthy();
		if (this.#closing) throw new Error("Session is closed");
		let result: T;
		// An async wrapper, so a backend that throws synchronously is guarded too.
		const call = (async () => run())();
		this.#underway.add(call);
		try {
			result = await call;
		} catch (error) {
			this.#assertHealthy();
			// An invalid read, or one its caller cancelled, says nothing about the Storage; it fails that call only.
			const exempt =
				read !== undefined && (error instanceof StorageRequestError || read.abortSignal?.aborted === true);
			if (!exempt) this.#latch.fail(error);
			throw error;
		} finally {
			this.#underway.delete(call);
		}
		this.#assertHealthy();
		return result;
	}

	#assertHealthy(): void {
		const failure = this.#latch.failure;
		if (failure !== undefined) throw new SessionFailed(failure.error);
	}
}
