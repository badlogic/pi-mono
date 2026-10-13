// INV-1 tool-group.ts: folding hides every child row, including images, without resetting output.
// INV-2 tool-execution.ts: summary status follows partial/final results, not a second state store.
// INV-3 tool-group.ts: summaries fit narrow widths and clicks affect only their own group.
// Revert tool-group.ts -> INV-1/3 fail; revert tool-execution.ts -> INV-2 fails.
import {
	resetCapabilitiesCache,
	setCapabilities,
	Text,
	type TUI,
	type TuiMouseEvent,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { ToolGroupComponent } from "../src/modes/interactive/components/tool-group.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
function tool(name: string, id = name) {
	return new ToolExecutionComponent(
		name,
		id,
		{},
		{},
		{
			renderCall: () => new Text(`call ${id}`, 0, 0),
			renderResult: (_result, _options, _theme, context) =>
				new Text(
					`${context.expanded ? "full output" : "preview"} pad=${context.outputPad} images=${context.showImages}`,
					0,
					0,
				),
		},
		{ requestRender: vi.fn() } as unknown as TUI,
		process.cwd(),
	);
}
function click(y = 0): TuiMouseEvent {
	return {
		type: "click",
		button: "left",
		x: 2,
		y,
		screenX: 2,
		screenY: y,
		width: 100,
		height: 20,
		shift: false,
		alt: false,
		ctrl: false,
		clickCount: 1,
	};
}

describe("ToolGroupComponent", () => {
	beforeEach(() => initTheme("dark"));
	afterEach(() => resetCapabilitiesCache());

	test("derives counts and running/error status from original children", () => {
		const group = new ToolGroupComponent();
		const first = tool("read", "one");
		const second = tool("read", "two");
		const shell = tool("bash");
		for (const child of [first, second, shell]) group.addTool(child);
		first.updateResult({ content: [], isError: false });
		second.updateResult({ content: [], isError: true });
		shell.updateResult({ content: [], isError: false }, true);
		const summary = stripAnsi(group.render(100)[0]);
		expect(summary).toContain("3 tools");
		expect(summary).toContain("read ×2");
		expect(summary).toContain("bash ×1");
		expect(summary).toContain("1 running");
		expect(summary).toContain("1 error");
		shell.updateResult({ content: [], isError: false });
		expect(stripAnsi(group.render(100)[0])).not.toContain("running");
		expect(first.getStatus()).toBe("success");
		expect(second.getStatus()).toBe("error");
	});

	test("one call uses the singular label and unstarted arguments are pending, not running", () => {
		const group = new ToolGroupComponent();
		const child = tool("read");
		group.addTool(child);
		child.updateArgs({ path: "partial" });
		child.setArgsComplete();
		expect(child.getStatus()).toBe("pending");
		const summary = stripAnsi(group.render(100)[0]);
		expect(summary).toContain("1 tool ·");
		expect(summary).not.toContain("1 tools");
		expect(summary).toContain("1 pending");
		expect(summary).not.toContain("running");
		child.updateResult({ content: [{ type: "text", text: "Operation aborted" }], isError: true });
		expect(stripAnsi(group.render(100)[0])).toContain("1 error");
		expect(stripAnsi(group.render(100)[0])).not.toContain("pending");
	});

	test("summary refreshes on start, partial, and final results without group invalidation", () => {
		const group = new ToolGroupComponent();
		const child = tool("bash");
		group.addTool(child);
		expect(stripAnsi(group.render(100)[0])).toContain("1 pending");
		child.markExecutionStarted();
		expect(stripAnsi(group.render(100)[0])).toContain("1 running");
		child.updateResult({ content: [{ type: "text", text: "partial output" }], isError: false }, true);
		expect(stripAnsi(group.render(100)[0])).toContain("1 running");
		child.updateResult({ content: [{ type: "text", text: "command failed" }], isError: true });
		const failed = stripAnsi(group.render(100)[0]);
		expect(failed).toContain("1 error");
		expect(failed).not.toContain("running");
		expect(failed).not.toContain("pending");
	});

	test("shows done only when every child completed successfully", () => {
		const group = new ToolGroupComponent();
		const first = tool("read");
		const second = tool("bash");
		group.addTool(first);
		group.addTool(second);
		first.updateResult({ content: [], isError: false });
		expect(stripAnsi(group.render(100)[0])).not.toContain("done");
		second.markExecutionStarted();
		expect(stripAnsi(group.render(100)[0])).not.toContain("done");
		second.updateResult({ content: [], isError: false });
		expect(stripAnsi(group.render(100)[0])).toContain("2 tools · done ·");
		second.updateResult({ content: [], isError: true });
		expect(stripAnsi(group.render(100)[0])).not.toContain("done");
	});

	test("collapsed output is exactly one width-truncated line even with wide names", () => {
		const group = new ToolGroupComponent();
		group.addTool(tool("長い名前".repeat(20)));
		for (const width of [0, 1, 2, 8, 20, 80]) {
			const lines = group.render(width);
			expect(lines).toHaveLength(1);
			expect(visibleWidth(lines[0])).toBeLessThanOrEqual(width);
		}
	});

	test("folding and reopening preserves child output, renderer state, and image identity", () => {
		setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
		const group = new ToolGroupComponent();
		const child = tool("custom");
		child.updateResult({ content: [{ type: "image", data: PNG, mimeType: "image/png" }], isError: false });
		child.setExpanded(true);
		group.addTool(child);
		group.setExpanded(true);
		const expanded = group.render(100).join("\n");
		expect(expanded).toContain("\x1b_G");
		expect(stripAnsi(expanded)).toContain("full output");
		group.setExpanded(false);
		expect(group.render(100).join("\n")).not.toContain("\x1b_G");
		group.invalidate();
		group.setExpanded(true);
		expect(group.render(100).join("\n")).toBe(expanded);
	});

	test("padding and image settings reach children while folded", () => {
		const group = new ToolGroupComponent();
		const child = tool("read");
		child.updateResult({ content: [], isError: false });
		group.addTool(child);
		group.setOutputPad(0);
		group.setShowImages(false);
		group.setImageWidthCells(12);
		expect(group.expanded).toBe(false);
		group.setExpanded(true);
		expect(stripAnsi(group.render(100).join("\n"))).toContain("pad=0 images=false");
	});

	test("summary clicks toggle only the group and expanded child clicks still change output", () => {
		const group = new ToolGroupComponent();
		const other = new ToolGroupComponent();
		const child = tool("read");
		child.updateResult({ content: [], isError: false });
		group.addTool(child);
		other.addTool(tool("other"));
		expect(group.handleMouse(click())?.handled).toBe(true);
		expect(group.expanded).toBe(true);
		expect(other.expanded).toBe(false);
		const lines = group.render(100);
		const row = lines.findIndex((line) => stripAnsi(line).includes("preview"));
		expect(group.handleMouse({ ...click(row), height: lines.length })?.handled).toBe(true);
		expect(stripAnsi(group.render(100).join("\n"))).toContain("full output");
		group.handleMouse(click());
		group.handleMouse(click());
		expect(stripAnsi(group.render(100).join("\n"))).toContain("full output");
	});
});
