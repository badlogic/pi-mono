import type { EventBus } from "@fugue/events";
import { type DrizzleDb, getAgent, updateAgentStatus } from "@fugue/graph";
import { newId } from "@fugue/shared";
import { type AgentContext, type AgentLoopConfig, agentLoop } from "@mariozechner/pi-agent-core";
import { getModel, type Message, streamSimple } from "@mariozechner/pi-ai";
import { createFugueTools } from "./tools.js";

// ─── System Prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(agentId: string, goal: string): string {
	return `You are a Fugue autonomous agent (id: ${agentId}).

Your goal: ${goal}

You work inside a collaborative knowledge graph where humans and AI agents
build shared understanding together. Use your tools to research, analyse, and
record findings in the graph.

Guidelines:
- Be concise and precise. Record findings as structured nodes, not prose dumps.
- Prefer creating "finding" nodes for confirmed facts, "assumption" nodes for
  hypotheses that need verification.
- Connect related nodes with edges to show relationships.
- Publish events when you complete significant milestones.
- Stop when you have addressed the goal. Do not loop forever.`;
}

// ─── FugueRunner ──────────────────────────────────────────────────────────────

export interface RunnerOptions {
	/** Env var name for Neuralwatt API key (default: NEURALWATT_API_KEY) */
	apiKeyEnvVar?: string;
}

/**
 * Executes a single Fugue agent run from start to completion.
 *
 * Fetches the agent record from the database, builds a tool-equipped
 * AgentContext, calls agentLoop, and updates the agent's status throughout.
 *
 * Throws if the agent is not found or is already terminal.
 */
export async function runAgent(
	agentId: string,
	db: DrizzleDb,
	bus: EventBus,
	signal: AbortSignal,
	options: RunnerOptions = {},
): Promise<void> {
	const agent = await getAgent(db, agentId);
	if (!agent) throw new Error(`Agent ${agentId} not found`);

	const terminal = new Set(["completed", "failed", "aborted"]);
	if (terminal.has(agent.status)) {
		throw new Error(`Agent ${agentId} is already in terminal state: ${agent.status}`);
	}

	const actor = { actorId: agentId, actorType: "agent" as const, authorityChain: [agentId] };

	// Mark running
	await updateAgentStatus(db, agentId, "running", actor);
	bus.publish({
		id: newId(),
		source: `agent:${agentId}`,
		type: "agent.started",
		payload: { agentId, goal: agent.goal },
		timestamp: new Date().toISOString(),
	});

	const modelId = (agent.model as "neuralwatt-large" | "neuralwatt-small") ?? "neuralwatt-large";
	const model = getModel("neuralwatt", modelId);

	const tools = createFugueTools(db, bus, agentId);

	const context: AgentContext = {
		systemPrompt: buildSystemPrompt(agentId, agent.goal),
		messages: [],
		tools,
	};

	const apiKeyEnvVar = options.apiKeyEnvVar ?? "NEURALWATT_API_KEY";
	const config: AgentLoopConfig = {
		model,
		convertToLlm: (messages) =>
			messages.filter(
				(m): m is Message =>
					typeof m === "object" &&
					m !== null &&
					"role" in m &&
					["user", "assistant", "tool_result"].includes((m as { role: string }).role),
			),
		getApiKey: (provider) => {
			if (provider === "neuralwatt") return process.env[apiKeyEnvVar];
			return undefined;
		},
	};

	const userMessage = {
		role: "user" as const,
		content: agent.goal,
		timestamp: Date.now(),
	};

	try {
		const stream = agentLoop([userMessage], context, config, signal, streamSimple);
		await stream.result();

		if (signal.aborted) {
			await updateAgentStatus(db, agentId, "aborted", actor);
			bus.publish({
				id: newId(),
				source: `agent:${agentId}`,
				type: "agent.aborted",
				payload: { agentId },
				timestamp: new Date().toISOString(),
			});
		} else {
			await updateAgentStatus(db, agentId, "completed", actor);
			bus.publish({
				id: newId(),
				source: `agent:${agentId}`,
				type: "agent.completed",
				payload: { agentId },
				timestamp: new Date().toISOString(),
			});
		}
	} catch (err) {
		await updateAgentStatus(db, agentId, "failed", actor);
		bus.publish({
			id: newId(),
			source: `agent:${agentId}`,
			type: "agent.failed",
			payload: { agentId, error: String(err) },
			timestamp: new Date().toISOString(),
		});
		throw err;
	}
}
