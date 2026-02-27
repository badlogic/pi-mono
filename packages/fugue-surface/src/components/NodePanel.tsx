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

	const { data: nodes = [], refetch } = trpc.nodes.list.useQuery({ status: "active" });
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

	const handleCreate = () => {
		if (!newTitle.trim()) return;
		createNode.mutate({ type: newType, title: newTitle.trim() });
	};

	return (
		<div className="node-panel">
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
						<button
							type="button"
							className="node-panel__archive-btn"
							onClick={() => archiveNode.mutate({ id: node.id })}
							aria-label={`Archive ${node.title}`}
						>
							Archive
						</button>
					</li>
				))}
				{nodes.length === 0 && <li className="node-panel__empty">No active nodes. Create one above.</li>}
			</ul>
		</div>
	);
}
