import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const BUILTINS_DIR = join(process.cwd(), "src", "core", "subagents", "builtins");

describe("subagent built-in prompts", () => {
	test("worker prompt forbids repeated progress chatter", () => {
		const prompt = readFileSync(join(BUILTINS_DIR, "worker.md"), "utf-8");
		expect(prompt).toContain("Do the work instead of narrating ongoing progress");
		expect(prompt).toContain("Do not restate the same plan, issue list, or status update multiple times");
		expect(prompt).toContain("Return the minimum useful result");
	});

	test("planner prompt forbids repeated re-analysis", () => {
		const prompt = readFileSync(join(BUILTINS_DIR, "planner.md"), "utf-8");
		expect(prompt).toContain("Do not repeat the same analysis with different wording");
		expect(prompt).toContain("If information is missing, name the exact missing fact once instead of looping");
	});
});
