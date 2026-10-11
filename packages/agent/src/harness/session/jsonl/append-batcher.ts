/**
 * Write-coalescing batcher for session JSONL appends (P5, ms-22-p5-jsonl).
 *
 * Crash contract (the fork behavior this file exists to preserve): a caller's promise
 * resolves only after the `write()` that carries its bytes has reached the OS, so
 * SIGKILL can never lose an acknowledged (committed) mutation or turn. Batching may
 * coalesce write syscalls — only unacknowledged bytes may share a later write; an
 * acknowledged record is never deferred again.
 */
import { fileResult } from "./errors.ts";
import type { FileError, Result } from "../../types.ts";

export type AppendWrite<T> = (bytes: string) => Promise<Result<T, FileError>>;

interface PendingAppend<T> {
	bytes: string;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
}

export class AppendBatcher<T = void> {
	private readonly write: AppendWrite<T>;
	private pending: PendingAppend<T>[] = [];
	private scheduled = false;

	constructor(write: AppendWrite<T>) {
		this.write = write;
	}

	/** Enqueue bytes; resolves after the flush write carrying them reaches the OS. */
	append(bytes: string): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.pending.push({ bytes, resolve, reject });
			if (!this.scheduled) {
				this.scheduled = true;
				setImmediate(() => {
					this.scheduled = false;
					void this.flush();
				});
			}
		});
	}

	/** Write every pending append in one write() and settle each caller. */
	async flush(): Promise<void> {
		const batch = this.pending;
		this.pending = [];
		if (batch.length === 0) return;
		try {
			const value = fileResult(await this.write(batch.map((item) => item.bytes).join("")), "Failed to append session");
			for (const item of batch) item.resolve(value);
		} catch (error) {
			for (const item of batch) item.reject(error);
		}
	}
}
