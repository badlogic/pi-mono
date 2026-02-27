import type { EventBus } from "@fugue/events";
import { createEdge, createNode, type DrizzleDb, getNode, listNodes, searchNodes } from "@fugue/graph";
import { newId } from "@fugue/shared";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

// ─── Tool: search_nodes ───────────────────────────────────────────────────────

const searchNodesSchema = Type.Object({
	query: Type.String({ description: "Full-text search query for graph nodes" }),
	limit: Type.Optional(Type.Number({ description: "Max results to return (default 10)", minimum: 1, maximum: 50 })),
});

export function createSearchNodesTool(db: DrizzleDb): AgentTool<typeof searchNodesSchema> {
	return {
		name: "search_nodes",
		label: "search nodes",
		description:
			"Search the Fugue knowledge graph for nodes matching a query. Returns nodes with their type, title, and content.",
		parameters: searchNodesSchema,
		execute: async (_id, params) => {
			const results = await searchNodes(db, params.query, params.limit ?? 10);
			const text =
				results.length === 0
					? "No nodes found matching that query."
					: results.map((n) => `[${n.type}] ${n.title} (id: ${n.id})\n${JSON.stringify(n.content)}`).join("\n\n");
			return { content: [{ type: "text", text }], details: results };
		},
	};
}

// ─── Tool: get_node ───────────────────────────────────────────────────────────

const getNodeSchema = Type.Object({
	id: Type.String({ description: "The graph node ID to retrieve" }),
});

export function createGetNodeTool(db: DrizzleDb): AgentTool<typeof getNodeSchema> {
	return {
		name: "get_node",
		label: "get node",
		description: "Retrieve a specific graph node by ID, including its full content.",
		parameters: getNodeSchema,
		execute: async (_id, params) => {
			const node = await getNode(db, params.id);
			if (!node) {
				return { content: [{ type: "text", text: `Node ${params.id} not found.` }], details: null };
			}
			const text = `[${node.type}] ${node.title}\nID: ${node.id}\nStatus: ${node.status}\nContent: ${JSON.stringify(node.content, null, 2)}`;
			return { content: [{ type: "text", text }], details: node };
		},
	};
}

// ─── Tool: list_nodes ─────────────────────────────────────────────────────────

const listNodesSchema = Type.Object({
	type: Type.Optional(
		Type.Union(
			[
				Type.Literal("idea"),
				Type.Literal("decision"),
				Type.Literal("assumption"),
				Type.Literal("finding"),
				Type.Literal("metric"),
				Type.Literal("event"),
				Type.Literal("investigation"),
				Type.Literal("competition"),
				Type.Literal("deployment"),
			],
			{ description: "Filter by node type" },
		),
	),
	limit: Type.Optional(Type.Number({ description: "Max nodes to return (default 20)", minimum: 1, maximum: 100 })),
});

export function createListNodesTool(db: DrizzleDb): AgentTool<typeof listNodesSchema> {
	return {
		name: "list_nodes",
		label: "list nodes",
		description: "List active nodes in the Fugue knowledge graph, optionally filtered by type.",
		parameters: listNodesSchema,
		execute: async (_id, params) => {
			const results = await listNodes(db, { type: params.type, limit: params.limit ?? 20 });
			const text =
				results.length === 0
					? "No nodes found."
					: results.map((n) => `[${n.type}] ${n.title} (id: ${n.id})`).join("\n");
			return { content: [{ type: "text", text }], details: results };
		},
	};
}

// ─── Tool: create_node ────────────────────────────────────────────────────────

const createNodeSchema = Type.Object({
	type: Type.Union(
		[
			Type.Literal("idea"),
			Type.Literal("decision"),
			Type.Literal("assumption"),
			Type.Literal("finding"),
			Type.Literal("metric"),
			Type.Literal("event"),
			Type.Literal("investigation"),
			Type.Literal("competition"),
			Type.Literal("deployment"),
		],
		{ description: "The type of knowledge node to create" },
	),
	title: Type.String({ description: "Short, descriptive title for the node (max 500 chars)", maxLength: 500 }),
	content: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description: "Structured content for the node (JSON object)",
		}),
	),
});

export function createCreateNodeTool(db: DrizzleDb, agentId: string): AgentTool<typeof createNodeSchema> {
	return {
		name: "create_node",
		label: "create node",
		description:
			"Create a new node in the Fugue knowledge graph to capture an idea, finding, decision, or other insight.",
		parameters: createNodeSchema,
		execute: async (_id, params) => {
			const node = await createNode(
				db,
				{
					type: params.type,
					title: params.title,
					content: params.content,
					authorId: agentId,
					authorType: "agent",
				},
				{ actorId: agentId, actorType: "agent", authorityChain: [agentId] },
			);
			const text = `Created [${node.type}] node: "${node.title}" (id: ${node.id})`;
			return { content: [{ type: "text", text }], details: node };
		},
	};
}

// ─── Tool: create_edge ────────────────────────────────────────────────────────

const createEdgeSchema = Type.Object({
	sourceId: Type.String({ description: "ID of the source node" }),
	targetId: Type.String({ description: "ID of the target node" }),
	type: Type.Union(
		[
			Type.Literal("builds_on"),
			Type.Literal("challenges"),
			Type.Literal("supports"),
			Type.Literal("decided_by"),
			Type.Literal("measures"),
			Type.Literal("spawned"),
			Type.Literal("investigates"),
			Type.Literal("competes_in"),
			Type.Literal("triggered_by"),
		],
		{ description: "The relationship type between the two nodes" },
	),
});

export function createCreateEdgeTool(db: DrizzleDb, agentId: string): AgentTool<typeof createEdgeSchema> {
	return {
		name: "create_edge",
		label: "create edge",
		description: "Create a directed relationship (edge) between two existing graph nodes.",
		parameters: createEdgeSchema,
		execute: async (_id, params) => {
			const edge = await createEdge(
				db,
				{
					sourceId: params.sourceId,
					targetId: params.targetId,
					type: params.type,
					authorId: agentId,
				},
				{ actorId: agentId, actorType: "agent", authorityChain: [agentId] },
			);
			const text = `Created edge: ${params.sourceId} --[${edge.type}]--> ${params.targetId} (id: ${edge.id})`;
			return { content: [{ type: "text", text }], details: edge };
		},
	};
}

// ─── Tool: publish_event ──────────────────────────────────────────────────────

const publishEventSchema = Type.Object({
	type: Type.String({ description: "Event type string, e.g. 'finding.created' or 'hypothesis.confirmed'" }),
	payload: Type.Record(Type.String(), Type.Unknown(), { description: "Event payload as a JSON object" }),
	graphNodeId: Type.Optional(Type.String({ description: "Optional graph node to associate this event with" })),
});

export function createPublishEventTool(bus: EventBus, agentId: string): AgentTool<typeof publishEventSchema> {
	return {
		name: "publish_event",
		label: "publish event",
		description: "Publish an event to the Fugue event bus so other agents and the UI can react to it.",
		parameters: publishEventSchema,
		execute: async (_id, params) => {
			bus.publish({
				id: newId(),
				source: `agent:${agentId}`,
				type: params.type,
				payload: params.payload,
				timestamp: new Date().toISOString(),
				graphNodeId: params.graphNodeId,
			});
			const text = `Published event "${params.type}"`;
			return { content: [{ type: "text", text }], details: { type: params.type } };
		},
	};
}

// ─── Factory: all standard tools ──────────────────────────────────────────────

export function createFugueTools(db: DrizzleDb, bus: EventBus, agentId: string): AgentTool<any>[] {
	return [
		createSearchNodesTool(db),
		createGetNodeTool(db),
		createListNodesTool(db),
		createCreateNodeTool(db, agentId),
		createCreateEdgeTool(db, agentId),
		createPublishEventTool(bus, agentId),
	];
}
