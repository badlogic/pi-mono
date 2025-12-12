import { existsSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join, resolve } from "path";
import { CONFIG_DIR_NAME } from "../config.js";

export interface SkillFrontmatter {
	name?: string;
	description: string;
}

export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	source: string;
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

export interface LoadSkillsFromDirOptions {
	/** Directory to scan for skills */
	dir: string;
	/** Source identifier for these skills */
	source: string;
	/** Use colon-separated path names (e.g., db:migrate) instead of simple directory name */
	useColonPath?: boolean;
}

/**
 * Load skills from a directory recursively.
 * Skills are directories containing a SKILL.md file with frontmatter including a description.
 */
export function loadSkillsFromDir(options: LoadSkillsFromDirOptions, subdir: string = ""): Skill[] {
	const { dir, source, useColonPath = false } = options;
	return loadSkillsFromDirInternal(dir, source, "recursive", useColonPath, subdir);
}

function loadSkillsFromDirInternal(
	dir: string,
	source: string,
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
					skills.push(...loadSkillsFromDirInternal(fullPath, source, format, useColonPath, newSubdir));
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

/**
 * Format skills for inclusion in a system prompt.
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
	if (skills.length === 0) {
		return "";
	}

	const lines = [
		"\n\n<available_skills>",
		"The following skills provide specialized instructions for specific tasks.",
		"Use the read tool to load a skill's file when the task matches its description.",
		"Skills may contain {baseDir} placeholders - replace them with the skill's base directory path.\n",
	];

	for (const skill of skills) {
		lines.push(`- ${skill.name}: ${skill.description}`);
		lines.push(`  File: ${skill.filePath}`);
		lines.push(`  Base directory: ${skill.baseDir}`);
	}

	lines.push("</available_skills>");

	return lines.join("\n");
}

export function loadSkills(): Skill[] {
	const skillMap = new Map<string, Skill>();

	// Codex: recursive, simple directory name
	const codexUserDir = join(homedir(), ".codex", "skills");
	for (const skill of loadSkillsFromDirInternal(codexUserDir, "codex-user", "recursive", false)) {
		skillMap.set(skill.name, skill);
	}

	// Claude: single level only
	const claudeUserDir = join(homedir(), ".claude", "skills");
	for (const skill of loadSkillsFromDirInternal(claudeUserDir, "claude-user", "claude", false)) {
		skillMap.set(skill.name, skill);
	}

	const claudeProjectDir = resolve(process.cwd(), ".claude", "skills");
	for (const skill of loadSkillsFromDirInternal(claudeProjectDir, "claude-project", "claude", false)) {
		skillMap.set(skill.name, skill);
	}

	// Pi: recursive, colon-separated path names
	const globalSkillsDir = join(homedir(), CONFIG_DIR_NAME, "agent", "skills");
	for (const skill of loadSkillsFromDirInternal(globalSkillsDir, "user", "recursive", true)) {
		skillMap.set(skill.name, skill);
	}

	const projectSkillsDir = resolve(process.cwd(), CONFIG_DIR_NAME, "skills");
	for (const skill of loadSkillsFromDirInternal(projectSkillsDir, "project", "recursive", true)) {
		skillMap.set(skill.name, skill);
	}

	return Array.from(skillMap.values());
}
