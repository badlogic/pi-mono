import { getMetricsForNode, listMetrics, recordMetric } from "@fugue/graph";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc.js";

export const metricsRouter = router({
	record: protectedProcedure
		.input(
			z.object({
				graphNodeId: z.string().optional(),
				name: z.string().min(1).max(200),
				value: z.number(),
				unit: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return recordMetric(
				ctx.db,
				{ ...input, measuredBy: ctx.session.userId },
				{ actorId: ctx.session.userId, actorType: "human" },
			);
		}),

	forNode: protectedProcedure.input(z.object({ graphNodeId: z.string() })).query(async ({ input, ctx }) => {
		return getMetricsForNode(ctx.db, input.graphNodeId);
	}),

	list: protectedProcedure
		.input(
			z
				.object({
					name: z.string().optional(),
					graphNodeId: z.string().optional(),
					limit: z.number().int().min(1).max(500).optional(),
				})
				.optional(),
		)
		.query(async ({ input, ctx }) => {
			return listMetrics(ctx.db, input);
		}),
});
