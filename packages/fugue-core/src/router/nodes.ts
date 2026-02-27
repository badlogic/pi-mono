import {
	archiveNode,
	createEdge,
	createNode,
	deleteEdge,
	findAncestors,
	getEdgesBetween,
	getEdgesFrom,
	getEdgesTo,
	getNode,
	listNodes,
	traverseFrom,
	updateNode,
} from "@fugue/graph";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc.js";

const NodeTypeSchema = z.enum([
	"idea",
	"decision",
	"assumption",
	"finding",
	"metric",
	"event",
	"investigation",
	"competition",
	"deployment",
]);

const EdgeTypeSchema = z.enum([
	"builds_on",
	"challenges",
	"supports",
	"decided_by",
	"measures",
	"spawned",
	"investigates",
	"competes_in",
	"triggered_by",
]);

const NodeStatusSchema = z.enum(["active", "archived", "stale"]);

export const nodesRouter = router({
	create: protectedProcedure
		.input(
			z.object({
				type: NodeTypeSchema,
				title: z.string().min(1).max(500),
				content: z.record(z.unknown()).optional(),
				authorType: z.enum(["human", "agent"]).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return createNode(
				ctx.db,
				{
					type: input.type,
					title: input.title,
					content: input.content,
					authorId: ctx.session.userId,
					authorType: input.authorType,
				},
				{
					actorId: ctx.session.userId,
					actorType: "human",
				},
			);
		}),

	get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
		const node = await getNode(ctx.db, input.id);
		if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "Node not found" });
		return node;
	}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				title: z.string().min(1).max(500).optional(),
				content: z.record(z.unknown()).optional(),
				status: NodeStatusSchema.optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			const { id, ...updates } = input;
			const node = await updateNode(ctx.db, id, updates, {
				actorId: ctx.session.userId,
				actorType: "human",
			});
			if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "Node not found" });
			return node;
		}),

	archive: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		const node = await archiveNode(ctx.db, input.id, {
			actorId: ctx.session.userId,
			actorType: "human",
		});
		if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "Node not found" });
		return node;
	}),

	list: protectedProcedure
		.input(
			z
				.object({
					type: NodeTypeSchema.optional(),
					authorId: z.string().optional(),
					status: NodeStatusSchema.optional(),
					limit: z.number().int().min(1).max(500).optional(),
					offset: z.number().int().min(0).optional(),
				})
				.optional(),
		)
		.query(async ({ input, ctx }) => {
			return listNodes(ctx.db, input);
		}),

	edgesFrom: protectedProcedure.input(z.object({ sourceId: z.string() })).query(async ({ input, ctx }) => {
		return getEdgesFrom(ctx.db, input.sourceId);
	}),

	edgesTo: protectedProcedure.input(z.object({ targetId: z.string() })).query(async ({ input, ctx }) => {
		return getEdgesTo(ctx.db, input.targetId);
	}),

	edgesBetween: protectedProcedure
		.input(z.object({ nodeAId: z.string(), nodeBId: z.string() }))
		.query(async ({ input, ctx }) => {
			return getEdgesBetween(ctx.db, input.nodeAId, input.nodeBId);
		}),

	createEdge: protectedProcedure
		.input(
			z.object({
				sourceId: z.string(),
				targetId: z.string(),
				type: EdgeTypeSchema,
				metadata: z.record(z.unknown()).optional(),
			}),
		)
		.mutation(async ({ input, ctx }) => {
			return createEdge(
				ctx.db,
				{
					sourceId: input.sourceId,
					targetId: input.targetId,
					type: input.type,
					metadata: input.metadata,
					authorId: ctx.session.userId,
				},
				{ actorId: ctx.session.userId, actorType: "human" },
			);
		}),

	deleteEdge: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
		const deleted = await deleteEdge(ctx.db, input.id, {
			actorId: ctx.session.userId,
			actorType: "human",
		});
		if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Edge not found" });
		return { deleted: true };
	}),

	traverse: protectedProcedure
		.input(
			z.object({
				startId: z.string(),
				maxDepth: z.number().int().min(1).max(10).optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			return traverseFrom(ctx.pool, input.startId, input.maxDepth);
		}),

	ancestors: protectedProcedure
		.input(
			z.object({
				nodeId: z.string(),
				maxDepth: z.number().int().min(1).max(10).optional(),
			}),
		)
		.query(async ({ input, ctx }) => {
			return findAncestors(ctx.pool, input.nodeId, input.maxDepth);
		}),
});
