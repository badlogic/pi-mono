import { aql, Database } from "arangojs";
import type { ArangoBackendConfig, IncomingMessage, Logger } from "../types.js";
import type { DatabaseAdapter } from "./database-adapter.js";

const DEFAULT_BATCH_LIMIT = 25;

function validateArangoConfig(cfg: ArangoBackendConfig): void {
	const missing: string[] = [];
	if (!cfg.url) missing.push("url");
	if (!cfg.database) missing.push("database");
	if (!cfg.messagesCollection) missing.push("messagesCollection");
	if (missing.length > 0) {
		throw new Error(`[poller] Arango config missing: ${missing.join(", ")}`);
	}
}

export class ArangoAdapter implements DatabaseAdapter {
	private readonly cfg: ArangoBackendConfig;
	private readonly logger: Logger;
	private db: Database | null = null;

	constructor(cfg: ArangoBackendConfig, logger: Logger) {
		validateArangoConfig(cfg);
		this.cfg = cfg;
		this.logger = logger;
	}

	async init(): Promise<void> {
		const db = new Database({ url: this.cfg.url, databaseName: this.cfg.database });
		if (this.cfg.username && this.cfg.password) {
			db.useBasicAuth(this.cfg.username, this.cfg.password);
		}
		await db.listCollections();
		this.db = db;
		this.logger.info("[poller] Arango adapter ready");
	}

	private get collectionName(): string {
		return this.cfg.messagesCollection;
	}

	private ensureDb(): Database {
		if (!this.db) {
			throw new Error("ArangoAdapter not initialized");
		}
		return this.db;
	}

	async fetchQueued(agentId: string, limit: number): Promise<IncomingMessage[]> {
		const db = this.ensureDb();
		const now = Date.now();
		const max = this.cfg.batchLimit ?? limit ?? DEFAULT_BATCH_LIMIT;
		const cursor = await db.query(aql`
			FOR m IN ${db.collection(this.collectionName)}
				FILTER m.to_agent == ${agentId}
					AND m.status == "queued"
					AND (m.claimed_by == null OR m.lease_until == null OR m.lease_until < ${now})
				LIMIT ${max}
				RETURN MERGE(m, { id: m._key })
		`);
		return cursor.all();
	}

	async claimMessage(id: string, agentId: string, leaseUntilMs: number): Promise<void> {
		const db = this.ensureDb();
		await db.query(aql`
			UPDATE ${id} WITH {
				claimed_by: ${agentId},
				lease_until: ${leaseUntilMs},
				status: "in_progress"
			} IN ${db.collection(this.collectionName)}
		`);
	}

	async updateStatus(id: string, status: "acked" | "done" | "failed"): Promise<void> {
		const db = this.ensureDb();
		await db.query(aql`
			UPDATE ${id} WITH {
				status: ${status},
				claimed_by: null,
				lease_until: null
			} IN ${db.collection(this.collectionName)}
		`);
	}

	async listInbox(agentId: string, limit: number): Promise<IncomingMessage[]> {
		const db = this.ensureDb();
		const max = limit ?? DEFAULT_BATCH_LIMIT;
		const cursor = await db.query(aql`
			FOR m IN ${db.collection(this.collectionName)}
				FILTER m.to_agent == ${agentId}
					AND (m.status == "in_progress" OR m.status == "queued")
				SORT m.created_at ASC
				LIMIT ${max}
				RETURN MERGE(m, { id: m._key })
		`);
		return cursor.all();
	}
}
