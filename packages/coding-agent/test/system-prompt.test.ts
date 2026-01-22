import { describe, expect, test } from "vitest";
import { buildSystemPrompt } from "../src/core/system-prompt.js";

describe("buildSystemPrompt", () => {
	describe("empty tools", () => {
		test("shows (none) for empty tools list", () => {
			const result = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
			});

			expect(result.prompt).toContain("Available tools:\n(none)");
		});

		test("shows file paths guideline even with no tools", () => {
			const result = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
			});

			expect(result.prompt).toContain("Show file paths clearly");
		});
	});

	describe("default tools", () => {
		test("includes all default tools", () => {
			const result = buildSystemPrompt({
				contextFiles: [],
				skills: [],
			});

			expect(result.prompt).toContain("- read:");
			expect(result.prompt).toContain("- bash:");
			expect(result.prompt).toContain("- edit:");
			expect(result.prompt).toContain("- write:");
		});
	});

	describe("template variables", () => {
		test("replaces {{tools}} with tool list", () => {
			const result = buildSystemPrompt({
				customPrompt: "My tools:\n{{tools}}",
				selectedTools: ["read", "bash"],
				contextFiles: [],
				skills: [],
			});

			expect(result.prompt).toContain("My tools:");
			expect(result.prompt).toContain("- read:");
			expect(result.prompt).toContain("- bash:");
			expect(result.prompt).not.toContain("{{tools}}");
		});

		test("replaces {{context}} with context files", () => {
			const result = buildSystemPrompt({
				customPrompt: "Context:\n{{context}}\nEnd context.",
				contextFiles: [{ path: "/test/AGENTS.md", content: "Test content" }],
				skills: [],
			});

			expect(result.prompt).toContain("Context:");
			expect(result.prompt).toContain("# Project Context");
			expect(result.prompt).toContain("/test/AGENTS.md");
			expect(result.prompt).toContain("Test content");
			expect(result.prompt).toContain("End context.");
			expect(result.prompt).not.toContain("{{context}}");
			expect(result.contextInjected).toBe(true);
		});

		test("replaces {{skills}} with skills section", () => {
			const result = buildSystemPrompt({
				customPrompt: "Skills:\n{{skills}}",
				selectedTools: ["read"],
				contextFiles: [],
				skills: [
					{
						name: "test-skill",
						description: "A test skill",
						filePath: "/test/skill.md",
						baseDir: "/test",
						source: "project",
						disableModelInvocation: false,
					},
				],
			});

			expect(result.prompt).toContain("Skills:");
			expect(result.prompt).toContain("test-skill");
			expect(result.prompt).not.toContain("{{skills}}");
			expect(result.skillsInjected).toBe(true);
		});

		test("{{skills}} is empty when read tool not available", () => {
			const result = buildSystemPrompt({
				customPrompt: "Skills: [{{skills}}]",
				selectedTools: ["bash"], // no read
				contextFiles: [],
				skills: [
					{
						name: "test-skill",
						description: "A test skill",
						filePath: "/test/skill.md",
						baseDir: "/test",
						source: "project",
						disableModelInvocation: false,
					},
				],
			});

			expect(result.prompt).toContain("Skills: []");
			expect(result.prompt).not.toContain("test-skill");
			expect(result.skillsInjected).toBe(true); // Still true, just empty
		});

		test("multiple template variables work together", () => {
			const result = buildSystemPrompt({
				customPrompt: "Tools:\n{{tools}}\n\n{{context}}\n\n{{skills}}",
				selectedTools: ["read", "edit"],
				contextFiles: [{ path: "/AGENTS.md", content: "Project rules" }],
				skills: [
					{
						name: "my-skill",
						description: "My skill",
						filePath: "/skill.md",
						baseDir: "/",
						source: "project",
						disableModelInvocation: false,
					},
				],
			});

			expect(result.prompt).toContain("- read:");
			expect(result.prompt).toContain("- edit:");
			expect(result.prompt).toContain("Project rules");
			expect(result.prompt).toContain("my-skill");
			expect(result.prompt).not.toContain("{{tools}}");
			expect(result.prompt).not.toContain("{{context}}");
			expect(result.prompt).not.toContain("{{skills}}");
			expect(result.contextInjected).toBe(true);
			expect(result.skillsInjected).toBe(true);
		});

		test("without template vars, context and skills are NOT appended (full replacement)", () => {
			const result = buildSystemPrompt({
				customPrompt: "My custom prompt",
				contextFiles: [{ path: "/AGENTS.md", content: "Context here" }],
				skills: [
					{
						name: "skill1",
						description: "Skill 1",
						filePath: "/skill.md",
						baseDir: "/",
						source: "project",
						disableModelInvocation: false,
					},
				],
			});

			// Full replacement mode: no automatic appending
			expect(result.prompt).toContain("My custom prompt");
			expect(result.prompt).not.toContain("Context here");
			expect(result.prompt).not.toContain("skill1");
			expect(result.contextInjected).toBe(false);
			expect(result.skillsInjected).toBe(false);
		});

		test("with template vars, content only appears where requested", () => {
			const result = buildSystemPrompt({
				customPrompt: "Only tools: {{tools}}",
				contextFiles: [{ path: "/AGENTS.md", content: "Should not appear" }],
				skills: [
					{
						name: "skill1",
						description: "Should not appear",
						filePath: "/skill.md",
						baseDir: "/",
						source: "project",
						disableModelInvocation: false,
					},
				],
			});

			// Has {{tools}} so template mode, but no {{context}} or {{skills}}
			expect(result.prompt).toContain("- read:");
			expect(result.prompt).not.toContain("Should not appear");
			expect(result.prompt).not.toContain("skill1");
			expect(result.contextInjected).toBe(false);
			expect(result.skillsInjected).toBe(false);
		});

		test("always includes datetime and cwd", () => {
			const result = buildSystemPrompt({
				customPrompt: "{{tools}}",
				cwd: "/test/dir",
				contextFiles: [],
				skills: [],
			});

			expect(result.prompt).toContain("Current date and time:");
			expect(result.prompt).toContain("Current working directory: /test/dir");
		});

		test("appendSystemPrompt still works with template vars", () => {
			const result = buildSystemPrompt({
				customPrompt: "Main: {{tools}}",
				appendSystemPrompt: "Extra instructions",
				contextFiles: [],
				skills: [],
			});

			expect(result.prompt).toContain("Main:");
			expect(result.prompt).toContain("Extra instructions");
		});

		test("default prompt returns contextInjected and skillsInjected true", () => {
			const result = buildSystemPrompt({
				contextFiles: [{ path: "/AGENTS.md", content: "Context" }],
				skills: [],
			});

			expect(result.contextInjected).toBe(true);
			expect(result.skillsInjected).toBe(true);
		});
	});
});
