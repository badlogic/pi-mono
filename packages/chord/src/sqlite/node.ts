import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { StatementSync } from "node:sqlite";
import { DatabaseSync } from "node:sqlite";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "./database.ts";

/** Node SQLite connection settings for a database file. */
export type NodeSqliteDatabaseOptions = {
	/** SQLite WAL auto-checkpoint threshold. SQLite and this adapter default to 1,000 pages; 0 disables it. */
	readonly walAutoCheckpointPages?: number;
	/** Time SQLite waits for a competing file lock. SQLite defaults to 0; this adapter defaults to 5,000 ms. */
	readonly busyTimeoutMs?: number;
};

const DEFAULT_WAL_AUTO_CHECKPOINT_PAGES = 1_000;
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

type HandleScope = { active: boolean };

const ignore = (): void => {};

/**
 * Runs operations in call order. An operation starts immediately when nothing is running or waiting;
 * otherwise it waits for everything before it. An asynchronous operation holds the queue until it settles.
 */
class SerialOperationQueue {
	private tail: Promise<void> = Promise.resolve();
	private pending = 0;

	run<T>(operation: () => T): Promise<T> {
		if (this.pending > 0) return this.enqueue(operation);
		try {
			return Promise.resolve(operation());
		} catch (error) {
			return Promise.reject(error);
		}
	}

	runAsync<T>(operation: () => Promise<T>): Promise<T> {
		if (this.pending > 0) return this.enqueue(operation);
		this.pending++;
		// Publish the barrier before the operation starts, so calls it makes synchronously wait behind it.
		const { promise: barrier, resolve: releaseBarrier } = Promise.withResolvers<void>();
		this.tail = barrier;
		let started: Promise<T>;
		try {
			started = operation();
		} catch (error) {
			started = Promise.reject(error);
		}
		return started.finally(() => {
			this.pending--;
			releaseBarrier();
		});
	}

	private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
		this.pending++;
		return this.release(this.tail.then(operation));
	}

	private release<T>(operation: Promise<T>): Promise<T> {
		const settled = operation.finally(() => {
			this.pending--;
		});
		this.tail = settled.then(ignore, ignore);
		return settled;
	}
}

/**
 * Executes SQL on one connection. Prepared statements are cached per connection by SQL text, so the
 * database and its transaction handles share them across transactions.
 */
abstract class NodeSqliteExecutor implements SqliteExecutor {
	protected readonly database: DatabaseSync;
	protected readonly statements: Map<string, StatementSync>;

	constructor(database: DatabaseSync, statements: Map<string, StatementSync>) {
		this.database = database;
		this.statements = statements;
	}

	exec(sql: string): Promise<void> {
		return this.runOperation(() => {
			this.database.exec(sql);
		});
	}

	run(sql: string, ...params: SqliteValue[]): Promise<void> {
		return this.runOperation(() => {
			this.statement(sql).run(...params);
		});
	}

	get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
		return this.runOperation(() => this.statement(sql).get(...params) as T | undefined);
	}

	all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
		return this.runOperation(() => this.statement(sql).all(...params) as T[]);
	}

	protected abstract runOperation<T>(operation: () => T): Promise<T>;

	private statement(sql: string): StatementSync {
		let statement = this.statements.get(sql);
		if (statement === undefined) {
			statement = this.database.prepare(sql);
			this.statements.set(sql, statement);
		}
		return statement;
	}
}

/** The handle passed to a transaction or exclusive operation; it runs SQL directly and is invalid once its scope ends. */
class NodeSqliteScopedExecutor extends NodeSqliteExecutor {
	private readonly scope: HandleScope;
	private readonly kind: string;

	constructor(database: DatabaseSync, statements: Map<string, StatementSync>, scope: HandleScope, kind: string) {
		super(database, statements);
		this.scope = scope;
		this.kind = kind;
	}

	protected async runOperation<T>(operation: () => T): Promise<T> {
		if (!this.scope.active) throw new Error(`SQLite ${this.kind} handle is no longer active`);
		return operation();
	}
}

/** `SqliteDatabase` adapter backed by Node's built-in `node:sqlite`. */
export class NodeSqliteDatabase extends NodeSqliteExecutor implements SqliteDatabase {
	private readonly access = new SerialOperationQueue();
	private closed = false;

	constructor(database: DatabaseSync) {
		super(database, new Map());
	}

	transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T> {
		return this.access.runAsync(async () => {
			this.database.exec("BEGIN IMMEDIATE");
			const scope = { active: true };
			try {
				const result = await callback(
					new NodeSqliteScopedExecutor(this.database, this.statements, scope, "transaction"),
				);
				scope.active = false;
				this.database.exec("COMMIT");
				return result;
			} catch (error) {
				scope.active = false;
				try {
					this.database.exec("ROLLBACK");
				} catch (rollbackError) {
					throw new AggregateError([error, rollbackError], "SQLite transaction failed and rollback failed");
				}
				throw error;
			}
		});
	}

	/**
	 * Runs `operation` alone on the connection, outside a transaction: it starts after every earlier operation and
	 * transaction has settled, and later calls wait until it settles. The handle runs SQL immediately and is invalid
	 * afterwards. Use it for work that must not interleave with commits but cannot run inside a transaction, such as
	 * `PRAGMA wal_checkpoint`, or to hold back all later operations while awaiting something else. As with
	 * `transaction`, calling the database itself from inside the operation waits for the operation and never settles.
	 *
	 * An operation that begins a transaction must end it. Otherwise later statements would silently join it and
	 * never commit, so a transaction still open when the operation settles is rolled back and the call rejects, with
	 * the operation's own error as the `cause` if it failed.
	 */
	exclusive<T>(operation: (executor: SqliteExecutor) => Promise<T>): Promise<T> {
		return this.access.runAsync(async () => {
			const scope = { active: true };
			let outcome: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };
			try {
				const handle = new NodeSqliteScopedExecutor(this.database, this.statements, scope, "exclusive");
				outcome = { ok: true, value: await operation(handle) };
			} catch (error) {
				outcome = { ok: false, error };
			} finally {
				scope.active = false;
			}
			if (this.database.isTransaction) {
				const leftOpen = new Error(
					"SQLite exclusive operation left a transaction open; it was rolled back",
					outcome.ok ? undefined : { cause: outcome.error },
				);
				try {
					this.database.exec("ROLLBACK");
				} catch (rollbackError) {
					throw new AggregateError(
						[leftOpen, rollbackError],
						"SQLite exclusive operation left a transaction open and rollback failed",
					);
				}
				throw leftOpen;
			}
			if (!outcome.ok) throw outcome.error;
			return outcome.value;
		});
	}

	close(): Promise<void> {
		return this.access.run(() => {
			if (this.closed) return;
			this.closed = true;
			this.statements.clear();
			try {
				this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
			} finally {
				this.database.close();
			}
		});
	}

	protected runOperation<T>(operation: () => T): Promise<T> {
		return this.access.run(operation);
	}
}

/** Open and configure a Node-backed SQLite database facade. */
export async function openNodeSqliteDatabase(
	path: string,
	options: NodeSqliteDatabaseOptions = {},
): Promise<NodeSqliteDatabase> {
	const checkpointPages = options.walAutoCheckpointPages ?? DEFAULT_WAL_AUTO_CHECKPOINT_PAGES;
	const timeout = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
	if (path !== ":memory:") await mkdir(dirname(path), { recursive: true });
	const database = new DatabaseSync(path, { timeout });
	const adapter = new NodeSqliteDatabase(database);
	try {
		await adapter.exec("PRAGMA journal_mode = WAL");
		await adapter.exec("PRAGMA synchronous = NORMAL");
		await adapter.exec(`PRAGMA wal_autocheckpoint = ${checkpointPages}`);
		return adapter;
	} catch (error) {
		try {
			await adapter.close();
		} catch {
			// Preserve the configuration failure.
		}
		throw error;
	}
}
