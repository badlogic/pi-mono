import { existsSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { CONFIG_DIR_NAME } from "../../config.js";
import type { Skill, SkillFrontmatter, SkillSource } from "./types.js";

function stripQuotes(value: string): string {
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value;
}

function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
	const frontmatter: SkillFrontmatter = { description: "" };

	const normalizedContent = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

	if (!normalizedContent.startsWith("---")) {
		return { frontmatter, body: normalizedContent };
	}

	const endIndex = normalizedContent.indexOf("\n---", 3);
	if (endIndex === -1) {
		return { frontmatter, body: normalizedContent };
	}

	const frontmatterBlock = normalizedContent.slice(4, endIndex);
	const body = normalizedContent.slice(endIndex + 4).trim();

	for (const line of frontmatterBlock.split("\n")) {
		const match = line.match(/^(\w+):\s*(.*)$/);
		if (match) {
			const key = match[1];
			const value = stripQuotes(match[2].trim());
			if (key === "name") {
				frontmatter.name = value;
			} else if (key === "description") {
				frontmatter.description = value;
			}
		}
	}

	return { frontmatter, body };
}

function loadPiSkillsFromDir(dir: string, source: SkillSource, subdir: string = ""): Skill[] {
	const skills: Skill[] = [];

	if (!existsSync(dir)) {
		return skills;
	}

	try {
		const entries = readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = join(dir, entry.name);

			if (entry.isDirectory()) {
				const newSubdir = subdir ? `${subdir}:${entry.name}` : entry.name;
				skills.push(...loadPiSkillsFromDir(fullPath, source, newSubdir));
			} else if (entry.isFile() && entry.name.endsWith(".md")) {
				try {
					const rawContent = readFileSync(fullPath, "utf-8");
					const { frontmatter } = parseFrontmatter(rawContent);

					if (!frontmatter.description) {
						continue;
					}

					const nameFromFile = entry.name.slice(0, -3);
					const name = frontmatter.name || (subdir ? `${subdir}:${nameFromFile}` : nameFromFile);

					skills.push({
						name,
						description: frontmatter.description,
						filePath: fullPath,
						baseDir: dirname(fullPath),
						source,
					});
				} catch {}
			}
		}
	} catch {}

	return skills;
}

function loadClaudeSkillsFromDir(dir: string, source: SkillSource): Skill[] {
	const skills: Skill[] = [];

	if (!existsSync(dir)) {
		return skills;
	}

	try {
		const entries = readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			if (!entry.isDirectory()) {
				continue;
			}

			const skillDir = join(dir, entry.name);
			const skillFile = join(skillDir, "SKILL.md");

			if (!existsSync(skillFile)) {
				continue;
			}

			try {
				const rawContent = readFileSync(skillFile, "utf-8");
				const { frontmatter } = parseFrontmatter(rawContent);

				if (!frontmatter.description) {
					continue;
				}

				const name = frontmatter.name || entry.name;

				skills.push({
					name,
					description: frontmatter.description,
					filePath: skillFile,
					baseDir: skillDir,
					source,
				});
			} catch {}
		}
	} catch {}

	return skills;
}

export function loadSkills(): Skill[] {
	const skillMap = new Map<string, Skill>();

	const claudeUserDir = join(homedir(), ".claude", "skills");
	for (const skill of loadClaudeSkillsFromDir(claudeUserDir, "claude-user")) {
		skillMap.set(skill.name, skill);
	}

	const claudeProjectDir = resolve(process.cwd(), ".claude", "skills");
	for (const skill of loadClaudeSkillsFromDir(claudeProjectDir, "claude-project")) {
		skillMap.set(skill.name, skill);
	}

	const globalSkillsDir = join(homedir(), CONFIG_DIR_NAME, "agent", "skills");
	for (const skill of loadPiSkillsFromDir(globalSkillsDir, "user")) {
		skillMap.set(skill.name, skill);
	}

	const projectSkillsDir = resolve(process.cwd(), CONFIG_DIR_NAME, "skills");
	for (const skill of loadPiSkillsFromDir(projectSkillsDir, "project")) {
		skillMap.set(skill.name, skill);
	}

	return Array.from(skillMap.values());
}
