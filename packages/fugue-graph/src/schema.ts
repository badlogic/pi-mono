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
