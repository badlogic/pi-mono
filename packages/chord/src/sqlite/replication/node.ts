import { resolve } from "node:path";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "../database.ts";
import { type NodeSqliteDatabase, openNodeSqliteDatabase } from "../node.ts";

/** What the replication engine observes on a replicated connection. See `ReplicatedNodeSqliteDatabase`. */
export interface ReplicationHooks {
	/**
	 * Called synchronously after any operation through the connection settles, whether it succeeded or not, because
	 * it may have committed. Must not throw and must not call the database.
	 */
	afterOperation(): void;
	/**
	 * Runs during `close`, alone on the connection, after every earlier operation and before SQLite checkpoints and
	 * deletes the WAL. Everything the engine has not taken out of the WAL by the time this settles is lost to it.
	 */
	beforeClose(executor: SqliteExecutor): Promise<void>;
}

/** Connection settings for a replicated database file. Automatic WAL checkpoints are always off. */
export type ReplicatedNodeSqliteDatabaseOptions = {
	/** Time SQLite waits for a competing file lock; see `NodeSqliteDatabaseOptions.busyTimeoutMs`. */
	readonly busyTimeoutMs?: number;
};

/**
 * A Node SQLite connection whose write-ahead log (WAL) the replication engine reads from outside SQLite.
 *
 * The engine ships the pages SQLite appends to `{path}-wal`. That only works if no page leaves the WAL before the
 * engine has read it, and a page leaves the WAL whenever anything checkpoints: SQLite's automatic checkpoint after a
 * commit, a checkpoint by another connection, and the checkpoint SQLite runs when the last connection closes. This
 * wrapper exists so that the engine, and only the engine, decides when that happens on this connection:
 *
 * - It opens the file itself, with automatic checkpoints disabled, so that the engine is attached before anyone else
 *   can write. pi-durable runs schema migrations on open, and those commits must be replicated like any other.
 * - It owns the underlying connection and never hands it out, so every operation goes through the wrapper. After
 *   each one it calls `afterOperation`, which is how the engine learns that the WAL may have grown. That includes
 *   statements outside a transaction, which commit on their own.
 * - It exposes `exclusive` so the engine can checkpoint, or hold back every later operation, without interleaving
 *   with a commit.
 * - `close` first runs `beforeClose` in the connection's queue, after everything queued earlier, and only then lets
 *   the connection close. Operations called after `close` reject, so nothing can commit between the two steps.
 *
 * The wrapper does not read the WAL, schedule flushes or checkpoint; that is the engine's work, through the hooks.
 * It also cannot stop another process from opening the file, which may checkpoint behind the engine's back. The
 * engine detects that from the WAL salts and recovers by taking a new base.
 *
 * The class is exported as a type only, so the only way to get an instance is `openReplicatedNodeSqliteDatabase`.
 * A constructor that accepted any `NodeSqliteDatabase` would let a caller pass one with automatic checkpoints on, or
 * keep writing through the connection directly, and either would drop WAL pages before the engine read them.
 */
class ReplicatedNodeSqliteDatabase implements SqliteDatabase {
	/** Absolute path of the database file. The WAL is `${path}-wal`. */
	readonly path: string;
	private readonly database: NodeSqliteDatabase;
	private readonly hooks: ReplicationHooks;
	private closing: Promise<void> | undefined;

	constructor(path: string, database: NodeSqliteDatabase, hooks: ReplicationHooks) {
		this.path = path;
		this.database = database;
		this.hooks = hooks;
	}

	exec(sql: string): Promise<void> {
		return this.observe(() => this.database.exec(sql));
	}

	run(sql: string, ...params: SqliteValue[]): Promise<void> {
		return this.observe(() => this.database.run(sql, ...params));
	}

	get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
		return this.observe(() => this.database.get<T>(sql, ...params));
	}

	all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
		return this.observe(() => this.database.all<T>(sql, ...params));
	}

	transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T> {
		return this.observe(() => this.database.transaction(callback));
	}

	/** Runs `operation` alone on the connection; see `NodeSqliteDatabase.exclusive`. */
	exclusive<T>(operation: (executor: SqliteExecutor) => Promise<T>): Promise<T> {
		if (this.closing !== undefined) return Promise.reject(closedError());
		return this.database.exclusive(operation);
	}

	close(): Promise<void> {
		this.closing ??= this.closeOnce();
		return this.closing;
	}

	private async closeOnce(): Promise<void> {
		let hookError: unknown;
		let hookFailed = false;
		try {
			await this.database.exclusive((executor) => this.hooks.beforeClose(executor));
		} catch (error) {
			hookFailed = true;
			hookError = error;
		}
		try {
			await this.database.close();
		} catch (closeError) {
			if (hookFailed) throw new AggregateError([hookError, closeError], "Replication close hook and close failed");
			throw closeError;
		}
		if (hookFailed) throw hookError;
	}

	// Delegating synchronously keeps call order: the operation enters the connection's queue before this returns.
	private observe<T>(operation: () => Promise<T>): Promise<T> {
		if (this.closing !== undefined) return Promise.reject(closedError());
		return operation().finally(() => this.hooks.afterOperation());
	}
}

export type { ReplicatedNodeSqliteDatabase };

const closedError = (): Error => new Error("Replicated SQLite database is closed");

/** Open a database file for replication. The file needs a WAL, so in-memory and temporary databases are refused. */
export async function openReplicatedNodeSqliteDatabase(
	path: string,
	hooks: ReplicationHooks,
	options: ReplicatedNodeSqliteDatabaseOptions = {},
): Promise<ReplicatedNodeSqliteDatabase> {
	if (path === "" || path === ":memory:" || path.startsWith("file:")) {
		throw new Error(`Replication needs a database file path, got ${JSON.stringify(path)}`);
	}
	const absolute = resolve(path);
	const database = await openNodeSqliteDatabase(absolute, {
		walAutoCheckpointPages: 0,
		busyTimeoutMs: options.busyTimeoutMs,
	});
	return new ReplicatedNodeSqliteDatabase(absolute, database, hooks);
}
