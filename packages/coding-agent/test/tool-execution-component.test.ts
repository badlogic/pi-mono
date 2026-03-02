import { Text, type TUI } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import stripAnsi from "strip-ansi";
import { beforeAll, describe, expect, test } from "vitest";
import type { ToolDefinition } from "../src/core/extensions/types.js";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function createBaseToolDefinition(): ToolDefinition {
	return {
		name: "custom_tool",
		label: "custom_tool",
		description: "custom tool",
		parameters: Type.Any(),
		execute: async () => ({
			content: [{ type: "text", text: "ok" }],
			details: {},
		}),
	};
}

function createFakeTui(): TUI {
	return {
		requestRender: () => {},
	} as unknown as TUI;
}

describe("ToolExecutionComponent custom renderer suppression", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("renders no lines when custom renderers return undefined", () => {
		const toolDefinition: ToolDefinition = {
			...createBaseToolDefinition(),
			renderCall: () => undefined,
			renderResult: () => undefined,
		};

		const component = new ToolExecutionComponent("custom_tool", {}, {}, toolDefinition, createFakeTui());
		expect(component.render(120)).toEqual([]);

		component.updateResult(
			{
				content: [{ type: "text", text: "hidden" }],
				details: {},
				isError: false,
			},
			false,
		);

		expect(component.render(120)).toEqual([]);
	});

	test("keeps built-in tool rendering visible", () => {
		const component = new ToolExecutionComponent("read", { path: "README.md" }, {}, undefined, createFakeTui());
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("read");
	});

	test("keeps custom tool rendering visible when renderer returns a component", () => {
		const toolDefinition: ToolDefinition = {
			...createBaseToolDefinition(),
			renderCall: () => new Text("custom call", 0, 0),
			renderResult: () => undefined,
		};

		const component = new ToolExecutionComponent("custom_tool", {}, {}, toolDefinition, createFakeTui());
		const rendered = stripAnsi(component.render(120).join("\n"));
		expect(rendered).toContain("custom call");
	});
});
