import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqliteExecutor } from "../../src/sqlite/index.ts";
import * as replication from "../../src/sqlite/replication/node.ts";
import { openReplicatedNodeSqliteDatabase, type ReplicationHooks } from "../../src/sqlite/replication/node.ts";

const WAL_HEADER_BYTES = 32;
const WAL_FRAME_HEADER_BYTES = 24;

/** Committed frames in a WAL file, counted from its header without validating checksums. */
function walCommitFrames(path: string): number {
	const wal = readFileSync(path);
	if (wal.length < WAL_HEADER_BYTES) return 0;
	const pageSize = wal.readUInt32BE(8);
	let commits = 0;
	for (let offset = WAL_HEADER_BYTES; offset + WAL_FRAME_HEADER_BYTES + pageSize <= wal.length; ) {
		if (wal.readUInt32BE(offset + 4) !== 0) commits++;
		offset += WAL_FRAME_HEADER_BYTES + pageSize;
	}
	return commits;
}

function recordingHooks(beforeClose: (executor: SqliteExecutor) => Promise<void> = async () => {}) {
	const hooks = {
		operations: 0,
		afterOperation() {
			hooks.operations++;
		},
		beforeClose,
	} satisfies ReplicationHooks & { operations: number };
	return hooks;
}

describe("replicated Node SQLite connection", () => {
	let directory: string;
	let path: string;

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "chord-replication-"));
		path = join(directory, "replica.sqlite");
	});

	afterEach(() => {
		rmSync(directory, { recursive: true, force: true });
	});

	it("can only be created by opening a file", () => {
		// A constructor would accept connections with automatic checkpoints on, or ones the caller still writes through.
		expect(Object.keys(replication).sort()).toEqual(["openReplicatedNodeSqliteDatabase"]);
	});

	it("refuses databases without a WAL file", async () => {
		for (const target of ["", ":memory:", "file::memory:"]) {
			await expect(openReplicatedNodeSqliteDatabase(target, recordingHooks())).rejects.toThrow(
				"Replication needs a database file path",
			);
		}
	});

	it("opens in WAL mode and never checkpoints on its own", async () => {
		const database = await openReplicatedNodeSqliteDatabase(path, recordingHooks());
		expect(database.path).toBe(path);
		expect(await database.get("PRAGMA journal_mode")).toEqual({ journal_mode: "wal" });
		expect(await database.get("PRAGMA wal_autocheckpoint")).toEqual({ wal_autocheckpoint: 0 });
		await database.exec("CREATE TABLE pages (value BLOB)");
		// SQLite's default would checkpoint once the WAL passes 1,000 pages; write well past that.
		for (let batch = 0; batch < 12; batch++) {
			await database.transaction(async (transaction) => {
				for (let row = 0; row < 100; row++)
					await transaction.run("INSERT INTO pages (value) VALUES (randomblob(4000))");
			});
		}
		expect(walCommitFrames(`${path}-wal`)).toBe(13);
		expect(statSync(`${path}-wal`).size).toBeGreaterThan(1_200 * 4_096);
		await database.close();
	});

	it("reports every operation, including failed ones and statements outside transactions", async () => {
		const hooks = recordingHooks();
		const database = await openReplicatedNodeSqliteDatabase(path, hooks);
		await database.exec("CREATE TABLE notes (value TEXT NOT NULL)");
		await database.run("INSERT INTO notes (value) VALUES (?)", "autocommit");
		await database.get("SELECT value FROM notes");
		await database.all("SELECT value FROM notes");
		await database.transaction(async (transaction) => {
			await transaction.run("INSERT INTO notes (value) VALUES (?)", "transaction");
		});
		await expect(database.run("INSERT INTO notes (value) VALUES (NULL)")).rejects.toThrow();
		expect(hooks.operations).toBe(6);
		await database.exclusive(async (executor) => {
			await executor.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		});
		expect(hooks.operations).toBe(6);
		await database.close();
	});

	it("runs the close hook after earlier operations, while the WAL holds every commit", async () => {
		let framesAtClose = -1;
		let rowsAtClose: unknown;
		const database = await openReplicatedNodeSqliteDatabase(
			path,
			recordingHooks(async (executor) => {
				framesAtClose = walCommitFrames(`${path}-wal`);
				rowsAtClose = await executor.get("SELECT count(*) AS count FROM notes");
			}),
		);
		await database.exec("CREATE TABLE notes (value TEXT)");
		// Called before close and still queued when close is called: these must commit before the hook runs.
		const pending = [1, 2, 3].map((value) => database.run("INSERT INTO notes (value) VALUES (?)", String(value)));
		const closed = database.close();
		expect(database.close()).toBe(closed);
		await Promise.all(pending);
		await closed;

		expect(framesAtClose).toBe(4);
		expect(rowsAtClose).toEqual({ count: 3 });
		// SQLite checkpoints and removes the WAL when the last connection closes.
		expect(existsSync(`${path}-wal`)).toBe(false);
		await expect(database.run("INSERT INTO notes (value) VALUES (?)", "late")).rejects.toThrow(
			"Replicated SQLite database is closed",
		);
		await expect(database.exclusive(async () => {})).rejects.toThrow("Replicated SQLite database is closed");
	});

	it("closes the connection even when the close hook fails", async () => {
		const database = await openReplicatedNodeSqliteDatabase(
			path,
			recordingHooks(async () => {
				throw new Error("spool failed");
			}),
		);
		await database.exec("CREATE TABLE notes (value TEXT)");
		await expect(database.close()).rejects.toThrow("spool failed");
		expect(existsSync(`${path}-wal`)).toBe(false);

		const reopened = await openReplicatedNodeSqliteDatabase(path, recordingHooks());
		expect(await reopened.all("SELECT value FROM notes")).toEqual([]);
		await reopened.close();
	});
});
