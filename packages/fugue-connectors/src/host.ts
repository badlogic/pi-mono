import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { EventBus } from "@fugue/events";
import { EventBridge } from "./bridge.js";
import { GitHubConnector } from "./github.js";

// ─── ConnectorHost ────────────────────────────────────────────────────────────

export interface ConnectorHostOptions {
	port?: number;
	/** GitHub webhook secret for HMAC validation (optional — skip if not set) */
	githubSecret?: string;
}

/**
 * HTTP server that receives external webhooks and routes them through
 * the EventBridge to the Fugue EventBus.
 *
 * Routes:
 *   POST /webhooks/github   — GitHub webhooks
 *
 * Usage:
 *   const host = new ConnectorHost(bus, { port: 4002 });
 *   await host.start();
 *   // ... later:
 *   await host.stop();
 */
export class ConnectorHost {
	private readonly bridge: EventBridge;
	private server: Server | null = null;
	private readonly port: number;

	constructor(bus: EventBus, options: ConnectorHostOptions = {}) {
		this.port = options.port ?? 4002;
		this.bridge = new EventBridge(bus);
		this.bridge.register(new GitHubConnector());
	}

	get eventBridge(): EventBridge {
		return this.bridge;
	}

	async start(): Promise<void> {
		if (this.server) return;

		this.server = createServer((req, res) => {
			this.handleRequest(req, res).catch((err) => {
				console.error("[ConnectorHost] request error:", err);
				if (!res.headersSent) {
					res.writeHead(500, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "Internal server error" }));
				}
			});
		});

		return new Promise((resolve, reject) => {
			this.server!.listen(this.port, () => resolve());
			this.server!.once("error", reject);
		});
	}

	async stop(): Promise<void> {
		if (!this.server) return;
		return new Promise((resolve, reject) => {
			this.server!.close((err) => (err ? reject(err) : resolve()));
			this.server = null;
		});
	}

	private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = req.url ?? "/";
		const method = req.method ?? "GET";

		// Health check
		if (url === "/health" && method === "GET") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: true, connectors: this.bridge.connectorNames }));
			return;
		}

		if (method !== "POST") {
			res.writeHead(405, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Method not allowed" }));
			return;
		}

		const body = await readBody(req);
		let parsed: unknown;
		try {
			parsed = JSON.parse(body);
		} catch {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Invalid JSON" }));
			return;
		}

		if (url === "/webhooks/github") {
			const event = req.headers["x-github-event"] as string | undefined;
			if (!event) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Missing X-GitHub-Event header" }));
				return;
			}

			const count = this.bridge.ingest("github", { event, body: parsed });
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: true, eventsPublished: count }));
			return;
		}

		res.writeHead(404, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "Not found" }));
	}
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", reject);
	});
}
