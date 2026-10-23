import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "./database.ts";
import { SqliteStorage } from "./storage.ts";

/** Values a Durable Object SQL binding accepts and returns. */
type DurableObjectSqlValue = ArrayBuffer | string | number | null;

/**
 * The parts of a SQLite-backed Durable Object's `ctx.storage` this adapter uses, typed structurally so the package
 * needs no Workers type dependency.
 */
export type DurableObjectSqliteStorage = {
	readonly sql: {
		exec(query: string, ...bindings: DurableObjectSqlValue[]): { toArray(): Record<string, DurableObjectSqlValue>[] };
	};
	transaction<T>(closure: () => Promise<T>): Promise<T>;
};

/** Runs operations one at a time in call order, so a transaction excludes every other operation. */
class SerialQueue {
	private tail: Promise<unknown> = Promise.resolve();

	run<T>(operation: () => T | Promise<T>): Promise<T> {
		const result = this.tail.then(operation);
		this.tail = result.catch(() => {});
		return result;
	}
}

/** Durable Object SQL binds numbers as doubles: a `bigint` outside the safe integer range would lose precision. */
function bindValue(value: SqliteValue): DurableObjectSqlValue {
	if (value instanceof Uint8Array) return value.slice().buffer as ArrayBuffer;
	if (typeof value !== "bigint") return value;
	if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError(`Durable Object SQL cannot bind ${value} without losing precision`);
	}
	return Number(value);
}

const bind = (params: readonly SqliteValue[]): DurableObjectSqlValue[] => params.map(bindValue);

/** Rows as returned, with `BLOB` columns converted to `Uint8Array` in place; no other copy is made. */
function rows<T>(rows: Record<string, DurableObjectSqlValue>[]): T[] {
	for (const row of rows) {
		for (const key in row) {
			const value = row[key];
			if (value instanceof ArrayBuffer) (row as Record<string, unknown>)[key] = new Uint8Array(value);
		}
	}
	return rows as T[];
}

/** Executes SQL through `ctx.storage.sql`, which has no separate prepare step. */
class DurableObjectSqliteExecutor implements SqliteExecutor {
	protected readonly storage: DurableObjectSqliteStorage;

	constructor(storage: DurableObjectSqliteStorage) {
		this.storage = storage;
	}

	async exec(sql: string): Promise<void> {
		this.check();
		this.storage.sql.exec(sql);
	}

	async run(sql: string, ...params: SqliteValue[]): Promise<void> {
		this.check();
		this.storage.sql.exec(sql, ...bind(params));
	}

	async get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
		this.check();
		return rows<T>(this.storage.sql.exec(sql, ...bind(params)).toArray())[0];
	}

	async all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
		this.check();
		return rows<T>(this.storage.sql.exec(sql, ...bind(params)).toArray());
	}

	/** Throws when this handle may no longer run SQL. */
	protected check(): void {}
}

/** The handle a transaction callback receives; invalid once the callback settles. */
class DurableObjectSqliteTransaction extends DurableObjectSqliteExecutor {
	active = true;

	protected override check(): void {
		if (!this.active) throw new Error("SQLite transaction handle is no longer active");
	}
}

/**
 * `SqliteDatabase` adapter for the SQLite storage of a Cloudflare Durable Object. Integers are JavaScript numbers;
 * binding a `bigint` outside the safe integer range throws.
 */
export class DurableObjectSqliteDatabase extends DurableObjectSqliteExecutor implements SqliteDatabase {
	private readonly queue = new SerialQueue();

	override exec(sql: string): Promise<void> {
		return this.queue.run(() => super.exec(sql));
	}

	override run(sql: string, ...params: SqliteValue[]): Promise<void> {
		return this.queue.run(() => super.run(sql, ...params));
	}

	override get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
		return this.queue.run(() => super.get<T>(sql, ...params));
	}

	override all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
		return this.queue.run(() => super.all<T>(sql, ...params));
	}

	/** `ctx.storage.transaction()` commits when the callback resolves and rolls back when it rejects. */
	transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T> {
		return this.queue.run(() =>
			this.storage.transaction(async () => {
				const transaction = new DurableObjectSqliteTransaction(this.storage);
				try {
					return await callback(transaction);
				} finally {
					transaction.active = false;
				}
			}),
		);
	}

	/** Waits for queued work. The Durable Object owns its storage, so nothing else closes. */
	close(): Promise<void> {
		return this.queue.run(() => {});
	}
}

/** Open durable storage on a SQLite-backed Durable Object's `ctx.storage`. */
export function openDurableObjectSqliteStorage(storage: DurableObjectSqliteStorage): Promise<SqliteStorage> {
	return SqliteStorage.open(new DurableObjectSqliteDatabase(storage));
}
