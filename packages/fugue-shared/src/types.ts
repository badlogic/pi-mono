// ─── Node Types ───────────────────────────────────────────────────────────────

export type NodeType =
	| "idea"
	| "decision"
	| "assumption"
	| "finding"
	| "metric"
	| "event"
	| "investigation"
	| "competition"
	| "deployment";

export type EdgeType =
	| "builds_on"
	| "challenges"
	| "supports"
	| "decided_by"
	| "measures"
	| "spawned"
	| "investigates"
	| "competes_in"
	| "triggered_by";

export type AuthorType = "human" | "agent";

export type NodeStatus = "active" | "archived" | "stale";

export interface GraphNode {
	id: string;
	type: NodeType;
	title: string;
	content: Record<string, unknown>;
	authorId: string;
	authorType: AuthorType;
	createdAt: string; // ISO 8601
	updatedAt: string;
	archivedAt?: string;
	status: NodeStatus;
}

export interface GraphEdge {
	id: string;
	sourceId: string;
	targetId: string;
	type: EdgeType;
	metadata?: Record<string, unknown>;
	authorId: string;
	createdAt: string;
}

// ─── Event Envelope ───────────────────────────────────────────────────────────

export interface FugueEvent {
	id: string;
	source: string; // "connector:github" | "system:deploy" | "agent:123" etc.
	type: string; // "pr.merged" | "build.failed" | "assumption.drifted" etc.
	payload: Record<string, unknown>;
	timestamp: string; // ISO 8601
	correlationId?: string;
	graphNodeId?: string;
	metadata?: Record<string, unknown>;
}

export type EventUrgency = "low" | "medium" | "high" | "critical";

export interface RoutedEvent extends FugueEvent {
	urgency: EventUrgency;
	relevanceReason: string;
	handledByAgent?: boolean;
	targetUserIds?: string[];
}

// ─── Agent Capabilities ───────────────────────────────────────────────────────

/**
 * Hierarchical capability strings.
 * Examples: "github:read", "github:write", "notion:*", "connectors:*"
 * Wildcards match any suffix after the colon.
 */
export type Capability = string;

export type NetworkPolicy = "none" | "restricted" | "full";

export interface CapabilitySet {
	capabilities: Capability[];
	maxRecursionDepth: number;
	maxBudgetJoules: number;
	networkPolicy: NetworkPolicy;
}

export function hasCapability(set: CapabilitySet, required: Capability): boolean {
	for (const cap of set.capabilities) {
		if (cap === required) return true;
		// wildcard: "github:*" matches "github:read", "github:write"
		if (cap.endsWith(":*")) {
			const prefix = cap.slice(0, -1); // "github:"
			if (required.startsWith(prefix)) return true;
		}
		// full wildcard
		if (cap === "*") return true;
	}
	return false;
}

export function isSubsetOf(child: CapabilitySet, parent: CapabilitySet): boolean {
	for (const cap of child.capabilities) {
		if (!hasCapability(parent, cap)) return false;
	}
	return child.maxRecursionDepth <= parent.maxRecursionDepth && child.maxBudgetJoules <= parent.maxBudgetJoules;
}

// ─── RBAC ─────────────────────────────────────────────────────────────────────

export type UserRole = "admin" | "member" | "viewer";

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
	admin: ["*"],
	member: ["canvas:read", "canvas:write", "graph:read", "graph:write", "agents:spawn", "events:read"],
	viewer: ["canvas:read", "graph:read", "events:read"],
};

export function roleHasPermission(role: UserRole, permission: string): boolean {
	const perms = ROLE_PERMISSIONS[role];
	if (perms.includes("*")) return true;
	if (perms.includes(permission)) return true;
	if (perms.some((p) => p.endsWith(":*") && permission.startsWith(p.slice(0, -1)))) return true;
	return false;
}

// ─── Agent State ──────────────────────────────────────────────────────────────

export type AgentStatus = "pending" | "running" | "paused" | "completed" | "failed" | "aborted";

export interface AgentState {
	id: string;
	parentId?: string;
	goal: string;
	context: Record<string, unknown>;
	capabilities: CapabilitySet;
	status: AgentStatus;
	journalEntries: JournalEntry[];
	findings: Finding[];
	budgetConsumedJoules: number;
	recursionDepth: number;
	spawnedAgentIds: string[];
	graphNodeId?: string; // canvas node this agent is attached to
	createdAt: string;
	updatedAt: string;
}

export interface JournalEntry {
	id: string;
	agentId: string;
	content: string;
	type: "search" | "finding" | "decision" | "dead_end" | "spawn" | "redirect";
	metadata?: Record<string, unknown>;
	timestamp: string;
}

export interface Finding {
	id: string;
	agentId: string;
	claim: string;
	evidence: string;
	confidence: number; // 0-1
	sources: string[];
	openQuestions: string[];
	timestamp: string;
}

// ─── Result Type ──────────────────────────────────────────────────────────────

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
	return { ok: true, value };
}

export function err<E = string>(error: E): Result<never, E> {
	return { ok: false, error };
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export interface AuditEntry {
	id: bigint;
	actorId: string;
	actorType: AuthorType;
	action: string; // "node.create" | "node.update" | "edge.create" | etc.
	targetType?: "node" | "edge" | "event" | "agent";
	targetId?: string;
	detail?: Record<string, unknown>;
	authorityChain: string[]; // ["human:uuid", "agent:uuid"]
	createdAt: string;
}

// ─── Compute Provider ─────────────────────────────────────────────────────────

export interface ComputeSpec {
	memoryMB: number;
	cpuMillicores: number;
	timeoutMs: number;
	image: string;
	capabilities: CapabilitySet;
	env?: Record<string, string>;
}

export interface ComputeInstance {
	id: string;
	spec: ComputeSpec;
	status: "starting" | "running" | "stopped" | "failed";
	startedAt: string;
	stoppedAt?: string;
}

export interface ResourceUsage {
	cpuMillicoresAvg: number;
	memoryMBPeak: number;
	networkBytesIn: number;
	networkBytesOut: number;
	durationMs: number;
}

// ─── Assumption ───────────────────────────────────────────────────────────────

export interface Assumption {
	id: string;
	claim: string;
	confidence: number; // 0-1
	evidence: string;
	ownerId: string;
	verificationMethod: string;
	verifyByDate?: string;
	graphNodeId: string;
	createdAt: string;
	updatedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const FUGUE_VERSION = "0.1.0";

export const MAX_RECURSION_DEPTH = 5;

export const DEFAULT_CAPABILITY_SET: CapabilitySet = {
	capabilities: [],
	maxRecursionDepth: 3,
	maxBudgetJoules: 1000,
	networkPolicy: "restricted",
};

export const ADMIN_CAPABILITY_SET: CapabilitySet = {
	capabilities: ["*"],
	maxRecursionDepth: MAX_RECURSION_DEPTH,
	maxBudgetJoules: 100_000,
	networkPolicy: "full",
};
