import { DatabaseSync } from "node:sqlite";
import type { DurableObjectSqliteStorage } from "../../src/sqlite/cloudflare.ts";

type SqlValue = ArrayBuffer | string | number | null;

/**
 * A stand-in for a SQLite-backed Durable Object's `ctx.storage` over `node:sqlite`, with its value types: `BLOB`
 * bindings and results are `ArrayBuffer`s, and `exec()` without bindings may run several statements. It keeps this
 * portable package free of Workers test dependencies; a Cloudflare host can run the same storage conformance suite
 * against its binding with `runInDurableObject()` from `cloudflare:test`.
 */
export function durableObjectStorage(
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
