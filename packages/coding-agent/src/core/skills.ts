import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "fs";
import { homedir } from "os";
import { basename, dirname, isAbsolute, join, resolve } from "path";
import { CONFIG_DIR_NAME, getAgentDir } from "../config.js";
import { parseFrontmatter } from "../utils/frontmatter.js";

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
		errors.push("description is required");
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
 * Load skills from a directory.
 *
 * Discovery rules:
 * - direct .md children in the root
 * - recursive SKILL.md under subdirectories
 */
export function loadSkillsFromDir(options: LoadSkillsFromDirOptions): LoadSkillsResult {
	const { dir, source } = options;
	return loadSkillsFromDirInternal(dir, source, true);
}

function loadSkillsFromDirInternal(dir: string, source: string, includeRootFiles: boolean): LoadSkillsResult {
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

			// Skip node_modules to avoid scanning dependencies
			if (entry.name === "node_modules") {
				continue;
			}

			const fullPath = join(dir, entry.name);

			// For symlinks, check if they point to a directory and follow them
			let isDirectory = entry.isDirectory();
			let isFile = entry.isFile();
			if (entry.isSymbolicLink()) {
				try {
					const stats = statSync(fullPath);
					isDirectory = stats.isDirectory();
					isFile = stats.isFile();
				} catch {
					// Broken symlink, skip it
					continue;
				}
			}

			if (isDirectory) {
				const subResult = loadSkillsFromDirInternal(fullPath, source, false);
				skills.push(...subResult.skills);
				warnings.push(...subResult.warnings);
				continue;
			}

			if (!isFile) {
				continue;
			}

			const isRootMd = includeRootFiles && entry.name.endsWith(".md");
			const isSkillMd = !includeRootFiles && entry.name === "SKILL.md";
			if (!isRootMd && !isSkillMd) {
				continue;
			}

			const result = loadSkillFromFile(fullPath, source);
			if (result.skill) {
				skills.push(result.skill);
			}
			warnings.push(...result.warnings);
		}
	} catch {}

	return { skills, warnings };
}

function loadSkillFromFile(filePath: string, source: string): { skill: Skill | null; warnings: SkillWarning[] } {
	const warnings: SkillWarning[] = [];

	try {
		const rawContent = readFileSync(filePath, "utf-8");
		const { frontmatter } = parseFrontmatter<SkillFrontmatter>(rawContent);
		const allKeys = Object.keys(frontmatter);
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
	} catch (error) {
		const message = error instanceof Error ? error.message : "failed to parse skill file";
		warnings.push({ skillPath: filePath, message });
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

export interface LoadSkillsOptions {
	/** Working directory for project-local skills. Default: process.cwd() */
	cwd?: string;
	/** Agent config directory for global skills. Default: ~/.pi/agent */
	agentDir?: string;
	/** Explicit skill paths (files or directories) */
	skillPaths?: string[];
}

function normalizePath(input: string): string {
	const trimmed = input.trim();
	if (trimmed === "~") return homedir();
	if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
	if (trimmed.startsWith("~")) return join(homedir(), trimmed.slice(1));
	return trimmed;
}

function resolveSkillPath(p: string, cwd: string): string {
	const normalized = normalizePath(p);
	return isAbsolute(normalized) ? normalized : resolve(cwd, normalized);
}

/**
 * Load skills from all configured locations.
 * Returns skills and any validation warnings.
 */
export function loadSkills(options: LoadSkillsOptions = {}): LoadSkillsResult {
	const { cwd = process.cwd(), agentDir, skillPaths = [] } = options;

	// Resolve agentDir - if not provided, use default from config
	const resolvedAgentDir = agentDir ?? getAgentDir();

	const skillMap = new Map<string, Skill>();
	const realPathSet = new Set<string>();
	const allWarnings: SkillWarning[] = [];
	const collisionWarnings: SkillWarning[] = [];

	function addSkills(result: LoadSkillsResult) {
		allWarnings.push(...result.warnings);
		for (const skill of result.skills) {
			// Resolve symlinks to detect duplicate files
			let realPath: string;
			try {
				realPath = realpathSync(skill.filePath);
			} catch {
				realPath = skill.filePath;
			}

			// Skip silently if we've already loaded this exact file (via symlink)
			if (realPathSet.has(realPath)) {
				continue;
			}

			const existing = skillMap.get(skill.name);
			if (existing) {
				collisionWarnings.push({
					skillPath: skill.filePath,
					message: `name collision: "${skill.name}" already loaded from ${existing.filePath}, skipping this one`,
				});
			} else {
				skillMap.set(skill.name, skill);
				realPathSet.add(realPath);
			}
		}
	}

	addSkills(loadSkillsFromDirInternal(join(resolvedAgentDir, "skills"), "user", true));
	addSkills(loadSkillsFromDirInternal(resolve(cwd, CONFIG_DIR_NAME, "skills"), "project", true));

	for (const rawPath of skillPaths) {
		const resolvedPath = resolveSkillPath(rawPath, cwd);
		if (!existsSync(resolvedPath)) {
			allWarnings.push({ skillPath: resolvedPath, message: "skill path does not exist" });
			continue;
		}

		try {
			const stats = statSync(resolvedPath);
			if (stats.isDirectory()) {
				addSkills(loadSkillsFromDirInternal(resolvedPath, "custom", true));
			} else if (stats.isFile() && resolvedPath.endsWith(".md")) {
				const result = loadSkillFromFile(resolvedPath, "custom");
				if (result.skill) {
					addSkills({ skills: [result.skill], warnings: result.warnings });
				} else {
					allWarnings.push(...result.warnings);
				}
			} else {
				allWarnings.push({ skillPath: resolvedPath, message: "skill path is not a markdown file" });
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : "failed to read skill path";
			allWarnings.push({ skillPath: resolvedPath, message });
		}
	}

	return {
		skills: Array.from(skillMap.values()),
		warnings: [...allWarnings, ...collisionWarnings],
	};
}
