import { initTRPC, TRPCError } from "@trpc/server";
import type { AppContext } from "./context.js";

const t = initTRPC.context<AppContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.session) {
		throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
	}
	return next({ ctx: { ...ctx, session: ctx.session } });
});
