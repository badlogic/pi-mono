import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
	normalizeRpcLabel,
	toRpcNavigateTreeResult,
	toRpcSessionListItem,
} from "../src/modes/rpc/rpc-command-wiring.js";

describe("toRpcSessionListItem", () => {
	const sample = {
		path: "/tmp/s.jsonl",
		id: "session-id",
		cwd: "/tmp",
		name: "sample",
		parentSessionPath: "/tmp/parent.jsonl",
		created: new Date("2026-01-01T00:00:00.000Z"),
		modified: new Date("2026-01-01T00:01:00.000Z"),
		messageCount: 3,
		firstMessage: "hello",
		allMessagesText: "hello world",
	};

	test("always includes allMessagesText", () => {
		const item = toRpcSessionListItem(sample);
		expect(item.allMessagesText).toBe("hello world");
	});

	test("normalizes path and date fields for rpc transport", () => {
		const item = toRpcSessionListItem({ ...sample, path: "relative/session.jsonl" });

		expect(item.path).toBe(resolve("relative/session.jsonl"));
		expect(item.created).toBe(sample.created.toISOString());
		expect(item.modified).toBe(sample.modified.toISOString());
	});

	test("falls back to epoch timestamp for invalid dates", () => {
		const invalidDate = new Date("invalid-date");
		const item = toRpcSessionListItem({ ...sample, created: invalidDate, modified: invalidDate });

		expect(item.created).toBe("1970-01-01T00:00:00.000Z");
		expect(item.modified).toBe("1970-01-01T00:00:00.000Z");
	});
});

describe("toRpcNavigateTreeResult", () => {
	test("maps summary metadata to rpc shape", () => {
		const result = toRpcNavigateTreeResult({
			cancelled: false,
			editorText: "draft",
			summaryEntry: {
				id: "summary-1",
				summary: "summary text",
				fromHook: true,
			},
		});

		expect(result.editorText).toBe("draft");
		expect(result.summaryEntry?.fromExtension).toBe(true);
	});

	test("maps missing fromHook to false for stable transport semantics", () => {
		const result = toRpcNavigateTreeResult({
			cancelled: false,
			summaryEntry: {
				id: "summary-2",
				summary: "summary text",
			},
		});

		expect(result.summaryEntry?.fromExtension).toBe(false);
	});

	test("preserves cancelled/aborted navigation states", () => {
		const result = toRpcNavigateTreeResult({ cancelled: true, aborted: true });

		expect(result.cancelled).toBe(true);
		expect(result.aborted).toBe(true);
		expect(result.summaryEntry).toBeUndefined();
	});
});

describe("normalizeRpcLabel", () => {
	test("trims and preserves valid labels", () => {
		expect(normalizeRpcLabel("  checkpoint  ")).toBe("checkpoint");
	});

	test("normalizes empty string to undefined", () => {
		expect(normalizeRpcLabel("")).toBeUndefined();
	});

	test("normalizes whitespace-only to undefined", () => {
		expect(normalizeRpcLabel("   ")).toBeUndefined();
	});

	test("passes through undefined", () => {
		expect(normalizeRpcLabel(undefined)).toBeUndefined();
	});
});
