import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DrizzleDb } from "../src/graph.js";
import {
	addCompetitionEntry,
	addFinding,
	archiveNode,
	concludeCompetition,
	concludeInvestigation,
	createAgent,
	createAssumption,
	createCompetition,
	createEdge,
	createInvestigation,
	createNode,
	deleteEdge,
	getAgent,
	getAssumptionsForNode,
	getCatchUpView,
	getCompetition,
	getCompetitionEntries,
	getEdgesBetween,
	getEdgesFrom,
	getEdgesTo,
	getFindingsForInvestigation,
	getMetricsForNode,
	getNode,
	listAgents,
	listCompetitions,
	listDecisionEpisodes,
	listInvestigations,
	listMetrics,
	listNodes,
	markStaleAssumptions,
	queryAuditLog,
	recordDecisionEpisode,
	recordMetric,
	scoreCompetitionEntry,
	searchDecisionEpisodes,
	updateAgentStatus,
	updateAssumptionConfidence,
	updateNode,
} from "../src/graph.js";
import { createTestDb, TEST_ACTOR } from "./helpers.js";

// ─── Test Setup ───────────────────────────────────────────────────────────────

let db: DrizzleDb;
let cleanup: () => Promise<void>;

beforeEach(async () => {
	({ db, cleanup } = await createTestDb());
});

afterEach(async () => {
	await cleanup();
});

// ─── Node CRUD ────────────────────────────────────────────────────────────────

describe("createNode", () => {
	it("creates a node with required fields", async () => {
		const node = await createNode(db, { type: "idea", title: "Test Idea", authorId: "user-1" }, TEST_ACTOR);

		expect(node.id).toBeTruthy();
		expect(node.type).toBe("idea");
		expect(node.title).toBe("Test Idea");
		expect(node.authorId).toBe("user-1");
		expect(node.authorType).toBe("human");
		expect(node.status).toBe("active");
		expect(node.content).toEqual({});
		expect(node.createdAt).toBeInstanceOf(Date);
		expect(node.updatedAt).toBeInstanceOf(Date);
		expect(node.archivedAt).toBeNull();
	});

	it("creates a node with optional content and authorType", async () => {
		const node = await createNode(
			db,
			{
				type: "decision",
				title: "Use PostgreSQL",
				content: { rationale: "ACID compliance" },
				authorId: "agent-1",
				authorType: "agent",
			},
			TEST_ACTOR,
		);

		expect(node.content).toEqual({ rationale: "ACID compliance" });
		expect(node.authorType).toBe("agent");
	});

	it("assigns unique ids to each node", async () => {
		const a = await createNode(db, { type: "idea", title: "A", authorId: "u" }, TEST_ACTOR);
		const b = await createNode(db, { type: "idea", title: "B", authorId: "u" }, TEST_ACTOR);

		expect(a.id).not.toBe(b.id);
	});

	it("writes an audit entry on creation", async () => {
		const node = await createNode(db, { type: "idea", title: "Audited", authorId: "u" }, TEST_ACTOR);

		const log = await queryAuditLog(db, { targetId: node.id });
		expect(log.length).toBe(1);
		expect(log[0]!.action).toBe("node.create");
		expect(log[0]!.actorId).toBe(TEST_ACTOR.actorId);
	});
});

describe("getNode", () => {
	it("returns a node by id", async () => {
		const created = await createNode(db, { type: "idea", title: "Fetch Me", authorId: "u" }, TEST_ACTOR);
		const found = await getNode(db, created.id);

		expect(found).toBeDefined();
		expect(found!.id).toBe(created.id);
		expect(found!.title).toBe("Fetch Me");
	});

	it("returns undefined for missing id", async () => {
		const found = await getNode(db, "nonexistent-id");
		expect(found).toBeUndefined();
	});
});

describe("updateNode", () => {
	it("updates title", async () => {
		const node = await createNode(db, { type: "idea", title: "Old Title", authorId: "u" }, TEST_ACTOR);
		const updated = await updateNode(db, node.id, { title: "New Title" }, TEST_ACTOR);

		expect(updated!.title).toBe("New Title");
		expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(node.updatedAt.getTime());
	});

	it("updates content", async () => {
		const node = await createNode(db, { type: "decision", title: "D", authorId: "u" }, TEST_ACTOR);
		const updated = await updateNode(db, node.id, { content: { key: "value" } }, TEST_ACTOR);

		expect(updated!.content).toEqual({ key: "value" });
	});

	it("updates status to archived and sets archivedAt", async () => {
		const node = await createNode(db, { type: "idea", title: "I", authorId: "u" }, TEST_ACTOR);
		const updated = await updateNode(db, node.id, { status: "archived" }, TEST_ACTOR);

		expect(updated!.status).toBe("archived");
		expect(updated!.archivedAt).toBeInstanceOf(Date);
	});

	it("returns undefined for missing node", async () => {
		const result = await updateNode(db, "ghost-id", { title: "x" }, TEST_ACTOR);
		expect(result).toBeUndefined();
	});

	it("writes an audit entry on update", async () => {
		const node = await createNode(db, { type: "idea", title: "I", authorId: "u" }, TEST_ACTOR);
		await updateNode(db, node.id, { title: "Updated" }, TEST_ACTOR);

		const log = await queryAuditLog(db, { targetId: node.id, action: "node.update" });
		expect(log.length).toBe(1);
	});
});

describe("archiveNode", () => {
	it("sets status to archived", async () => {
		const node = await createNode(db, { type: "idea", title: "I", authorId: "u" }, TEST_ACTOR);
		const archived = await archiveNode(db, node.id, TEST_ACTOR);

		expect(archived!.status).toBe("archived");
		expect(archived!.archivedAt).toBeInstanceOf(Date);
	});
});

describe("listNodes", () => {
	it("returns all nodes when no filter", async () => {
		await createNode(db, { type: "idea", title: "A", authorId: "u" }, TEST_ACTOR);
		await createNode(db, { type: "decision", title: "B", authorId: "u" }, TEST_ACTOR);

		const nodes = await listNodes(db);
		expect(nodes.length).toBe(2);
	});

	it("filters by type", async () => {
		await createNode(db, { type: "idea", title: "Idea", authorId: "u" }, TEST_ACTOR);
		await createNode(db, { type: "decision", title: "Decision", authorId: "u" }, TEST_ACTOR);

		const ideas = await listNodes(db, { type: "idea" });
		expect(ideas.length).toBe(1);
		expect(ideas[0]!.type).toBe("idea");
	});

	it("filters by authorId", async () => {
		await createNode(db, { type: "idea", title: "Mine", authorId: "user-a" }, TEST_ACTOR);
		await createNode(db, { type: "idea", title: "Theirs", authorId: "user-b" }, TEST_ACTOR);

		const mine = await listNodes(db, { authorId: "user-a" });
		expect(mine.length).toBe(1);
		expect(mine[0]!.authorId).toBe("user-a");
	});

	it("filters by status", async () => {
		const n1 = await createNode(db, { type: "idea", title: "Active", authorId: "u" }, TEST_ACTOR);
		const n2 = await createNode(db, { type: "idea", title: "Archived", authorId: "u" }, TEST_ACTOR);
		await archiveNode(db, n2.id, TEST_ACTOR);

		const active = await listNodes(db, { status: "active" });
		expect(active.every((n) => n.status === "active")).toBe(true);
		expect(active.some((n) => n.id === n1.id)).toBe(true);
		expect(active.some((n) => n.id === n2.id)).toBe(false);
	});

	it("respects limit and offset", async () => {
		for (let i = 0; i < 5; i++) {
			await createNode(db, { type: "idea", title: `Node ${i}`, authorId: "u" }, TEST_ACTOR);
		}

		const first2 = await listNodes(db, { limit: 2 });
		expect(first2.length).toBe(2);

		const next2 = await listNodes(db, { limit: 2, offset: 2 });
		expect(next2.length).toBe(2);
		expect(next2[0]!.id).not.toBe(first2[0]!.id);
	});

	it("returns empty array when nothing matches", async () => {
		const nodes = await listNodes(db, { type: "metric" });
		expect(nodes).toEqual([]);
	});
});

// ─── Edge CRUD ────────────────────────────────────────────────────────────────

describe("createEdge", () => {
	it("creates an edge between two nodes", async () => {
		const source = await createNode(db, { type: "idea", title: "Source", authorId: "u" }, TEST_ACTOR);
		const target = await createNode(db, { type: "decision", title: "Target", authorId: "u" }, TEST_ACTOR);

		const edge = await createEdge(
			db,
			{ sourceId: source.id, targetId: target.id, type: "builds_on", authorId: "u" },
			TEST_ACTOR,
		);

		expect(edge.id).toBeTruthy();
		expect(edge.sourceId).toBe(source.id);
		expect(edge.targetId).toBe(target.id);
		expect(edge.type).toBe("builds_on");
		expect(edge.metadata).toBeNull();
	});

	it("stores optional metadata", async () => {
		const a = await createNode(db, { type: "idea", title: "A", authorId: "u" }, TEST_ACTOR);
		const b = await createNode(db, { type: "idea", title: "B", authorId: "u" }, TEST_ACTOR);

		const edge = await createEdge(
			db,
			{
				sourceId: a.id,
				targetId: b.id,
				type: "challenges",
				metadata: { reason: "conflicting goals" },
				authorId: "u",
			},
			TEST_ACTOR,
		);

		expect(edge.metadata).toEqual({ reason: "conflicting goals" });
	});

	it("writes an audit entry", async () => {
		const a = await createNode(db, { type: "idea", title: "A", authorId: "u" }, TEST_ACTOR);
		const b = await createNode(db, { type: "idea", title: "B", authorId: "u" }, TEST_ACTOR);
		const edge = await createEdge(
			db,
			{ sourceId: a.id, targetId: b.id, type: "supports", authorId: "u" },
			TEST_ACTOR,
		);

		const log = await queryAuditLog(db, { targetId: edge.id, action: "edge.create" });
		expect(log.length).toBe(1);
	});
});

describe("deleteEdge", () => {
	it("deletes an existing edge and returns true", async () => {
		const a = await createNode(db, { type: "idea", title: "A", authorId: "u" }, TEST_ACTOR);
		const b = await createNode(db, { type: "idea", title: "B", authorId: "u" }, TEST_ACTOR);
		const edge = await createEdge(
			db,
			{ sourceId: a.id, targetId: b.id, type: "supports", authorId: "u" },
			TEST_ACTOR,
		);

		const result = await deleteEdge(db, edge.id, TEST_ACTOR);
		expect(result).toBe(true);

		const remaining = await getEdgesFrom(db, a.id);
		expect(remaining.length).toBe(0);
	});

	it("returns false for nonexistent edge", async () => {
		const result = await deleteEdge(db, "ghost-edge", TEST_ACTOR);
		expect(result).toBe(false);
	});

	it("writes an audit entry on delete", async () => {
		const a = await createNode(db, { type: "idea", title: "A", authorId: "u" }, TEST_ACTOR);
		const b = await createNode(db, { type: "idea", title: "B", authorId: "u" }, TEST_ACTOR);
		const edge = await createEdge(
			db,
			{ sourceId: a.id, targetId: b.id, type: "supports", authorId: "u" },
			TEST_ACTOR,
		);

		await deleteEdge(db, edge.id, TEST_ACTOR);
		const log = await queryAuditLog(db, { targetId: edge.id, action: "edge.delete" });
		expect(log.length).toBe(1);
	});
});

describe("getEdgesFrom", () => {
	it("returns edges from a source node", async () => {
		const a = await createNode(db, { type: "idea", title: "A", authorId: "u" }, TEST_ACTOR);
		const b = await createNode(db, { type: "idea", title: "B", authorId: "u" }, TEST_ACTOR);
		const c = await createNode(db, { type: "idea", title: "C", authorId: "u" }, TEST_ACTOR);

		await createEdge(db, { sourceId: a.id, targetId: b.id, type: "supports", authorId: "u" }, TEST_ACTOR);
		await createEdge(db, { sourceId: a.id, targetId: c.id, type: "challenges", authorId: "u" }, TEST_ACTOR);

		const edges = await getEdgesFrom(db, a.id);
		expect(edges.length).toBe(2);
		expect(edges.every((e) => e.sourceId === a.id)).toBe(true);
	});

	it("returns empty array when no edges", async () => {
		const a = await createNode(db, { type: "idea", title: "A", authorId: "u" }, TEST_ACTOR);
		const edges = await getEdgesFrom(db, a.id);
		expect(edges).toEqual([]);
	});
});

describe("getEdgesTo", () => {
	it("returns edges pointing to a target node", async () => {
		const a = await createNode(db, { type: "idea", title: "A", authorId: "u" }, TEST_ACTOR);
		const b = await createNode(db, { type: "idea", title: "B", authorId: "u" }, TEST_ACTOR);
		const c = await createNode(db, { type: "idea", title: "C", authorId: "u" }, TEST_ACTOR);

		await createEdge(db, { sourceId: a.id, targetId: c.id, type: "supports", authorId: "u" }, TEST_ACTOR);
		await createEdge(db, { sourceId: b.id, targetId: c.id, type: "builds_on", authorId: "u" }, TEST_ACTOR);

		const edges = await getEdgesTo(db, c.id);
		expect(edges.length).toBe(2);
		expect(edges.every((e) => e.targetId === c.id)).toBe(true);
	});
});

describe("getEdgesBetween", () => {
	it("returns edges in both directions", async () => {
		const a = await createNode(db, { type: "idea", title: "A", authorId: "u" }, TEST_ACTOR);
		const b = await createNode(db, { type: "idea", title: "B", authorId: "u" }, TEST_ACTOR);
		const c = await createNode(db, { type: "idea", title: "C", authorId: "u" }, TEST_ACTOR);

		const e1 = await createEdge(db, { sourceId: a.id, targetId: b.id, type: "supports", authorId: "u" }, TEST_ACTOR);
		const e2 = await createEdge(
			db,
			{ sourceId: b.id, targetId: a.id, type: "challenges", authorId: "u" },
			TEST_ACTOR,
		);
		await createEdge(db, { sourceId: a.id, targetId: c.id, type: "supports", authorId: "u" }, TEST_ACTOR);

		const edges = await getEdgesBetween(db, a.id, b.id);
		expect(edges.length).toBe(2);
		const ids = edges.map((e) => e.id);
		expect(ids).toContain(e1.id);
		expect(ids).toContain(e2.id);
	});

	it("returns empty array when no edges between nodes", async () => {
		const a = await createNode(db, { type: "idea", title: "A", authorId: "u" }, TEST_ACTOR);
		const b = await createNode(db, { type: "idea", title: "B", authorId: "u" }, TEST_ACTOR);

		const edges = await getEdgesBetween(db, a.id, b.id);
		expect(edges).toEqual([]);
	});
});

// ─── Assumptions ─────────────────────────────────────────────────────────────

describe("createAssumption", () => {
	it("creates an assumption with defaults", async () => {
		const node = await createNode(db, { type: "decision", title: "Decision", authorId: "u" }, TEST_ACTOR);
		const assumption = await createAssumption(
			db,
			{ graphNodeId: node.id, claim: "Users want this", ownerId: "user-1" },
			TEST_ACTOR,
		);

		expect(assumption.id).toBeTruthy();
		expect(assumption.graphNodeId).toBe(node.id);
		expect(assumption.claim).toBe("Users want this");
		expect(assumption.confidence).toBe(0.5);
		expect(assumption.evidence).toBe("");
		expect(assumption.isStale).toBe(false);
		expect(assumption.verifyByDate).toBeNull();
	});

	it("creates an assumption with custom values", async () => {
		const node = await createNode(db, { type: "decision", title: "D", authorId: "u" }, TEST_ACTOR);
		const verifyByDays = 30;
		const assumption = await createAssumption(
			db,
			{
				graphNodeId: node.id,
				claim: "Market is large enough",
				confidence: 0.8,
				evidence: "Industry report Q4",
				ownerId: "user-1",
				verificationMethod: "user interview",
				verifyByDays,
			},
			TEST_ACTOR,
		);

		expect(assumption.confidence).toBe(0.8);
		expect(assumption.evidence).toBe("Industry report Q4");
		expect(assumption.verificationMethod).toBe("user interview");
		expect(assumption.verifyByDate).toBeInstanceOf(Date);

		const daysFromNow = (assumption.verifyByDate!.getTime() - Date.now()) / 86_400_000;
		expect(daysFromNow).toBeGreaterThan(29);
		expect(daysFromNow).toBeLessThan(31);
	});

	it("writes an audit entry", async () => {
		const node = await createNode(db, { type: "decision", title: "D", authorId: "u" }, TEST_ACTOR);
		await createAssumption(db, { graphNodeId: node.id, claim: "Test claim", ownerId: "user-1" }, TEST_ACTOR);

		const log = await queryAuditLog(db, { targetId: node.id, action: "assumption.create" });
		expect(log.length).toBe(1);
	});
});

describe("updateAssumptionConfidence", () => {
	it("updates confidence value", async () => {
		const node = await createNode(db, { type: "decision", title: "D", authorId: "u" }, TEST_ACTOR);
		const assumption = await createAssumption(db, { graphNodeId: node.id, claim: "Claim", ownerId: "u" }, TEST_ACTOR);

		const updated = await updateAssumptionConfidence(db, assumption.id, 0.9, TEST_ACTOR);
		expect(updated!.confidence).toBe(0.9);
		expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(assumption.updatedAt.getTime());
	});

	it("returns undefined for nonexistent assumption", async () => {
		const result = await updateAssumptionConfidence(db, "ghost", 0.5, TEST_ACTOR);
		expect(result).toBeUndefined();
	});

	it("writes an audit entry", async () => {
		const node = await createNode(db, { type: "decision", title: "D", authorId: "u" }, TEST_ACTOR);
		const assumption = await createAssumption(db, { graphNodeId: node.id, claim: "Claim", ownerId: "u" }, TEST_ACTOR);

		await updateAssumptionConfidence(db, assumption.id, 0.75, TEST_ACTOR);
		const log = await queryAuditLog(db, { action: "assumption.confidence_updated" });
		expect(log.length).toBe(1);
	});
});

describe("getAssumptionsForNode", () => {
	it("returns all assumptions for a node", async () => {
		const node = await createNode(db, { type: "decision", title: "D", authorId: "u" }, TEST_ACTOR);
		await createAssumption(db, { graphNodeId: node.id, claim: "Claim 1", ownerId: "u" }, TEST_ACTOR);
		await createAssumption(db, { graphNodeId: node.id, claim: "Claim 2", ownerId: "u" }, TEST_ACTOR);

		const assumptions = await getAssumptionsForNode(db, node.id);
		expect(assumptions.length).toBe(2);
		expect(assumptions.every((a) => a.graphNodeId === node.id)).toBe(true);
	});

	it("returns empty array when no assumptions", async () => {
		const node = await createNode(db, { type: "idea", title: "I", authorId: "u" }, TEST_ACTOR);
		const assumptions = await getAssumptionsForNode(db, node.id);
		expect(assumptions).toEqual([]);
	});

	it("does not return assumptions from other nodes", async () => {
		const n1 = await createNode(db, { type: "decision", title: "D1", authorId: "u" }, TEST_ACTOR);
		const n2 = await createNode(db, { type: "decision", title: "D2", authorId: "u" }, TEST_ACTOR);
		await createAssumption(db, { graphNodeId: n1.id, claim: "For n1", ownerId: "u" }, TEST_ACTOR);
		await createAssumption(db, { graphNodeId: n2.id, claim: "For n2", ownerId: "u" }, TEST_ACTOR);

		const n1Assumptions = await getAssumptionsForNode(db, n1.id);
		expect(n1Assumptions.length).toBe(1);
		expect(n1Assumptions[0]!.claim).toBe("For n1");
	});
});

describe("markStaleAssumptions", () => {
	it("marks assumptions past their verify_by_date as stale", async () => {
		const node = await createNode(db, { type: "decision", title: "D", authorId: "u" }, TEST_ACTOR);
		// Create assumption that's already past due (negative days)
		// We'll manually insert one with a past date using SQL
		await createAssumption(
			db,
			{ graphNodeId: node.id, claim: "Past due", ownerId: "u", verifyByDays: -1 },
			TEST_ACTOR,
		);

		// The assumption with verifyByDays: -1 creates a date 1 day in the past
		const count = await markStaleAssumptions(db);
		expect(count).toBeGreaterThanOrEqual(1);

		const assumptions = await getAssumptionsForNode(db, node.id);
		const pastDue = assumptions.filter((a) => a.claim === "Past due");
		expect(pastDue[0]!.isStale).toBe(true);
	});

	it("does not mark future assumptions as stale", async () => {
		const node = await createNode(db, { type: "decision", title: "D", authorId: "u" }, TEST_ACTOR);
		await createAssumption(db, { graphNodeId: node.id, claim: "Future", ownerId: "u", verifyByDays: 30 }, TEST_ACTOR);

		const count = await markStaleAssumptions(db);
		expect(count).toBe(0);

		const assumptions = await getAssumptionsForNode(db, node.id);
		expect(assumptions[0]!.isStale).toBe(false);
	});
});

// ─── Audit Log ────────────────────────────────────────────────────────────────

describe("queryAuditLog", () => {
	it("returns all entries when no filter", async () => {
		const node = await createNode(db, { type: "idea", title: "I", authorId: "u" }, TEST_ACTOR);
		await updateNode(db, node.id, { title: "Updated" }, TEST_ACTOR);

		const log = await queryAuditLog(db);
		expect(log.length).toBe(2);
	});

	it("filters by actorId", async () => {
		const actorA = { actorId: "actor-a", actorType: "human" as const, authorityChain: ["actor-a"] };
		const actorB = { actorId: "actor-b", actorType: "human" as const, authorityChain: ["actor-b"] };

		await createNode(db, { type: "idea", title: "By A", authorId: "u" }, actorA);
		await createNode(db, { type: "idea", title: "By B", authorId: "u" }, actorB);

		const logA = await queryAuditLog(db, { actorId: "actor-a" });
		expect(logA.length).toBe(1);
		expect(logA[0]!.actorId).toBe("actor-a");
	});

	it("filters by targetId", async () => {
		const n1 = await createNode(db, { type: "idea", title: "N1", authorId: "u" }, TEST_ACTOR);
		const n2 = await createNode(db, { type: "idea", title: "N2", authorId: "u" }, TEST_ACTOR);

		const logN1 = await queryAuditLog(db, { targetId: n1.id });
		expect(logN1.length).toBe(1);
		expect(logN1[0]!.targetId).toBe(n1.id);

		const logN2 = await queryAuditLog(db, { targetId: n2.id });
		expect(logN2.length).toBe(1);
		expect(logN2[0]!.targetId).toBe(n2.id);
	});

	it("filters by action", async () => {
		const node = await createNode(db, { type: "idea", title: "I", authorId: "u" }, TEST_ACTOR);
		await updateNode(db, node.id, { title: "Updated" }, TEST_ACTOR);

		const creates = await queryAuditLog(db, { action: "node.create" });
		const updates = await queryAuditLog(db, { action: "node.update" });

		expect(creates.length).toBe(1);
		expect(updates.length).toBe(1);
	});

	it("respects limit", async () => {
		for (let i = 0; i < 5; i++) {
			await createNode(db, { type: "idea", title: `Node ${i}`, authorId: "u" }, TEST_ACTOR);
		}

		const log = await queryAuditLog(db, { limit: 3 });
		expect(log.length).toBe(3);
	});

	it("records authority chain", async () => {
		const chainActor = {
			actorId: "agent-1",
			actorType: "agent" as const,
			authorityChain: ["user-root", "agent-1"],
		};
		await createNode(db, { type: "idea", title: "Chain test", authorId: "agent-1" }, chainActor);

		const log = await queryAuditLog(db, { actorId: "agent-1" });
		expect(log[0]!.authorityChain).toEqual(["user-root", "agent-1"]);
	});
});

// ─── Agent CRUD ───────────────────────────────────────────────────────────────

describe("createAgent", () => {
	it("creates an agent with required fields", async () => {
		const agent = await createAgent(db, { goal: "Analyze market trends" }, TEST_ACTOR);

		expect(agent.id).toBeTruthy();
		expect(agent.goal).toBe("Analyze market trends");
		expect(agent.status).toBe("pending");
		expect(agent.model).toBe("neuralwatt-large");
		expect(agent.budgetConsumedJoules).toBe(0);
		expect(agent.budgetMaxJoules).toBeNull();
		expect(agent.graphNodeId).toBeNull();
		expect(agent.parentAgentId).toBeNull();
		expect(agent.capabilities).toEqual({});
		expect(agent.createdAt).toBeInstanceOf(Date);
		expect(agent.updatedAt).toBeInstanceOf(Date);
	});

	it("creates an agent with optional fields", async () => {
		const node = await createNode(db, { type: "investigation", title: "Market Research", authorId: "u" }, TEST_ACTOR);

		const agent = await createAgent(
			db,
			{
				goal: "Deep research",
				graphNodeId: node.id,
				model: "neuralwatt-small",
				budgetMaxJoules: 500,
				capabilities: { github: true },
			},
			TEST_ACTOR,
		);

		expect(agent.graphNodeId).toBe(node.id);
		expect(agent.model).toBe("neuralwatt-small");
		expect(agent.budgetMaxJoules).toBe(500);
		expect(agent.capabilities).toEqual({ github: true });
	});

	it("creates a child agent with parentAgentId", async () => {
		const parent = await createAgent(db, { goal: "Parent goal" }, TEST_ACTOR);
		const child = await createAgent(db, { goal: "Child goal", parentAgentId: parent.id }, TEST_ACTOR);

		expect(child.parentAgentId).toBe(parent.id);
	});

	it("writes an audit entry", async () => {
		const agent = await createAgent(db, { goal: "Audit test" }, TEST_ACTOR);

		const log = await queryAuditLog(db, { targetId: agent.id, action: "agent.create" });
		expect(log.length).toBe(1);
		expect(log[0]!.detail).toMatchObject({ goal: "Audit test" });
	});
});

describe("getAgent", () => {
	it("returns the agent by id", async () => {
		const created = await createAgent(db, { goal: "Fetch me" }, TEST_ACTOR);
		const found = await getAgent(db, created.id);

		expect(found).toBeDefined();
		expect(found!.id).toBe(created.id);
		expect(found!.goal).toBe("Fetch me");
	});

	it("returns undefined for unknown id", async () => {
		const result = await getAgent(db, "nonexistent");
		expect(result).toBeUndefined();
	});
});

describe("updateAgentStatus", () => {
	it("transitions status and updates updatedAt", async () => {
		const agent = await createAgent(db, { goal: "Status test" }, TEST_ACTOR);
		const updated = await updateAgentStatus(db, agent.id, "running", TEST_ACTOR);

		expect(updated).toBeDefined();
		expect(updated!.status).toBe("running");
		expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(agent.updatedAt.getTime());
	});

	it("updates budgetConsumedJoules when provided", async () => {
		const agent = await createAgent(db, { goal: "Budget test", budgetMaxJoules: 1000 }, TEST_ACTOR);
		const updated = await updateAgentStatus(db, agent.id, "running", TEST_ACTOR, 42.5);

		expect(updated!.budgetConsumedJoules).toBe(42.5);
	});

	it("returns undefined for nonexistent agent", async () => {
		const result = await updateAgentStatus(db, "ghost", "completed", TEST_ACTOR);
		expect(result).toBeUndefined();
	});

	it("writes an audit entry for each transition", async () => {
		const agent = await createAgent(db, { goal: "Audit transitions" }, TEST_ACTOR);
		await updateAgentStatus(db, agent.id, "running", TEST_ACTOR);
		await updateAgentStatus(db, agent.id, "completed", TEST_ACTOR);

		const log = await queryAuditLog(db, { targetId: agent.id, action: "agent.status_changed" });
		expect(log.length).toBe(2);
	});
});

describe("listAgents", () => {
	it("returns all agents ordered by createdAt desc", async () => {
		await createAgent(db, { goal: "First" }, TEST_ACTOR);
		await createAgent(db, { goal: "Second" }, TEST_ACTOR);
		await createAgent(db, { goal: "Third" }, TEST_ACTOR);

		const agents = await listAgents(db);
		expect(agents.length).toBe(3);
		// Most recently created first
		expect(agents[0]!.goal).toBe("Third");
	});

	it("filters by status", async () => {
		const a1 = await createAgent(db, { goal: "Will run" }, TEST_ACTOR);
		await createAgent(db, { goal: "Stays pending" }, TEST_ACTOR);
		await updateAgentStatus(db, a1.id, "running", TEST_ACTOR);

		const running = await listAgents(db, { status: "running" });
		expect(running.length).toBe(1);
		expect(running[0]!.id).toBe(a1.id);
	});

	it("respects limit", async () => {
		for (let i = 0; i < 5; i++) {
			await createAgent(db, { goal: `Agent ${i}` }, TEST_ACTOR);
		}

		const agents = await listAgents(db, { limit: 2 });
		expect(agents.length).toBe(2);
	});

	it("returns empty array when none match filter", async () => {
		await createAgent(db, { goal: "Pending only" }, TEST_ACTOR);

		const completed = await listAgents(db, { status: "completed" });
		expect(completed).toEqual([]);
	});
});

// ─── Investigations (C5 Research Engine) ─────────────────────────────────────

describe("createInvestigation", () => {
	it("creates an investigation with required fields", async () => {
		const inv = await createInvestigation(
			db,
			{ question: "Is PostgreSQL the right choice?", investigatorId: "user-1" },
			TEST_ACTOR,
		);

		expect(inv.id).toBeTruthy();
		expect(inv.question).toBe("Is PostgreSQL the right choice?");
		expect(inv.investigatorId).toBe("user-1");
		expect(inv.status).toBe("open");
		expect(inv.conclusion).toBe("");
		expect(inv.methodology).toBe("");
		expect(inv.graphNodeId).toBeNull();
	});

	it("links to a graph node when provided", async () => {
		const node = await createNode(db, { type: "investigation", title: "DB Research", authorId: "u" }, TEST_ACTOR);
		const inv = await createInvestigation(
			db,
			{ question: "Which DB?", investigatorId: "u", graphNodeId: node.id },
			TEST_ACTOR,
		);
		expect(inv.graphNodeId).toBe(node.id);
	});

	it("writes an audit entry", async () => {
		await createInvestigation(db, { question: "Q?", investigatorId: "u" }, TEST_ACTOR);
		const log = await queryAuditLog(db, { action: "investigation.create" });
		expect(log.length).toBe(1);
	});
});

describe("concludeInvestigation", () => {
	it("sets status to concluded and stores conclusion", async () => {
		const inv = await createInvestigation(db, { question: "Q?", investigatorId: "u" }, TEST_ACTOR);
		const concluded = await concludeInvestigation(db, inv.id, "PostgreSQL is the right choice.", TEST_ACTOR);

		expect(concluded!.status).toBe("concluded");
		expect(concluded!.conclusion).toBe("PostgreSQL is the right choice.");
	});

	it("returns undefined for nonexistent investigation", async () => {
		const result = await concludeInvestigation(db, "ghost", "nothing", TEST_ACTOR);
		expect(result).toBeUndefined();
	});
});

describe("addFinding", () => {
	it("adds a finding to an investigation", async () => {
		const inv = await createInvestigation(db, { question: "Q?", investigatorId: "u" }, TEST_ACTOR);
		const finding = await addFinding(
			db,
			{
				investigationId: inv.id,
				claim: "PostgreSQL handles JSONB well",
				evidence: "Benchmarks from 2024",
				confidence: 0.9,
				authorId: "u",
			},
			TEST_ACTOR,
		);

		expect(finding.id).toBeTruthy();
		expect(finding.investigationId).toBe(inv.id);
		expect(finding.claim).toBe("PostgreSQL handles JSONB well");
		expect(finding.confidence).toBe(0.9);
		expect(finding.evidence).toBe("Benchmarks from 2024");
	});

	it("returns findings via getFindingsForInvestigation", async () => {
		const inv = await createInvestigation(db, { question: "Q?", investigatorId: "u" }, TEST_ACTOR);
		await addFinding(db, { investigationId: inv.id, claim: "Finding 1", authorId: "u" }, TEST_ACTOR);
		await addFinding(db, { investigationId: inv.id, claim: "Finding 2", authorId: "u" }, TEST_ACTOR);

		const findings = await getFindingsForInvestigation(db, inv.id);
		expect(findings.length).toBe(2);
		expect(findings.every((f) => f.investigationId === inv.id)).toBe(true);
	});
});

describe("listInvestigations", () => {
	it("filters by status", async () => {
		const i1 = await createInvestigation(db, { question: "Open Q?", investigatorId: "u" }, TEST_ACTOR);
		await concludeInvestigation(db, i1.id, "Done.", TEST_ACTOR);
		await createInvestigation(db, { question: "Still open Q?", investigatorId: "u" }, TEST_ACTOR);

		const open = await listInvestigations(db, { status: "open" });
		expect(open.length).toBe(1);
		expect(open[0]!.question).toBe("Still open Q?");

		const concluded = await listInvestigations(db, { status: "concluded" });
		expect(concluded.length).toBe(1);
	});

	it("filters by investigatorId", async () => {
		await createInvestigation(db, { question: "Q by alice", investigatorId: "alice" }, TEST_ACTOR);
		await createInvestigation(db, { question: "Q by bob", investigatorId: "bob" }, TEST_ACTOR);

		const aliceInvs = await listInvestigations(db, { investigatorId: "alice" });
		expect(aliceInvs.length).toBe(1);
		expect(aliceInvs[0]!.question).toBe("Q by alice");
	});
});

// ─── Decision Episodes (C10 Institutional Memory) ─────────────────────────────

describe("recordDecisionEpisode", () => {
	it("records a decision with required fields", async () => {
		const episode = await recordDecisionEpisode(
			db,
			{
				title: "Use pgmq over NATS",
				decision: "pgmq",
				context: "We evaluated message queue options",
				optionsConsidered: ["pgmq", "NATS", "RabbitMQ"],
				rationale: "pgmq runs inside Postgres, reducing infra complexity",
				authorId: "user-1",
			},
			TEST_ACTOR,
		);

		expect(episode.id).toBeTruthy();
		expect(episode.title).toBe("Use pgmq over NATS");
		expect(episode.decision).toBe("pgmq");
		expect(episode.optionsConsidered).toEqual(["pgmq", "NATS", "RabbitMQ"]);
		expect(episode.rationale).toBe("pgmq runs inside Postgres, reducing infra complexity");
		expect(episode.authorId).toBe("user-1");
	});

	it("writes an audit entry", async () => {
		await recordDecisionEpisode(db, { title: "Decide X", decision: "X", authorId: "u" }, TEST_ACTOR);
		const log = await queryAuditLog(db, { action: "decision.record" });
		expect(log.length).toBe(1);
	});
});

describe("searchDecisionEpisodes", () => {
	it("finds episodes matching title", async () => {
		await recordDecisionEpisode(db, { title: "Use pgmq over NATS", decision: "pgmq", authorId: "u" }, TEST_ACTOR);
		await recordDecisionEpisode(db, { title: "Choose React", decision: "React", authorId: "u" }, TEST_ACTOR);

		const results = await searchDecisionEpisodes(db, "pgmq");
		expect(results.length).toBe(1);
		expect(results[0]!.title).toBe("Use pgmq over NATS");
	});

	it("finds episodes matching rationale", async () => {
		await recordDecisionEpisode(
			db,
			{ title: "Decision", decision: "X", rationale: "because of ACID compliance", authorId: "u" },
			TEST_ACTOR,
		);

		const results = await searchDecisionEpisodes(db, "ACID");
		expect(results.length).toBe(1);
	});

	it("returns empty array for no matches", async () => {
		const results = await searchDecisionEpisodes(db, "nonexistentterm12345");
		expect(results).toEqual([]);
	});
});

describe("listDecisionEpisodes", () => {
	it("returns episodes ordered by createdAt desc", async () => {
		await recordDecisionEpisode(db, { title: "First", decision: "A", authorId: "u" }, TEST_ACTOR);
		await recordDecisionEpisode(db, { title: "Second", decision: "B", authorId: "u" }, TEST_ACTOR);

		const episodes = await listDecisionEpisodes(db);
		expect(episodes.length).toBe(2);
		expect(episodes[0]!.title).toBe("Second");
	});
});

describe("getCatchUpView", () => {
	it("returns recent activity across all entity types", async () => {
		const past = new Date(Date.now() - 5000); // 5 seconds ago

		const node = await createNode(db, { type: "idea", title: "New idea", authorId: "u" }, TEST_ACTOR);
		const inv = await createInvestigation(db, { question: "Research Q?", investigatorId: "u" }, TEST_ACTOR);
		await addFinding(db, { investigationId: inv.id, claim: "Found something", authorId: "u" }, TEST_ACTOR);
		await recordDecisionEpisode(db, { title: "Big decision", decision: "Go!", authorId: "u" }, TEST_ACTOR);
		await createAssumption(db, { graphNodeId: node.id, claim: "Will work", ownerId: "u" }, TEST_ACTOR);

		const items = await getCatchUpView(db, past);
		const types = new Set(items.map((i) => i.type));

		expect(types.has("node")).toBe(true);
		expect(types.has("investigation")).toBe(true);
		expect(types.has("finding")).toBe(true);
		expect(types.has("decision")).toBe(true);
		expect(types.has("assumption")).toBe(true);
	});

	it("only returns items created after the since date", async () => {
		const node = await createNode(db, { type: "idea", title: "Old idea", authorId: "u" }, TEST_ACTOR);

		// Set since to 1 second from now — nothing should match
		const future = new Date(Date.now() + 1000);
		const items = await getCatchUpView(db, future);

		// node.createdAt < future, so nothing should be returned
		expect(items.filter((i) => i.id === node.id)).toHaveLength(0);
	});
});

// ─── Metrics (C7 Impact Tracker) ──────────────────────────────────────────────

describe("recordMetric", () => {
	it("records a metric with required fields", async () => {
		const metric = await recordMetric(
			db,
			{ name: "test_coverage", value: 92.5, unit: "%", measuredBy: "ci-bot" },
			TEST_ACTOR,
		);

		expect(metric.id).toBeTruthy();
		expect(metric.name).toBe("test_coverage");
		expect(metric.value).toBeCloseTo(92.5);
		expect(metric.unit).toBe("%");
		expect(metric.measuredBy).toBe("ci-bot");
		expect(metric.graphNodeId).toBeNull();
	});

	it("links to a graph node", async () => {
		const node = await createNode(db, { type: "metric", title: "Coverage goal", authorId: "u" }, TEST_ACTOR);
		const metric = await recordMetric(
			db,
			{ name: "coverage", value: 80, graphNodeId: node.id, measuredBy: "u" },
			TEST_ACTOR,
		);
		expect(metric.graphNodeId).toBe(node.id);
	});
});

describe("getMetricsForNode", () => {
	it("returns all metrics for a node", async () => {
		const node = await createNode(db, { type: "metric", title: "Goal", authorId: "u" }, TEST_ACTOR);
		await recordMetric(db, { name: "metric_a", value: 1, graphNodeId: node.id, measuredBy: "u" }, TEST_ACTOR);
		await recordMetric(db, { name: "metric_b", value: 2, graphNodeId: node.id, measuredBy: "u" }, TEST_ACTOR);

		const metrics = await getMetricsForNode(db, node.id);
		expect(metrics.length).toBe(2);
		expect(metrics.every((m) => m.graphNodeId === node.id)).toBe(true);
	});

	it("returns empty array for node with no metrics", async () => {
		const node = await createNode(db, { type: "idea", title: "No metrics", authorId: "u" }, TEST_ACTOR);
		const metrics = await getMetricsForNode(db, node.id);
		expect(metrics).toEqual([]);
	});
});

describe("listMetrics", () => {
	it("filters by name", async () => {
		await recordMetric(db, { name: "velocity", value: 10, measuredBy: "u" }, TEST_ACTOR);
		await recordMetric(db, { name: "coverage", value: 80, measuredBy: "u" }, TEST_ACTOR);

		const velocity = await listMetrics(db, { name: "velocity" });
		expect(velocity.length).toBe(1);
		expect(velocity[0]!.name).toBe("velocity");
	});
});

// ─── Competitions (C6 Competition Framework) ──────────────────────────────────

describe("createCompetition", () => {
	it("creates a competition with required fields", async () => {
		const comp = await createCompetition(db, { title: "Best routing approach", authorId: "user-1" }, TEST_ACTOR);

		expect(comp.id).toBeTruthy();
		expect(comp.title).toBe("Best routing approach");
		expect(comp.status).toBe("active");
		expect(comp.winnerNodeId).toBeNull();
		expect(comp.concludedAt).toBeNull();
	});

	it("stores criteria JSONB", async () => {
		const comp = await createCompetition(
			db,
			{
				title: "Best DB",
				criteria: { speed: "weight: 0.4", reliability: "weight: 0.6" },
				authorId: "u",
			},
			TEST_ACTOR,
		);
		expect(comp.criteria).toEqual({ speed: "weight: 0.4", reliability: "weight: 0.6" });
	});
});

describe("addCompetitionEntry and scoring", () => {
	it("adds entries and scores them", async () => {
		const comp = await createCompetition(db, { title: "Routing comp", authorId: "u" }, TEST_ACTOR);
		const nodeA = await createNode(db, { type: "competition", title: "Approach A", authorId: "u" }, TEST_ACTOR);
		const nodeB = await createNode(db, { type: "competition", title: "Approach B", authorId: "u" }, TEST_ACTOR);

		const entryA = await addCompetitionEntry(
			db,
			{ competitionId: comp.id, graphNodeId: nodeA.id, notes: "Fast", authorId: "u" },
			TEST_ACTOR,
		);
		const entryB = await addCompetitionEntry(
			db,
			{ competitionId: comp.id, graphNodeId: nodeB.id, notes: "Reliable", authorId: "u" },
			TEST_ACTOR,
		);

		await scoreCompetitionEntry(db, entryA.id, 0.8, TEST_ACTOR);
		await scoreCompetitionEntry(db, entryB.id, 0.95, TEST_ACTOR);

		const entries = await getCompetitionEntries(db, comp.id);
		expect(entries.length).toBe(2);
		const scores = entries.map((e) => e.score).sort();
		expect(scores[0]).toBeCloseTo(0.8);
		expect(scores[1]).toBeCloseTo(0.95);
	});
});

describe("concludeCompetition", () => {
	it("sets winner and concludedAt", async () => {
		const comp = await createCompetition(db, { title: "Final comp", authorId: "u" }, TEST_ACTOR);
		const winner = await createNode(db, { type: "competition", title: "Winner approach", authorId: "u" }, TEST_ACTOR);

		const concluded = await concludeCompetition(db, comp.id, winner.id, TEST_ACTOR);

		expect(concluded!.status).toBe("concluded");
		expect(concluded!.winnerNodeId).toBe(winner.id);
		expect(concluded!.concludedAt).toBeInstanceOf(Date);
	});
});

describe("listCompetitions", () => {
	it("filters by status", async () => {
		const c1 = await createCompetition(db, { title: "Active comp", authorId: "u" }, TEST_ACTOR);
		await createCompetition(db, { title: "Another active", authorId: "u" }, TEST_ACTOR);
		const winner = await createNode(db, { type: "competition", title: "W", authorId: "u" }, TEST_ACTOR);
		await concludeCompetition(db, c1.id, winner.id, TEST_ACTOR);

		const active = await listCompetitions(db, { status: "active" });
		expect(active.length).toBe(1);
		expect(active[0]!.title).toBe("Another active");

		const concluded = await listCompetitions(db, { status: "concluded" });
		expect(concluded.length).toBe(1);
	});
});

describe("getCompetition", () => {
	it("returns undefined for nonexistent competition", async () => {
		const result = await getCompetition(db, "ghost");
		expect(result).toBeUndefined();
	});
});

// ─── Cascade deletes ──────────────────────────────────────────────────────────

describe("cascade deletes", () => {
	it("deletes edges when source node is deleted", async () => {
		// pg-mem supports basic FK cascade
		const source = await createNode(db, { type: "idea", title: "Source", authorId: "u" }, TEST_ACTOR);
		const target = await createNode(db, { type: "idea", title: "Target", authorId: "u" }, TEST_ACTOR);
		await createEdge(db, { sourceId: source.id, targetId: target.id, type: "supports", authorId: "u" }, TEST_ACTOR);

		// Delete source node directly via drizzle
		const { fugueNodes } = await import("../src/schema.js");
		const { eq } = await import("drizzle-orm");
		await db.delete(fugueNodes).where(eq(fugueNodes.id, source.id));

		const edges = await getEdgesFrom(db, source.id);
		expect(edges.length).toBe(0);
	});
});
