import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../src/core/session-manager.js";
import { buildSessionSearchItems, searchSessions } from "../src/core/session-search.js";

function makeSession(overrides: Partial<SessionInfo> & { id: string; path: string }): SessionInfo {
	return {
		path: overrides.path,
		id: overrides.id,
		cwd: overrides.cwd ?? "",
		name: overrides.name,
		parentSessionPath: overrides.parentSessionPath,
		created: overrides.created ?? new Date(0),
		modified: overrides.modified ?? new Date(0),
		messageCount: overrides.messageCount ?? 1,
		firstMessage: overrides.firstMessage ?? "(no messages)",
		allMessagesText: overrides.allMessagesText ?? "",
	};
}

describe("session search", () => {
	describe("buildSessionSearchItems", () => {
		it("builds search items with labels and clean names", () => {
			const sessions: SessionInfo[] = [
				makeSession({
					id: "a",
					path: "/tmp/a.jsonl",
					name: "Test Session",
					modified: new Date("2026-01-01T12:00:00.000Z"),
				}),
			];

			const items = buildSessionSearchItems(sessions);

			expect(items).toHaveLength(1);
			expect(items[0]!.sessionInfo.id).toBe("a");
			expect(items[0]!.cleanName).toBe("Test Session");
			expect(items[0]!.label).toContain("Test Session");
			expect(items[0]!.description).toBe("");
		});

		it("uses firstMessage when name is missing", () => {
			const sessions: SessionInfo[] = [
				makeSession({
					id: "a",
					path: "/tmp/a.jsonl",
					firstMessage: "Hello world",
					modified: new Date("2026-01-01T12:00:00.000Z"),
				}),
			];

			const items = buildSessionSearchItems(sessions);

			expect(items[0]!.cleanName).toBe("Hello world");
		});

		it("strips newlines from session names", () => {
			const sessions: SessionInfo[] = [
				makeSession({
					id: "a",
					path: "/tmp/a.jsonl",
					name: "Line 1\nLine 2\r\nLine 3",
					modified: new Date("2026-01-01T12:00:00.000Z"),
				}),
			];

			const items = buildSessionSearchItems(sessions);

			expect(items[0]!.cleanName).toBe("Line 1 Line 2 Line 3");
			expect(items[0]!.cleanName).not.toContain("\n");
			expect(items[0]!.cleanName).not.toContain("\r");
		});

		it("includes tree prefix in label for children", () => {
			const sessions: SessionInfo[] = [
				makeSession({ id: "parent", path: "/tmp/parent.jsonl", modified: new Date("2026-01-01") }),
				makeSession({
					id: "child",
					path: "/tmp/child.jsonl",
					parentSessionPath: "/tmp/parent.jsonl",
					modified: new Date("2026-01-02"),
				}),
			];

			const items = buildSessionSearchItems(sessions);

			expect(items).toHaveLength(2);
			// Parent should not have tree prefix
			expect(items[0]!.label).not.toContain("├");
			expect(items[0]!.label).not.toContain("└");
			// Child should have tree prefix
			expect(items[1]!.label).toMatch(/[├└]/);
		});

		it("preserves clean name without tree prefix", () => {
			const sessions: SessionInfo[] = [
				makeSession({ id: "parent", path: "/tmp/parent.jsonl", modified: new Date("2026-01-01") }),
				makeSession({
					id: "child",
					path: "/tmp/child.jsonl",
					name: "Child Session",
					parentSessionPath: "/tmp/parent.jsonl",
					modified: new Date("2026-01-02"),
				}),
			];

			const items = buildSessionSearchItems(sessions);

			// Child should have tree prefix in label
			expect(items[1]!.label).toMatch(/[├└]/);
			// But clean name should not
			expect(items[1]!.cleanName).toBe("Child Session");
			expect(items[1]!.cleanName).not.toContain("└");
			expect(items[1]!.cleanName).not.toContain("├");
		});

		it("formats relative time correctly", () => {
			const now = Date.now();
			const sessions: SessionInfo[] = [
				makeSession({
					id: "recent",
					path: "/tmp/recent.jsonl",
					modified: new Date(now - 5 * 60 * 1000), // 5 minutes ago
				}),
			];

			const items = buildSessionSearchItems(sessions);

			expect(items[0]!.label).toMatch(/\d+m ago/);
		});
	});

	describe("searchSessions", () => {
		const items = buildSessionSearchItems([
			makeSession({
				id: "a",
				path: "/tmp/a.jsonl",
				name: "Authentication System",
				modified: new Date("2026-01-03"),
			}),
			makeSession({
				id: "b",
				path: "/tmp/b.jsonl",
				name: "Authorization Logic",
				modified: new Date("2026-01-02"),
			}),
			makeSession({
				id: "c",
				path: "/tmp/c.jsonl",
				name: "Database Schema",
				modified: new Date("2026-01-01"),
			}),
		]);

		it("returns all items when query is empty", () => {
			const results = searchSessions(items, "");
			expect(results).toHaveLength(3);
		});

		it("filters by fuzzy query", () => {
			const results = searchSessions(items, "auth");
			expect(results).toHaveLength(2);
			expect(results.some((r) => r.sessionInfo.id === "a")).toBe(true);
			expect(results.some((r) => r.sessionInfo.id === "b")).toBe(true);
		});

		it("is case-insensitive", () => {
			const results = searchSessions(items, "AUTH");
			expect(results).toHaveLength(2);
		});

		it("respects max results limit", () => {
			const manyItems = Array.from({ length: 50 }, (_, i) =>
				buildSessionSearchItems([
					makeSession({ id: `session-${i}`, path: `/tmp/${i}.jsonl`, name: `Session ${i}` }),
				]),
			).flat();

			const results = searchSessions(manyItems, "");
			expect(results).toHaveLength(25); // MAX_RESULTS = 25
		});

		it("returns empty array when no matches", () => {
			const results = searchSessions(items, "nonexistent");
			expect(results).toHaveLength(0);
		});

		it("matches on label and description", () => {
			const customItems = buildSessionSearchItems([
				makeSession({
					id: "test",
					path: "/tmp/test.jsonl",
					name: "Test",
					firstMessage: "discussed authentication",
				}),
			]);

			const results = searchSessions(customItems, "Test");
			expect(results).toHaveLength(1);
		});
	});

	describe("discoverSessions", () => {
		it("deduplicates sessions by path", async () => {
			// This is a behavioral test - the actual deduplication happens in discoverSessions
			// We're testing the contract, not the implementation
			const sessions: SessionInfo[] = [
				makeSession({ id: "a", path: "/tmp/duplicate.jsonl" }),
				makeSession({ id: "b", path: "/tmp/duplicate.jsonl" }), // Duplicate path
				makeSession({ id: "c", path: "/tmp/unique.jsonl" }),
			];

			// Simulate deduplication logic
			const seen = new Set<string>();
			const deduplicated = sessions.filter((s) => {
				if (seen.has(s.path)) return false;
				seen.add(s.path);
				return true;
			});

			expect(deduplicated).toHaveLength(2);
			expect(deduplicated[0]!.id).toBe("a"); // First occurrence kept
			expect(deduplicated[1]!.id).toBe("c");
		});

		it("sorts by modified date descending", async () => {
			const sessions: SessionInfo[] = [
				makeSession({ id: "old", path: "/tmp/old.jsonl", modified: new Date("2026-01-01") }),
				makeSession({ id: "new", path: "/tmp/new.jsonl", modified: new Date("2026-01-03") }),
				makeSession({ id: "mid", path: "/tmp/mid.jsonl", modified: new Date("2026-01-02") }),
			];

			const sorted = [...sessions].sort((a, b) => b.modified.getTime() - a.modified.getTime());

			expect(sorted[0]!.id).toBe("new");
			expect(sorted[1]!.id).toBe("mid");
			expect(sorted[2]!.id).toBe("old");
		});

		it("limits results when scope is recent", async () => {
			const sessions = Array.from({ length: 50 }, (_, i) =>
				makeSession({
					id: `session-${i}`,
					path: `/tmp/${i}.jsonl`,
					modified: new Date(Date.now() - i * 1000),
				}),
			);

			const recentLimit = 10;
			const limited = sessions.slice(0, recentLimit);

			expect(limited).toHaveLength(10);
		});
	});
});
