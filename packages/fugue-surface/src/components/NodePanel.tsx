import { useState } from "react";
import { trpc } from "../trpc.js";

type NodeType =
	| "idea"
	| "decision"
	| "assumption"
	| "finding"
	| "metric"
	| "event"
	| "investigation"
	| "competition"
	| "deployment";

/**
 * Side panel for browsing and creating Fugue graph nodes.
 * Connects to fugue-core via tRPC.
 */
export function NodePanel() {
	const [newTitle, setNewTitle] = useState("");
	const [newType, setNewType] = useState<NodeType>("idea");
	const [isCreating, setIsCreating] = useState(false);
	const [spawnGoal, setSpawnGoal] = useState<string | null>(null);
	const [agentGoalInput, setAgentGoalInput] = useState("");

	const { data: nodes = [], refetch } = trpc.nodes.list.useQuery({ status: "active" });
	const { data: agents = [], refetch: refetchAgents } = trpc.agents.list.useQuery();

	const createNode = trpc.nodes.create.useMutation({
		onSuccess: () => {
			refetch();
			setNewTitle("");
			setIsCreating(false);
		},
	});

	const archiveNode = trpc.nodes.archive.useMutation({
		onSuccess: () => refetch(),
	});

	const spawnAgent = trpc.agents.spawn.useMutation({
		onSuccess: () => {
			refetchAgents();
			setSpawnGoal(null);
			setAgentGoalInput("");
		},
	});

	const abortAgent = trpc.agents.abort.useMutation({
		onSuccess: () => refetchAgents(),
	});

	const handleCreate = () => {
		if (!newTitle.trim()) return;
		createNode.mutate({ type: newType, title: newTitle.trim() });
	};

	const handleSpawnAgent = (graphNodeId?: string) => {
		if (!agentGoalInput.trim()) return;
		spawnAgent.mutate({ goal: agentGoalInput.trim(), graphNodeId });
	};

	const AGENT_STATUS_COLOR: Record<string, string> = {
		pending: "#94a3b8",
		running: "#3b82f6",
		completed: "#10b981",
		failed: "#ef4444",
		aborted: "#f59e0b",
		paused: "#8b5cf6",
	};

	return (
		<div className="node-panel">
			{/* ── Nodes section ── */}
			<div className="node-panel__header">
				<h2>Nodes</h2>
				<button type="button" onClick={() => setIsCreating(!isCreating)} aria-label="Add node">
					{isCreating ? "Cancel" : "+"}
				</button>
			</div>

			{isCreating && (
				<form
					className="node-panel__create-form"
					onSubmit={(e) => {
						e.preventDefault();
						handleCreate();
					}}
				>
					<select value={newType} onChange={(e) => setNewType(e.target.value as NodeType)} aria-label="Node type">
						<option value="idea">Idea</option>
						<option value="decision">Decision</option>
						<option value="assumption">Assumption</option>
						<option value="finding">Finding</option>
						<option value="metric">Metric</option>
						<option value="investigation">Investigation</option>
					</select>
					<input
						type="text"
						value={newTitle}
						onChange={(e) => setNewTitle(e.target.value)}
						placeholder="Node title…"
						aria-label="Node title"
					/>
					<button type="submit" disabled={!newTitle.trim() || createNode.isPending}>
						{createNode.isPending ? "Creating…" : "Create"}
					</button>
				</form>
			)}

			<ul className="node-panel__list" aria-label="Node list">
				{nodes.map((node) => (
					<li key={node.id} className={`node-panel__item node-panel__item--${node.type}`}>
						<span className="node-panel__type-badge">{node.type}</span>
						<span className="node-panel__title">{node.title}</span>
						<div className="node-panel__actions">
							<button
								type="button"
								className="node-panel__spawn-btn"
								onClick={() => {
									setSpawnGoal(node.id);
									setAgentGoalInput(`Investigate: ${node.title}`);
								}}
								aria-label={`Spawn agent for ${node.title}`}
								title="Spawn agent"
							>
								Agent
							</button>
							<button
								type="button"
								className="node-panel__archive-btn"
								onClick={() => archiveNode.mutate({ id: node.id })}
								aria-label={`Archive ${node.title}`}
							>
								Archive
							</button>
						</div>
					</li>
				))}
				{nodes.length === 0 && <li className="node-panel__empty">No active nodes. Create one above.</li>}
			</ul>

			{/* ── Spawn Agent modal ── */}
			{spawnGoal !== null && (
				<div className="node-panel__spawn-overlay" role="dialog" aria-label="Spawn agent">
					<div className="node-panel__spawn-dialog">
						<h3>Spawn Agent</h3>
						<textarea
							value={agentGoalInput}
							onChange={(e) => setAgentGoalInput(e.target.value)}
							placeholder="Describe what this agent should investigate…"
							aria-label="Agent goal"
							rows={3}
						/>
						<div className="node-panel__spawn-dialog-actions">
							<button
								type="button"
								onClick={() => handleSpawnAgent(spawnGoal === "standalone" ? undefined : spawnGoal)}
								disabled={!agentGoalInput.trim() || spawnAgent.isPending}
							>
								{spawnAgent.isPending ? "Spawning…" : "Spawn"}
							</button>
							<button type="button" onClick={() => setSpawnGoal(null)}>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}

			{/* ── Agents section ── */}
			<div className="node-panel__header">
				<h2>Agents</h2>
				<button
					type="button"
					onClick={() => {
						setSpawnGoal("standalone");
						setAgentGoalInput("");
					}}
					aria-label="Spawn standalone agent"
					title="Spawn a standalone agent"
				>
					+
				</button>
			</div>

			<ul className="node-panel__list" aria-label="Agent list">
				{agents.map((agent) => (
					<li key={agent.id} className="node-panel__item node-panel__item--agent">
						<span
							className="node-panel__status-dot"
							style={{ background: AGENT_STATUS_COLOR[agent.status] ?? "#94a3b8" }}
							title={agent.status}
						/>
						<span className="node-panel__title" title={agent.goal}>
							{agent.goal.length > 60 ? `${agent.goal.slice(0, 60)}…` : agent.goal}
						</span>
						{(agent.status === "pending" || agent.status === "running") && (
							<button
								type="button"
								className="node-panel__archive-btn"
								onClick={() => abortAgent.mutate({ id: agent.id })}
								aria-label={`Abort agent`}
							>
								Abort
							</button>
						)}
					</li>
				))}
				{agents.length === 0 && <li className="node-panel__empty">No agents yet.</li>}
			</ul>
		</div>
	);
}
