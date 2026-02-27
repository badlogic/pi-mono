import { bigserial, boolean, jsonb, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

// ─── Users (minimal, Better Auth manages the full user table) ─────────────────

export const fugueUsers = pgTable("fugue_users", {
	id: text("id").primaryKey(),
	email: text("email").notNull().unique(),
	role: text("role").notNull().default("member"), // "admin" | "member" | "viewer"
	displayName: text("display_name"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Context Graph Nodes ──────────────────────────────────────────────────────

export const fugueNodes = pgTable("fugue_nodes", {
	id: text("id").primaryKey(),
	type: text("type").notNull(), // NodeType
	title: text("title").notNull(),
	content: jsonb("content").notNull().default({}),
	authorId: text("author_id").notNull(),
	authorType: text("author_type").notNull().default("human"), // "human" | "agent"
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	archivedAt: timestamp("archived_at", { withTimezone: true }),
	status: text("status").notNull().default("active"), // "active" | "archived" | "stale"
});

// ─── Context Graph Edges ──────────────────────────────────────────────────────

export const fugueEdges = pgTable("fugue_edges", {
	id: text("id").primaryKey(),
	sourceId: text("source_id")
		.notNull()
		.references(() => fugueNodes.id, { onDelete: "cascade" }),
	targetId: text("target_id")
		.notNull()
		.references(() => fugueNodes.id, { onDelete: "cascade" }),
	type: text("type").notNull(), // EdgeType
	metadata: jsonb("metadata"),
	authorId: text("author_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Assumptions ─────────────────────────────────────────────────────────────

export const fugueAssumptions = pgTable("fugue_assumptions", {
	id: text("id").primaryKey(),
	graphNodeId: text("graph_node_id")
		.notNull()
		.references(() => fugueNodes.id, { onDelete: "cascade" }),
	claim: text("claim").notNull(),
	confidence: real("confidence").notNull().default(0.5), // 0-1
	evidence: text("evidence").notNull().default(""),
	ownerId: text("owner_id").notNull(),
	verificationMethod: text("verification_method").notNull().default(""),
	verifyByDate: timestamp("verify_by_date", { withTimezone: true }),
	isStale: boolean("is_stale").notNull().default(false),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Audit Log ────────────────────────────────────────────────────────────────

export const fugueAuditLog = pgTable("fugue_audit_log", {
	id: bigserial("id", { mode: "bigint" }).primaryKey(),
	actorId: text("actor_id").notNull(),
	actorType: text("actor_type").notNull(), // "human" | "agent"
	action: text("action").notNull(), // "node.create" | "edge.create" | etc.
	targetType: text("target_type"), // "node" | "edge" | "event" | "agent"
	targetId: text("target_id"),
	detail: jsonb("detail"),
	authorityChain: text("authority_chain").array().notNull().default([]),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Investigations (C5 Research Engine) ─────────────────────────────────────

export const fugueInvestigations = pgTable("fugue_investigations", {
	id: text("id").primaryKey(),
	graphNodeId: text("graph_node_id").references(() => fugueNodes.id, { onDelete: "set null" }),
	question: text("question").notNull(),
	methodology: text("methodology").notNull().default(""),
	status: text("status").notNull().default("open"), // "open" | "active" | "concluded"
	conclusion: text("conclusion").notNull().default(""),
	investigatorId: text("investigator_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Findings (C5 Research Engine) ────────────────────────────────────────────

export const fugueFindings = pgTable("fugue_findings", {
	id: text("id").primaryKey(),
	investigationId: text("investigation_id")
		.notNull()
		.references(() => fugueInvestigations.id, { onDelete: "cascade" }),
	graphNodeId: text("graph_node_id").references(() => fugueNodes.id, { onDelete: "set null" }),
	claim: text("claim").notNull(),
	evidence: text("evidence").notNull().default(""),
	confidence: real("confidence").notNull().default(0.5),
	authorId: text("author_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Decision Episodes (C10 Institutional Memory) ─────────────────────────────

export const fugueDecisionEpisodes = pgTable("fugue_decision_episodes", {
	id: text("id").primaryKey(),
	title: text("title").notNull(),
	context: text("context").notNull().default(""),
	optionsConsidered: jsonb("options_considered").notNull().default([]),
	decision: text("decision").notNull(),
	rationale: text("rationale").notNull().default(""),
	outcome: text("outcome").notNull().default(""),
	graphNodeId: text("graph_node_id").references(() => fugueNodes.id, { onDelete: "set null" }),
	authorId: text("author_id").notNull(),
	decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Metrics (C7 Impact Tracker) ──────────────────────────────────────────────

export const fugueMetrics = pgTable("fugue_metrics", {
	id: text("id").primaryKey(),
	graphNodeId: text("graph_node_id").references(() => fugueNodes.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	value: real("value").notNull(),
	unit: text("unit").notNull().default(""),
	measuredBy: text("measured_by").notNull(),
	measuredAt: timestamp("measured_at", { withTimezone: true }).notNull().defaultNow(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Competitions (C6 Competition Framework) ──────────────────────────────────

export const fugueCompetitions = pgTable("fugue_competitions", {
	id: text("id").primaryKey(),
	title: text("title").notNull(),
	description: text("description").notNull().default(""),
	status: text("status").notNull().default("active"), // "active" | "concluded"
	criteria: jsonb("criteria").notNull().default({}),
	winnerNodeId: text("winner_node_id").references(() => fugueNodes.id, { onDelete: "set null" }),
	authorId: text("author_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	concludedAt: timestamp("concluded_at", { withTimezone: true }),
});

export const fugueCompetitionEntries = pgTable("fugue_competition_entries", {
	id: text("id").primaryKey(),
	competitionId: text("competition_id")
		.notNull()
		.references(() => fugueCompetitions.id, { onDelete: "cascade" }),
	graphNodeId: text("graph_node_id")
		.notNull()
		.references(() => fugueNodes.id, { onDelete: "cascade" }),
	score: real("score"),
	notes: text("notes").notNull().default(""),
	authorId: text("author_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Agents ───────────────────────────────────────────────────────────────────

export const fugueAgents = pgTable("fugue_agents", {
	id: text("id").primaryKey(),
	graphNodeId: text("graph_node_id").references(() => fugueNodes.id, { onDelete: "set null" }),
	parentAgentId: text("parent_agent_id"), // FK to self not expressed in Drizzle to avoid circular ref
	goal: text("goal").notNull(),
	status: text("status").notNull().default("pending"), // AgentStatus
	model: text("model").notNull().default("neuralwatt-large"),
	budgetMaxJoules: real("budget_max_joules"),
	budgetConsumedJoules: real("budget_consumed_joules").notNull().default(0),
	capabilities: jsonb("capabilities").notNull().default({}),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Drizzle type exports ─────────────────────────────────────────────────────

export type InsertNode = typeof fugueNodes.$inferInsert;
export type SelectNode = typeof fugueNodes.$inferSelect;
export type InsertEdge = typeof fugueEdges.$inferInsert;
export type SelectEdge = typeof fugueEdges.$inferSelect;
export type InsertAuditEntry = typeof fugueAuditLog.$inferInsert;
export type SelectAuditEntry = typeof fugueAuditLog.$inferSelect;
export type InsertAssumption = typeof fugueAssumptions.$inferInsert;
export type SelectAssumption = typeof fugueAssumptions.$inferSelect;
export type InsertAgent = typeof fugueAgents.$inferInsert;
export type SelectAgent = typeof fugueAgents.$inferSelect;
export type InsertInvestigation = typeof fugueInvestigations.$inferInsert;
export type SelectInvestigation = typeof fugueInvestigations.$inferSelect;
export type InsertFinding = typeof fugueFindings.$inferInsert;
export type SelectFinding = typeof fugueFindings.$inferSelect;
export type InsertDecisionEpisode = typeof fugueDecisionEpisodes.$inferInsert;
export type SelectDecisionEpisode = typeof fugueDecisionEpisodes.$inferSelect;
export type InsertMetric = typeof fugueMetrics.$inferInsert;
export type SelectMetric = typeof fugueMetrics.$inferSelect;
export type InsertCompetition = typeof fugueCompetitions.$inferInsert;
export type SelectCompetition = typeof fugueCompetitions.$inferSelect;
export type InsertCompetitionEntry = typeof fugueCompetitionEntries.$inferInsert;
export type SelectCompetitionEntry = typeof fugueCompetitionEntries.$inferSelect;
