import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EvolutionSuggestion } from "../src/evolution.js";
import { applyEvolution, buildEvolutionPrompt, parseEvolutionResult } from "../src/evolution.js";

describe("Evolution Engine", () => {
	let dataDir: string;

	beforeEach(() => {
		dataDir = mkdtempSync(join(tmpdir(), "evolution-test-"));
	});

	afterEach(() => {
		rmSync(dataDir, { recursive: true, force: true });
	});

	describe("buildEvolutionPrompt", () => {
		it("should return a prompt string containing the soul content", () => {
			writeFileSync(join(dataDir, "soul.md"), "You are a fierce warrior AI.");

			const prompt = buildEvolutionPrompt({ dataDir });

			expect(prompt).toContain("You are a fierce warrior AI.");
			expect(prompt).toContain("## Current Soul");
		});

		it("should return a prompt with task list content", () => {
			writeFileSync(join(dataDir, "soul.md"), "Basic soul.");
			const taskDir = join(dataDir, "tasks");
			mkdirSync(taskDir, { recursive: true });
			writeFileSync(join(taskDir, "combat.md"), "- Attack enemies\n- Defend base");
			writeFileSync(join(taskDir, "economy.md"), "- Gather resources");

			const prompt = buildEvolutionPrompt({ dataDir });

			expect(prompt).toContain("### combat");
			expect(prompt).toContain("- Attack enemies");
			expect(prompt).toContain("- Defend base");
			expect(prompt).toContain("### economy");
			expect(prompt).toContain("- Gather resources");
		});

		it("should handle missing soul.md gracefully", () => {
			const prompt = buildEvolutionPrompt({ dataDir });

			expect(prompt).toContain("(no soul defined)");
			expect(prompt).toContain("## Current Soul");
		});

		it("should handle empty tasks directory", () => {
			writeFileSync(join(dataDir, "soul.md"), "A soul.");
			const taskDir = join(dataDir, "tasks");
			mkdirSync(taskDir, { recursive: true });

			const prompt = buildEvolutionPrompt({ dataDir });

			expect(prompt).toContain("## Current Task Lists");
			// Should not contain any ### domain headers
			expect(prompt).not.toMatch(/### \w+/);
		});

		it("should handle nonexistent tasks directory", () => {
			writeFileSync(join(dataDir, "soul.md"), "A soul.");

			const prompt = buildEvolutionPrompt({ dataDir });

			expect(prompt).toContain("## Current Task Lists");
			expect(prompt).toContain("## Instructions");
		});

		it("should include instructions for the LLM", () => {
			writeFileSync(join(dataDir, "soul.md"), "A soul.");

			const prompt = buildEvolutionPrompt({ dataDir });

			expect(prompt).toContain("## Instructions");
			expect(prompt).toContain("JSON");
			expect(prompt).toContain("target");
			expect(prompt).toContain("reasoning");
		});
	});

	describe("parseEvolutionResult", () => {
		it("should parse a valid response with JSON code block", () => {
			const response = `## Analysis

The agent is too aggressive.

\`\`\`json
[
  {
    "target": "soul",
    "action": "update",
    "content": "You are a balanced warrior.",
    "reasoning": "Agent needs more defensive strategies."
  }
]
\`\`\``;

			const result = parseEvolutionResult(response);

			expect(result.suggestions).toHaveLength(1);
			expect(result.suggestions[0].target).toBe("soul");
			expect(result.suggestions[0].action).toBe("update");
			expect(result.suggestions[0].content).toBe("You are a balanced warrior.");
			expect(result.suggestions[0].reasoning).toBe("Agent needs more defensive strategies.");
		});

		it("should return empty suggestions for response without JSON", () => {
			const response = "The agent is doing great, no changes needed.";

			const result = parseEvolutionResult(response);

			expect(result.suggestions).toHaveLength(0);
			expect(result.analysis).toBe("The agent is doing great, no changes needed.");
		});

		it("should return empty suggestions for malformed JSON", () => {
			const response = `Some analysis.

\`\`\`json
{ this is not valid json !!!
\`\`\``;

			const result = parseEvolutionResult(response);

			expect(result.suggestions).toHaveLength(0);
		});

		it("should extract analysis text before the JSON block", () => {
			const response = `## Performance Review

The agent performed well in combat but poorly in economy.

\`\`\`json
[
  {
    "target": "task_list",
    "domain": "economy",
    "action": "update",
    "content": "- Prioritize gold mining",
    "reasoning": "Economy is weak."
  }
]
\`\`\``;

			const result = parseEvolutionResult(response);

			expect(result.analysis).toContain("## Performance Review");
			expect(result.analysis).toContain("performed well in combat but poorly in economy");
		});

		it("should filter out invalid suggestion objects (missing required fields)", () => {
			const response = `Analysis.

\`\`\`json
[
  {
    "target": "soul",
    "action": "update",
    "content": "Valid suggestion.",
    "reasoning": "Good reason."
  },
  {
    "target": "soul"
  },
  {
    "action": "update",
    "content": "Missing target."
  },
  null,
  42,
  {
    "target": "task_list",
    "action": "create",
    "content": "Also valid.",
    "domain": "combat"
  }
]
\`\`\``;

			const result = parseEvolutionResult(response);

			expect(result.suggestions).toHaveLength(2);
			expect(result.suggestions[0].target).toBe("soul");
			expect(result.suggestions[1].target).toBe("task_list");
			expect(result.suggestions[1].domain).toBe("combat");
		});

		it("should handle bare JSON without language specifier in code fence", () => {
			const response = `Analysis here.

\`\`\`
[
  {
    "target": "soul",
    "action": "update",
    "content": "New soul content.",
    "reasoning": "Improvement."
  }
]
\`\`\``;

			const result = parseEvolutionResult(response);

			expect(result.suggestions).toHaveLength(1);
			expect(result.suggestions[0].content).toBe("New soul content.");
		});

		it("should default reasoning to empty string when missing", () => {
			const response = `Analysis.

\`\`\`json
[
  {
    "target": "soul",
    "action": "update",
    "content": "New soul."
  }
]
\`\`\``;

			const result = parseEvolutionResult(response);

			expect(result.suggestions).toHaveLength(1);
			expect(result.suggestions[0].reasoning).toBe("");
		});

		it("should parse multiple suggestions", () => {
			const response = `Analysis.

\`\`\`json
[
  {
    "target": "soul",
    "action": "update",
    "content": "Updated soul.",
    "reasoning": "Reason 1."
  },
  {
    "target": "task_list",
    "domain": "combat",
    "action": "update",
    "content": "- New combat tasks",
    "reasoning": "Reason 2."
  },
  {
    "target": "skill",
    "domain": "flanking",
    "action": "create",
    "content": "# Flanking Skill",
    "reasoning": "Reason 3."
  }
]
\`\`\``;

			const result = parseEvolutionResult(response);

			expect(result.suggestions).toHaveLength(3);
			expect(result.suggestions[0].target).toBe("soul");
			expect(result.suggestions[1].target).toBe("task_list");
			expect(result.suggestions[1].domain).toBe("combat");
			expect(result.suggestions[2].target).toBe("skill");
			expect(result.suggestions[2].domain).toBe("flanking");
		});
	});

	describe("applyEvolution", () => {
		it("should write soul update to soul.md", async () => {
			const suggestions: EvolutionSuggestion[] = [
				{
					target: "soul",
					action: "update",
					content: "You are an evolved warrior AI.",
					reasoning: "Improvement needed.",
				},
			];

			const applied = await applyEvolution(suggestions, dataDir);

			const soulPath = join(dataDir, "soul.md");
			expect(applied).toContain(soulPath);
			expect(readFileSync(soulPath, "utf-8")).toBe("You are an evolved warrior AI.");
		});

		it("should write task_list update to tasks/{domain}.md", async () => {
			const suggestions: EvolutionSuggestion[] = [
				{
					target: "task_list",
					domain: "combat",
					action: "update",
					content: "- New combat strategy\n- Defend more",
					reasoning: "Combat was weak.",
				},
			];

			const applied = await applyEvolution(suggestions, dataDir);

			const taskPath = join(dataDir, "tasks", "combat.md");
			expect(applied).toContain(taskPath);
			expect(readFileSync(taskPath, "utf-8")).toBe("- New combat strategy\n- Defend more");
		});

		it("should write skill create to skills/{domain}/SKILL.md", async () => {
			const suggestions: EvolutionSuggestion[] = [
				{
					target: "skill",
					domain: "flanking",
					action: "create",
					content: "# Flanking\n\nApproach from the side.",
					reasoning: "New tactic.",
				},
			];

			const applied = await applyEvolution(suggestions, dataDir);

			const skillPath = join(dataDir, "skills", "flanking", "SKILL.md");
			expect(applied).toContain(skillPath);
			expect(readFileSync(skillPath, "utf-8")).toBe("# Flanking\n\nApproach from the side.");
		});

		it("should create directories as needed", async () => {
			const suggestions: EvolutionSuggestion[] = [
				{
					target: "task_list",
					domain: "economy",
					action: "create",
					content: "- Gather gold",
					reasoning: "No economy tasks existed.",
				},
				{
					target: "skill",
					domain: "trading",
					action: "create",
					content: "# Trading Skill",
					reasoning: "New skill.",
				},
			];

			// Verify dirs don't exist yet
			expect(existsSync(join(dataDir, "tasks"))).toBe(false);
			expect(existsSync(join(dataDir, "skills"))).toBe(false);

			await applyEvolution(suggestions, dataDir);

			expect(existsSync(join(dataDir, "tasks", "economy.md"))).toBe(true);
			expect(existsSync(join(dataDir, "skills", "trading", "SKILL.md"))).toBe(true);
		});

		it("should skip suggestions with missing domain for task_list", async () => {
			const suggestions: EvolutionSuggestion[] = [
				{
					target: "task_list",
					action: "update",
					content: "- Some tasks",
					reasoning: "Missing domain.",
				},
			];

			const applied = await applyEvolution(suggestions, dataDir);

			expect(applied).toHaveLength(0);
		});

		it("should skip suggestions with missing domain for skill", async () => {
			const suggestions: EvolutionSuggestion[] = [
				{
					target: "skill",
					action: "create",
					content: "# Some Skill",
					reasoning: "Missing domain.",
				},
			];

			const applied = await applyEvolution(suggestions, dataDir);

			expect(applied).toHaveLength(0);
		});

		it("should return list of applied file paths", async () => {
			const suggestions: EvolutionSuggestion[] = [
				{
					target: "soul",
					action: "update",
					content: "New soul.",
					reasoning: "Reason.",
				},
				{
					target: "task_list",
					domain: "combat",
					action: "update",
					content: "- Fight better",
					reasoning: "Reason.",
				},
				{
					target: "skill",
					domain: "dodge",
					action: "create",
					content: "# Dodge",
					reasoning: "Reason.",
				},
			];

			const applied = await applyEvolution(suggestions, dataDir);

			expect(applied).toHaveLength(3);
			expect(applied).toContain(join(dataDir, "soul.md"));
			expect(applied).toContain(join(dataDir, "tasks", "combat.md"));
			expect(applied).toContain(join(dataDir, "skills", "dodge", "SKILL.md"));
		});

		it("should handle empty suggestions array", async () => {
			const applied = await applyEvolution([], dataDir);

			expect(applied).toHaveLength(0);
		});

		it("should skip suggestions with unknown target", async () => {
			const suggestions = [
				{
					target: "unknown" as EvolutionSuggestion["target"],
					action: "update" as const,
					content: "Something",
					reasoning: "Reason.",
				},
			];

			const applied = await applyEvolution(suggestions, dataDir);

			expect(applied).toHaveLength(0);
		});
	});
});
