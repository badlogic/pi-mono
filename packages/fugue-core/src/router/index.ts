import { router } from "../trpc.js";
import { agentsRouter } from "./agents.js";
import { assumptionsRouter } from "./assumptions.js";
import { auditRouter } from "./audit.js";
import { competitionsRouter } from "./competitions.js";
import { memoryRouter } from "./memory.js";
import { metricsRouter } from "./metrics.js";
import { nodesRouter } from "./nodes.js";
import { researchRouter } from "./research.js";

export const appRouter = router({
	nodes: nodesRouter,
	assumptions: assumptionsRouter,
	audit: auditRouter,
	agents: agentsRouter,
	research: researchRouter,
	memory: memoryRouter,
	metrics: metricsRouter,
	competitions: competitionsRouter,
});

export type AppRouter = typeof appRouter;
