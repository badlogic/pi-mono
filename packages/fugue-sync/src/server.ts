import type { Pool } from "pg";
import { WebSocket, WebSocketServer } from "ws";
import { RoomManager } from "./room-manager.js";
import { RoomStore } from "./store.js";

export interface SyncServerConfig {
	pool: Pool;
	port?: number;
}

/**
 * WebSocket sync server for tldraw.
 * URL pattern: /rooms/:roomId
 * Protocol: tldraw sync protocol (handled by TLSocketRoom)
 */
export function createSyncServer(config: SyncServerConfig) {
	const store = new RoomStore(config.pool);
	const manager = new RoomManager(store);

	const wss = new WebSocketServer({ port: config.port ?? 3002, path: "/" });

	wss.on("connection", async (ws, req) => {
		// Extract roomId from URL: /rooms/:roomId
		const url = req.url ?? "";
		const match = url.match(/^\/rooms\/([^/?#]+)/);

		if (!match) {
			ws.close(1008, "Invalid room URL — expected /rooms/:roomId");
			return;
		}

		const roomId = decodeURIComponent(match[1]!);
		const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

		let room: Awaited<ReturnType<typeof manager.getOrCreate>> | null = null;

		try {
			room = await manager.getOrCreate(roomId);
		} catch {
			ws.close(1011, "Room initialization failed");
			return;
		}

		manager.onConnectionOpen(roomId);

		room.handleSocketConnect({
			sessionId,
			socket: {
				get readyState() {
					return ws.readyState;
				},
				send: (data: string) => {
					if (ws.readyState === WebSocket.OPEN) {
						ws.send(data);
					}
				},
				close: (code?: number, reason?: string) => ws.close(code, reason),
			},
		});

		ws.on("message", (data) => {
			try {
				const msg = JSON.parse(data.toString());
				room?.handleSocketMessage(sessionId, msg);
			} catch {
				ws.close(1007, "Invalid message format");
			}
		});

		ws.on("close", () => {
			room?.handleSocketClose(sessionId);
			manager.onConnectionClose(roomId);
			room = null;
		});

		ws.on("error", () => {
			ws.close();
		});
	});

	return {
		wss,
		store,
		manager,
		close: async () => {
			wss.close();
			await manager.close();
		},
	};
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

async function main() {
	const { Pool } = await import("pg");
	const pool = new Pool({
		connectionString: process.env.DATABASE_URL ?? "postgresql://fugue:fugue@localhost:5432/fugue",
	});

	const store = new RoomStore(pool);
	await store.setup();

	const port = Number(process.env.SYNC_PORT ?? 3002);
	const server = createSyncServer({ pool, port });

	console.log(`fugue-sync listening on :${port}`);

	process.on("SIGTERM", async () => {
		await server.close();
		await pool.end();
		process.exit(0);
	});
}

if (process.argv[1]?.endsWith("server.js") || process.argv[1]?.endsWith("server.ts")) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
