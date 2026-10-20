import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { DurableObjectSqliteDatabase } from "@earendil-works/chord/sqlite/cloudflare";
import { registerStorageConformance } from "@earendil-works/pi-durable/testing";
import { describe, expect, it } from "vitest";
import { openDurableObjectSqliteStorage } from "../src/storage/sqlite/cloudflare.ts";
import { applySqliteMigrationsForSchema, createSqliteMigrations } from "../src/storage/sqlite/migrations.ts";
import { createSqliteSchema } from "../src/storage/sqlite/schema.ts";

const fresh = () => env.SESSIONS.get(env.SESSIONS.newUniqueId());

let suite = 0;
registerStorageConformance({ describe, expect, it }, "SqliteStorage on Durable Object SQLite in workerd", (use) =>
	runInDurableObject(fresh(), async (_instance, state) => {
		// Tables of their own, next to the ones the object's Harness opened.
		await use(await openDurableObjectSqliteStorage(state.storage, { prefix: `conformance${suite++}_` }));
	}),
);

describe("Durable Object SQLite schema", () => {
	it("migrates a version 1 schema to admit sleeping tasks, keeping tasks and indexes", async () => {
		await runInDurableObject(fresh(), async (_instance, state) => {
			const database = new DurableObjectSqliteDatabase(state.storage);
			const schema = createSqliteSchema("legacy_");
			const tasks = schema.tables.tasks;
			const insert = (id: number, status: string) =>
				database.run(
					`INSERT INTO ${tasks} (id, conversation_id, kind, status, abort_requested, background, record) VALUES (?, 1, 'test', ?, 0, 0, '{}')`,
					id,
					status,
				);
			// A database written by a version that knew schema version 1 only.
			await applySqliteMigrationsForSchema(database, schema, createSqliteMigrations(schema).slice(0, 1));
			await insert(5, "waiting");
			await expect(insert(6, "sleeping")).rejects.toThrow();

			await openDurableObjectSqliteStorage(state.storage, { prefix: "legacy_" });
			expect(await database.get(`SELECT version FROM ${schema.tables.durableSchema}`)).toEqual({ version: 2 });
			expect(await database.get(`SELECT status FROM ${tasks} WHERE id = 5`)).toEqual({ status: "waiting" });
			await insert(6, "sleeping");
			const indexes = await database.all<{ name: string }>(
				`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? ORDER BY name`,
				tasks,
			);
			expect(indexes.map(({ name }) => name)).toEqual([
				schema.indexes.tasksByAbortRequested,
				schema.indexes.tasksByBackground,
				schema.indexes.tasksByConversation,
				schema.indexes.tasksByKind,
				schema.indexes.tasksByStatus,
			]);
		});
	});
});
