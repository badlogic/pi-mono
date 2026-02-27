import { getCatchUpView, listDecisionEpisodes, recordDecisionEpisode, searchDecisionEpisodes } from "@fugue/graph";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc.js";

export const memoryRouter = router({
	recordDecision: protectedProcedure
		.input(
			z.object({
				title: z.string().min(1).max(500),
				context: z.string().optional(),
				optionsConsidered: z.array(z.string()).optional(),
				decision: z.string().min(1).max(2000),
				rationale: z.string().optional(),
				graphNodeId: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return recordDecisionEpisode(
				ctx.db,
				{ ...input, authorId: ctx.session.userId },
				{ actorId: ctx.session.userId, actorType: "human" },
			);
		}),

	list: protectedProcedure
		.input(
			z
				.object({
					authorId: z.string().optional(),
					limit: z.number().int().min(1).max(200).optional(),
				})
				.optional(),
		)
		.query(async ({ input, ctx }) => {
			return listDecisionEpisodes(ctx.db, input);
		}),

	search: protectedProcedure
		.input(z.object({ q: z.string().min(1).max(200), limit: z.number().int().min(1).max(100).optional() }))
		.query(async ({ input, ctx }) => {
			return searchDecisionEpisodes(ctx.db, input.q, input.limit);
		}),

	catchUp: protectedProcedure
		.input(
			z.object({
				sinceDays: z.number().int().min(1).max(365).default(7),
				limit: z.number().int().min(1).max(200).optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			const since = new Date(Date.now() - input.sinceDays * 86_400_000);
			return getCatchUpView(ctx.db, since, input.limit);
		}),
});
