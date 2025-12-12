import { existsSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join, resolve } from "path";
import { CONFIG_DIR_NAME } from "../config.js";

export interface SkillFrontmatter {
	name?: string;
	description: string;
}

export type SkillSource = "user" | "project" | "claude-user" | "claude-project" | "codex-user";

export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	source: SkillSource;
}

type SkillFormat = "recursive" | "claude";

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

function loadSkillsFromDir(
	dir: string,
	source: SkillSource,
	format: SkillFormat,
	useColonPath: boolean = false,
	subdir: string = "",
): Skill[] {
	const skills: Skill[] = [];

	if (!existsSync(dir)) {
		return skills;
	}

	try {
		const entries = readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			if (entry.name.startsWith(".")) {
				continue;
			}

			if (entry.isSymbolicLink()) {
				continue;
			}

			const fullPath = join(dir, entry.name);

			if (format === "recursive") {
				// Recursive format: scan directories, look for SKILL.md files
				if (entry.isDirectory()) {
					const newSubdir = subdir ? `${subdir}:${entry.name}` : entry.name;
					skills.push(...loadSkillsFromDir(fullPath, source, format, useColonPath, newSubdir));
				} else if (entry.isFile() && entry.name === "SKILL.md") {
					try {
						const rawContent = readFileSync(fullPath, "utf-8");
						const { frontmatter } = parseFrontmatter(rawContent);

						if (!frontmatter.description) {
							continue;
						}

						const skillDir = dirname(fullPath);
						// useColonPath: db:migrate (pi), otherwise just: migrate (codex)
						const nameFromPath = useColonPath ? subdir || basename(skillDir) : basename(skillDir);
						const name = frontmatter.name || nameFromPath;

						skills.push({
							name,
							description: frontmatter.description,
							filePath: fullPath,
							baseDir: skillDir,
							source,
						});
					} catch {}
				}
			} else if (format === "claude") {
				// Claude format: only one level deep, each directory must contain SKILL.md
				if (!entry.isDirectory()) {
					continue;
				}

				const skillDir = fullPath;
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
		}
	} catch {}

	return skills;
}

export function loadSkills(): Skill[] {
	const skillMap = new Map<string, Skill>();

	// Codex: recursive, simple directory name
	const codexUserDir = join(homedir(), ".codex", "skills");
	for (const skill of loadSkillsFromDir(codexUserDir, "codex-user", "recursive", false)) {
		skillMap.set(skill.name, skill);
	}

	// Claude: single level only
	const claudeUserDir = join(homedir(), ".claude", "skills");
	for (const skill of loadSkillsFromDir(claudeUserDir, "claude-user", "claude", false)) {
		skillMap.set(skill.name, skill);
	}

	const claudeProjectDir = resolve(process.cwd(), ".claude", "skills");
	for (const skill of loadSkillsFromDir(claudeProjectDir, "claude-project", "claude", false)) {
		skillMap.set(skill.name, skill);
	}

	// Pi: recursive, colon-separated path names
	const globalSkillsDir = join(homedir(), CONFIG_DIR_NAME, "agent", "skills");
	for (const skill of loadSkillsFromDir(globalSkillsDir, "user", "recursive", true)) {
		skillMap.set(skill.name, skill);
	}

	const projectSkillsDir = resolve(process.cwd(), CONFIG_DIR_NAME, "skills");
	for (const skill of loadSkillsFromDir(projectSkillsDir, "project", "recursive", true)) {
		skillMap.set(skill.name, skill);
	}

	return Array.from(skillMap.values());
}
