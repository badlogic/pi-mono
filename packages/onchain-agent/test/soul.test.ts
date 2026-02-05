import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGamePrompt, loadSoul, loadTaskLists } from "../src/soul.js";

describe("Soul + Task Lists", () => {
	const tmpDir = join(import.meta.dirname, ".tmp-soul-test");

	beforeEach(() => {
		mkdirSync(tmpDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	describe("loadSoul", () => {
		it("should read a markdown file and return content", () => {
			const soulPath = join(tmpDir, "soul.md");
			writeFileSync(soulPath, "You are a fierce warrior AI.\n\nFight with honor.");

			const result = loadSoul(soulPath);
			expect(result).toBe("You are a fierce warrior AI.\n\nFight with honor.");
		});

		it("should strip YAML frontmatter and return body only", () => {
			const soulPath = join(tmpDir, "soul-with-frontmatter.md");
			writeFileSync(
				soulPath,
				"---\ntitle: Warrior Soul\nversion: 1\n---\nYou are a fierce warrior AI.\n\nFight with honor.",
			);

			const result = loadSoul(soulPath);
			expect(result).toBe("You are a fierce warrior AI.\n\nFight with honor.");
		});

		it("should handle frontmatter with trailing newline after closing delimiter", () => {
			const soulPath = join(tmpDir, "soul-trailing.md");
			writeFileSync(soulPath, "---\ntitle: Test\n---\n\nBody content here.");

			const result = loadSoul(soulPath);
			expect(result).toBe("Body content here.");
		});

		it("should throw if file does not exist", () => {
			expect(() => loadSoul(join(tmpDir, "nonexistent.md"))).toThrow();
		});
	});

	describe("loadTaskLists", () => {
		it("should discover all .md files and return Map<domain, content>", () => {
			const taskDir = join(tmpDir, "tasks");
			mkdirSync(taskDir, { recursive: true });
			writeFileSync(join(taskDir, "combat.md"), "- Attack enemies\n- Defend base");
			writeFileSync(join(taskDir, "economy.md"), "- Gather resources\n- Build structures");

			const result = loadTaskLists(taskDir);
			expect(result.size).toBe(2);
			expect(result.get("combat")).toBe("- Attack enemies\n- Defend base");
			expect(result.get("economy")).toBe("- Gather resources\n- Build structures");
		});

		it("should use filename without .md as domain key", () => {
			const taskDir = join(tmpDir, "tasks2");
			mkdirSync(taskDir, { recursive: true });
			writeFileSync(join(taskDir, "exploration.md"), "Explore the map.");

			const result = loadTaskLists(taskDir);
			expect(result.has("exploration")).toBe(true);
			expect(result.has("exploration.md")).toBe(false);
		});

		it("should strip frontmatter from task list files", () => {
			const taskDir = join(tmpDir, "tasks3");
			mkdirSync(taskDir, { recursive: true });
			writeFileSync(join(taskDir, "combat.md"), "---\npriority: high\n---\n- Attack enemies");

			const result = loadTaskLists(taskDir);
			expect(result.get("combat")).toBe("- Attack enemies");
		});

		it("should return empty map for nonexistent directory", () => {
			const result = loadTaskLists(join(tmpDir, "no-such-dir"));
			expect(result.size).toBe(0);
		});

		it("should ignore non-.md files", () => {
			const taskDir = join(tmpDir, "tasks4");
			mkdirSync(taskDir, { recursive: true });
			writeFileSync(join(taskDir, "combat.md"), "Fight!");
			writeFileSync(join(taskDir, "notes.txt"), "Not a task list");
			writeFileSync(join(taskDir, "config.json"), "{}");

			const result = loadTaskLists(taskDir);
			expect(result.size).toBe(1);
			expect(result.has("combat")).toBe(true);
		});
	});

	describe("buildGamePrompt", () => {
		it("should place soul as systemPrompt", () => {
			const result = buildGamePrompt({
				soul: "You are a strategic AI.",
				taskLists: new Map(),
			});

			expect(result.systemPrompt).toBe("You are a strategic AI.");
		});

		it("should wrap task lists in XML-style tags", () => {
			const taskLists = new Map<string, string>();
			taskLists.set("combat", "- Attack when health > 50%");
			taskLists.set("economy", "- Prioritize gold mining");

			const result = buildGamePrompt({
				soul: "You are an AI.",
				taskLists,
			});

			expect(result.appendSections).toHaveLength(1);
			const taskSection = result.appendSections[0];
			expect(taskSection).toContain("<task_lists>");
			expect(taskSection).toContain('<domain name="combat">');
			expect(taskSection).toContain("- Attack when health > 50%");
			expect(taskSection).toContain('<domain name="economy">');
			expect(taskSection).toContain("- Prioritize gold mining");
			expect(taskSection).toContain("</task_lists>");
		});

		it("should not include task_lists section when task lists are empty", () => {
			const result = buildGamePrompt({
				soul: "You are an AI.",
				taskLists: new Map(),
			});

			expect(result.appendSections).toHaveLength(0);
		});

		it("should include world state summary when provided", () => {
			const result = buildGamePrompt({
				soul: "You are an AI.",
				taskLists: new Map(),
				worldStateSummary: "You have 500 gold and 3 units.",
			});

			expect(result.appendSections).toHaveLength(1);
			expect(result.appendSections[0]).toContain("## Current World State");
			expect(result.appendSections[0]).toContain("You have 500 gold and 3 units.");
		});

		it("should include both task lists and world state when both provided", () => {
			const taskLists = new Map<string, string>();
			taskLists.set("combat", "Fight!");

			const result = buildGamePrompt({
				soul: "You are an AI.",
				taskLists,
				worldStateSummary: "All clear.",
			});

			expect(result.appendSections).toHaveLength(2);
			expect(result.appendSections[0]).toContain("<task_lists>");
			expect(result.appendSections[1]).toContain("## Current World State");
		});
	});
});
