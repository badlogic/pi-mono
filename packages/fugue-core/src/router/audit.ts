import { queryAuditLog } from "@fugue/graph";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc.js";

export const auditRouter = router({
	query: protectedProcedure
		.input(
			z
				.object({
					actorId: z.string().optional(),
					targetId: z.string().optional(),
					action: z.string().optional(),
					limit: z.number().int().min(1).max(500).optional(),
				})
				.optional(),
		)
		.query(async ({ input, ctx }) => {
			return queryAuditLog(ctx.db, input);
		}),
});
