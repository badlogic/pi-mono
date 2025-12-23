/**
 * Verify the documentation example from hooks.md compiles and works.
 */

import { describe, expect, it } from "vitest";
import type { HookAPI } from "../src/core/hooks/index.js";
import type { CompactionEntry } from "../src/core/session-manager.js";

describe("Documentation example", () => {
	it("custom compaction example should type-check correctly", () => {
		// This is the example from hooks.md - verify it compiles
		const exampleHook = (pi: HookAPI) => {
			pi.on("session", async (event, _ctx) => {
				if (event.reason !== "before_compact") return;

				// After narrowing, these should all be accessible
				const messages = event.messagesToSummarize;
				const cutPoint = event.cutPoint;
				const tokensBefore = event.tokensBefore;
				const model = event.model;
				const apiKey = event.apiKey;

				// Verify types
				expect(Array.isArray(messages)).toBe(true);
				expect(typeof cutPoint.firstKeptEntryIndex).toBe("number");
				expect(typeof tokensBefore).toBe("number");
				expect(model).toBeDefined();
				expect(typeof apiKey).toBe("string");

				const summary = messages
					.filter((m) => m.role === "user")
					.map((m) => `- ${typeof m.content === "string" ? m.content.slice(0, 100) : "[complex]"}`)
					.join("\n");

				const compactionEntry: CompactionEntry = {
					type: "compaction",
					timestamp: new Date().toISOString(),
					summary: `User requests:\n${summary}`,
					firstKeptEntryIndex: event.cutPoint.firstKeptEntryIndex,
					tokensBefore: event.tokensBefore,
				};

				return { compactionEntry };
			});
		};

		// Just verify the function exists and is callable
		expect(typeof exampleHook).toBe("function");
	});

	it("compact event should have correct fields after narrowing", () => {
		const checkCompactEvent = (pi: HookAPI) => {
			pi.on("session", async (event, _ctx) => {
				if (event.reason !== "compact") return;

				// After narrowing, these should all be accessible
				const entry = event.compactionEntry;
				const tokensBefore = event.tokensBefore;
				const fromHook = event.fromHook;

				expect(entry.type).toBe("compaction");
				expect(typeof entry.summary).toBe("string");
				expect(typeof tokensBefore).toBe("number");
				expect(typeof fromHook).toBe("boolean");
			});
		};

		expect(typeof checkCompactEvent).toBe("function");
	});
});
