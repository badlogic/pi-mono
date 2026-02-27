import { useMemo } from "react";
import { type TLComponents, Tldraw, useSync } from "tldraw";
import "tldraw/tldraw.css";
import { GraphSyncLayer } from "./GraphSyncLayer.js";
import { NodeTypeOverlay } from "./NodeTypeOverlay.js";

interface CanvasProps {
	roomId: string;
	syncUrl?: string;
}

// Custom tldraw components — injected inside the canvas tree
const CANVAS_COMPONENTS: TLComponents = {
	// InFrontOfTheCanvas renders above all shapes but inside the editor
	InFrontOfTheCanvas: () => (
		<>
			<NodeTypeOverlay />
			<GraphSyncLayer />
		</>
	),
};

/**
 * Collaborative canvas backed by tldraw + fugue-sync.
 * When syncUrl is provided, uses tldraw's native sync protocol.
 * Falls back to local-only mode when syncUrl is absent (useful for testing).
 *
 * Graph sync: shapes with an assigned node type are mirrored to the Fugue
 * context graph via tRPC — create, update (debounced), and archive on delete.
 * Arrows between node-linked shapes create graph edges automatically.
 */
export function Canvas({ roomId, syncUrl }: CanvasProps) {
	if (syncUrl) {
		return <SyncedCanvas roomId={roomId} syncUrl={syncUrl} />;
	}
	return <LocalCanvas />;
}

function LocalCanvas() {
	return (
		<div style={{ position: "fixed", inset: 0 }}>
			<Tldraw components={CANVAS_COMPONENTS} />
		</div>
	);
}

function SyncedCanvas({ roomId, syncUrl }: { roomId: string; syncUrl: string }) {
	const store = useSync({
		uri: `${syncUrl}/rooms/${encodeURIComponent(roomId)}`,
		assets: useMemo(
			() => ({
				upload: async (_asset: unknown, file: File): Promise<string> => {
					return new Promise((resolve) => {
						const reader = new FileReader();
						reader.onloadend = () => resolve(reader.result as string);
						reader.readAsDataURL(file);
					});
				},
				resolve: (asset: { props: { src?: string } }) => asset.props.src ?? "",
			}),
			[],
		),
	});

	return (
		<div style={{ position: "fixed", inset: 0 }}>
			<Tldraw store={store} components={CANVAS_COMPONENTS} />
		</div>
	);
}
