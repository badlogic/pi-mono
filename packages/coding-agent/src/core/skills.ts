import { existsSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join, resolve } from "path";
import { CONFIG_DIR_NAME } from "../config.js";

/**
 * Standard frontmatter fields per Agent Skills spec.
 * See: https://agentskills.io/specification#frontmatter-required
 */
const ALLOWED_FRONTMATTER_FIELDS = new Set([
	"name",
	"description",
	"license",
	"compatibility",
	"metadata",
	"allowed-tools",
]);

/** Max name length per spec */
const MAX_NAME_LENGTH = 64;

/** Max description length per spec */
const MAX_DESCRIPTION_LENGTH = 1024;

export interface SkillFrontmatter {
	name?: string;
	description?: string;
	[key: string]: unknown;
}

export interface Skill {
	name: string;
	description: string;
	filePath: string;
	baseDir: string;
	source: string;
}

export interface SkillWarning {
	skillPath: string;
	message: string;
}

export interface LoadSkillsResult {
	skills: Skill[];
	warnings: SkillWarning[];
}

type SkillFormat = "recursive" | "claude";

function stripQuotes(value: string): string {
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value;
}

function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string; allKeys: string[] } {
	const frontmatter: SkillFrontmatter = {};
	const allKeys: string[] = [];

	const normalizedContent = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

	if (!normalizedContent.startsWith("---")) {
		return { frontmatter, body: normalizedContent, allKeys };
	}

	const endIndex = normalizedContent.indexOf("\n---", 3);
	if (endIndex === -1) {
		return { frontmatter, body: normalizedContent, allKeys };
	}

	const frontmatterBlock = normalizedContent.slice(4, endIndex);
	const body = normalizedContent.slice(endIndex + 4).trim();

	for (const line of frontmatterBlock.split("\n")) {
		const match = line.match(/^(\w[\w-]*):\s*(.*)$/);
		if (match) {
			const key = match[1];
			const value = stripQuotes(match[2].trim());
			allKeys.push(key);
			if (key === "name") {
				frontmatter.name = value;
			} else if (key === "description") {
				frontmatter.description = value;
			}
		}
	}

	return { frontmatter, body, allKeys };
}

/**
 * Validate skill name per Agent Skills spec.
 * Returns array of validation error messages (empty if valid).
 */
function validateName(name: string, parentDirName: string): string[] {
	const errors: string[] = [];

	if (name !== parentDirName) {
		errors.push(`name "${name}" does not match parent directory "${parentDirName}"`);
	}

	if (name.length > MAX_NAME_LENGTH) {
		errors.push(`name exceeds ${MAX_NAME_LENGTH} characters (${name.length})`);
	}

	if (!/^[a-z0-9-]+$/.test(name)) {
		errors.push(`name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)`);
	}

	if (name.startsWith("-") || name.endsWith("-")) {
		errors.push(`name must not start or end with a hyphen`);
	}

	if (name.includes("--")) {
		errors.push(`name must not contain consecutive hyphens`);
	}

	return errors;
}

/**
 * Validate description per Agent Skills spec.
 */
function validateDescription(description: string | undefined): string[] {
	const errors: string[] = [];

	if (!description || description.trim() === "") {
		errors.push(`description is required`);
	} else if (description.length > MAX_DESCRIPTION_LENGTH) {
		errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters (${description.length})`);
	}

	return errors;
}

/**
 * Check for unknown frontmatter fields.
 */
function validateFrontmatterFields(keys: string[]): string[] {
	const errors: string[] = [];
	for (const key of keys) {
		if (!ALLOWED_FRONTMATTER_FIELDS.has(key)) {
			errors.push(`unknown frontmatter field "${key}"`);
		}
	}
	return errors;
}

export interface LoadSkillsFromDirOptions {
	/** Directory to scan for skills */
	dir: string;
	/** Source identifier for these skills */
	source: string;
}

/**
 * Load skills from a directory recursively.
 * Skills are directories containing a SKILL.md file with frontmatter including a description.
 */
export function loadSkillsFromDir(options: LoadSkillsFromDirOptions): LoadSkillsResult {
	const { dir, source } = options;
	return loadSkillsFromDirInternal(dir, source, "recursive");
}

function loadSkillsFromDirInternal(dir: string, source: string, format: SkillFormat): LoadSkillsResult {
	const skills: Skill[] = [];
	const warnings: SkillWarning[] = [];

	if (!existsSync(dir)) {
		return { skills, warnings };
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
					const subResult = loadSkillsFromDirInternal(fullPath, source, format);
					skills.push(...subResult.skills);
					warnings.push(...subResult.warnings);
				} else if (entry.isFile() && entry.name === "SKILL.md") {
					const result = loadSkillFromFile(fullPath, source);
					if (result.skill) {
						skills.push(result.skill);
					}
					warnings.push(...result.warnings);
				}
			} else if (format === "claude") {
				// Claude format: only one level deep, each directory must contain SKILL.md
				if (!entry.isDirectory()) {
					continue;
				}

				const skillFile = join(fullPath, "SKILL.md");
				if (!existsSync(skillFile)) {
					continue;
				}

				const result = loadSkillFromFile(skillFile, source);
				if (result.skill) {
					skills.push(result.skill);
				}
				warnings.push(...result.warnings);
			}
		}
	} catch {}

	return { skills, warnings };
}

function loadSkillFromFile(filePath: string, source: string): { skill: Skill | null; warnings: SkillWarning[] } {
	const warnings: SkillWarning[] = [];

	try {
		const rawContent = readFileSync(filePath, "utf-8");
		const { frontmatter, allKeys } = parseFrontmatter(rawContent);
		const skillDir = dirname(filePath);
		const parentDirName = basename(skillDir);

		// Validate frontmatter fields
		const fieldErrors = validateFrontmatterFields(allKeys);
		for (const error of fieldErrors) {
			warnings.push({ skillPath: filePath, message: error });
		}

		// Validate description
		const descErrors = validateDescription(frontmatter.description);
		for (const error of descErrors) {
			warnings.push({ skillPath: filePath, message: error });
		}

		// Use name from frontmatter, or fall back to parent directory name
		const name = frontmatter.name || parentDirName;

		// Validate name
		const nameErrors = validateName(name, parentDirName);
		for (const error of nameErrors) {
			warnings.push({ skillPath: filePath, message: error });
		}

		// Still load the skill even with warnings (unless description is completely missing)
		if (!frontmatter.description || frontmatter.description.trim() === "") {
			return { skill: null, warnings };
		}

		return {
			skill: {
				name,
				description: frontmatter.description,
				filePath,
				baseDir: skillDir,
				source,
			},
			warnings,
		};
	} catch {
		return { skill: null, warnings };
	}
}

/**
 * Format skills for inclusion in a system prompt.
 * Uses XML format per Agent Skills standard.
 * See: https://agentskills.io/integrate-skills
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
	if (skills.length === 0) {
		return "";
	}

	const lines = [
		"\n\nThe following skills provide specialized instructions for specific tasks.",
		"Use the read tool to load a skill's file when the task matches its description.",
		"",
		"<available_skills>",
	];

	for (const skill of skills) {
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(skill.name)}</name>`);
		lines.push(`    <description>${escapeXml(skill.description)}</description>`);
		lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
		lines.push("  </skill>");
	}

	lines.push("</available_skills>");

	return lines.join("\n");
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/**
 * Load skills from all configured locations.
 * Returns skills and any validation warnings.
 */
export function loadSkills(): LoadSkillsResult {
	const skillMap = new Map<string, Skill>();
	const allWarnings: SkillWarning[] = [];
	const collisionWarnings: SkillWarning[] = [];

	function addSkills(result: LoadSkillsResult) {
		allWarnings.push(...result.warnings);
		for (const skill of result.skills) {
			const existing = skillMap.get(skill.name);
			if (existing) {
				collisionWarnings.push({
					skillPath: skill.filePath,
					message: `name collision: "${skill.name}" already loaded from ${existing.filePath}, skipping this one`,
				});
			} else {
				skillMap.set(skill.name, skill);
			}
		}
	}

	// Codex: recursive
	const codexUserDir = join(homedir(), ".codex", "skills");
	addSkills(loadSkillsFromDirInternal(codexUserDir, "codex-user", "recursive"));

	// Claude: single level only
	const claudeUserDir = join(homedir(), ".claude", "skills");
	addSkills(loadSkillsFromDirInternal(claudeUserDir, "claude-user", "claude"));

	const claudeProjectDir = resolve(process.cwd(), ".claude", "skills");
	addSkills(loadSkillsFromDirInternal(claudeProjectDir, "claude-project", "claude"));

	// Pi: recursive
	const globalSkillsDir = join(homedir(), CONFIG_DIR_NAME, "agent", "skills");
	addSkills(loadSkillsFromDirInternal(globalSkillsDir, "user", "recursive"));

	const projectSkillsDir = resolve(process.cwd(), CONFIG_DIR_NAME, "skills");
	addSkills(loadSkillsFromDirInternal(projectSkillsDir, "project", "recursive"));

	return {
		skills: Array.from(skillMap.values()),
		warnings: [...allWarnings, ...collisionWarnings],
	};
}
