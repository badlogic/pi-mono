import { describe, expect, test } from "vitest";
import { buildSystemPrompt } from "../src/core/system-prompt.js";

describe("buildSystemPrompt", () => {
	describe("empty tools", () => {
		test("shows (none) for empty tools list", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("Available tools:\n(none)");
		});

		test("shows file paths guideline even with no tools", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("Show file paths clearly");
		});
	});

	describe("default tools", () => {
		test("includes all default tools", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("- read:");
			expect(prompt).toContain("- bash:");
			expect(prompt).toContain("- edit:");
			expect(prompt).toContain("- write:");
		});

		test("does not include non-default builtins when no tools specified", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
			});

			expect(prompt).not.toContain("- grep:");
			expect(prompt).not.toContain("- find:");
			expect(prompt).not.toContain("- ls:");
		});
	});

	describe("custom tools via tools option", () => {
		test("includes custom tool with shortDescription", () => {
			const prompt = buildSystemPrompt({
				tools: [
					{ name: "read", shortDescription: "Read file contents" },
					{ name: "my_tool", shortDescription: "Manage a todo list" },
				],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("- read: Read file contents");
			expect(prompt).toContain("- my_tool: Manage a todo list");
		});

		test("falls back to tool name when shortDescription is undefined", () => {
			const prompt = buildSystemPrompt({
				tools: [{ name: "my_tool" }],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("- my_tool: my_tool");
		});

		test("hides tool from list when shortDescription is empty string", () => {
			const prompt = buildSystemPrompt({
				tools: [
					{ name: "read", shortDescription: "Read file contents" },
					{ name: "hidden_tool", shortDescription: "" },
				],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("- read: Read file contents");
			expect(prompt).not.toContain("hidden_tool");
		});

		test("appends systemGuidelines from custom tools", () => {
			const prompt = buildSystemPrompt({
				tools: [
					{
						name: "my_tool",
						shortDescription: "Manage a todo list",
						systemGuidelines: ["Confirm with the user before removing items"],
					},
				],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("- Confirm with the user before removing items");
		});

		test("deduplicates guidelines", () => {
			const prompt = buildSystemPrompt({
				tools: [
					{
						name: "tool_a",
						shortDescription: "Tool A",
						systemGuidelines: ["Be concise in your responses"],
					},
				],
				contextFiles: [],
				skills: [],
			});

			const matches = prompt.match(/Be concise in your responses/g);
			expect(matches).toHaveLength(1);
		});
	});
});
