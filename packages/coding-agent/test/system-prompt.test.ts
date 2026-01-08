import { describe, expect, test } from "vitest";
import { buildSystemPrompt } from "../src/core/system-prompt.js";

describe("buildSystemPrompt", () => {
	describe("empty tools", () => {
		test("does not show READ-ONLY mode when no built-in tools", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
			});

			// Should not mention READ-ONLY mode when there are no tools
			// (extensions may provide write capabilities)
			expect(prompt).not.toContain("READ-ONLY mode");
		});

		test("shows (none) for empty tools list", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("Available tools:\n(none)");
		});

		test("does not show file paths guideline when no tools", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).not.toContain("Show file paths clearly");
		});
	});

	describe("read-only tools", () => {
		test("shows READ-ONLY mode when only read tools available", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "grep", "find", "ls"],
				contextFiles: [],
				skills: [],
			});

			expect(prompt).toContain("READ-ONLY mode");
		});
	});

	describe("default tools", () => {
		test("does not show READ-ONLY mode with default tools", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
			});

			expect(prompt).not.toContain("READ-ONLY mode");
			expect(prompt).toContain("- read:");
			expect(prompt).toContain("- bash:");
			expect(prompt).toContain("- edit:");
			expect(prompt).toContain("- write:");
		});
	});
});
