import type { AssistantMessage } from "@apholdings/jensen-ai";
import { Container, type TUI } from "@apholdings/jensen-tui";
import stripAnsi from "strip-ansi";
import { beforeAll, describe, expect, test } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.js";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.js";
import { getMarkdownTheme, initTheme } from "../src/modes/interactive/theme/theme.js";

function createFakeTui(): TUI {
	return {
		requestRender: () => {},
	} as unknown as TUI;
}

function createUsage(): AssistantMessage["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	};
}

function createAssistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "gpt-5",
		usage: createUsage(),
		stopReason,
		timestamp: 0,
	};
}

function normalizeLines(lines: string[]): string[] {
	return lines.map((line) => stripAnsi(line).trimEnd());
}

function expectSingleBlankLineBetween(lines: string[], firstNeedle: string, secondNeedle: string): void {
	const normalized = normalizeLines(lines);
	const firstIndex = normalized.findIndex((line) => line.includes(firstNeedle));
	const secondIndex = normalized.findIndex((line, index) => index > firstIndex && line.includes(secondNeedle));

	expect(firstIndex).toBeGreaterThanOrEqual(0);
	expect(secondIndex).toBeGreaterThan(firstIndex);

	const between = lines.slice(firstIndex + 1, secondIndex);
	const spacerLines = between.filter((line) => line === "");
	expect(spacerLines).toEqual([""]);
}

describe("assistant and tool spacing", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("keeps one blank line between assistant text and following tool card", () => {
		const assistant = new AssistantMessageComponent(
			createAssistantMessage(
				[
					{ type: "text", text: "First paragraph" },
					{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "README.md" } },
				],
				"toolUse",
			),
			false,
			getMarkdownTheme(),
		);
		const tool = new ToolExecutionComponent("read", { path: "README.md" }, {}, undefined, createFakeTui());
		const container = new Container();
		container.addChild(assistant);
		container.addChild(tool);

		expectSingleBlankLineBetween(container.render(80), "First paragraph", "read README.md");
	});

	test("keeps one blank line between a tool card and the next assistant paragraph", () => {
		const tool = new ToolExecutionComponent("read", { path: "README.md" }, {}, undefined, createFakeTui());
		const assistant = new AssistantMessageComponent(
			createAssistantMessage([{ type: "text", text: "Next paragraph" }]),
			false,
			getMarkdownTheme(),
		);
		const container = new Container();
		container.addChild(tool);
		container.addChild(assistant);

		expectSingleBlankLineBetween(container.render(80), "read README.md", "Next paragraph");
	});
});
