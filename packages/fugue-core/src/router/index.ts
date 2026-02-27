import { router } from "../trpc.js";
import { assumptionsRouter } from "./assumptions.js";
import { auditRouter } from "./audit.js";
import { nodesRouter } from "./nodes.js";

export const appRouter = router({
	nodes: nodesRouter,
	assumptions: assumptionsRouter,
	audit: auditRouter,
});

export type AppRouter = typeof appRouter;
