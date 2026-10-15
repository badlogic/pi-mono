import { DatabaseSync } from "node:sqlite";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { registerStorageConformance } from "@earendil-works/pi-durable/testing";
import { describe, expect, it } from "vitest";
import { idFromNumber } from "../src/ids.ts";
import {
	DurableObjectSqliteDatabase,
	type DurableObjectSqliteStorage,
	openDurableObjectSqliteStorage,
} from "../src/storage/sqlite/cloudflare.ts";
import { type EntryId, ROOT_CONVERSATION_ID } from "../src/types.ts";

type SqlValue = ArrayBuffer | string | number | null;

/**
 * A stand-in for a SQLite-backed Durable Object's `ctx.storage` over `node:sqlite`, with its value types: `BLOB`
 * bindings and results are `ArrayBuffer`s, and `exec()` without bindings may run several statements. It keeps this
 * portable package free of Workers test dependencies; a Cloudflare host can run the same storage conformance suite
 * against its binding with `runInDurableObject()` from `cloudflare:test`.
 */
function durableObjectStorage(
	database = new DatabaseSync(":memory:"),
	onCursorOperation?: (operation: "next" | "toArray") => void,
): DurableObjectSqliteStorage {
	const toNode = (value: SqlValue) => (value instanceof ArrayBuffer ? new Uint8Array(value) : value);
	const fromNode = (value: unknown): SqlValue =>
		value instanceof Uint8Array ? (value.slice().buffer as ArrayBuffer) : (value as SqlValue);
	const cursor = (rows: Record<string, SqlValue>[]) => {
		let index = 0;
		return {
			next(): { done: false; value: Record<string, SqlValue> } | { done: true } {
				onCursorOperation?.("next");
				const value = rows[index++];
				return value === undefined ? { done: true } : { done: false, value };
			},
			toArray(): Record<string, SqlValue>[] {
				onCursorOperation?.("toArray");
				const remaining = rows.slice(index);
				index = rows.length;
				return remaining;
			},
		};
	};
	return {
		sql: {
			exec(query, ...bindings) {
				if (bindings.length === 0 && query.trim().replace(/;\s*$/, "").includes(";")) {
					database.exec(query);
					return cursor([]);
				}
				const statement = database.prepare(query);
				if (statement.columns().length === 0) {
					statement.run(...bindings.map(toNode));
					return cursor([]);
				}
				const rows = (statement.all(...bindings.map(toNode)) as Record<string, unknown>[]).map((row) =>
					Object.fromEntries(Object.entries(row).map(([key, value]) => [key, fromNode(value)])),
				);
				return cursor(rows);
			},
		},
		async transaction(closure) {
			database.exec("BEGIN");
			try {
				const result = await closure();
				database.exec("COMMIT");
				return result;
			} catch (error) {
				database.exec("ROLLBACK");
				throw error;
			}
		},
	};
}

registerStorageConformance({ describe, expect, it }, "SqliteStorage on a prefixed Durable Object", async (use) =>
	use(await openDurableObjectSqliteStorage(durableObjectStorage(), { prefix: "pi_" })),
);

describe("Durable Object SQLite adapter", () => {
	it("keeps schema names unprefixed by default", async () => {
		const sqlite = new DatabaseSync(":memory:");
		await openDurableObjectSqliteStorage(durableObjectStorage(sqlite));
		expect(sqlite.prepare("SELECT version FROM durable_schema").get()).toEqual({ version: 1 });
		expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'pi_durable_schema'").get()).toBeUndefined();
	});

	it("prefixes pi's tables and indexes without changing host tables", async () => {
		const sqlite = new DatabaseSync(":memory:");
		const storage = durableObjectStorage(sqlite);
		const database = new DurableObjectSqliteDatabase(storage);
		await database.exec("CREATE TABLE host_notes (text TEXT)");
		await database.exec("CREATE TABLE tasks (text TEXT)");
		await openDurableObjectSqliteStorage(storage, { prefix: "pi_" });
		const names = sqlite
			.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'")
			.all()
			.map((row) => String(row.name));
		expect(names).toContain("host_notes");
		expect(names).toContain("tasks");
		expect(names).not.toContain("pi_host_notes");
		const piNames = names.filter((name) => !["host_notes", "tasks"].includes(name));
		expect(piNames.length).toBeGreaterThan(10);
		expect(piNames.every((name) => name.startsWith("pi_"))).toBe(true);
		expect(piNames).toContain("pi_tasks");
		expect(piNames).toContain("pi_durable_schema");
	});

	it("isolates concurrently opened prefixes on one Durable Object", async () => {
		const storage = durableObjectStorage();
		const [first, second] = await Promise.all([
			openDurableObjectSqliteStorage(storage, { prefix: "first_" }),
			openDurableObjectSqliteStorage(storage, { prefix: "second_" }),
		]);
		const entryId = idFromNumber<EntryId>(2);
		await Promise.all([
			first.commit(
				[
					{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } },
					{ type: "entry", value: { id: entryId, conversationId: ROOT_CONVERSATION_ID, kind: "first" } },
				],
				BACKGROUND_CONTEXT,
			),
			second.commit(
				[
					{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } },
					{ type: "entry", value: { id: entryId, conversationId: ROOT_CONVERSATION_ID, kind: "second" } },
				],
				BACKGROUND_CONTEXT,
			),
		]);
		expect((await first.entry(entryId, BACKGROUND_CONTEXT))?.entry.kind).toBe("first");
		expect((await second.entry(entryId, BACKGROUND_CONTEXT))?.entry.kind).toBe("second");
		await Promise.all([first.close(BACKGROUND_CONTEXT), second.close(BACKGROUND_CONTEXT)]);
	});

	it("rejects invalid and reserved prefixes", async () => {
		await expect(openDurableObjectSqliteStorage(durableObjectStorage(), { prefix: "" })).rejects.toThrow("Invalid");
		await expect(openDurableObjectSqliteStorage(durableObjectStorage(), { prefix: "bad-prefix" })).rejects.toThrow(
			"Invalid",
		);
		await expect(openDurableObjectSqliteStorage(durableObjectStorage(), { prefix: "sqlite_pi_" })).rejects.toThrow(
			"reserved",
		);
	});

	it("binds and returns BLOB values as Uint8Array", async () => {
		const database = new DurableObjectSqliteDatabase(durableObjectStorage());
		await database.exec("CREATE TABLE blobs (id INTEGER PRIMARY KEY, data BLOB, n INTEGER)");
		await database.run("INSERT INTO blobs (id, data, n) VALUES (?, ?, ?)", 1, new Uint8Array([1, 2, 3]), 7n);
		expect(await database.get("SELECT data, n FROM blobs WHERE id = ?", 1)).toEqual({
			data: new Uint8Array([1, 2, 3]),
			n: 7,
		});
	});

	it("reads only the cursor's first row for get", async () => {
		const operations: string[] = [];
		const database = new DurableObjectSqliteDatabase(
			durableObjectStorage(new DatabaseSync(":memory:"), (operation) => operations.push(operation)),
		);
		await database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)");
		await database.run("INSERT INTO items (id) VALUES (1), (2)");
		expect(await database.get("SELECT id FROM items ORDER BY id")).toEqual({ id: 1 });
		expect(operations).toEqual(["next"]);
	});

	it("rejects a bigint binding outside the safe integer range", async () => {
		const database = new DurableObjectSqliteDatabase(durableObjectStorage());
		await database.exec("CREATE TABLE numbers (n INTEGER)");
		await expect(database.run("INSERT INTO numbers (n) VALUES (?)", 9_007_199_254_740_993n)).rejects.toThrow(
			RangeError,
		);
		expect(await database.all("SELECT n FROM numbers")).toEqual([]);
	});

	it("closes after an active transaction settles", async () => {
		const database = new DurableObjectSqliteDatabase(durableObjectStorage());
		await database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)");
		const order: string[] = [];
		const { promise: gate, resolve } = Promise.withResolvers<void>();
		const transaction = database.transaction(async (handle) => {
			await handle.run("INSERT INTO items (id) VALUES (?)", 1);
			await gate;
			order.push("transaction");
		});
		const closed = database.close().then(() => order.push("close"));
		resolve();
		await Promise.all([transaction, closed]);
		expect(order).toEqual(["transaction", "close"]);
	});

	it("runs an uncontended statement before returning its promise", async () => {
		const sqlite = new DatabaseSync(":memory:");
		const database = new DurableObjectSqliteDatabase(durableObjectStorage(sqlite));
		await database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)");
		const written = database.run("INSERT INTO items (id) VALUES (?)", 1);
		expect(sqlite.prepare("SELECT id FROM items").all()).toEqual([{ id: 1 }]);
		await written;
	});

	it("rolls back a rejected transaction and rejects its handle afterwards", async () => {
		const database = new DurableObjectSqliteDatabase(durableObjectStorage());
		await database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)");
		let handle: Parameters<Parameters<DurableObjectSqliteDatabase["transaction"]>[0]>[0] | undefined;
		await expect(
			database.transaction(async (transaction) => {
				handle = transaction;
				await transaction.run("INSERT INTO items (id) VALUES (?)", 1);
				throw new Error("abort");
			}),
		).rejects.toThrow("abort");
		expect(await database.all("SELECT id FROM items")).toEqual([]);
		await expect(handle!.run("INSERT INTO items (id) VALUES (?)", 2)).rejects.toThrow("no longer active");
	});

	it("runs operations from another adapter after a transaction, outside its rollback", async () => {
		const storage = durableObjectStorage();
		const database = new DurableObjectSqliteDatabase(storage);
		const other = new DurableObjectSqliteDatabase(storage);
		await database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)");
		const { promise: gate, resolve } = Promise.withResolvers<void>();
		const transaction = database.transaction(async (handle) => {
			await handle.run("INSERT INTO items (id) VALUES (?)", 1);
			await gate;
			throw new Error("abort");
		});
		const outside = other.run("INSERT INTO items (id) VALUES (?)", 2);
		const read = other.all("SELECT id FROM items");
		resolve();
		await expect(transaction).rejects.toThrow("abort");
		await outside;
		expect(await read).toEqual([{ id: 2 }]);
		await database.close();
	});

	it("includes direct underlying calls in an active transaction", async () => {
		const sqlite = new DatabaseSync(":memory:");
		const storage = durableObjectStorage(sqlite);
		const database = new DurableObjectSqliteDatabase(storage);
		await database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)");
		const { promise: opened, resolve: markOpened } = Promise.withResolvers<void>();
		const { promise: gate, resolve } = Promise.withResolvers<void>();
		const transaction = database.transaction(async (handle) => {
			await handle.run("INSERT INTO items (id) VALUES (?)", 1);
			markOpened();
			await gate;
			throw new Error("abort");
		});
		await opened;
		storage.sql.exec("INSERT INTO items (id) VALUES (?)", 2);
		resolve();
		await expect(transaction).rejects.toThrow("abort");
		expect(sqlite.prepare("SELECT id FROM items").all()).toEqual([]);
	});
});
