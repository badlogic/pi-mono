/**
 * Standalone HTTP server for fugue-connectors.
 * Receives external webhooks and publishes them to the Fugue EventBus via HTTP.
 *
 * Environment variables:
 *   CONNECTOR_PORT          — HTTP port (default: 4002)
 *   GITHUB_WEBHOOK_SECRET   — HMAC-SHA256 secret for GitHub webhooks (optional)
 *   FUGUE_CORE_URL          — Used for health logging only (default: http://localhost:3001)
 */
import { InMemoryEventBus } from "@fugue/events";
import { ConnectorHost } from "./host.js";

const port = Number(process.env["CONNECTOR_PORT"] ?? 4002);
const githubSecret = process.env["GITHUB_WEBHOOK_SECRET"] || undefined;

const bus = new InMemoryEventBus();
const host = new ConnectorHost(bus, { port, githubSecret });

async function main(): Promise<void> {
	await host.start();
	console.log(`[fugue-connectors] listening on port ${port}`);
	if (githubSecret) {
		console.log("[fugue-connectors] GitHub webhook HMAC validation enabled");
	} else {
		console.warn("[fugue-connectors] GitHub webhook HMAC validation disabled (no secret set)");
	}
}

main().catch((err) => {
	console.error("[fugue-connectors] startup failed:", err);
	process.exit(1);
});

// Graceful shutdown
for (const sig of ["SIGTERM", "SIGINT"]) {
	process.on(sig, async () => {
		console.log(`[fugue-connectors] received ${sig}, shutting down`);
		await host.stop();
		process.exit(0);
	});
}
