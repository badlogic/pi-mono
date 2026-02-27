import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Canvas } from "./components/Canvas.js";
import { NodePanel } from "./components/NodePanel.js";
import { createTrpcClient, trpc } from "./trpc.js";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 5_000,
			retry: 1,
		},
	},
});

const trpcClient = createTrpcClient();

const SYNC_URL = import.meta.env.VITE_SYNC_URL ?? "ws://localhost:3002";
const DEFAULT_ROOM = "default";

export function App() {
	const [showPanel, setShowPanel] = useState(true);
	const roomId = new URL(window.location.href).searchParams.get("room") ?? DEFAULT_ROOM;

	return (
		<trpc.Provider client={trpcClient} queryClient={queryClient}>
			<QueryClientProvider client={queryClient}>
				<div className="fugue-app">
					<Canvas roomId={roomId} syncUrl={SYNC_URL} />
					{showPanel && (
						<div className="fugue-app__panel">
							<NodePanel />
						</div>
					)}
					<button
						type="button"
						className="fugue-app__panel-toggle"
						onClick={() => setShowPanel((v) => !v)}
						aria-label={showPanel ? "Hide panel" : "Show panel"}
					>
						{showPanel ? "◀" : "▶"}
					</button>
				</div>
			</QueryClientProvider>
		</trpc.Provider>
	);
}
