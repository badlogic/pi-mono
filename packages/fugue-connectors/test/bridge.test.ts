import { InMemoryEventBus } from "@fugue/events";
import type { FugueEvent } from "@fugue/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { EventBridge } from "../src/bridge.js";
import { GitHubConnector } from "../src/github.js";

// ─── EventBridge ──────────────────────────────────────────────────────────────

describe("EventBridge", () => {
	let bus: InMemoryEventBus;
	let bridge: EventBridge;

	beforeEach(() => {
		bus = new InMemoryEventBus();
		bridge = new EventBridge(bus);
	});

	it("throws when ingesting an unregistered connector", () => {
		expect(() => bridge.ingest("unknown", {})).toThrow("No connector registered for source: unknown");
	});

	it("registers and lists connectors", () => {
		bridge.register(new GitHubConnector());
		expect(bridge.connectorNames).toContain("github");
	});

	it("publishes events produced by a connector", () => {
		bridge.register(new GitHubConnector());

		const received: FugueEvent[] = [];
		bus.subscribe((e) => received.push(e), "github.pr.opened");

		const count = bridge.ingest("github", {
			event: "pull_request",
			body: {
				action: "opened",
				number: 42,
				pull_request: {
					title: "feat: new thing",
					html_url: "https://github.com/org/repo/pull/42",
					state: "open",
					merged: false,
					user: { login: "alice" },
					head: { ref: "feature/new-thing" },
					base: { ref: "main" },
				},
				repository: { full_name: "org/repo" },
			},
		});

		expect(count).toBe(1);
		expect(received.length).toBe(1);
		expect(received[0]!.type).toBe("github.pr.opened");
		expect(received[0]!.payload.number).toBe(42);
	});
});

// ─── GitHubConnector ──────────────────────────────────────────────────────────

describe("GitHubConnector", () => {
	let connector: GitHubConnector;

	beforeEach(() => {
		connector = new GitHubConnector();
	});

	describe("push event", () => {
		it("transforms a push event with commits", () => {
			const events = connector.transform({
				event: "push",
				body: {
					ref: "refs/heads/main",
					repository: { full_name: "org/repo", html_url: "https://github.com/org/repo" },
					pusher: { name: "bob" },
					commits: [
						{
							id: "abc123",
							message: "fix: bug",
							url: "https://github.com/org/repo/commit/abc123",
							added: [],
							modified: ["src/index.ts"],
							removed: [],
						},
					],
				},
			});

			expect(events.length).toBe(1);
			expect(events[0]!.type).toBe("github.push");
			expect(events[0]!.payload.branch).toBe("main");
			expect(events[0]!.payload.commitCount).toBe(1);
			expect(events[0]!.source).toBe("connector:github");
		});

		it("returns empty array for push with no commits", () => {
			const events = connector.transform({ event: "push", body: { ref: "refs/heads/main", commits: [] } });
			expect(events).toEqual([]);
		});
	});

	describe("pull_request event", () => {
		it("transforms an opened PR", () => {
			const events = connector.transform({
				event: "pull_request",
				body: {
					action: "opened",
					number: 7,
					pull_request: {
						title: "Add feature",
						html_url: "https://github.com/org/repo/pull/7",
						state: "open",
						merged: false,
						user: { login: "carol" },
						head: { ref: "feature/x" },
						base: { ref: "main" },
					},
					repository: { full_name: "org/repo" },
				},
			});

			expect(events.length).toBe(1);
			expect(events[0]!.type).toBe("github.pr.opened");
			expect(events[0]!.payload.title).toBe("Add feature");
		});

		it("transforms a merged PR as github.pr.merged", () => {
			const events = connector.transform({
				event: "pull_request",
				body: {
					action: "closed",
					number: 8,
					pull_request: {
						title: "Merged PR",
						html_url: "https://github.com/org/repo/pull/8",
						state: "closed",
						merged: true,
						user: { login: "dave" },
						head: { ref: "feature/y" },
						base: { ref: "main" },
					},
					repository: { full_name: "org/repo" },
				},
			});

			expect(events.length).toBe(1);
			expect(events[0]!.type).toBe("github.pr.merged");
		});

		it("ignores uninteresting PR actions (e.g. review_requested)", () => {
			const events = connector.transform({
				event: "pull_request",
				body: { action: "review_requested", number: 9, pull_request: {}, repository: {} },
			});
			expect(events).toEqual([]);
		});
	});

	describe("issues event", () => {
		it("transforms an opened issue", () => {
			const events = connector.transform({
				event: "issues",
				body: {
					action: "opened",
					issue: {
						number: 5,
						title: "Something broke",
						html_url: "https://github.com/org/repo/issues/5",
						state: "open",
						user: { login: "eve" },
					},
					repository: { full_name: "org/repo" },
				},
			});

			expect(events.length).toBe(1);
			expect(events[0]!.type).toBe("github.issue.opened");
			expect(events[0]!.payload.number).toBe(5);
		});
	});

	describe("unknown events", () => {
		it("returns empty array for unknown event types", () => {
			const events = connector.transform({ event: "workflow_run", body: {} });
			expect(events).toEqual([]);
		});

		it("returns empty array for invalid payload shape", () => {
			const events = connector.transform("not-an-object");
			expect(events).toEqual([]);
		});
	});
});
