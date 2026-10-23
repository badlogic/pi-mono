import { DatabaseSync } from "node:sqlite";
import { registerStorageConformance } from "@earendil-works/pi-durable/testing";
import { describe, expect, it } from "vitest";
import {
	DurableObjectSqliteDatabase,
	type DurableObjectSqliteStorage,
	openDurableObjectSqliteStorage,
} from "../src/storage/sqlite/cloudflare.ts";

type SqlValue = ArrayBuffer | string | number | null;

/**
 * A stand-in for a SQLite-backed Durable Object's `ctx.storage` over `node:sqlite`, with its value types: `BLOB`
 * bindings and results are `ArrayBuffer`s, and `exec()` without bindings may run several statements.
 */
function durableObjectStorage(database = new DatabaseSync(":memory:")): DurableObjectSqliteStorage {
	const toNode = (value: SqlValue) => (value instanceof ArrayBuffer ? new Uint8Array(value) : value);
	const fromNode = (value: unknown): SqlValue =>
		value instanceof Uint8Array ? (value.slice().buffer as ArrayBuffer) : (value as SqlValue);
	return {
		sql: {
			exec(query, ...bindings) {
				if (bindings.length === 0 && query.trim().replace(/;\s*$/, "").includes(";")) {
					database.exec(query);
					return { toArray: () => [] };
				}
				const statement = database.prepare(query);
				if (statement.columns().length === 0) {
					statement.run(...bindings.map(toNode));
					return { toArray: () => [] };
				}
				const rows = statement.all(...bindings.map(toNode)) as Record<string, unknown>[];
				return {
					toArray: () =>
						rows.map((row) =>
							Object.fromEntries(Object.entries(row).map(([key, value]) => [key, fromNode(value)])),
						),
				};
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

registerStorageConformance({ describe, expect, it }, "SqliteStorage on a Durable Object", async (use) =>
	use(await openDurableObjectSqliteStorage(durableObjectStorage())),
);

describe("Durable Object SQLite adapter", () => {
	it("binds and returns BLOB values as Uint8Array", async () => {
		const database = new DurableObjectSqliteDatabase(durableObjectStorage());
		await database.exec("CREATE TABLE blobs (id INTEGER PRIMARY KEY, data BLOB, n INTEGER)");
		await database.run("INSERT INTO blobs (id, data, n) VALUES (?, ?, ?)", 1, new Uint8Array([1, 2, 3]), 7n);
		expect(await database.get("SELECT data, n FROM blobs WHERE id = ?", 1)).toEqual({
			data: new Uint8Array([1, 2, 3]),
			n: 7,
		});
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

	it("queues operations behind an active transaction", async () => {
		const database = new DurableObjectSqliteDatabase(durableObjectStorage());
		await database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY)");
		const order: string[] = [];
		const { promise: gate, resolve } = Promise.withResolvers<void>();
		const transaction = database.transaction(async (handle) => {
			await handle.run("INSERT INTO items (id) VALUES (?)", 1);
			await gate;
			order.push("transaction");
		});
		const read = database.all("SELECT id FROM items").then((rows) => {
			order.push("read");
			return rows;
		});
		resolve();
		await transaction;
		expect(await read).toEqual([{ id: 1 }]);
		expect(order).toEqual(["transaction", "read"]);
		await database.close();
	});
});
