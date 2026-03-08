import { describe, expect, it } from "vitest";

import { __testing } from "../addons-extensions/subagent.js";

describe("subagent tmux helpers", () => {
	it("builds a linked launch plan when already inside tmux", () => {
		expect(__testing.buildTmuxLaunchPlan("pi-subagent-7", "main")).toEqual({
			session: "pi-subagent-7",
			linkedSession: "main",
		});
	});

	it("always links subagents into the current tmux session when pi is already inside tmux", () => {
		expect(__testing.shouldLinkSubagentTmuxWindow("/tmp/project", "main")).toBe(true);
	});

	it("does not link back into the dedicated session", () => {
		expect(__testing.buildTmuxLaunchPlan("pi-subagent-7", "pi-subagent-7")).toEqual({
			session: "pi-subagent-7",
			linkedSession: undefined,
		});
	});

	it("does not link into the current tmux session when the setting disables it", () => {
		expect(__testing.buildTmuxLaunchPlan("pi-subagent-7", "main", false)).toEqual({
			session: "pi-subagent-7",
			linkedSession: undefined,
		});
	});

	it("prefers the linked session when listing window targets", () => {
		expect(
			__testing.listTmuxWindowTargets({
				tmuxSession: "pi-subagent-7",
				tmuxLinkedSession: "main",
				tmuxWindow: "sub-7",
			}),
		).toEqual(["main:sub-7", "pi-subagent-7:sub-7"]);
	});

	it("routes /sub-attach to the linked session but keeps the dedicated attach target", () => {
		expect(
			__testing.resolveTmuxAttachTarget(
				{
					tmuxSession: "pi-subagent-7",
					tmuxLinkedSession: "main",
					tmuxWindow: "sub-7",
				},
				"main",
			),
		).toEqual({
			session: "main",
			windowTarget: "main:sub-7",
			attachSession: "pi-subagent-7",
		});
	});

	it("falls back to the dedicated session when no linked session exists", () => {
		expect(
			__testing.resolveTmuxAttachTarget(
				{
					tmuxSession: "pi-subagent-7",
					tmuxLinkedSession: undefined,
					tmuxWindow: "sub-7",
				},
				"main",
			),
		).toEqual({
			session: "pi-subagent-7",
			windowTarget: "pi-subagent-7:sub-7",
			attachSession: "pi-subagent-7",
		});
	});
});
