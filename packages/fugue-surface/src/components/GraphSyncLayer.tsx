import type { EdgeType } from "@fugue/shared";
import { useEffect, useRef } from "react";
import { getArrowBindings, type TLArrowShape, type TLShape, type TLShapeId, useEditor } from "tldraw";
import {
	getArrowMeta,
	getNodeMeta,
	getShapeText,
	isArrow,
	setArrowEdgeMeta,
	setShapeNodeMeta,
} from "../lib/shape-meta.js";
import { trpc } from "../trpc.js";

// ─── GraphSyncLayer ───────────────────────────────────────────────────────────

/**
 * Invisible component mounted inside the Tldraw tree.
 * Listens to canvas store changes and syncs shape↔node and arrow↔edge to the
 * Fugue graph via tRPC mutations.
 *
 * Sync rules:
 *   - Shape with meta.nodeType (assigned by NodeTypeOverlay) → create graph node
 *   - Shape text changes when meta.nodeId set → update node title (debounced 500ms)
 *   - Shape deleted with meta.nodeId → archive graph node
 *   - Arrow connecting two node-linked shapes → create graph edge
 *   - Arrow deleted with meta.edgeId → delete graph edge
 */
export function GraphSyncLayer() {
	const editor = useEditor();
	const createNode = trpc.nodes.create.useMutation();
	const updateNode = trpc.nodes.update.useMutation();
	const archiveNode = trpc.nodes.archive.useMutation();
	const createEdge = trpc.nodes.createEdge.useMutation();
	const deleteEdge = trpc.nodes.deleteEdge.useMutation();

	// Pending title updates: shapeId → { nodeId, title, timer }
	const pendingUpdates = useRef<Map<string, { nodeId: string; title: string; timer: ReturnType<typeof setTimeout> }>>(
		new Map(),
	);
	// Prevent re-entrant store updates when we write nodeId back to shape meta
	const writingMeta = useRef<Set<string>>(new Set());

	// Capture stable refs to mutations so the effect doesn't re-subscribe on render
	const mutationRefs = useRef({ createNode, updateNode, archiveNode, createEdge, deleteEdge });
	mutationRefs.current = { createNode, updateNode, archiveNode, createEdge, deleteEdge };

	useEffect(() => {
		function handleCreateNode(shape: TLShape): void {
			const meta = getNodeMeta(shape);
			if (!meta.nodeType) return;
			const title = getShapeText(shape) || "Untitled";
			mutationRefs.current.createNode.mutate(
				{ type: meta.nodeType, title },
				{
					onSuccess: (node) => {
						writingMeta.current.add(shape.id);
						setShapeNodeMeta(editor, shape.id as TLShapeId, { nodeId: node.id, nodeType: meta.nodeType });
						setTimeout(() => writingMeta.current.delete(shape.id), 0);
					},
				},
			);
		}

		function handleArrowChange(shape: TLArrowShape): void {
			const bindings = getArrowBindings(editor, shape);
			if (!bindings.start?.toId || !bindings.end?.toId) return;

			const sourceShape = editor.getShape(bindings.start.toId);
			const targetShape = editor.getShape(bindings.end.toId);
			if (!sourceShape || !targetShape) return;

			const sourceMeta = getNodeMeta(sourceShape);
			const targetMeta = getNodeMeta(targetShape);
			if (!sourceMeta.nodeId || !targetMeta.nodeId) return;

			const arrowMeta = getArrowMeta(shape);
			if (arrowMeta.edgeId) return;

			const edgeType: EdgeType = arrowMeta.edgeType ?? "supports";
			mutationRefs.current.createEdge.mutate(
				{ sourceId: sourceMeta.nodeId, targetId: targetMeta.nodeId, type: edgeType },
				{
					onSuccess: (edge) => {
						writingMeta.current.add(shape.id);
						setArrowEdgeMeta(editor, shape.id as TLShapeId, { edgeId: edge.id, edgeType: edge.type as EdgeType });
						setTimeout(() => writingMeta.current.delete(shape.id), 0);
					},
				},
			);
		}

		function scheduleUpdate(shapeId: string, nodeId: string, title: string): void {
			const existing = pendingUpdates.current.get(shapeId);
			if (existing) clearTimeout(existing.timer);
			const timer = setTimeout(() => {
				pendingUpdates.current.delete(shapeId);
				mutationRefs.current.updateNode.mutate({ id: nodeId, title: title || "Untitled" });
			}, 500);
			pendingUpdates.current.set(shapeId, { nodeId, title, timer });
		}

		const cleanup = editor.store.listen(
			({ changes }) => {
				// ── Added ──────────────────────────────────────────────────────
				for (const record of Object.values(changes.added)) {
					if (record.typeName !== "shape") continue;
					const shape = record as TLShape;
					if (writingMeta.current.has(shape.id)) continue;
					if (isArrow(shape)) {
						handleArrowChange(shape as TLArrowShape);
					} else {
						const meta = getNodeMeta(shape);
						if (meta.nodeType && !meta.nodeId) handleCreateNode(shape);
					}
				}

				// ── Updated ────────────────────────────────────────────────────
				for (const [before, after] of Object.values(changes.updated) as [TLShape, TLShape][]) {
					if (before.typeName !== "shape") continue;
					if (writingMeta.current.has(before.id)) continue;
					if (isArrow(after)) {
						const edgeMeta = getArrowMeta(after);
						if (!edgeMeta.edgeId) handleArrowChange(after as TLArrowShape);
					} else {
						const metaBefore = getNodeMeta(before);
						const metaAfter = getNodeMeta(after);
						if (metaAfter.nodeType && !metaBefore.nodeType && !metaAfter.nodeId) {
							handleCreateNode(after);
						} else if (metaAfter.nodeId) {
							const textBefore = getShapeText(before);
							const textAfter = getShapeText(after);
							if (textBefore !== textAfter) scheduleUpdate(after.id, metaAfter.nodeId, textAfter);
						}
					}
				}

				// ── Removed ────────────────────────────────────────────────────
				for (const record of Object.values(changes.removed)) {
					if (record.typeName !== "shape") continue;
					const shape = record as TLShape;
					if (isArrow(shape)) {
						const edgeMeta = getArrowMeta(shape);
						if (edgeMeta.edgeId) mutationRefs.current.deleteEdge.mutate({ id: edgeMeta.edgeId });
					} else {
						const meta = getNodeMeta(shape);
						if (meta.nodeId) {
							const pending = pendingUpdates.current.get(shape.id);
							if (pending) {
								clearTimeout(pending.timer);
								pendingUpdates.current.delete(shape.id);
							}
							mutationRefs.current.archiveNode.mutate({ id: meta.nodeId });
						}
					}
				}
			},
			{ source: "user", scope: "document" },
		);

		return () => {
			cleanup();
			for (const { timer } of pendingUpdates.current.values()) clearTimeout(timer);
			pendingUpdates.current.clear();
		};
	}, [editor]); // editor is stable; mutations accessed via ref

	return null;
}
