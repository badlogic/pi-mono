import { createAgent, getAgent, listAgents, updateAgentStatus } from "@fugue/graph";
import { newId } from "@fugue/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc.js";

const AgentStatusSchema = z.enum(["pending", "running", "paused", "completed", "failed", "aborted"]);

export const agentsRouter = router({
	spawn: protectedProcedure
		.input(
			z.object({
				goal: z.string().min(1).max(2000),
				graphNodeId: z.string().optional(),
				model: z.string().optional(),
				budgetMaxJoules: z.number().positive().optional(),
				capabilities: z.record(z.unknown()).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const agent = await createAgent(
				ctx.db,
				{
					goal: input.goal,
					graphNodeId: input.graphNodeId,
					model: input.model,
					budgetMaxJoules: input.budgetMaxJoules,
					capabilities: input.capabilities,
				},
				{ actorId: ctx.session.userId, actorType: "human" },
			);

			ctx.bus.publish({
				id: newId(),
				source: "system",
				type: "agent.spawn",
				payload: { agentId: agent.id, goal: agent.goal },
				timestamp: new Date().toISOString(),
			});

			return agent;
		}),

	getState: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
		const agent = await getAgent(ctx.db, input.id);
		if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
		return agent;
	}),

	list: protectedProcedure
		.input(
			z
				.object({
					status: AgentStatusSchema.optional(),
					limit: z.number().int().min(1).max(100).optional(),
				})
				.optional(),
		)
		.query(async ({ input, ctx }) => {
			return listAgents(ctx.db, input);
		}),

	abort: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		const agent = await updateAgentStatus(ctx.db, input.id, "aborted", {
			actorId: ctx.session.userId,
			actorType: "human",
		});
		if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });

		ctx.bus.publish({
			id: newId(),
			source: "system",
			type: "agent.abort",
			payload: { agentId: agent.id },
			timestamp: new Date().toISOString(),
		});

		return agent;
	}),
});
