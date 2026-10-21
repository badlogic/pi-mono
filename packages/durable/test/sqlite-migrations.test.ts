import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { afterEach, describe, expect, it } from "vitest";
import { idFromNumber, seqFromNumber } from "../src/ids.ts";
import {
	applySqliteMigrations,
	CURRENT_SQLITE_SCHEMA_VERSION,
	SQLITE_MIGRATIONS,
	type SqliteMigration,
} from "../src/storage/sqlite/index.ts";
import { openNodeSqliteDatabase, openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import { type EntryId, ROOT_CONVERSATION_ID } from "../src/types.ts";

const directories = new Set<string>();

async function databasePath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "pi-durable-migrations-"));
	directories.add(directory);
	return join(directory, "storage.sqlite");
}

afterEach(async () => {
	for (const directory of directories) await rm(directory, { recursive: true, force: true });
	directories.clear();
});

describe("durable SQLite migrations", () => {
	it("creates the current schema and can be applied repeatedly", async () => {
		const database = await openNodeSqliteDatabase(await databasePath());
		try {
			await applySqliteMigrations(database);
			await applySqliteMigrations(database);
			expect(await database.get("SELECT version FROM durable_schema WHERE singleton = 1")).toEqual({
				version: CURRENT_SQLITE_SCHEMA_VERSION,
			});
			expect(await database.get("SELECT next_id, next_seq FROM durable_metadata WHERE singleton = 1")).toEqual({
				next_id: "2",
				next_seq: 1,
			});
		} finally {
			await database.close();
		}
	});

	it("stamps records stored before version 3 with sequence 0, which only a complete log reads", async () => {
		const path = await databasePath();
		const database = await openNodeSqliteDatabase(path);
		await applySqliteMigrations(database, SQLITE_MIGRATIONS.slice(0, 2));
		const task = {
			id: 2,
			conversationId: 1,
			kind: "test.task",
			version: 1,
			input: null,
			background: false,
			abortRequested: false,
			state: { status: "pending", checkpoint: { phase: "run" } },
		};
		await database.exec(`
			INSERT INTO record_ids (id, record_type) VALUES (1, 'conversation'), (2, 'task'), (3, 'entry');
			INSERT INTO conversations (id, record) VALUES (1, '{"id":1}');
			INSERT INTO tasks (id, conversation_id, kind, status, abort_requested, background, record)
				VALUES (2, 1, '"test.task"', 'pending', 0, 0, '${JSON.stringify(task)}');
			INSERT INTO entries (id, conversation_id, commit_seq, record)
				VALUES (3, 1, 2, '{"id":3,"conversationId":1,"kind":"message"}');
			UPDATE durable_metadata SET next_id = '4', next_seq = 3 WHERE singleton = 1;
		`);
		await database.close();

		const storage = await openNodeSqliteStorage(path);
		try {
			const log = [];
			for await (const record of storage.log(undefined, BACKGROUND_CONTEXT)) log.push(record);
			expect(log).toEqual([
				{
					seq: 2,
					writes: [
						{ type: "conversation", value: { id: 1 } },
						{ type: "task", value: task },
						{ type: "entry", value: { id: 3, conversationId: 1, kind: "message" } },
					],
				},
			]);
			// A replica holding sequence 1 already holds them.
			const after = [];
			for await (const record of storage.log(seqFromNumber(1), BACKGROUND_CONTEXT)) after.push(record);
			expect(after).toEqual([
				{ seq: 2, writes: [{ type: "entry", value: { id: 3, conversationId: 1, kind: "message" } }] },
			]);
		} finally {
			await storage.close(BACKGROUND_CONTEXT);
		}
	});

	it("migrates a version 1 database to store sleeping tasks, keeping its tasks and indexes", async () => {
		const path = await databasePath();
		const database = await openNodeSqliteDatabase(path);
		await applySqliteMigrations(database, SQLITE_MIGRATIONS.slice(0, 1));
		const waiting = {
			id: 5,
			conversationId: 1,
			kind: "test.task",
			version: 1,
			input: null,
			background: false,
			abortRequested: false,
			state: { status: "waiting", checkpoint: { phase: "run" }, on: [], policy: "allSettled" },
		};
		await database.run(
			"INSERT INTO tasks (id, conversation_id, kind, status, abort_requested, background, record) VALUES (5, 1, 'test.task', 'waiting', 0, 0, ?)",
			JSON.stringify(waiting),
		);
		await expect(
			database.run(
				"INSERT INTO tasks (id, conversation_id, kind, status, abort_requested, background, record) VALUES (6, 1, 'test.task', 'sleeping', 0, 0, '{}')",
			),
		).rejects.toThrow();
		await database.close();

		const storage = await openNodeSqliteStorage(path);
		await storage.close(BACKGROUND_CONTEXT);
		const migrated = await openNodeSqliteDatabase(path);
		try {
			expect(await migrated.get("SELECT version FROM durable_schema WHERE singleton = 1")).toEqual({ version: 3 });
			expect(await migrated.get("SELECT status, record FROM tasks WHERE id = 5")).toEqual({
				status: "waiting",
				record: JSON.stringify(waiting),
			});
			await migrated.run(
				"INSERT INTO tasks (id, conversation_id, kind, status, abort_requested, background, record) VALUES (6, 1, 'test.task', 'sleeping', 0, 0, '{}')",
			);
			const indexes = await migrated.all<{ name: string }>(
				"SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'tasks' ORDER BY name",
			);
			expect(indexes.map(({ name }) => name)).toEqual([
				"tasks_by_abort_requested",
				"tasks_by_background",
				"tasks_by_conversation",
				"tasks_by_kind",
				"tasks_by_seq",
				"tasks_by_status",
			]);
			expect(await migrated.get("SELECT count(*) AS count FROM sqlite_schema WHERE name = 'tasks_v2'")).toEqual({
				count: 0,
			});
		} finally {
			await migrated.close();
		}
	});

	it("rejects a database newer than the portable core", async () => {
		const path = await databasePath();
		const database = await openNodeSqliteDatabase(path);
		await applySqliteMigrations(database);
		await database.run(
			"UPDATE durable_schema SET version = ? WHERE singleton = 1",
			CURRENT_SQLITE_SCHEMA_VERSION + 1,
		);
		await database.close();

		await expect(openNodeSqliteStorage(path)).rejects.toThrow("is newer than supported version");
	});

	it("rolls a failed migration back and preserves stored data for a successful retry", async () => {
		const path = await databasePath();
		const storage = await openNodeSqliteStorage(path);
		await storage.commit(
			[
				{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } },
				{
					type: "entry",
					value: {
						id: idFromNumber<EntryId>(2),
						conversationId: ROOT_CONVERSATION_ID,
						kind: "retained",
						data: { retained: true },
					},
				},
			],
			BACKGROUND_CONTEXT,
		);
		await storage.close(BACKGROUND_CONTEXT);

		const database = await openNodeSqliteDatabase(path);
		const nextVersion = CURRENT_SQLITE_SCHEMA_VERSION + 1;
		const failedMigrations: readonly SqliteMigration[] = [
			...SQLITE_MIGRATIONS,
			{
				version: nextVersion,
				statements: ["CREATE TABLE migration_probe (value TEXT) STRICT", "THIS IS NOT SQL"],
			},
		];
		await expect(applySqliteMigrations(database, failedMigrations)).rejects.toThrow();
		expect(await database.get("SELECT version FROM durable_schema WHERE singleton = 1")).toEqual({
			version: CURRENT_SQLITE_SCHEMA_VERSION,
		});
		expect(
			await database.get(
				"SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'migration_probe'",
			),
		).toEqual({ count: 0 });

		const successfulMigrations: readonly SqliteMigration[] = [
			...SQLITE_MIGRATIONS,
			{ version: nextVersion, statements: ["CREATE TABLE migration_probe (value TEXT) STRICT"] },
		];
		await applySqliteMigrations(database, successfulMigrations);
		expect(await database.get("SELECT version FROM durable_schema WHERE singleton = 1")).toEqual({
			version: nextVersion,
		});
		expect(await database.get("SELECT record, commit_seq FROM entries WHERE id = 2")).toEqual({
			record: JSON.stringify({
				id: 2,
				conversationId: ROOT_CONVERSATION_ID,
				kind: "retained",
				data: { retained: true },
			}),
			commit_seq: 1,
		});
		expect(await database.get("SELECT next_id, next_seq FROM durable_metadata WHERE singleton = 1")).toEqual({
			next_id: "3",
			next_seq: 2,
		});
		await database.close();
	});
});
