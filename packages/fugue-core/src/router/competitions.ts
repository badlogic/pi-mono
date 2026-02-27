import {
	addCompetitionEntry,
	concludeCompetition,
	createCompetition,
	getCompetition,
	getCompetitionEntries,
	listCompetitions,
	scoreCompetitionEntry,
} from "@fugue/graph";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc.js";

export const competitionsRouter = router({
	create: protectedProcedure
		.input(
			z.object({
				title: z.string().min(1).max(500),
				description: z.string().optional(),
				criteria: z.record(z.unknown()).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return createCompetition(
				ctx.db,
				{ ...input, authorId: ctx.session.userId },
				{ actorId: ctx.session.userId, actorType: "human" },
			);
		}),

	get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
		const comp = await getCompetition(ctx.db, input.id);
		if (!comp) throw new TRPCError({ code: "NOT_FOUND", message: "Competition not found" });
		return comp;
	}),

	list: protectedProcedure
		.input(
			z
				.object({
					status: z.enum(["active", "concluded"]).optional(),
					limit: z.number().int().min(1).max(100).optional(),
				})
				.optional(),
		)
		.query(async ({ input, ctx }) => {
			return listCompetitions(ctx.db, input);
		}),

	addEntry: protectedProcedure
		.input(
			z.object({
				competitionId: z.string(),
				graphNodeId: z.string(),
				notes: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return addCompetitionEntry(
				ctx.db,
				{ ...input, authorId: ctx.session.userId },
				{ actorId: ctx.session.userId, actorType: "human" },
			);
		}),

	scoreEntry: protectedProcedure
		.input(z.object({ entryId: z.string(), score: z.number().min(0).max(1) }))
		.mutation(async ({ input, ctx }) => {
			const result = await scoreCompetitionEntry(ctx.db, input.entryId, input.score, {
				actorId: ctx.session.userId,
				actorType: "human",
			});
			if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Entry not found" });
			return result;
		}),

	conclude: protectedProcedure
		.input(z.object({ id: z.string(), winnerNodeId: z.string() }))
		.mutation(async ({ input, ctx }) => {
			const result = await concludeCompetition(ctx.db, input.id, input.winnerNodeId, {
				actorId: ctx.session.userId,
				actorType: "human",
			});
			if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Competition not found" });
			return result;
		}),

	entries: protectedProcedure.input(z.object({ competitionId: z.string() })).query(async ({ input, ctx }) => {
		return getCompetitionEntries(ctx.db, input.competitionId);
	}),
});
