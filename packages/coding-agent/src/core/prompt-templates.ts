import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { CONFIG_DIR_NAME, getPromptsDir } from "../config.js";

/**
 * Represents a prompt template loaded from a markdown file
 */
export interface PromptTemplate {
	name: string;
	description: string;
	content: string;
	source: string; // e.g., "(user)", "(project)", "(project:frontend)"
}

/**
 * Parse YAML frontmatter from markdown content
 * Returns { frontmatter, content } where content has frontmatter stripped
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; content: string } {
	const frontmatter: Record<string, string> = {};

	if (!content.startsWith("---")) {
		return { frontmatter, content };
	}

	const endIndex = content.indexOf("\n---", 3);
	if (endIndex === -1) {
		return { frontmatter, content };
	}

	const frontmatterBlock = content.slice(4, endIndex);
	const remainingContent = content.slice(endIndex + 4).trim();

	// Simple YAML parsing - just key: value pairs
	for (const line of frontmatterBlock.split("\n")) {
		const match = line.match(/^(\w+):\s*(.*)$/);
		if (match) {
			frontmatter[match[1]] = match[2].trim();
		}
	}

	return { frontmatter, content: remainingContent };
}

/**
 * Parse command arguments respecting quoted strings (bash-style)
 * Returns array of arguments
 */
export function parseCommandArgs(argsString: string): string[] {
	const args: string[] = [];
	let current = "";
	let inQuote: string | null = null;

	for (let i = 0; i < argsString.length; i++) {
		const char = argsString[i];

		if (inQuote) {
			if (char === inQuote) {
				inQuote = null;
			} else {
				current += char;
			}
		} else if (char === '"' || char === "'") {
			inQuote = char;
		} else if (char === " " || char === "\t") {
			if (current) {
				args.push(current);
				current = "";
			}
		} else {
			current += char;
		}
	}

	if (current) {
		args.push(current);
	}

	return args;
}

/**
 * Substitute argument placeholders in template content
 * Supports $1, $2, ... for positional args, $@ and $ARGUMENTS for all args
 *
 * Note: Replacement happens on the template string only. Argument values
 * containing patterns like $1, $@, or $ARGUMENTS are NOT recursively substituted.
 */
export function substituteArgs(content: string, args: string[]): string {
	let result = content;

	// Replace $1, $2, etc. with positional args FIRST (before wildcards)
	// This prevents wildcard replacement values containing $<digit> patterns from being re-substituted
	result = result.replace(/\$(\d+)/g, (_, num) => {
		const index = parseInt(num, 10) - 1;
		return args[index] ?? "";
	});

	// Pre-compute all args joined (optimization)
	const allArgs = args.join(" ");

	// Replace $ARGUMENTS with all args joined (new syntax, aligns with Claude, Codex, OpenCode)
	result = result.replace(/\$ARGUMENTS/g, allArgs);

	// Replace $@ with all args joined (existing syntax)
	result = result.replace(/\$@/g, allArgs);

	return result;
}

/**
 * Recursively scan a directory for .md files (and symlinks to .md files) and load them as prompt templates
 */
function loadTemplatesFromDir(dir: string, source: "user" | "project", subdir: string = ""): PromptTemplate[] {
	const templates: PromptTemplate[] = [];

	if (!existsSync(dir)) {
		return templates;
	}

	try {
		const entries = readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = join(dir, entry.name);

			if (entry.isDirectory()) {
				// Recurse into subdirectory
				const newSubdir = subdir ? `${subdir}:${entry.name}` : entry.name;
				templates.push(...loadTemplatesFromDir(fullPath, source, newSubdir));
			} else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md")) {
				try {
					const rawContent = readFileSync(fullPath, "utf-8");
					const { frontmatter, content } = parseFrontmatter(rawContent);

					const name = entry.name.slice(0, -3); // Remove .md extension

					// Build source string
					let sourceStr: string;
					if (source === "user") {
						sourceStr = subdir ? `(user:${subdir})` : "(user)";
					} else {
						sourceStr = subdir ? `(project:${subdir})` : "(project)";
					}

					// Get description from frontmatter or first non-empty line
					let description = frontmatter.description || "";
					if (!description) {
						const firstLine = content.split("\n").find((line) => line.trim());
						if (firstLine) {
							// Truncate if too long
							description = firstLine.slice(0, 60);
							if (firstLine.length > 60) description += "...";
						}
					}

					// Append source to description
					description = description ? `${description} ${sourceStr}` : sourceStr;

					templates.push({
						name,
						description,
						content,
						source: sourceStr,
					});
				} catch (_error) {
					// Silently skip files that can't be read
				}
			}
		}
	} catch (_error) {
		// Silently skip directories that can't be read
	}

	return templates;
}

export interface LoadPromptTemplatesOptions {
	/** Working directory for project-local templates. Default: process.cwd() */
	cwd?: string;
	/** Agent config directory for global templates. Default: from getPromptsDir() */
	agentDir?: string;
}

/**
 * Load all prompt templates from:
 * 1. Global: agentDir/prompts/
 * 2. Project: cwd/{CONFIG_DIR_NAME}/prompts/
 */
export function loadPromptTemplates(options: LoadPromptTemplatesOptions = {}): PromptTemplate[] {
	const resolvedCwd = options.cwd ?? process.cwd();
	const resolvedAgentDir = options.agentDir ?? getPromptsDir();

	const templates: PromptTemplate[] = [];

	// 1. Load global templates from agentDir/prompts/
	// Note: if agentDir is provided, it should be the agent dir, not the prompts dir
	const globalPromptsDir = options.agentDir ? join(options.agentDir, "prompts") : resolvedAgentDir;
	templates.push(...loadTemplatesFromDir(globalPromptsDir, "user"));

	// 2. Load project templates from cwd/{CONFIG_DIR_NAME}/prompts/
	const projectPromptsDir = resolve(resolvedCwd, CONFIG_DIR_NAME, "prompts");
	templates.push(...loadTemplatesFromDir(projectPromptsDir, "project"));

	return templates;
}

/**
 * Expand a prompt template if it matches a template name.
 * Returns the expanded content or the original text if not a template.
 */
export function expandPromptTemplate(text: string, templates: PromptTemplate[]): string {
	if (!text.startsWith("/")) return text;

	const spaceIndex = text.indexOf(" ");
	const templateName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
	const argsString = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);

	const template = templates.find((t) => t.name === templateName);
	if (template) {
		const args = parseCommandArgs(argsString);
		return substituteArgs(template.content, args);
	}

	return text;
}
