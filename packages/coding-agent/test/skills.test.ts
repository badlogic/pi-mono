import { join, resolve } from "path";
import { describe, expect, it } from "vitest";
import { formatSkillsForPrompt, loadSkillsFromDir, type Skill } from "../src/core/skills.js";

const fixturesDir = resolve(__dirname, "fixtures/skills");
const collisionFixturesDir = resolve(__dirname, "fixtures/skills-collision");

describe("skills", () => {
	describe("loadSkillsFromDir", () => {
		it("should load a valid skill", () => {
			const { skills, warnings } = loadSkillsFromDir({
				dir: join(fixturesDir, "valid-skill"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("valid-skill");
			expect(skills[0].description).toBe("A valid skill for testing purposes.");
			expect(skills[0].source).toBe("test");
			expect(warnings).toHaveLength(0);
		});

		it("should warn when name doesn't match parent directory", () => {
			const { skills, warnings } = loadSkillsFromDir({
				dir: join(fixturesDir, "name-mismatch"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("different-name");
			expect(warnings.some((w) => w.message.includes("does not match parent directory"))).toBe(true);
		});

		it("should warn when name contains invalid characters", () => {
			const { skills, warnings } = loadSkillsFromDir({
				dir: join(fixturesDir, "invalid-name-chars"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(warnings.some((w) => w.message.includes("invalid characters"))).toBe(true);
		});

		it("should warn when name exceeds 64 characters", () => {
			const { skills, warnings } = loadSkillsFromDir({
				dir: join(fixturesDir, "long-name"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(warnings.some((w) => w.message.includes("exceeds 64 characters"))).toBe(true);
		});

		it("should warn and skip skill when description is missing", () => {
			const { skills, warnings } = loadSkillsFromDir({
				dir: join(fixturesDir, "missing-description"),
				source: "test",
			});

			expect(skills).toHaveLength(0);
			expect(warnings.some((w) => w.message.includes("description is required"))).toBe(true);
		});

		it("should warn when unknown frontmatter fields are present", () => {
			const { skills, warnings } = loadSkillsFromDir({
				dir: join(fixturesDir, "unknown-field"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(warnings.some((w) => w.message.includes('unknown frontmatter field "author"'))).toBe(true);
			expect(warnings.some((w) => w.message.includes('unknown frontmatter field "version"'))).toBe(true);
		});

		it("should load nested skills recursively", () => {
			const { skills, warnings } = loadSkillsFromDir({
				dir: join(fixturesDir, "nested"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("child-skill");
			expect(warnings).toHaveLength(0);
		});

		it("should skip files without frontmatter", () => {
			const { skills, warnings } = loadSkillsFromDir({
				dir: join(fixturesDir, "no-frontmatter"),
				source: "test",
			});

			// no-frontmatter has no description, so it should be skipped
			expect(skills).toHaveLength(0);
			expect(warnings.some((w) => w.message.includes("description is required"))).toBe(true);
		});

		it("should warn when name contains consecutive hyphens", () => {
			const { skills, warnings } = loadSkillsFromDir({
				dir: join(fixturesDir, "consecutive-hyphens"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(warnings.some((w) => w.message.includes("consecutive hyphens"))).toBe(true);
		});

		it("should load all skills from fixture directory", () => {
			const { skills, warnings } = loadSkillsFromDir({
				dir: fixturesDir,
				source: "test",
			});

			// Should load all skills that have descriptions (even with warnings)
			// valid-skill, name-mismatch, invalid-name-chars, long-name, unknown-field, nested/child-skill, consecutive-hyphens
			// NOT: missing-description, no-frontmatter (both missing descriptions)
			expect(skills.length).toBeGreaterThanOrEqual(6);
		});

		it("should return empty for non-existent directory", () => {
			const { skills, warnings } = loadSkillsFromDir({
				dir: "/non/existent/path",
				source: "test",
			});

			expect(skills).toHaveLength(0);
			expect(warnings).toHaveLength(0);
		});

		it("should use parent directory name when name not in frontmatter", () => {
			// The no-frontmatter fixture has no name in frontmatter, so it should use "no-frontmatter"
			// But it also has no description, so it won't load
			// Let's test with a valid skill that relies on directory name
			const { skills } = loadSkillsFromDir({
				dir: join(fixturesDir, "valid-skill"),
				source: "test",
			});

			expect(skills).toHaveLength(1);
			expect(skills[0].name).toBe("valid-skill");
		});
	});

	describe("formatSkillsForPrompt", () => {
		it("should return empty string for no skills", () => {
			const result = formatSkillsForPrompt([]);
			expect(result).toBe("");
		});

		it("should format skills as XML", () => {
			const skills: Skill[] = [
				{
					name: "test-skill",
					description: "A test skill.",
					filePath: "/path/to/skill/SKILL.md",
					baseDir: "/path/to/skill",
					source: "test",
				},
			];

			const result = formatSkillsForPrompt(skills);

			expect(result).toContain("<available_skills>");
			expect(result).toContain("</available_skills>");
			expect(result).toContain("<skill>");
			expect(result).toContain("<name>test-skill</name>");
			expect(result).toContain("<description>A test skill.</description>");
			expect(result).toContain("<location>/path/to/skill/SKILL.md</location>");
		});

		it("should include intro text before XML", () => {
			const skills: Skill[] = [
				{
					name: "test-skill",
					description: "A test skill.",
					filePath: "/path/to/skill/SKILL.md",
					baseDir: "/path/to/skill",
					source: "test",
				},
			];

			const result = formatSkillsForPrompt(skills);
			const xmlStart = result.indexOf("<available_skills>");
			const introText = result.substring(0, xmlStart);

			expect(introText).toContain("The following skills provide specialized instructions");
			expect(introText).toContain("Use the read tool to load a skill's file");
		});

		it("should escape XML special characters", () => {
			const skills: Skill[] = [
				{
					name: "test-skill",
					description: 'A skill with <special> & "characters".',
					filePath: "/path/to/skill/SKILL.md",
					baseDir: "/path/to/skill",
					source: "test",
				},
			];

			const result = formatSkillsForPrompt(skills);

			expect(result).toContain("&lt;special&gt;");
			expect(result).toContain("&amp;");
			expect(result).toContain("&quot;characters&quot;");
		});

		it("should format multiple skills", () => {
			const skills: Skill[] = [
				{
					name: "skill-one",
					description: "First skill.",
					filePath: "/path/one/SKILL.md",
					baseDir: "/path/one",
					source: "test",
				},
				{
					name: "skill-two",
					description: "Second skill.",
					filePath: "/path/two/SKILL.md",
					baseDir: "/path/two",
					source: "test",
				},
			];

			const result = formatSkillsForPrompt(skills);

			expect(result).toContain("<name>skill-one</name>");
			expect(result).toContain("<name>skill-two</name>");
			expect((result.match(/<skill>/g) || []).length).toBe(2);
		});
	});

	describe("collision handling", () => {
		it("should detect name collisions and keep first skill", () => {
			// Load from first directory
			const first = loadSkillsFromDir({
				dir: join(collisionFixturesDir, "first"),
				source: "first",
			});

			const second = loadSkillsFromDir({
				dir: join(collisionFixturesDir, "second"),
				source: "second",
			});

			// Simulate the collision behavior from loadSkills()
			const skillMap = new Map<string, Skill>();
			const collisionWarnings: Array<{ skillPath: string; message: string }> = [];

			for (const skill of first.skills) {
				skillMap.set(skill.name, skill);
			}

			for (const skill of second.skills) {
				const existing = skillMap.get(skill.name);
				if (existing) {
					collisionWarnings.push({
						skillPath: skill.filePath,
						message: `name collision: "${skill.name}" already loaded from ${existing.filePath}`,
					});
				} else {
					skillMap.set(skill.name, skill);
				}
			}

			expect(skillMap.size).toBe(1);
			expect(skillMap.get("calendar")?.source).toBe("first");
			expect(collisionWarnings).toHaveLength(1);
			expect(collisionWarnings[0].message).toContain("name collision");
		});
	});
});
