import {
	createAssumption,
	getAssumptionsForNode,
	markStaleAssumptions,
	updateAssumptionConfidence,
} from "@fugue/graph";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc.js";

export const assumptionsRouter = router({
	create: protectedProcedure
		.input(
			z.object({
				graphNodeId: z.string(),
				claim: z.string().min(1).max(2000),
				confidence: z.number().min(0).max(1).optional(),
				evidence: z.string().optional(),
				verificationMethod: z.string().optional(),
				verifyByDays: z.number().int().min(1).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return createAssumption(
				ctx.db,
				{ ...input, ownerId: ctx.session.userId },
				{ actorId: ctx.session.userId, actorType: "human" },
			);
		}),

	updateConfidence: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				confidence: z.number().min(0).max(1),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const result = await updateAssumptionConfidence(ctx.db, input.id, input.confidence, {
				actorId: ctx.session.userId,
				actorType: "human",
			});
			if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Assumption not found" });
			return result;
		}),

	forNode: protectedProcedure.input(z.object({ graphNodeId: z.string() })).query(async ({ input, ctx }) => {
		return getAssumptionsForNode(ctx.db, input.graphNodeId);
	}),

	markStale: protectedProcedure.mutation(async ({ ctx }) => {
		const count = await markStaleAssumptions(ctx.db);
		return { markedStale: count };
	}),
});
