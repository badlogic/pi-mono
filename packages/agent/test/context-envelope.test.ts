import { getModel, type Message, type Tool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { describe, expect, test } from "vitest";
import type { ContextEnvelope } from "../src/context-envelope.js";
import { applyContextPatch, compileSystemPrompt } from "../src/context-envelope.js";

function msg(text: string, timestamp: number): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp };
}

describe("context envelope patch ops", () => {
	test("messages_uncached_append appends to uncached tail", () => {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const envelope: ContextEnvelope = {
			system: {
				parts: [{ name: "base", text: "SYSTEM" }],
				compiled: "SYSTEM",
			},
			tools: [],
			messages: {
				cached: [msg("a", 1)],
				uncached: [],
			},
			options: {},
			meta: {
				model,
				limit: model.contextWindow,
				turnIndex: 0,
				requestIndex: 0,
				signal: new AbortController().signal,
			},
		};

		const result = applyContextPatch(envelope, [
			{ op: "messages_uncached_append", scope: "uncached", messages: [msg("eph", 2)] },
		]);

		expect(result.envelope.messages.cached).toHaveLength(1);
		expect(result.envelope.messages.uncached).toHaveLength(1);
		expect(result.cacheInvalidated).toBe(false);
	});

	test("cached ops require invalidateCacheReason", () => {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const envelope: ContextEnvelope = {
			system: { parts: [{ name: "base", text: "SYSTEM" }], compiled: "SYSTEM" },
			tools: [],
			messages: { cached: [msg("a", 1)], uncached: [] },
			options: {},
			meta: {
				model,
				limit: model.contextWindow,
				turnIndex: 0,
				requestIndex: 0,
				signal: new AbortController().signal,
			},
		};

		expect(() =>
			applyContextPatch(envelope, [
				{
					op: "messages_cached_replace",
					scope: "cached",
					messages: [],
					invalidateCacheReason: "",
				},
			]),
		).toThrow(/invalidateCacheReason/);
	});

	test("system_part_set updates compiled prompt deterministically", () => {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const envelope: ContextEnvelope = {
			system: {
				parts: [
					{ name: "a", text: "A" },
					{ name: "b", text: "B" },
				],
				compiled: "AB",
			},
			tools: [],
			messages: { cached: [], uncached: [] },
			options: {},
			meta: {
				model,
				limit: model.contextWindow,
				turnIndex: 0,
				requestIndex: 0,
				signal: new AbortController().signal,
			},
		};

		const result = applyContextPatch(envelope, [
			{
				op: "system_part_set",
				scope: "cached",
				partName: "b",
				text: "BB",
				invalidateCacheReason: "update",
			},
		]);

		expect(result.envelope.system.compiled).toBe(compileSystemPrompt(result.envelope.system.parts));
		expect(result.envelope.system.compiled).toBe("ABB");
	});

	test("tools_remove filters tools by name", () => {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const t1: Tool = { name: "a", description: "a", parameters: Type.Object({}) };
		const t2: Tool = { name: "b", description: "b", parameters: Type.Object({}) };

		const envelope: ContextEnvelope = {
			system: { parts: [{ name: "base", text: "SYSTEM" }], compiled: "SYSTEM" },
			tools: [t1, t2],
			messages: { cached: [], uncached: [] },
			options: {},
			meta: {
				model,
				limit: model.contextWindow,
				turnIndex: 0,
				requestIndex: 0,
				signal: new AbortController().signal,
			},
		};

		const result = applyContextPatch(envelope, [
			{
				op: "tools_remove",
				scope: "cached",
				toolNames: ["b"],
				invalidateCacheReason: "gate tools",
			},
		]);

		expect(result.envelope.tools.map((t) => t.name)).toEqual(["a"]);
	});

	test("compaction_apply inserts summary + keeps tail", () => {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const envelope: ContextEnvelope = {
			system: { parts: [{ name: "base", text: "SYSTEM" }], compiled: "SYSTEM" },
			tools: [],
			messages: {
				cached: [msg("m0", 1), msg("m1", 2), msg("m2", 3)],
				uncached: [],
			},
			options: {},
			meta: {
				model,
				limit: model.contextWindow,
				turnIndex: 0,
				requestIndex: 0,
				signal: new AbortController().signal,
			},
		};

		const ts = 123;
		const result = applyContextPatch(envelope, [
			{
				op: "compaction_apply",
				scope: "cached",
				summary: "SUMMARY",
				timestamp: ts,
				firstKeptMessageIndex: 2,
				tokensBefore: 999,
				invalidateCacheReason: "compact",
			},
		]);

		expect(result.envelope.messages.cached).toHaveLength(1 + 1);
		expect(result.envelope.messages.cached[0]).toMatchObject({ role: "user", timestamp: ts });
		expect(result.envelope.messages.cached[1]).toMatchObject({ role: "user", timestamp: 3 });
	});
});
