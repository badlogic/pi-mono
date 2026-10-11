/**
 * P5 pin tests — session JSONL append batching (fork behavior).
 *
 * These FAIL if the fork behavior regresses:
 *   1. a mutator promise resolves only after its bytes' write() reached the OS
 *      (kill-9 must never lose a committed turn);
 *   2. queued appends coalesce into one write() syscall (the P5 batching behavior);
 *   3. a write failure rejects the mutator promise (error contract preserved);
 *   4. drain() does not return before pending writes land;
 *   5. the batched transcript is byte-identical to one-write-per-mutation output.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "../../../src/harness/env/nodejs.ts";
import { AppendBatcher } from "../../../src/harness/session/jsonl/append-batcher.ts";
import {
	type JsonlSessionMetadata,
	JsonlSessionStorage,
} from "../../../src/harness/session/jsonl/storage.ts";
import type { JsonlSessionRepoFileSystem } from "../../../src/harness/session/jsonl/types.ts";
import type { FileError, Result } from "../../../src/harness/types.ts";

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-agent-append-batcher-"));
	tempDirs.push(dir);
	return dir;
}

function memoryWrite(): {
	writes: string[];
	batcher: AppendBatcher<void>;
	pendingResolvers: Array<() => void>;
} {
	const writes: string[] = [];
	const pendingResolvers: Array<() => void> = [];
	const batcher = new AppendBatcher<void>(async (bytes) => {
		await new Promise<void>((resolve) => pendingResolvers.push(resolve));
		writes.push(bytes);
		return { ok: true, value: undefined } as Result<void, FileError>;
	});
	return { writes, batcher, pendingResolvers };
}

describe("AppendBatcher", () => {
	it("coalesces same-tick appends into one write syscall", async () => {
		const { writes, batcher, pendingResolvers } = memoryWrite();
		const acks = [batcher.append("a\n"), batcher.append("b\n"), batcher.append("c\n")];
		await new Promise((resolve) => setImmediate(resolve));
		expect(writes).toEqual([]);
		pendingResolvers.splice(0).forEach((resolve) => resolve());
		await Promise.all(acks);
		expect(writes).toEqual(["a\nb\nc\n"]);
	});

	it("resolves each caller only after the write carrying its bytes lands (kill-9 contract)", async () => {
		const { writes, batcher, pendingResolvers } = memoryWrite();
		let first = false;
		const firstAck = batcher.append("x\n").then(() => {
			first = true;
		});
		const secondAck = batcher.append("y\n");
		await new Promise((resolve) => setImmediate(resolve));
		expect(first).toBe(false);
		expect(writes).toEqual([]);
		pendingResolvers.splice(0).forEach((resolve) => resolve());
		await Promise.all([firstAck, secondAck]);
		expect(first).toBe(true);
		expect(writes).toEqual(["x\ny\n"]);
	});

	it("rejects every covered caller when the write fails", async () => {
		const batcher = new AppendBatcher<void>(async () => ({ ok: false, error: { code: "EIO" } as FileError }));
		const acks = [batcher.append("a\n"), batcher.append("b\n")];
		await expect(Promise.all(acks)).rejects.toThrow("Failed to append session");
	});
});

describe("JsonlSessionStorage append batching (fork pin)", () => {
	function storageWithSpy(root: string, failWrites = false): {
		storage: JsonlSessionStorage;
		calls: string[];
		deferred: Array<() => void>;
		path: string;
	} {
		const env = new NodeExecutionEnv({ cwd: root });
		const calls: string[] = [];
		const deferred: Array<() => void> = [];
		const fs = Object.create(env) as JsonlSessionRepoFileSystem;
		const path = join(root, "session.jsonl");
		const appendFile = env.appendFile.bind(env);
		fs.appendFile = async (target: string, content: string) => {
			calls.push(content);
			await new Promise<void>((resolve) => deferred.push(resolve));
			if (failWrites) return { ok: false, error: { code: "EIO" } } as never;
			return appendFile(target, content);
		};
		const metadata = { path, createdAt: 1, id: "session" } as unknown as JsonlSessionMetadata;
		return { storage: new JsonlSessionStorage(fs, metadata), calls, deferred, path };
	}

	async function untilCalls(deferred: Array<() => void>, count: number): Promise<void> {
		while (deferred.length < count) await new Promise((resolve) => setImmediate(resolve));
	}

	it("pin 1+2: mutator promise waits for its write while queued appends coalesce", async () => {
		const { storage, calls, deferred } = storageWithSpy(tempDir());
		let firstAcked = false;
		const first = storage.setName("alpha").then(() => {
			firstAcked = true;
		});
		const second = storage.setName("beta");
		await untilCalls(deferred, 1);
		expect(calls).toHaveLength(1); // both mutations share one write syscall
		expect(firstAcked).toBe(false); // nothing acknowledged before the write lands
		deferred.splice(0).forEach((resolve) => resolve());
		await Promise.all([first, second]);
		expect(firstAcked).toBe(true);
		const lines = readFileSync((storage as unknown as { metadata: { path: string } }).metadata.path, "utf8")
			.trim()
			.split("\n");
		expect(lines).toHaveLength(2);
	});

	it("pin 3: write failure rejects the mutator promise", async () => {
		const { storage, deferred } = storageWithSpy(tempDir(), true);
		const run = storage.setName("boom");
		await untilCalls(deferred, 1);
		deferred.splice(0).forEach((resolve) => resolve());
		await expect(run).rejects.toThrow("Failed to append session");
	});

	it("pin 4: drain() waits for pending writes", async () => {
		const { storage, calls, deferred } = storageWithSpy(tempDir());
		void storage.setName("drain-me");
		const drained = storage.drain().then(() => calls.length);
		await untilCalls(deferred, 1);
		deferred.splice(0).forEach((resolve) => resolve());
		expect(await drained).toBe(1);
	});

	it("pin 5: batched transcript equals the concatenated mutations byte-for-byte", async () => {
		const { storage, calls, deferred } = storageWithSpy(tempDir());
		const acks = [storage.setName("one"), storage.setName("two"), storage.setName("three")];
		await untilCalls(deferred, 1);
		deferred.splice(0).forEach((resolve) => resolve());
		await Promise.all(acks);
		const file = readFileSync((storage as unknown as { metadata: { path: string } }).metadata.path, "utf8");
		expect(calls.join("")).toBe(file);
	});
});
