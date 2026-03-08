import type { TUI } from "@mariozechner/pi-tui";
import stripAnsi from "strip-ansi";
import { beforeAll, describe, expect, test } from "vitest";
import { BashExecutionComponent } from "../src/modes/interactive/components/bash-execution.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function createFakeTui(): TUI {
	return {
		requestRender: () => {},
		terminal: { columns: 80 },
	} as unknown as TUI;
}

describe("BashExecutionComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("renders oh-my-pi style bash header", () => {
		const component = new BashExecutionComponent("git status", createFakeTui());
		component.setComplete(0, false);
		const rendered = stripAnsi(component.render(80).join("\n"));
		expect(rendered).toContain("Bash: $ git status");
	});

	test("shows execution duration when bash completes", () => {
		const component = new BashExecutionComponent("git status", createFakeTui());
		component.setComplete(0, false, undefined, undefined, 1250);
		const rendered = stripAnsi(component.render(80).join("\n"));
		expect(rendered).toContain("1.3s");
	});

	test("clamps extremely long bash output lines", () => {
		const component = new BashExecutionComponent("printf", createFakeTui());
		component.appendOutput("x".repeat(4505));
		component.setComplete(0, false);
		const rendered = stripAnsi(component.render(80).join("\n"));
		expect(rendered).toContain("[505 chars omitted]");
	});
});
