import {
	addFinding,
	concludeInvestigation,
	createInvestigation,
	getFindingsForInvestigation,
	listInvestigations,
} from "@fugue/graph";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc.js";

const InvestigationStatusSchema = z.enum(["open", "active", "concluded"]);

export const researchRouter = router({
	createInvestigation: protectedProcedure
		.input(
			z.object({
				question: z.string().min(1).max(2000),
				methodology: z.string().optional(),
				graphNodeId: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return createInvestigation(
				ctx.db,
				{ ...input, investigatorId: ctx.session.userId },
				{ actorId: ctx.session.userId, actorType: "human" },
			);
		}),

	conclude: protectedProcedure
		.input(z.object({ id: z.string(), conclusion: z.string().min(1).max(5000) }))
		.mutation(async ({ input, ctx }) => {
			const result = await concludeInvestigation(ctx.db, input.id, input.conclusion, {
				actorId: ctx.session.userId,
				actorType: "human",
			});
			if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Investigation not found" });
			return result;
		}),

	list: protectedProcedure
		.input(
			z
				.object({
					status: InvestigationStatusSchema.optional(),
					investigatorId: z.string().optional(),
					limit: z.number().int().min(1).max(100).optional(),
				})
				.optional(),
		)
		.query(async ({ input, ctx }) => {
			return listInvestigations(ctx.db, input);
		}),

	addFinding: protectedProcedure
		.input(
			z.object({
				investigationId: z.string(),
				claim: z.string().min(1).max(2000),
				evidence: z.string().optional(),
				confidence: z.number().min(0).max(1).optional(),
				graphNodeId: z.string().optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return addFinding(
				ctx.db,
				{ ...input, authorId: ctx.session.userId },
				{ actorId: ctx.session.userId, actorType: "human" },
			);
		}),

	findingsFor: protectedProcedure.input(z.object({ investigationId: z.string() })).query(async ({ input, ctx }) => {
		return getFindingsForInvestigation(ctx.db, input.investigationId);
	}),
});
