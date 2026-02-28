import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { formatSkillsForPrompt, loadSkillsFromDir, type Skill } from "../src/core/skills.js";

const fixturesDir = resolve(__dirname, "fixtures/skills");

// Temp dirs to clean up
const tempDirs: string[] = [];
function makeTempSkillDir(): string {
	const dir = mkdtempSync("/tmp/pi-trigger-test-");
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	// We don't delete tempDirs since tests are ephemeral anyway
});

describe("skills trigger parsing", () => {
	it("should parse triggers array from frontmatter", () => {
		const { skills, diagnostics } = loadSkillsFromDir({
			dir: join(fixturesDir, "with-triggers"),
			source: "test",
		});

		expect(skills).toHaveLength(1);
		expect(skills[0].name).toBe("with-triggers");
		expect(skills[0].triggers).toEqual(["test trigger", "another trigger", "third trigger"]);
		expect(diagnostics).toHaveLength(0);
	});

	it("should default triggers to empty array when not in frontmatter", () => {
		const { skills } = loadSkillsFromDir({
			dir: join(fixturesDir, "valid-skill"),
			source: "test",
		});

		expect(skills).toHaveLength(1);
		expect(skills[0].triggers).toEqual([]);
	});

	it("should handle single trigger", () => {
		const root = makeTempSkillDir();
		const skillDir = join(root, "single-trigger");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			"---\nname: single-trigger\ndescription: Skill with one trigger.\ntriggers:\n  - only trigger\n---\nBody.\n",
		);

		const { skills } = loadSkillsFromDir({ dir: root, source: "test" });
		expect(skills).toHaveLength(1);
		expect(skills[0].triggers).toEqual(["only trigger"]);
	});

	it("should handle empty triggers list", () => {
		const root = makeTempSkillDir();
		const skillDir = join(root, "empty-triggers");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			"---\nname: empty-triggers\ndescription: Skill with empty triggers.\ntriggers: []\n---\nBody.\n",
		);

		const { skills } = loadSkillsFromDir({ dir: root, source: "test" });
		expect(skills).toHaveLength(1);
		expect(skills[0].triggers).toEqual([]);
	});

	it("should handle triggers with special characters", () => {
		const root = makeTempSkillDir();
		const skillDir = join(root, "special-triggers");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			'---\nname: special-triggers\ndescription: Triggers with special chars.\ntriggers:\n  - "create a PDF"\n  - extract & transform\n  - "test <data>"\n---\nBody.\n',
		);

		const { skills } = loadSkillsFromDir({ dir: root, source: "test" });
		expect(skills).toHaveLength(1);
		expect(skills[0].triggers).toHaveLength(3);
		expect(skills[0].triggers![0]).toBe("create a PDF");
		expect(skills[0].triggers![1]).toBe("extract & transform");
		expect(skills[0].triggers![2]).toBe("test <data>");
	});

	it("should treat non-array triggers as empty array", () => {
		const root = makeTempSkillDir();
		const skillDir = join(root, "bad-triggers");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			"---\nname: bad-triggers\ndescription: Triggers set to a string.\ntriggers: not an array\n---\nBody.\n",
		);

		const { skills } = loadSkillsFromDir({ dir: root, source: "test" });
		expect(skills).toHaveLength(1);
		expect(skills[0].triggers).toEqual([]);
	});

	it("should include triggers in formatSkillsForPrompt XML output", () => {
		const skills: Skill[] = [
			{
				name: "my-skill",
				description: "A test skill.",
				triggers: ["build project", "compile code"],
				filePath: "/path/to/skill/SKILL.md",
				baseDir: "/path/to/skill",
				source: "test",
				disableModelInvocation: false,
			},
		];

		const result = formatSkillsForPrompt(skills);
		expect(result).toContain("<triggers>");
		expect(result).toContain("build project, compile code");
		expect(result).toContain("</triggers>");
	});

	it("should omit triggers tag in XML when triggers are empty", () => {
		const skills: Skill[] = [
			{
				name: "no-triggers",
				description: "A skill without triggers.",
				triggers: [],
				filePath: "/path/to/skill/SKILL.md",
				baseDir: "/path/to/skill",
				source: "test",
				disableModelInvocation: false,
			},
		];

		const result = formatSkillsForPrompt(skills);
		expect(result).not.toContain("<triggers>");
	});

	it("should escape XML characters in triggers", () => {
		const skills: Skill[] = [
			{
				name: "xml-triggers",
				description: "Triggers with XML chars.",
				triggers: ["extract <data>", "search & find"],
				filePath: "/path/to/skill/SKILL.md",
				baseDir: "/path/to/skill",
				source: "test",
				disableModelInvocation: false,
			},
		];

		const result = formatSkillsForPrompt(skills);
		expect(result).toContain("&lt;data&gt;");
		expect(result).toContain("&amp;");
		expect(result).not.toContain("<data>");
	});

	it("should preserve triggers through fixture directory scan", () => {
		const { skills } = loadSkillsFromDir({
			dir: fixturesDir,
			source: "test",
		});

		const withTriggers = skills.find((s) => s.name === "with-triggers");
		expect(withTriggers).toBeDefined();
		expect(withTriggers!.triggers).toEqual(["test trigger", "another trigger", "third trigger"]);

		// All other skills should have empty triggers
		for (const skill of skills) {
			if (skill.name !== "with-triggers") {
				expect(skill.triggers).toEqual([]);
			}
		}
	});

	it("should handle many triggers", () => {
		const root = makeTempSkillDir();
		const skillDir = join(root, "many-triggers");
		mkdirSync(skillDir, { recursive: true });
		const triggers = Array.from({ length: 20 }, (_, i) => `  - trigger number ${i + 1}`);
		writeFileSync(
			join(skillDir, "SKILL.md"),
			`---\nname: many-triggers\ndescription: Lots of triggers.\ntriggers:\n${triggers.join("\n")}\n---\nBody.\n`,
		);

		const { skills } = loadSkillsFromDir({ dir: root, source: "test" });
		expect(skills).toHaveLength(1);
		expect(skills[0].triggers).toHaveLength(20);
		expect(skills[0].triggers![0]).toBe("trigger number 1");
		expect(skills[0].triggers![19]).toBe("trigger number 20");
	});
});
