import { stripVTControlCharacters } from "node:util";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Component, Text, type TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolRenderContext } from "../src/core/extensions/types.ts";
import { codemodeRenderers } from "../src/extensions/codemode/renderer.ts";
import type { CodemodeToolDetails } from "../src/extensions/codemode/tool.ts";
import { keyHint } from "../src/modes/interactive/components/keybinding-hints.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { VisualLinePreview } from "../src/modes/interactive/components/visual-truncate.ts";
import * as themeModule from "../src/modes/interactive/theme/theme.ts";
import { highlightCode, initTheme, type Theme, theme } from "../src/modes/interactive/theme/theme.ts";
import { getHighlightLanguageCount, loadAllHighlightLanguages } from "../src/utils/syntax-highlight.ts";

function render(
	result: AgentToolResult<CodemodeToolDetails | undefined>,
	isError = false,
	expanded = true,
	width = 200,
): string {
	const context = {
		args: { code: "" },
		toolCallId: "call",
		invalidate: () => {},
		lastComponent: undefined,
		state: {},
		cwd: "/",
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded,
		showImages: false,
		isError,
		durationMs: undefined,
		outputPad: 1,
	} satisfies ToolRenderContext;
	const component = codemodeRenderers.renderResult?.(
		result,
		{ expanded, isPartial: false },
		theme,
		context,
	) as Component;
	return stripVTControlCharacters(component.render(width).join("\n"))
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.trim();
}

function callContext(expanded = false): ToolRenderContext<Record<string, unknown>, { code?: unknown }> {
	return {
		args: {},
		toolCallId: "call",
		invalidate: () => {},
		lastComponent: undefined,
		state: {},
		cwd: "/",
		executionStarted: false,
		argsComplete: false,
		isPartial: true,
		expanded,
		showImages: false,
		isError: false,
		durationMs: undefined,
		outputPad: 1,
	};
}

function renderCall(
	code: unknown,
	context: ReturnType<typeof callContext>,
	width = 80,
	callTheme: Theme = theme,
): string[] {
	context.args = { code };
	const component = codemodeRenderers.renderCall?.(context.args, callTheme, context) as Component;
	context.lastComponent = component;
	return component.render(width);
}

describe("codemode renderer", () => {
	beforeAll(() => initTheme("dark"));
	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
		initTheme("dark");
	});

	it("refreshes embedded syntax coloring after deferred grammars load", async () => {
		const spy = vi.spyOn(themeModule, "highlightCode");
		const context = callContext(true);
		const code = 'const markup = html`<div class="x">ok</div>`;\nconst sheet = css`div { color: red; }`;';
		const initialCount = getHighlightLanguageCount();
		const initial = renderCall(code, context);
		await loadAllHighlightLanguages();
		expect(getHighlightLanguageCount()).toBeGreaterThan(initialCount);
		const loaded = renderCall(code, context);
		expect(loaded).not.toEqual(initial);
		expect(spy).toHaveBeenCalledTimes(2);
		expect(loaded).toEqual([
			...renderCall("", callContext(true)),
			...new Text(highlightCode(code, "javascript").join("\n"), 0, 0).render(80),
		]);
		expect(renderCall(code, context)).toEqual(loaded);
		expect(spy).toHaveBeenCalledTimes(3); // The explicit fresh-highlight reference adds one call.
	});

	it("highlights unchanged scripts once across redraws, resizing and expansion", () => {
		const spy = vi.spyOn(themeModule, "highlightCode");
		const context = callContext();
		const code = Array.from({ length: 30 }, (_, i) => `const value${i} = ${i};`).join("\n");
		const original = renderCall(code, context);
		expect(renderCall(code, context)).toEqual(original);
		renderCall(code, context, 20);
		context.expanded = true;
		const expanded = renderCall(code, context);
		expect(stripVTControlCharacters(expanded.join("\n"))).toContain("const value29 = 29;");
		context.expanded = false;
		expect(renderCall(code, context)).toEqual(original);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it("preserves exact full-source syntax coloring and wrapped preview counts", () => {
		const code =
			'// @options: {"max_output_tokens": 2000}\r\n\tconst value = `你好 😀\n' +
			Array.from({ length: 20 }, (_, i) => `nested ${i}: ${"x".repeat(30)}`).join("\n") +
			"\n`;\n/* comment\ncontinued */\nconst fn = (a, b) => a + b;\n  ";
		const normalized = code.replace(/\r/g, "").trimEnd().replace(/\t/g, "   ");
		const highlighted = highlightCode(normalized, "javascript").join("\n");
		for (const width of [1, 10, 40, 200]) {
			const context = callContext(true);
			expect(renderCall(code, context, width)).toEqual([
				...renderCall("", callContext(true), width),
				...new Text(highlighted, 0, 0).render(width),
			]);
			context.expanded = false;
			const preview = new VisualLinePreview({
				text: highlighted,
				maxVisualLines: 10,
				keep: "start",
				formatHint: (hidden) =>
					`${theme.fg("muted", `... (${hidden} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`,
			});
			expect(renderCall(code, context, width)).toEqual([
				...renderCall("", callContext(), width),
				...preview.render(width),
			]);
		}
	});

	it("rehighlights changed arguments while keeping each tool row independent", () => {
		const spy = vi.spyOn(themeModule, "highlightCode");
		const first = callContext(true);
		const second = callContext(true);
		renderCall("const value = 1;", first);
		const changed = renderCall("const value = 2;", first);
		expect(stripVTControlCharacters(changed.join("\n"))).toContain("const value = 2;");
		expect(stripVTControlCharacters(changed.join("\n"))).not.toContain("const value = 1;");
		renderCall("const value = 2;", second);
		renderCall("const value = 2;", first);
		expect(spy).toHaveBeenCalledTimes(3);
	});

	it("refreshes syntax colors when the global theme changes behind the same proxy", () => {
		const spy = vi.spyOn(themeModule, "highlightCode");
		const context = callContext(true);
		const code = 'const value = "hello"; // note';
		const dark = renderCall(code, context);
		initTheme("light");
		const light = renderCall(code, context);
		expect(light).not.toEqual(dark);
		expect(stripVTControlCharacters(light.join("\n"))).toEqual(stripVTControlCharacters(dark.join("\n")));
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it("clears old highlighting for empty, missing and invalid code", () => {
		for (const empty of ["", null, undefined, 123, {}]) {
			const spy = vi.spyOn(themeModule, "highlightCode");
			const context = callContext(true);
			renderCall("const value = 1;", context);
			const cleared = stripVTControlCharacters(renderCall(empty, context).join("\n"));
			expect(cleared).not.toContain("const value");
			expect(cleared.includes("[invalid arg]")).toBe(
				typeof empty === "number" || (typeof empty === "object" && empty !== null),
			);
			renderCall("const value = 1;", context);
			expect(spy).toHaveBeenCalledTimes(2);
			spy.mockRestore();
		}
	});

	it("does not rehighlight during tool progress, timer redraws or completion", () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const spy = vi.spyOn(themeModule, "highlightCode");
		const tui = { requestRender: () => {} } as unknown as TUI;
		const code = 'await tools.read({path: "README.md"});';
		const component = new ToolExecutionComponent("codemode", "call", { code }, {}, codemodeRenderers, tui, "/");
		component.setArgsComplete();
		component.markExecutionStarted();
		for (let i = 0; i < 3; i++) {
			component.updateResult({ content: [], details: { calls: [] }, isError: false }, true);
			vi.advanceTimersByTime(1_000);
		}
		component.setExpanded(true);
		component.setExpanded(false);
		component.updateResult(
			{ content: [{ type: "text", text: "done" }], details: { calls: [] }, isError: false, durationMs: 3_000 },
			false,
		);
		expect(stripVTControlCharacters(component.render(120).join("\n"))).toContain("Took 3.0s");
		expect(spy).toHaveBeenCalledTimes(1);
		component.updateArgs({ code: 'emit("changed");' });
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it("hides the script header and shows the output", () => {
		const text = render({
			content: [
				{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" },
				{ type: "text", text: "hello" },
			],
			details: { calls: [{ id: "call/1", name: "read", args: '{"path":"a"}', status: "ok", durationMs: 5 }] },
		});
		expect(text).toBe('✓ read {"path":"a"} 5ms\n\nhello');
	});

	it("shows the cost of model calls and their total", () => {
		const call = { name: "models.classify", args: "scorer/judge", status: "ok" as const, durationMs: 5 };
		const text = render({
			content: [{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" }],
			details: {
				calls: [
					{ ...call, id: "call/models.classify/1", cost: 0.000012936 },
					{ ...call, id: "call/models.classify/2", cost: 0.02 },
					{ ...call, id: "call/models.classify/3" },
				],
			},
		});
		expect(text).toBe(
			[
				"✓ models.classify scorer/judge 5ms $0.000013",
				"✓ models.classify scorer/judge 5ms $0.02",
				"✓ models.classify scorer/judge 5ms",
				"Model calls: $0.02",
			].join("\n"),
		);
	});

	it("shows results without a header, such as rejected options", () => {
		const text = render(
			{
				content: [{ type: "text", text: "The @options line must be followed by JavaScript source" }],
				details: undefined,
			},
			true,
		);
		expect(text).toBe("The @options line must be followed by JavaScript source");
	});

	it("limits collapsed output to wrapped lines, not logical lines", () => {
		const text = render(
			{
				content: [
					{ type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" },
					{ type: "text", text: "x".repeat(1000) },
				],
				details: { calls: [], fullOutputPath: "/tmp/out.txt" },
			},
			false,
			false,
			50,
		);
		const lines = text.split("\n");
		expect(lines).toHaveLength(7);
		expect(lines.slice(0, 5)).toEqual(Array(5).fill("x".repeat(50)));
		expect(lines[5]).toMatch(/^\.\.\. \(15 more lines,/);
		expect(lines[6]).toBe("Full output: /tmp/out.txt");
	});

	// #10708
	it("shows the elapsed time while the script runs and the total once it finished", () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const tui = { requestRender: () => {} } as unknown as TUI;
		const component = new ToolExecutionComponent("codemode", "call", { code: "" }, {}, codemodeRenderers, tui, "/");
		const text = () => stripVTControlCharacters(component.render(120).join("\n"));
		component.markExecutionStarted();
		component.updateResult({ content: [], details: { calls: [] }, isError: false }, true);
		vi.advanceTimersByTime(3_000);
		expect(text()).toContain("Elapsed 3.0s");

		component.updateResult({ content: [], details: { calls: [] }, isError: false, durationMs: 5_100 }, false);
		expect(text()).toContain("Took 5.1s");
		expect(text()).not.toContain("Elapsed");
	});
});
