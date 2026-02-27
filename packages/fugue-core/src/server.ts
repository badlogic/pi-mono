import type { EventBus } from "@fugue/events";
import { createInMemoryBus, createPgmqBus } from "@fugue/events";
import { createDb, runMigrations } from "@fugue/graph";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { Pool } from "pg";
import { createAuth } from "./auth.js";
import type { Session } from "./context.js";
import { appRouter } from "./router/index.js";

// ─── Server Factory ──────────────────────────────────────────────────────────

export interface ServerConfig {
	pool: Pool;
	bus?: EventBus;
	port?: number;
}

export function createApp(config: ServerConfig) {
	const { pool } = config;
	const db = createDb(pool);
	const bus = config.bus ?? createInMemoryBus();
	const auth = createAuth(pool);

	const app = new Hono();

	// ── Health check
	app.get("/health", (c) => c.json({ status: "ok", service: "fugue-core" }));

	// ── Better Auth routes (sign-in, sign-up, session, etc.)
	app.on(["GET", "POST"], "/auth/**", (c) => {
		return auth.handler(c.req.raw);
	});

	// ── tRPC API
	app.use(
		"/trpc/**",
		trpcServer({
			router: appRouter,
			createContext: async (opts) => {
				// Resolve session from Better Auth
				const sessionResult = await auth.api.getSession({ headers: opts.req.headers });
				const session: Session | null = sessionResult?.user
					? {
							userId: sessionResult.user.id,
							email: sessionResult.user.email,
							role: ((sessionResult.user as Record<string, unknown>).role as string) ?? "member",
						}
					: null;

				return { db, pool, bus, session };
			},
		}),
	);

	return { app, db, pool, bus, auth };
}

// ─── Entry Point (direct run) ─────────────────────────────────────────────────

async function main() {
	const pool = new Pool({
		connectionString: process.env.DATABASE_URL ?? "postgresql://fugue:fugue@localhost:5432/fugue",
	});

	await runMigrations(pool);

	const bus = process.env.USE_PGMQ === "true" ? createPgmqBus(pool) : createInMemoryBus();

	const { app } = createApp({ pool, bus });
	const port = Number(process.env.PORT ?? 3001);

	const { serve } = await import("@hono/node-server");
	serve({ fetch: app.fetch, port }, () => {
		console.log(`fugue-core listening on :${port}`);
	});
}

// Allow running directly: `node dist/server.js`
if (process.argv[1]?.endsWith("server.js") || process.argv[1]?.endsWith("server.ts")) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
