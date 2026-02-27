import { Tldraw, useSync } from "tldraw";
import "tldraw/tldraw.css";

interface CanvasProps {
	roomId: string;
	syncUrl?: string;
}

/**
 * Collaborative canvas backed by tldraw + fugue-sync.
 * When syncUrl is provided, uses tldraw's native sync protocol.
 * Falls back to local-only mode when syncUrl is absent (useful for testing).
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
			<Tldraw />
		</div>
	);
}

function SyncedCanvas({ roomId, syncUrl }: { roomId: string; syncUrl: string }) {
	const store = useSync({
		uri: `${syncUrl}/rooms/${encodeURIComponent(roomId)}`,
		assets: {
			upload: async (_asset, file) => {
				// MVP: upload to fugue-core (not implemented yet — return data URL)
				return new Promise((resolve) => {
					const reader = new FileReader();
					reader.onloadend = () => resolve(reader.result as string);
					reader.readAsDataURL(file);
				});
			},
			resolve: (asset) => asset.props.src ?? "",
		},
	});

	return (
		<div style={{ position: "fixed", inset: 0 }}>
			<Tldraw store={store} />
		</div>
	);
}
