import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../src/core/session-manager.js";
import { filterAndSortSessions } from "../src/modes/interactive/components/session-selector-search.js";

function makeSession(
	overrides: Partial<SessionInfo> & { id: string; modified: Date; allMessagesText: string },
): SessionInfo {
	return {
		path: `/tmp/${overrides.id}.jsonl`,
		id: overrides.id,
		cwd: overrides.cwd ?? "",
		name: overrides.name,
		created: overrides.created ?? new Date(0),
		modified: overrides.modified,
		messageCount: overrides.messageCount ?? 1,
		firstMessage: overrides.firstMessage ?? "(no messages)",
		allMessagesText: overrides.allMessagesText,
	};
}

describe("session selector search", () => {
	it("filters by quoted phrase with whitespace normalization", () => {
		const sessions: SessionInfo[] = [
			makeSession({
				id: "a",
				modified: new Date("2026-01-01T00:00:00.000Z"),
				allMessagesText: "node\n\n   cve was discussed",
			}),
			makeSession({
				id: "b",
				modified: new Date("2026-01-02T00:00:00.000Z"),
				allMessagesText: "node something else",
			}),
		];

		const result = filterAndSortSessions(sessions, '"node cve"', "recent");
		expect(result.map((s) => s.id)).toEqual(["a"]);
	});

	it("filters by regex (re:) and is case-insensitive", () => {
		const sessions: SessionInfo[] = [
			makeSession({
				id: "a",
				modified: new Date("2026-01-02T00:00:00.000Z"),
				allMessagesText: "Brave is great",
			}),
			makeSession({
				id: "b",
				modified: new Date("2026-01-03T00:00:00.000Z"),
				allMessagesText: "bravery is not the same",
			}),
		];

		const result = filterAndSortSessions(sessions, "re:\\bbrave\\b", "recent");
		expect(result.map((s) => s.id)).toEqual(["a"]);
	});

	it("recent sort preserves input order", () => {
		const sessions: SessionInfo[] = [
			makeSession({
				id: "newer",
				modified: new Date("2026-01-03T00:00:00.000Z"),
				allMessagesText: "brave",
			}),
			makeSession({
				id: "older",
				modified: new Date("2026-01-01T00:00:00.000Z"),
				allMessagesText: "brave",
			}),
			makeSession({
				id: "nomatch",
				modified: new Date("2026-01-04T00:00:00.000Z"),
				allMessagesText: "something else",
			}),
		];

		const result = filterAndSortSessions(sessions, '"brave"', "recent");
		expect(result.map((s) => s.id)).toEqual(["newer", "older"]);
	});

	it("relevance sort orders by score and tie-breaks by modified desc", () => {
		const sessions: SessionInfo[] = [
			makeSession({
				id: "late",
				modified: new Date("2026-01-03T00:00:00.000Z"),
				allMessagesText: "xxxx brave",
			}),
			makeSession({
				id: "early",
				modified: new Date("2026-01-01T00:00:00.000Z"),
				allMessagesText: "brave xxxx",
			}),
		];

		const result1 = filterAndSortSessions(sessions, '"brave"', "relevance");
		expect(result1.map((s) => s.id)).toEqual(["early", "late"]);

		const tieSessions: SessionInfo[] = [
			makeSession({
				id: "newer",
				modified: new Date("2026-01-03T00:00:00.000Z"),
				allMessagesText: "brave",
			}),
			makeSession({
				id: "older",
				modified: new Date("2026-01-01T00:00:00.000Z"),
				allMessagesText: "brave",
			}),
		];

		const result2 = filterAndSortSessions(tieSessions, '"brave"', "relevance");
		expect(result2.map((s) => s.id)).toEqual(["newer", "older"]);
	});

	it("returns empty list for invalid regex", () => {
		const sessions: SessionInfo[] = [
			makeSession({
				id: "a",
				modified: new Date("2026-01-01T00:00:00.000Z"),
				allMessagesText: "brave",
			}),
		];

		const result = filterAndSortSessions(sessions, "re:(", "recent");
		expect(result).toEqual([]);
	});
});
