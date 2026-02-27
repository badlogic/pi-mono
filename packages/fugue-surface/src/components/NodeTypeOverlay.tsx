import type { NodeType } from "@fugue/shared";
import { useEditor, useValue } from "tldraw";
import { getNodeMeta, isArrow, setShapeNodeMeta } from "../lib/shape-meta.js";
import { trpc } from "../trpc.js";

// Node type ordering + display labels
const NODE_TYPES: { value: NodeType; label: string; color: string }[] = [
	{ value: "idea", label: "Idea", color: "#6366f1" },
	{ value: "decision", label: "Decision", color: "#f59e0b" },
	{ value: "assumption", label: "Assumption", color: "#ef4444" },
	{ value: "finding", label: "Finding", color: "#10b981" },
	{ value: "metric", label: "Metric", color: "#3b82f6" },
	{ value: "investigation", label: "Investigation", color: "#8b5cf6" },
	{ value: "deployment", label: "Deployment", color: "#06b6d4" },
];

const EDGE_TYPE_LABELS: Record<string, string> = {
	supports: "supports",
	builds_on: "builds on",
	challenges: "challenges",
	decided_by: "decided by",
	measures: "measures",
	spawned: "spawned",
	investigates: "investigates",
	competes_in: "competes in",
	triggered_by: "triggered by",
};

/**
 * Overlay rendered inside the Tldraw tree (via InFrontOfTheCanvas).
 * Shows a node-type assignment pill when exactly one non-arrow shape is selected
 * and has no nodeType yet, OR shows the current type badge if already linked.
 */
export function NodeTypeOverlay() {
	const editor = useEditor();
	const createNode = trpc.nodes.create.useMutation();

	// Derive UI state reactively from tldraw store
	const state = useValue("fugue-overlay-state", () => {
		const selected = editor.getSelectedShapes();
		if (selected.length !== 1) return null;
		const shape = selected[0]!;
		if (isArrow(shape)) return null;
		const meta = getNodeMeta(shape);
		return { shapeId: shape.id, shapeType: shape.type, meta };
	}, [editor]);

	if (!state) return null;

	const { shapeId, meta } = state;

	const assignType = (nodeType: NodeType) => {
		const shape = editor.getShape(shapeId);
		if (!shape) return;
		const title = (shape.props as Record<string, unknown>).text as string | undefined;
		const resolvedTitle = typeof title === "string" && title.trim() ? title.trim() : "Untitled";

		// Set meta immediately so GraphSyncLayer picks it up via the store listener
		setShapeNodeMeta(editor, shapeId, { nodeType });

		// If there's no title yet, also create right here for instant feedback
		if (!meta.nodeId) {
			createNode.mutate(
				{ type: nodeType, title: resolvedTitle },
				{
					onSuccess: (node) => {
						setShapeNodeMeta(editor, shapeId, { nodeId: node.id, nodeType });
					},
				},
			);
		}
	};

	return (
		<div
			style={{
				position: "absolute",
				top: 8,
				left: "50%",
				transform: "translateX(-50%)",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 6,
				pointerEvents: "all",
				zIndex: 300,
			}}
		>
			{meta.nodeType ? (
				// Already linked — show type badge
				<LinkedBadge nodeType={meta.nodeType} nodeId={meta.nodeId} />
			) : (
				// Not linked — show type picker
				<TypePicker onSelect={assignType} />
			)}
		</div>
	);
}

function LinkedBadge({ nodeType, nodeId }: { nodeType: NodeType; nodeId?: string }) {
	const def = NODE_TYPES.find((t) => t.value === nodeType);
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				background: "white",
				border: `2px solid ${def?.color ?? "#888"}`,
				borderRadius: 20,
				padding: "3px 10px",
				fontSize: 12,
				fontWeight: 600,
				color: def?.color ?? "#888",
				boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
				userSelect: "none",
			}}
		>
			<span
				style={{
					width: 8,
					height: 8,
					borderRadius: "50%",
					background: def?.color ?? "#888",
					display: "inline-block",
				}}
			/>
			{def?.label ?? nodeType}
			{nodeId && <span style={{ opacity: 0.5, fontWeight: 400, fontSize: 10 }}>#{nodeId.slice(-6)}</span>}
		</div>
	);
}

function TypePicker({ onSelect }: { onSelect: (type: NodeType) => void }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 4,
				background: "white",
				borderRadius: 20,
				padding: "4px 8px",
				boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
			}}
		>
			<span style={{ fontSize: 11, color: "#888", marginRight: 4, userSelect: "none" }}>Tag as:</span>
			{NODE_TYPES.map(({ value, label, color }) => (
				<button
					key={value}
					type="button"
					onClick={() => onSelect(value)}
					style={{
						background: "none",
						border: `1.5px solid ${color}`,
						borderRadius: 12,
						padding: "2px 8px",
						fontSize: 11,
						fontWeight: 500,
						color,
						cursor: "pointer",
						transition: "background 0.1s",
					}}
					onMouseEnter={(e) => {
						(e.currentTarget as HTMLButtonElement).style.background = `${color}22`;
					}}
					onMouseLeave={(e) => {
						(e.currentTarget as HTMLButtonElement).style.background = "none";
					}}
				>
					{label}
				</button>
			))}
		</div>
	);
}

export { EDGE_TYPE_LABELS, NODE_TYPES };
