import { type SessionMutation, SessionState } from "../state.ts";
import {
	type BranchBounds,
	type Entry,
	type EntryQuery,
	type ForkOptions,
	type LanePointer,
	type LaneRecord,
	type LogItem,
	type LogOptions,
	type NewRecord,
	type OperationStartedRecord,
	type ProvisionedEntry,
	type RecordQuery,
	SessionError,
	type SessionStats,
	type SessionStorage,
} from "../types.ts";
import { AppendBatcher } from "./append-batcher.ts";
import { encodeHeader, encodeMutation, metadataFromHeader, parseHeader, parseMutation } from "./codec.ts";
import { fileResult, invalidFile, JsonlDecodeError } from "./errors.ts";
import type { JsonlSessionMetadata, JsonlSessionRepoFileSystem, JsonlV4Header } from "./types.ts";

/**
 * Build a complete sibling temporary file, then atomically rename it over the destination.
 * The populate callback must create or overwrite `tempPath` with the complete file. The
 * destination is untouched until the rename commits, so a process crash while populating
 * can leave only the ignored `.tmp` file behind.
 *
 * Rejects when population or rename fails. On rejection, temporary-file removal is
 * best-effort and the original error is preserved. Callers must serialize publications to
 * the same destination because they share its deterministic `.tmp` path.
 */
async function publishFileAtomically(
	fs: JsonlSessionRepoFileSystem,
	destinationPath: string,
	populate: (tempPath: string) => Promise<void>,
): Promise<void> {
	const tempPath = `${destinationPath}.tmp`;
	try {
		await populate(tempPath);
		fileResult(await fs.renameFile(tempPath, destinationPath), `Failed to publish staged file ${destinationPath}`);
	} catch (error) {
		await fs.remove(tempPath, { force: true });
		throw error;
	}
}

export class JsonlSessionStorage implements SessionStorage<JsonlSessionMetadata> {
	private readonly fs: JsonlSessionRepoFileSystem;
	private readonly metadata: JsonlSessionMetadata;
	private state = new SessionState();
	private readonly appends: AppendBatcher<void>;
	private tail: Promise<void> = Promise.resolve();
	private writeAcks: Promise<void>[] | undefined;

	constructor(fs: JsonlSessionRepoFileSystem, metadata: JsonlSessionMetadata) {
		this.fs = fs;
		this.metadata = structuredClone(metadata);
		this.appends = new AppendBatcher<void>(async (bytes) =>
			this.fs.appendFile(this.metadata.path, bytes),
		);
	}

	static async create(
		fs: JsonlSessionRepoFileSystem,
		path: string,
		header: JsonlV4Header,
	): Promise<JsonlSessionStorage> {
		fileResult(await fs.writeFile(path, encodeHeader(header)), `Failed to initialize session ${path}`);
		const fileInfo = fileResult(await fs.fileInfo(path), `Failed to read session metadata ${path}`);
		return new JsonlSessionStorage(fs, metadataFromHeader(header, path, fileInfo.mtimeMs));
	}

	static async load(fs: JsonlSessionRepoFileSystem, path: string): Promise<JsonlSessionStorage> {
		const content = fileResult(await fs.readTextFile(path), `Failed to read session ${path}`);
		const physicalLines = content.split("\n");
		if (physicalLines.at(-1) === "") physicalLines.pop();
		if (physicalLines.length === 0 || !physicalLines[0]) {
			throw invalidFile(path, 1, new JsonlDecodeError("schema", "is missing a header"));
		}
		const headerResult = parseHeader(physicalLines[0]);
		if (!headerResult.ok) throw invalidFile(path, 1, headerResult.error);
		const fileInfo = fileResult(await fs.fileInfo(path), `Failed to read session metadata ${path}`);
		const storage = new JsonlSessionStorage(fs, metadataFromHeader(headerResult.value, path, fileInfo.mtimeMs));
		for (let index = 1; index < physicalLines.length; index++) {
			const line = physicalLines[index]!;
			const mutationResult = parseMutation(line);
			if (!mutationResult.ok) {
				const isTornTail = index === physicalLines.length - 1 && mutationResult.error.kind === "syntax";
				if (isTornTail) {
					// Drop the unacknowledged partial append by atomically publishing the valid prefix.
					const validPrefix = `${physicalLines.slice(0, index).join("\n")}\n`;
					await publishFileAtomically(fs, path, async (tempPath) => {
						fileResult(await fs.writeFile(tempPath, validPrefix), `Failed to stage torn-tail repair ${path}`);
					});
					return storage;
				}
				throw invalidFile(path, index + 1, mutationResult.error);
			}
			try {
				storage.applyMutation(mutationResult.value);
			} catch (error) {
				if (error instanceof SessionError && error.code === "invalid_entry") {
					throw invalidFile(path, index + 1, error);
				}
				throw error;
			}
		}
		if (!content.endsWith("\n")) {
			fileResult(await fs.appendFile(path, "\n"), `Failed to repair unterminated session tail ${path}`);
		}
		return storage;
	}

	async fork(path: string, header: JsonlV4Header, options: ForkOptions): Promise<JsonlSessionStorage> {
		const mutations = this.state.createForkMutations(options);
		await publishFileAtomically(this.fs, path, async (tempPath) => {
			const targetStorage = await JsonlSessionStorage.create(this.fs, tempPath, header);
			for (const mutation of mutations) {
				// Staging keeps the upstream one-write-per-mutation, post-write ordering:
				// awaiting the ack stops the populate on the first failed append exactly
				// where callers expect, before the atomic rename can publish a partial fork.
				await targetStorage.appendMutationAwaited(mutation);
				targetStorage.applyMutation(mutation);
			}
			// The atomic publish must not rename the temp file while batched appends are
			// still pending — the forked file would be stale and the writes would land on
			// a new ghost temp path.
			await targetStorage.drain();
		});
		return JsonlSessionStorage.load(this.fs, path);
	}

	async drain(): Promise<void> {
		await this.tail;
		await this.appends.flush();
	}

	async getMetadata(): Promise<JsonlSessionMetadata> {
		return structuredClone(this.metadata);
	}

	async getLanes(): Promise<LanePointer[]> {
		return this.state.getLanes();
	}

	createLane(lane: string, at: string | null): Promise<void> {
		return this.enqueue(async () => {
			this.state.validateNewLane(lane);
			this.state.validateTarget(at);
			const mutation: SessionMutation = { kind: "lane", seq: this.state.nextSequence, lane, leafId: at };
			await this.appendMutation(mutation);
			this.applyMutation(mutation);
		});
	}

	moveLane(lane: string, to: string | null): Promise<void> {
		return this.enqueue(async () => {
			this.state.requireLane(lane);
			this.state.validateTarget(to);
			const mutation: SessionMutation = { kind: "lane", seq: this.state.nextSequence, lane, leafId: to };
			await this.appendMutation(mutation);
			this.applyMutation(mutation);
		});
	}

	appendEntry<TEntry extends Entry>(newEntry: ProvisionedEntry<TEntry>, lane: string): Promise<TEntry> {
		return this.enqueue(async () => {
			const parentId = this.state.requireLane(lane);
			this.state.validateUnusedId(newEntry.id);
			const entry = {
				...structuredClone(newEntry),
				parentId,
				seq: this.state.nextSequence,
				timestamp: Date.now(),
			} as unknown as TEntry;
			const mutation: SessionMutation = { kind: "entry", lane, entry };
			await this.appendMutation(mutation);
			this.applyMutation(mutation);
			return structuredClone(entry);
		});
	}

	appendRecord<TRecord extends LaneRecord>(newRecord: NewRecord<TRecord>): Promise<TRecord> {
		return this.enqueue(async () => {
			this.state.requireLane(newRecord.lane);
			this.state.validateUnusedId(newRecord.id);
			const currentOpenOperationId = this.state.findOpenOperations(newRecord.lane, { limit: 1 })[0]?.id;
			if (newRecord.type === "operation_started" && currentOpenOperationId !== undefined) {
				throw new SessionError(
					"storage",
					`Lane ${newRecord.lane} already has an open operation ${currentOpenOperationId}`,
				);
			}
			const record = {
				...structuredClone(newRecord),
				seq: this.state.nextSequence,
				timestamp: Date.now(),
			} as unknown as TRecord;
			const mutation: SessionMutation = { kind: "record", record };
			await this.appendMutation(mutation);
			this.applyMutation(mutation);
			return structuredClone(record);
		});
	}

	async getEntry(id: string): Promise<Entry | undefined> {
		const entry = this.state.getEntry(id);
		return entry === undefined ? undefined : structuredClone(entry);
	}

	async findEntries(query: EntryQuery = {}): Promise<Entry[]> {
		return structuredClone(this.state.findEntries(query));
	}

	async findEntriesOnBranch(query: EntryQuery & BranchBounds & { start: string }): Promise<Entry[]> {
		return structuredClone(this.state.findEntriesOnBranch(query));
	}

	async findRecords<K extends LaneRecord["type"]>(
		query: RecordQuery & { type: K },
	): Promise<Extract<LaneRecord, { type: K }>[]>;
	async findRecords(query?: RecordQuery): Promise<LaneRecord[]>;
	async findRecords(query: RecordQuery = {}): Promise<LaneRecord[]> {
		return structuredClone(this.state.findRecords(query));
	}

	async findOpenOperations(lane: string, options?: { limit?: number }): Promise<OperationStartedRecord[]> {
		return structuredClone(this.state.findOpenOperations(lane, options));
	}

	async getLog(options: LogOptions = {}): Promise<LogItem[]> {
		return structuredClone(this.state.getLog(options));
	}

	async getName(): Promise<string | undefined> {
		return this.state.getName();
	}

	setName(name: string | undefined): Promise<void> {
		return this.enqueue(async () => {
			const mutation: SessionMutation = { kind: "fact", seq: this.state.nextSequence, fact: "name", name };
			await this.appendMutation(mutation);
			this.applyMutation(mutation);
		});
	}

	async getLabel(id: string): Promise<string | undefined> {
		return this.state.getLabel(id);
	}

	setLabel(id: string, label: string | undefined): Promise<void> {
		return this.enqueue(async () => {
			this.state.validateTarget(id);
			const mutation: SessionMutation = {
				kind: "fact",
				seq: this.state.nextSequence,
				fact: "label",
				targetId: id,
				label,
			};
			await this.appendMutation(mutation);
			this.applyMutation(mutation);
		});
	}

	async getStats(): Promise<SessionStats> {
		return structuredClone(this.state.getStats());
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const writeAcks: Promise<void>[] = [];
		const result = this.tail
			.then(() => {
				this.writeAcks = writeAcks;
				return operation();
			})
			.finally(() => {
				this.writeAcks = undefined;
			});
		this.tail = result.then(
			() => undefined,
			() => undefined,
		);
		// P5 crash contract: the caller's promise resolves only after every write carrying
		// this operation's mutations has reached the OS (kill-9 never loses committed turns),
		// while the serialized chain itself advances without waiting on the write so queued
		// appends may coalesce into one write syscall.
		return result.then(
			async (value) => {
				try {
					await Promise.all(writeAcks);
				} catch (error) {
					// Pinned contract: after an append failure the state must not advance
					// and the queue must not be poisoned — settle every other pending
					// write, then converge on the durable log (the file is the truth).
					await Promise.allSettled(writeAcks);
					await this.appends.flush();
					try {
						const recovered = await JsonlSessionStorage.load(this.fs, this.metadata.path);
						this.state = recovered.state;
					} catch {
						// Best-effort convergence: the append error is the contract; a missing
						// or unreadable file must not replace it.
					}
					throw error;
				}
				return value;
			},
			async (error) => {
				await Promise.allSettled(writeAcks);
				throw error;
			},
		);
	}

	private appendMutation(mutation: SessionMutation): Promise<void> {
		const writeAck = this.appends.append(encodeMutation(mutation));
		if (this.writeAcks) this.writeAcks.push(writeAck);
		return Promise.resolve();
	}

	/** Post-write ordering for callers outside the batching window (fork staging). */
	private appendMutationAwaited(mutation: SessionMutation): Promise<void> {
		return this.appends.append(encodeMutation(mutation));
	}

	private applyMutation(mutation: SessionMutation): void {
		this.state.applyMutation(mutation);
	}
}
