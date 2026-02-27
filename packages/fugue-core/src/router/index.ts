import { router } from "../trpc.js";
import { agentsRouter } from "./agents.js";
import { assumptionsRouter } from "./assumptions.js";
import { auditRouter } from "./audit.js";
import { nodesRouter } from "./nodes.js";

export const appRouter = router({
	nodes: nodesRouter,
	assumptions: assumptionsRouter,
	audit: auditRouter,
	agents: agentsRouter,
});

export type AppRouter = typeof appRouter;
