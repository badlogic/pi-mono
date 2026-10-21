import type { Context } from "@earendil-works/chord";
import type { FileError, FileSystem, Result } from "../env/index.ts";
import { seqFromNumber } from "../ids.ts";
import type { Seq } from "../types.ts";
import type { BatchInfo, PutBatchResult, RemoteListing, SessionSyncMaintenance } from "./remote.ts";

const pad = (value: number): string => String(value).padStart(16, "0");
const SLOT_NAME = /^(\d{16})\.json$/;
const SNAPSHOT_NAME = /^(\d{16})\.batch$/;

function unwrap<T>(result: Result<T, FileError>): T {
	if (!result.ok) throw result.error;
	return result.value;
}

/**
 * A remote store in a directory, laid out as the real remote is: per session, one slot per batch start, holding where
 * the batch ends and which device created it, and snapshots named by their end. Creating a slot is check-then-write,
 * without the atomicity of the real remote across processes: for development and tests, with one process writing.
 *
 * ```text
 * {root}/{session}/slots/{after}.json     { after, to, device, folded? }, written once
 * {root}/{session}/batches/{after}.batch  the records, until folded
 * {root}/{session}/snapshots/{to}.batch
 * ```
 */
export class FileSystemSyncRemote implements SessionSyncMaintenance {
	readonly #fs: FileSystem;
	readonly #root: string;

	constructor(fs: FileSystem, root: string) {
		this.#fs = fs;
		this.#root = root;
	}

	async putBatch(
		sessionId: string,
		after: Seq,
		to: Seq,
		device: string,
		body: Uint8Array,
		context: Context,
	): Promise<PutBatchResult> {
		const existing = await this.#slot(sessionId, after, context);
		if (existing !== undefined) return { type: "exists", to: existing.to, device: existing.device };
		await this.#write([sessionId, "batches"], `${pad(after)}.batch`, body, context);
		// The slot is written last: it is what makes the batch exist.
		const slot: BatchInfo = { after, to, device };
		await this.#write(
			[sessionId, "slots"],
			`${pad(after)}.json`,
			new TextEncoder().encode(JSON.stringify(slot)),
			context,
		);
		return { type: "created" };
	}

	async getBatch(sessionId: string, after: Seq, context: Context): Promise<Uint8Array | undefined> {
		const slot = await this.#slot(sessionId, after, context);
		if (slot === undefined || slot.folded) return undefined;
		return this.#read(context, sessionId, "batches", `${pad(after)}.batch`);
	}

	getSnapshot(sessionId: string, to: Seq, context: Context): Promise<Uint8Array | undefined> {
		return this.#read(context, sessionId, "snapshots", `${pad(to)}.batch`);
	}

	async putSnapshot(sessionId: string, to: Seq, body: Uint8Array, context: Context): Promise<void> {
		await this.#write([sessionId, "snapshots"], `${pad(to)}.batch`, body, context);
	}

	async foldBatches(sessionId: string, afters: readonly Seq[], context: Context): Promise<void> {
		for (const after of afters) {
			const slot = await this.#slot(sessionId, after, context);
			if (slot === undefined || slot.folded) continue;
			const folded: BatchInfo = { ...slot, folded: true };
			await this.#write(
				[sessionId, "slots"],
				`${pad(after)}.json`,
				new TextEncoder().encode(JSON.stringify(folded)),
				context,
			);
			const body = await this.#path(context, sessionId, "batches", `${pad(after)}.batch`);
			unwrap(await this.#fs.remove(body, { force: true }, context));
		}
	}

	async deleteSnapshots(sessionId: string, snapshots: readonly Seq[], context: Context): Promise<void> {
		for (const to of snapshots) {
			const path = await this.#path(context, sessionId, "snapshots", `${pad(to)}.batch`);
			unwrap(await this.#fs.remove(path, { force: true }, context));
		}
	}

	async list(sessionId: string, context: Context): Promise<RemoteListing> {
		const batches: BatchInfo[] = [];
		for (const name of await this.#names(context, sessionId, "slots")) {
			const match = SLOT_NAME.exec(name);
			if (match === null) continue;
			const slot = await this.#slot(sessionId, seqFromNumber(Number(match[1])), context);
			if (slot !== undefined) batches.push(slot);
		}
		const snapshots: Seq[] = [];
		for (const name of await this.#names(context, sessionId, "snapshots")) {
			const match = SNAPSHOT_NAME.exec(name);
			if (match !== null) snapshots.push(seqFromNumber(Number(match[1])));
		}
		return { batches, snapshots };
	}

	async #slot(sessionId: string, after: Seq, context: Context): Promise<BatchInfo | undefined> {
		const bytes = await this.#read(context, sessionId, "slots", `${pad(after)}.json`);
		return bytes === undefined ? undefined : (JSON.parse(new TextDecoder().decode(bytes)) as BatchInfo);
	}

	async #names(context: Context, ...parts: string[]): Promise<string[]> {
		const result = await this.#fs.listDir(await this.#path(context, ...parts), context);
		if (!result.ok && result.error.code === "not_found") return [];
		return unwrap(result).map((info) => info.name);
	}

	async #read(context: Context, ...parts: string[]): Promise<Uint8Array | undefined> {
		const result = await this.#fs.readBinaryFile(await this.#path(context, ...parts), context);
		if (!result.ok && result.error.code === "not_found") return undefined;
		return unwrap(result);
	}

	/** Write through a temporary file and a rename, so a reader never sees half a file. */
	async #write(directory: readonly string[], name: string, body: Uint8Array, context: Context): Promise<void> {
		unwrap(await this.#fs.createDir(await this.#path(context, ...directory), { recursive: true }, context));
		const path = await this.#path(context, ...directory, name);
		const temporary = await this.#path(context, ...directory, `${name}.tmp`);
		unwrap(await this.#fs.writeFile(temporary, body, context));
		unwrap(await this.#fs.renameFile(temporary, path, context));
	}

	async #path(context: Context, ...parts: string[]): Promise<string> {
		return unwrap(await this.#fs.joinPath([this.#root, ...parts], context));
	}
}
