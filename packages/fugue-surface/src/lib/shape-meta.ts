import type { EdgeType, NodeType } from "@fugue/shared";
import type { Editor, TLShape, TLShapeId } from "tldraw";

// ─── Shape Metadata Types ─────────────────────────────────────────────────────

/**
 * Metadata stored in a shape's `meta` field to link it to a Fugue graph node.
 * Only shapes with `nodeType` set are synced to the graph.
 */
export interface FugueShapeMeta {
	nodeId?: string;
	nodeType?: NodeType;
}

/**
 * Metadata stored in an arrow shape's `meta` field to link it to a graph edge.
 */
export interface FugueArrowMeta {
	edgeId?: string;
	edgeType?: EdgeType;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getNodeMeta(shape: TLShape): FugueShapeMeta {
	const meta = shape.meta as Record<string, unknown>;
	return {
		nodeId: typeof meta.nodeId === "string" ? meta.nodeId : undefined,
		nodeType: typeof meta.nodeType === "string" ? (meta.nodeType as NodeType) : undefined,
	};
}

export function getArrowMeta(shape: TLShape): FugueArrowMeta {
	const meta = shape.meta as Record<string, unknown>;
	return {
		edgeId: typeof meta.edgeId === "string" ? meta.edgeId : undefined,
		edgeType: typeof meta.edgeType === "string" ? (meta.edgeType as EdgeType) : undefined,
	};
}

/**
 * Extract the display text from a shape (title for graph node name).
 * Handles geo, note, text, arrow, and frame shapes.
 */
export function getShapeText(shape: TLShape): string {
	const props = shape.props as Record<string, unknown>;
	if (typeof props.text === "string" && props.text.trim()) return props.text.trim();
	if (typeof props.name === "string") return props.name.trim();
	return "";
}

export function setShapeNodeMeta(editor: Editor, shapeId: TLShapeId, meta: FugueShapeMeta): void {
	const shape = editor.getShape(shapeId);
	if (!shape) return;
	editor.updateShape({ id: shapeId, type: shape.type, meta: { ...shape.meta, ...meta } });
}

export function setArrowEdgeMeta(editor: Editor, shapeId: TLShapeId, meta: FugueArrowMeta): void {
	const shape = editor.getShape(shapeId);
	if (!shape) return;
	editor.updateShape({ id: shapeId, type: shape.type, meta: { ...shape.meta, ...meta } });
}

export function isArrow(shape: TLShape): boolean {
	return shape.type === "arrow";
}
