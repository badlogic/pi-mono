import type { AgentStatus, AuthorType, EdgeType, NodeStatus, NodeType } from "@fugue/shared";
import { newId } from "@fugue/shared";
import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
	fugueAgents,
	fugueAssumptions,
	fugueAuditLog,
	fugueCompetitionEntries,
	fugueCompetitions,
	fugueDecisionEpisodes,
	fugueEdges,
	fugueFindings,
	fugueInvestigations,
	fugueMetrics,
	fugueNodes,
	type InsertAgent,
	type InsertAssumption,
	type InsertCompetition,
	type InsertCompetitionEntry,
	type InsertDecisionEpisode,
	type InsertEdge,
	type InsertFinding,
	type InsertInvestigation,
	type InsertMetric,
	type InsertNode,
	type SelectAgent,
	type SelectAssumption,
	type SelectCompetition,
	type SelectCompetitionEntry,
	type SelectDecisionEpisode,
	type SelectEdge,
	type SelectFinding,
	type SelectInvestigation,
	type SelectMetric,
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

// ─── Agents ───────────────────────────────────────────────────────────────────

export interface CreateAgentInput {
	goal: string;
	graphNodeId?: string;
	parentAgentId?: string;
	model?: string;
	budgetMaxJoules?: number;
	capabilities?: Record<string, unknown>;
}

export async function createAgent(db: DrizzleDb, input: CreateAgentInput, ctx: AuditCtx): Promise<SelectAgent> {
	const id = newId();
	const row: InsertAgent = {
		id,
		goal: input.goal,
		graphNodeId: input.graphNodeId ?? null,
		parentAgentId: input.parentAgentId ?? null,
		model: input.model ?? "neuralwatt-large",
		status: "pending",
		budgetMaxJoules: input.budgetMaxJoules ?? null,
		budgetConsumedJoules: 0,
		capabilities: input.capabilities ?? {},
		createdAt: new Date(),
		updatedAt: new Date(),
	};
	const [agent] = await db.insert(fugueAgents).values(row).returning();
	await audit(db, ctx, "agent.create", "agent", id, { goal: input.goal });
	return agent;
}

export async function getAgent(db: DrizzleDb, id: string): Promise<SelectAgent | undefined> {
	const [agent] = await db.select().from(fugueAgents).where(eq(fugueAgents.id, id));
	return agent;
}

export async function updateAgentStatus(
	db: DrizzleDb,
	id: string,
	status: AgentStatus,
	ctx: AuditCtx,
	budgetConsumedJoules?: number,
): Promise<SelectAgent | undefined> {
	const updates: Partial<InsertAgent> = { status, updatedAt: new Date() };
	if (budgetConsumedJoules !== undefined) updates.budgetConsumedJoules = budgetConsumedJoules;
	const [agent] = await db.update(fugueAgents).set(updates).where(eq(fugueAgents.id, id)).returning();
	if (agent) await audit(db, ctx, "agent.status_changed", "agent", id, { status });
	return agent;
}

export async function listAgents(
	db: DrizzleDb,
	opts?: { status?: AgentStatus; limit?: number },
): Promise<SelectAgent[]> {
	const conditions = [];
	if (opts?.status) conditions.push(eq(fugueAgents.status, opts.status));
	const query = db
		.select()
		.from(fugueAgents)
		.orderBy(desc(fugueAgents.createdAt))
		.limit(opts?.limit ?? 50);
	return conditions.length > 0 ? query.where(and(...conditions)) : query;
}

// ─── Investigations (C5 Research Engine) ─────────────────────────────────────

export interface CreateInvestigationInput {
	question: string;
	methodology?: string;
	graphNodeId?: string;
	investigatorId: string;
}

export async function createInvestigation(
	db: DrizzleDb,
	input: CreateInvestigationInput,
	ctx: AuditCtx,
): Promise<SelectInvestigation> {
	const id = newId();
	const row: InsertInvestigation = {
		id,
		question: input.question,
		methodology: input.methodology ?? "",
		graphNodeId: input.graphNodeId ?? null,
		investigatorId: input.investigatorId,
		status: "open",
		conclusion: "",
		createdAt: new Date(),
		updatedAt: new Date(),
	};
	const [inv] = await db.insert(fugueInvestigations).values(row).returning();
	await audit(db, ctx, "investigation.create", "investigation", id, { question: input.question });
	return inv;
}

export async function concludeInvestigation(
	db: DrizzleDb,
	id: string,
	conclusion: string,
	ctx: AuditCtx,
): Promise<SelectInvestigation | undefined> {
	const [inv] = await db
		.update(fugueInvestigations)
		.set({ status: "concluded", conclusion, updatedAt: new Date() })
		.where(eq(fugueInvestigations.id, id))
		.returning();
	if (inv)
		await audit(db, ctx, "investigation.concluded", "investigation", id, { conclusion: conclusion.slice(0, 200) });
	return inv;
}

export async function listInvestigations(
	db: DrizzleDb,
	opts?: { status?: string; investigatorId?: string; limit?: number },
): Promise<SelectInvestigation[]> {
	const conditions = [];
	if (opts?.status) conditions.push(eq(fugueInvestigations.status, opts.status));
	if (opts?.investigatorId) conditions.push(eq(fugueInvestigations.investigatorId, opts.investigatorId));
	const query = db
		.select()
		.from(fugueInvestigations)
		.orderBy(desc(fugueInvestigations.createdAt))
		.limit(opts?.limit ?? 50);
	return conditions.length > 0 ? query.where(and(...conditions)) : query;
}

export interface AddFindingInput {
	investigationId: string;
	claim: string;
	evidence?: string;
	confidence?: number;
	graphNodeId?: string;
	authorId: string;
}

export async function addFinding(db: DrizzleDb, input: AddFindingInput, ctx: AuditCtx): Promise<SelectFinding> {
	const id = newId();
	const row: InsertFinding = {
		id,
		investigationId: input.investigationId,
		claim: input.claim,
		evidence: input.evidence ?? "",
		confidence: input.confidence ?? 0.5,
		graphNodeId: input.graphNodeId ?? null,
		authorId: input.authorId,
		createdAt: new Date(),
	};
	const [finding] = await db.insert(fugueFindings).values(row).returning();
	await audit(db, ctx, "finding.create", "investigation", input.investigationId, { claim: input.claim });
	return finding;
}

export async function getFindingsForInvestigation(db: DrizzleDb, investigationId: string): Promise<SelectFinding[]> {
	return db
		.select()
		.from(fugueFindings)
		.where(eq(fugueFindings.investigationId, investigationId))
		.orderBy(desc(fugueFindings.createdAt));
}

// ─── Decision Episodes (C10 Institutional Memory) ─────────────────────────────

export interface RecordDecisionEpisodeInput {
	title: string;
	context?: string;
	optionsConsidered?: string[];
	decision: string;
	rationale?: string;
	graphNodeId?: string;
	authorId: string;
}

export async function recordDecisionEpisode(
	db: DrizzleDb,
	input: RecordDecisionEpisodeInput,
	ctx: AuditCtx,
): Promise<SelectDecisionEpisode> {
	const id = newId();
	const row: InsertDecisionEpisode = {
		id,
		title: input.title,
		context: input.context ?? "",
		optionsConsidered: input.optionsConsidered ?? [],
		decision: input.decision,
		rationale: input.rationale ?? "",
		outcome: "",
		graphNodeId: input.graphNodeId ?? null,
		authorId: input.authorId,
		decidedAt: new Date(),
		createdAt: new Date(),
	};
	const [episode] = await db.insert(fugueDecisionEpisodes).values(row).returning();
	await audit(db, ctx, "decision.record", "decision", id, { title: input.title, decision: input.decision });
	return episode;
}

export async function listDecisionEpisodes(
	db: DrizzleDb,
	opts?: { authorId?: string; limit?: number },
): Promise<SelectDecisionEpisode[]> {
	const conditions = [];
	if (opts?.authorId) conditions.push(eq(fugueDecisionEpisodes.authorId, opts.authorId));
	const query = db
		.select()
		.from(fugueDecisionEpisodes)
		.orderBy(desc(fugueDecisionEpisodes.createdAt))
		.limit(opts?.limit ?? 50);
	return conditions.length > 0 ? query.where(and(...conditions)) : query;
}

export async function searchDecisionEpisodes(db: DrizzleDb, q: string, limit = 20): Promise<SelectDecisionEpisode[]> {
	const pattern = `%${q}%`;
	return db
		.select()
		.from(fugueDecisionEpisodes)
		.where(
			or(
				sql`lower(${fugueDecisionEpisodes.title}) like lower(${pattern})`,
				sql`lower(${fugueDecisionEpisodes.decision}) like lower(${pattern})`,
				sql`lower(${fugueDecisionEpisodes.rationale}) like lower(${pattern})`,
			),
		)
		.orderBy(desc(fugueDecisionEpisodes.createdAt))
		.limit(limit);
}

export interface CatchUpItem {
	type: "node" | "assumption" | "investigation" | "decision" | "finding";
	id: string;
	title: string;
	actorId: string;
	timestamp: Date;
}

export async function getCatchUpView(db: DrizzleDb, since: Date, limit = 50): Promise<CatchUpItem[]> {
	const [nodes, assumptions, investigations, decisions, findings] = await Promise.all([
		db
			.select()
			.from(fugueNodes)
			.where(gte(fugueNodes.createdAt, since))
			.orderBy(desc(fugueNodes.createdAt))
			.limit(limit),
		db
			.select()
			.from(fugueAssumptions)
			.where(gte(fugueAssumptions.updatedAt, since))
			.orderBy(desc(fugueAssumptions.updatedAt))
			.limit(limit),
		db
			.select()
			.from(fugueInvestigations)
			.where(gte(fugueInvestigations.updatedAt, since))
			.orderBy(desc(fugueInvestigations.updatedAt))
			.limit(limit),
		db
			.select()
			.from(fugueDecisionEpisodes)
			.where(gte(fugueDecisionEpisodes.createdAt, since))
			.orderBy(desc(fugueDecisionEpisodes.createdAt))
			.limit(limit),
		db
			.select()
			.from(fugueFindings)
			.where(gte(fugueFindings.createdAt, since))
			.orderBy(desc(fugueFindings.createdAt))
			.limit(limit),
	]);

	const items: CatchUpItem[] = [
		...nodes.map((n) => ({
			type: "node" as const,
			id: n.id,
			title: n.title,
			actorId: n.authorId,
			timestamp: n.createdAt,
		})),
		...assumptions.map((a) => ({
			type: "assumption" as const,
			id: a.id,
			title: a.claim.slice(0, 120),
			actorId: a.ownerId,
			timestamp: a.updatedAt,
		})),
		...investigations.map((i) => ({
			type: "investigation" as const,
			id: i.id,
			title: i.question.slice(0, 120),
			actorId: i.investigatorId,
			timestamp: i.updatedAt,
		})),
		...decisions.map((d) => ({
			type: "decision" as const,
			id: d.id,
			title: d.title,
			actorId: d.authorId,
			timestamp: d.createdAt,
		})),
		...findings.map((f) => ({
			type: "finding" as const,
			id: f.id,
			title: f.claim.slice(0, 120),
			actorId: f.authorId,
			timestamp: f.createdAt,
		})),
	];

	return items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, limit);
}

// ─── Metrics (C7 Impact Tracker) ──────────────────────────────────────────────

export interface RecordMetricInput {
	graphNodeId?: string;
	name: string;
	value: number;
	unit?: string;
	measuredBy: string;
}

export async function recordMetric(db: DrizzleDb, input: RecordMetricInput, ctx: AuditCtx): Promise<SelectMetric> {
	const id = newId();
	const row: InsertMetric = {
		id,
		graphNodeId: input.graphNodeId ?? null,
		name: input.name,
		value: input.value,
		unit: input.unit ?? "",
		measuredBy: input.measuredBy,
		measuredAt: new Date(),
		createdAt: new Date(),
	};
	const [metric] = await db.insert(fugueMetrics).values(row).returning();
	await audit(db, ctx, "metric.record", "metric", id, { name: input.name, value: input.value });
	return metric;
}

export async function getMetricsForNode(db: DrizzleDb, graphNodeId: string): Promise<SelectMetric[]> {
	return db
		.select()
		.from(fugueMetrics)
		.where(eq(fugueMetrics.graphNodeId, graphNodeId))
		.orderBy(desc(fugueMetrics.measuredAt));
}

export async function listMetrics(
	db: DrizzleDb,
	opts?: { name?: string; graphNodeId?: string; limit?: number },
): Promise<SelectMetric[]> {
	const conditions = [];
	if (opts?.name) conditions.push(eq(fugueMetrics.name, opts.name));
	if (opts?.graphNodeId) conditions.push(eq(fugueMetrics.graphNodeId, opts.graphNodeId));
	const query = db
		.select()
		.from(fugueMetrics)
		.orderBy(desc(fugueMetrics.measuredAt))
		.limit(opts?.limit ?? 100);
	return conditions.length > 0 ? query.where(and(...conditions)) : query;
}

// ─── Competitions (C6 Competition Framework) ──────────────────────────────────

export interface CreateCompetitionInput {
	title: string;
	description?: string;
	criteria?: Record<string, unknown>;
	authorId: string;
}

export async function createCompetition(
	db: DrizzleDb,
	input: CreateCompetitionInput,
	ctx: AuditCtx,
): Promise<SelectCompetition> {
	const id = newId();
	const row: InsertCompetition = {
		id,
		title: input.title,
		description: input.description ?? "",
		status: "active",
		criteria: input.criteria ?? {},
		winnerNodeId: null,
		authorId: input.authorId,
		createdAt: new Date(),
		concludedAt: null,
	};
	const [comp] = await db.insert(fugueCompetitions).values(row).returning();
	await audit(db, ctx, "competition.create", "competition", id, { title: input.title });
	return comp;
}

export async function getCompetition(db: DrizzleDb, id: string): Promise<SelectCompetition | undefined> {
	const [comp] = await db.select().from(fugueCompetitions).where(eq(fugueCompetitions.id, id));
	return comp;
}

export async function listCompetitions(
	db: DrizzleDb,
	opts?: { status?: string; limit?: number },
): Promise<SelectCompetition[]> {
	const conditions = [];
	if (opts?.status) conditions.push(eq(fugueCompetitions.status, opts.status));
	const query = db
		.select()
		.from(fugueCompetitions)
		.orderBy(desc(fugueCompetitions.createdAt))
		.limit(opts?.limit ?? 50);
	return conditions.length > 0 ? query.where(and(...conditions)) : query;
}

export interface AddEntryInput {
	competitionId: string;
	graphNodeId: string;
	notes?: string;
	authorId: string;
}

export async function addCompetitionEntry(
	db: DrizzleDb,
	input: AddEntryInput,
	ctx: AuditCtx,
): Promise<SelectCompetitionEntry> {
	const id = newId();
	const row: InsertCompetitionEntry = {
		id,
		competitionId: input.competitionId,
		graphNodeId: input.graphNodeId,
		notes: input.notes ?? "",
		score: null,
		authorId: input.authorId,
		createdAt: new Date(),
	};
	const [entry] = await db.insert(fugueCompetitionEntries).values(row).returning();
	await audit(db, ctx, "competition.entry_added", "competition", input.competitionId, {
		graphNodeId: input.graphNodeId,
	});
	return entry;
}

export async function scoreCompetitionEntry(
	db: DrizzleDb,
	entryId: string,
	score: number,
	ctx: AuditCtx,
): Promise<SelectCompetitionEntry | undefined> {
	const [entry] = await db
		.update(fugueCompetitionEntries)
		.set({ score })
		.where(eq(fugueCompetitionEntries.id, entryId))
		.returning();
	if (entry) await audit(db, ctx, "competition.entry_scored", "competition", entry.competitionId, { entryId, score });
	return entry;
}

export async function concludeCompetition(
	db: DrizzleDb,
	id: string,
	winnerNodeId: string,
	ctx: AuditCtx,
): Promise<SelectCompetition | undefined> {
	const [comp] = await db
		.update(fugueCompetitions)
		.set({ status: "concluded", winnerNodeId, concludedAt: new Date() })
		.where(eq(fugueCompetitions.id, id))
		.returning();
	if (comp) await audit(db, ctx, "competition.concluded", "competition", id, { winnerNodeId });
	return comp;
}

export async function getCompetitionEntries(db: DrizzleDb, competitionId: string): Promise<SelectCompetitionEntry[]> {
	return db
		.select()
		.from(fugueCompetitionEntries)
		.where(eq(fugueCompetitionEntries.competitionId, competitionId))
		.orderBy(desc(fugueCompetitionEntries.createdAt));
}
