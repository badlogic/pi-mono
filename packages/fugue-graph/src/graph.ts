import type { AuthorType, EdgeType, NodeStatus, NodeType } from "@fugue/shared";
import { newId } from "@fugue/shared";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
	fugueAssumptions,
	fugueAuditLog,
	fugueEdges,
	fugueNodes,
	type InsertAssumption,
	type InsertEdge,
	type InsertNode,
	type SelectAssumption,
	type SelectEdge,
	type SelectNode,
} from "./schema.js";

export type DrizzleDb = ReturnType<typeof drizzle>;

export function createDb(pool: Pool): DrizzleDb {
	return drizzle(pool);
}

// ─── Audit Helper ─────────────────────────────────────────────────────────────

interface AuditCtx {
	actorId: string;
	actorType: AuthorType;
	authorityChain?: string[];
}

async function audit(
	db: DrizzleDb,
	ctx: AuditCtx,
	action: string,
	targetType: string,
	targetId: string,
	detail?: Record<string, unknown>,
): Promise<void> {
	await db.insert(fugueAuditLog).values({
		actorId: ctx.actorId,
		actorType: ctx.actorType,
		action,
		targetType,
		targetId,
		detail: detail ?? null,
		authorityChain: ctx.authorityChain ?? [ctx.actorId],
	});
}

// ─── Node CRUD ────────────────────────────────────────────────────────────────

export interface CreateNodeInput {
	type: NodeType;
	title: string;
	content?: Record<string, unknown>;
	authorId: string;
	authorType?: AuthorType;
}

export async function createNode(db: DrizzleDb, input: CreateNodeInput, ctx: AuditCtx): Promise<SelectNode> {
	const id = newId();
	const now = new Date();
	const row: InsertNode = {
		id,
		type: input.type,
		title: input.title,
		content: input.content ?? {},
		authorId: input.authorId,
		authorType: input.authorType ?? "human",
		createdAt: now,
		updatedAt: now,
		status: "active",
	};
	const [node] = await db.insert(fugueNodes).values(row).returning();
	await audit(db, ctx, "node.create", "node", id, { type: input.type, title: input.title });
	return node;
}

export async function getNode(db: DrizzleDb, id: string): Promise<SelectNode | undefined> {
	const [node] = await db.select().from(fugueNodes).where(eq(fugueNodes.id, id));
	return node;
}

export interface UpdateNodeInput {
	title?: string;
	content?: Record<string, unknown>;
	status?: NodeStatus;
}

export async function updateNode(
	db: DrizzleDb,
	id: string,
	input: UpdateNodeInput,
	ctx: AuditCtx,
): Promise<SelectNode | undefined> {
	const updates: Partial<InsertNode> = {
		updatedAt: new Date(),
	};
	if (input.title !== undefined) updates.title = input.title;
	if (input.content !== undefined) updates.content = input.content;
	if (input.status !== undefined) {
		updates.status = input.status;
		if (input.status === "archived") updates.archivedAt = new Date();
	}
	const [node] = await db.update(fugueNodes).set(updates).where(eq(fugueNodes.id, id)).returning();
	if (node) {
		await audit(db, ctx, "node.update", "node", id, input as Record<string, unknown>);
	}
	return node;
}

export async function archiveNode(db: DrizzleDb, id: string, ctx: AuditCtx): Promise<SelectNode | undefined> {
	return updateNode(db, id, { status: "archived" }, ctx);
}

export async function listNodes(
	db: DrizzleDb,
	opts?: { type?: NodeType; authorId?: string; status?: NodeStatus; limit?: number; offset?: number },
): Promise<SelectNode[]> {
	const conditions = [];
	if (opts?.type) conditions.push(eq(fugueNodes.type, opts.type));
	if (opts?.authorId) conditions.push(eq(fugueNodes.authorId, opts.authorId));
	if (opts?.status) conditions.push(eq(fugueNodes.status, opts.status));

	const query = db
		.select()
		.from(fugueNodes)
		.orderBy(desc(fugueNodes.createdAt))
		.limit(opts?.limit ?? 100)
		.offset(opts?.offset ?? 0);

	if (conditions.length > 0) {
		return query.where(and(...conditions));
	}
	return query;
}

export async function searchNodes(db: DrizzleDb, q: string, limit = 20): Promise<SelectNode[]> {
	const pattern = `%${q}%`;
	return db.select().from(fugueNodes).where(sql`lower(${fugueNodes.title}) like lower(${pattern})`).limit(limit);
}

// ─── Edge CRUD ────────────────────────────────────────────────────────────────

export interface CreateEdgeInput {
	sourceId: string;
	targetId: string;
	type: EdgeType;
	metadata?: Record<string, unknown>;
	authorId: string;
}

export async function createEdge(db: DrizzleDb, input: CreateEdgeInput, ctx: AuditCtx): Promise<SelectEdge> {
	const id = newId();
	const row: InsertEdge = {
		id,
		sourceId: input.sourceId,
		targetId: input.targetId,
		type: input.type,
		metadata: input.metadata ?? null,
		authorId: input.authorId,
		createdAt: new Date(),
	};
	const [edge] = await db.insert(fugueEdges).values(row).returning();
	await audit(db, ctx, "edge.create", "edge", id, {
		sourceId: input.sourceId,
		targetId: input.targetId,
		type: input.type,
	});
	return edge;
}

export async function deleteEdge(db: DrizzleDb, id: string, ctx: AuditCtx): Promise<boolean> {
	const result = await db.delete(fugueEdges).where(eq(fugueEdges.id, id)).returning();
	if (result.length > 0) {
		await audit(db, ctx, "edge.delete", "edge", id);
		return true;
	}
	return false;
}

export async function getEdgesFrom(db: DrizzleDb, sourceId: string): Promise<SelectEdge[]> {
	return db.select().from(fugueEdges).where(eq(fugueEdges.sourceId, sourceId));
}

export async function getEdgesTo(db: DrizzleDb, targetId: string): Promise<SelectEdge[]> {
	return db.select().from(fugueEdges).where(eq(fugueEdges.targetId, targetId));
}

export async function getEdgesBetween(db: DrizzleDb, sourceId: string, targetId: string): Promise<SelectEdge[]> {
	return db
		.select()
		.from(fugueEdges)
		.where(
			or(
				and(eq(fugueEdges.sourceId, sourceId), eq(fugueEdges.targetId, targetId)),
				and(eq(fugueEdges.sourceId, targetId), eq(fugueEdges.targetId, sourceId)),
			),
		);
}

// ─── Graph Traversal (SQL recursive CTEs — works without AGE for basic cases) ─

export interface TraversalResult {
	node: SelectNode;
	depth: number;
	path: string[];
}

/**
 * BFS traversal from a start node up to maxDepth hops.
 * Returns all reachable nodes with their depth and path.
 * Uses a recursive CTE — no AGE required for basic traversal.
 */
export async function traverseFrom(pool: Pool, startId: string, maxDepth = 3): Promise<TraversalResult[]> {
	const { rows } = await pool.query<{
		id: string;
		depth: number;
		path: string[];
		type: string;
		title: string;
		content: Record<string, unknown>;
		author_id: string;
		author_type: string;
		created_at: Date;
		updated_at: Date;
		archived_at: Date | null;
		status: string;
	}>(
		`
		WITH RECURSIVE traversal AS (
			-- Base case: start node
			SELECT
				n.id, n.type, n.title, n.content, n.author_id, n.author_type,
				n.created_at, n.updated_at, n.archived_at, n.status,
				0 AS depth,
				ARRAY[n.id] AS path
			FROM fugue_nodes n
			WHERE n.id = $1

			UNION ALL

			-- Recursive case: follow edges
			SELECT
				n.id, n.type, n.title, n.content, n.author_id, n.author_type,
				n.created_at, n.updated_at, n.archived_at, n.status,
				t.depth + 1,
				t.path || n.id
			FROM traversal t
			JOIN fugue_edges e ON e.source_id = t.id
			JOIN fugue_nodes n ON n.id = e.target_id
			WHERE t.depth < $2
			  AND NOT (n.id = ANY(t.path)) -- prevent cycles
		)
		SELECT DISTINCT ON (id) * FROM traversal ORDER BY id, depth
		`,
		[startId, maxDepth],
	);

	return rows.map((row) => ({
		node: {
			id: row.id,
			type: row.type as NodeType,
			title: row.title,
			content: row.content,
			authorId: row.author_id,
			authorType: row.author_type as AuthorType,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			archivedAt: row.archived_at,
			status: row.status as NodeStatus,
		},
		depth: row.depth,
		path: row.path,
	}));
}

/**
 * Find ancestors of a node (nodes that point TO it, recursively).
 */
export async function findAncestors(pool: Pool, nodeId: string, maxDepth = 3): Promise<TraversalResult[]> {
	const { rows } = await pool.query<{
		id: string;
		depth: number;
		path: string[];
		type: string;
		title: string;
		content: Record<string, unknown>;
		author_id: string;
		author_type: string;
		created_at: Date;
		updated_at: Date;
		archived_at: Date | null;
		status: string;
	}>(
		`
		WITH RECURSIVE ancestors AS (
			SELECT
				n.id, n.type, n.title, n.content, n.author_id, n.author_type,
				n.created_at, n.updated_at, n.archived_at, n.status,
				0 AS depth,
				ARRAY[n.id] AS path
			FROM fugue_nodes n
			WHERE n.id = $1

			UNION ALL

			SELECT
				n.id, n.type, n.title, n.content, n.author_id, n.author_type,
				n.created_at, n.updated_at, n.archived_at, n.status,
				a.depth + 1,
				a.path || n.id
			FROM ancestors a
			JOIN fugue_edges e ON e.target_id = a.id
			JOIN fugue_nodes n ON n.id = e.source_id
			WHERE a.depth < $2
			  AND NOT (n.id = ANY(a.path))
		)
		SELECT DISTINCT ON (id) * FROM ancestors WHERE id != $1 ORDER BY id, depth
		`,
		[nodeId, maxDepth],
	);

	return rows.map((row) => ({
		node: {
			id: row.id,
			type: row.type as NodeType,
			title: row.title,
			content: row.content,
			authorId: row.author_id,
			authorType: row.author_type as AuthorType,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			archivedAt: row.archived_at,
			status: row.status as NodeStatus,
		},
		depth: row.depth,
		path: row.path,
	}));
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export async function queryAuditLog(
	db: DrizzleDb,
	opts?: { actorId?: string; targetId?: string; action?: string; limit?: number },
) {
	const conditions = [];
	if (opts?.actorId) conditions.push(eq(fugueAuditLog.actorId, opts.actorId));
	if (opts?.targetId) conditions.push(eq(fugueAuditLog.targetId, opts.targetId));
	if (opts?.action) conditions.push(eq(fugueAuditLog.action, opts.action));

	const query = db
		.select()
		.from(fugueAuditLog)
		.orderBy(desc(fugueAuditLog.createdAt))
		.limit(opts?.limit ?? 100);

	if (conditions.length > 0) {
		return query.where(and(...conditions));
	}
	return query;
}

// ─── Assumptions ─────────────────────────────────────────────────────────────

export interface CreateAssumptionInput {
	graphNodeId: string;
	claim: string;
	confidence?: number;
	evidence?: string;
	ownerId: string;
	verificationMethod?: string;
	verifyByDays?: number;
}

export async function createAssumption(
	db: DrizzleDb,
	input: CreateAssumptionInput,
	ctx: AuditCtx,
): Promise<SelectAssumption> {
	const id = newId();
	const verifyByDate = input.verifyByDays ? new Date(Date.now() + input.verifyByDays * 86_400_000) : null;

	const row: InsertAssumption = {
		id,
		graphNodeId: input.graphNodeId,
		claim: input.claim,
		confidence: input.confidence ?? 0.5,
		evidence: input.evidence ?? "",
		ownerId: input.ownerId,
		verificationMethod: input.verificationMethod ?? "",
		verifyByDate,
		isStale: false,
	};

	const [assumption] = await db.insert(fugueAssumptions).values(row).returning();
	await audit(db, ctx, "assumption.create", "node", input.graphNodeId, { claim: input.claim });
	return assumption;
}

export async function updateAssumptionConfidence(
	db: DrizzleDb,
	id: string,
	confidence: number,
	ctx: AuditCtx,
): Promise<SelectAssumption | undefined> {
	const [assumption] = await db
		.update(fugueAssumptions)
		.set({ confidence, updatedAt: new Date() })
		.where(eq(fugueAssumptions.id, id))
		.returning();
	if (assumption) {
		await audit(db, ctx, "assumption.confidence_updated", "node", id, { confidence });
	}
	return assumption;
}

export async function markStaleAssumptions(db: DrizzleDb): Promise<number> {
	const result = await db
		.update(fugueAssumptions)
		.set({ isStale: true })
		.where(and(eq(fugueAssumptions.isStale, false), sql`verify_by_date < NOW()`))
		.returning();
	return result.length;
}

export async function getAssumptionsForNode(db: DrizzleDb, graphNodeId: string): Promise<SelectAssumption[]> {
	return db.select().from(fugueAssumptions).where(eq(fugueAssumptions.graphNodeId, graphNodeId));
}
