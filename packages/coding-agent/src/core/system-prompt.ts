/**
 * System prompt construction and project context loading
 */

import chalk from "chalk";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { getAgentDir, getDocsPath, getReadmePath } from "../config.js";
import { formatSkillsForPrompt, loadSkills } from "./skills.js";
import type { ToolName } from "./tools/index.js";

/** Tool descriptions for system prompt */
const toolDescriptions: Record<ToolName, string> = {
	read: "Read file contents",
	bash: "Execute bash commands (ls, grep, find, etc.)",
	edit: "Make surgical edits to files (find exact text and replace)",
	write: "Create or overwrite files",
	grep: "Search file contents for patterns (respects .gitignore)",
	find: "Find files by glob pattern (respects .gitignore)",
	ls: "List directory contents",
};

/** Resolve input as file path or literal string */
function resolvePromptInput(input: string | undefined, description: string): string | undefined {
	if (!input) {
		return undefined;
	}

	if (existsSync(input)) {
		try {
			return readFileSync(input, "utf-8");
		} catch (error) {
			console.error(chalk.yellow(`Warning: Could not read ${description} file ${input}: ${error}`));
			return input;
		}
	}

	return input;
}

/** Look for AGENTS.md or CLAUDE.md in a directory (prefers AGENTS.md) */
function loadContextFileFromDir(dir: string): { path: string; content: string } | null {
	const candidates = ["AGENTS.md", "CLAUDE.md"];
	for (const filename of candidates) {
		const filePath = join(dir, filename);
		if (existsSync(filePath)) {
			try {
				return {
					path: filePath,
					content: readFileSync(filePath, "utf-8"),
				};
			} catch (error) {
				console.error(chalk.yellow(`Warning: Could not read ${filePath}: ${error}`));
			}
		}
	}
	return null;
}

/**
 * Load all project context files in order:
 * 1. Global: ~/{CONFIG_DIR_NAME}/agent/AGENTS.md or CLAUDE.md
 * 2. Parent directories (top-most first) down to cwd
 * Each returns {path, content} for separate messages
 */
export function loadProjectContextFiles(): Array<{ path: string; content: string }> {
	const contextFiles: Array<{ path: string; content: string }> = [];
	const seenPaths = new Set<string>();

	// 1. Load global context from ~/{CONFIG_DIR_NAME}/agent/
	const globalContextDir = getAgentDir();
	const globalContext = loadContextFileFromDir(globalContextDir);
	if (globalContext) {
		contextFiles.push(globalContext);
		seenPaths.add(globalContext.path);
	}

	// 2. Walk up from cwd to root, collecting all context files
	const cwd = process.cwd();
	const ancestorContextFiles: Array<{ path: string; content: string }> = [];

	let currentDir = cwd;
	const root = resolve("/");

	while (true) {
		const contextFile = loadContextFileFromDir(currentDir);
		if (contextFile && !seenPaths.has(contextFile.path)) {
			// Add to beginning so we get top-most parent first
			ancestorContextFiles.unshift(contextFile);
			seenPaths.add(contextFile.path);
		}

		// Stop if we've reached root
		if (currentDir === root) break;

		// Move up one directory
		const parentDir = resolve(currentDir, "..");
		if (parentDir === currentDir) break; // Safety check
		currentDir = parentDir;
	}

	// Add ancestor files in order (top-most → cwd)
	contextFiles.push(...ancestorContextFiles);

	return contextFiles;
}

export interface BuildSystemPromptOptions {
	customPrompt?: string;
	selectedTools?: ToolName[];
	appendSystemPrompt?: string;
	skillsEnabled?: boolean;
}

/** Build the system prompt with tools, guidelines, and context */
export function buildSystemPrompt(options: BuildSystemPromptOptions = {}): string {
	const { customPrompt, selectedTools, appendSystemPrompt, skillsEnabled = true } = options;
	const resolvedCustomPrompt = resolvePromptInput(customPrompt, "system prompt");
	const resolvedAppendPrompt = resolvePromptInput(appendSystemPrompt, "append system prompt");

	const now = new Date();
	const dateTime = now.toLocaleString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		timeZoneName: "short",
	});

	const appendSection = resolvedAppendPrompt ? `\n\n${resolvedAppendPrompt}` : "";

	if (resolvedCustomPrompt) {
		let prompt = resolvedCustomPrompt;

		if (appendSection) {
			prompt += appendSection;
		}

		// Append project context files
		const contextFiles = loadProjectContextFiles();
		if (contextFiles.length > 0) {
			prompt += "\n\n# Project Context\n\n";
			prompt += "The following project context files have been loaded:\n\n";
			for (const { path: filePath, content } of contextFiles) {
				prompt += `## ${filePath}\n\n${content}\n\n`;
			}
		}

		// Append skills section (only if read tool is available)
		const customPromptHasRead = !selectedTools || selectedTools.includes("read");
		if (skillsEnabled && customPromptHasRead) {
			const { skills } = loadSkills();
			prompt += formatSkillsForPrompt(skills);
		}

		// Add date/time and working directory last
		prompt += `\nCurrent date and time: ${dateTime}`;
		prompt += `\nCurrent working directory: ${process.cwd()}`;

		return prompt;
	}

	// Get absolute paths to documentation
	const readmePath = getReadmePath();
	const docsPath = getDocsPath();

	// Build tools list based on selected tools
	const tools = selectedTools || (["read", "bash", "edit", "write"] as ToolName[]);
	const toolsList = tools.map((t) => `- ${t}: ${toolDescriptions[t]}`).join("\n");

	// Build guidelines based on which tools are actually available
	const guidelinesList: string[] = [];

	const hasBash = tools.includes("bash");
	const hasEdit = tools.includes("edit");
	const hasWrite = tools.includes("write");
	const hasGrep = tools.includes("grep");
	const hasFind = tools.includes("find");
	const hasLs = tools.includes("ls");
	const hasRead = tools.includes("read");

	// Read-only mode notice (no bash, edit, or write)
	if (!hasBash && !hasEdit && !hasWrite) {
		guidelinesList.push("You are in READ-ONLY mode - you cannot modify files or execute arbitrary commands");
	}

	// Bash without edit/write = read-only bash mode
	if (hasBash && !hasEdit && !hasWrite) {
		guidelinesList.push(
			"Use bash ONLY for read-only operations (git log, gh issue view, curl, etc.) - do NOT modify any files",
		);
	}

	// File exploration guidelines
	if (hasBash && !hasGrep && !hasFind && !hasLs) {
		guidelinesList.push("Use bash for file operations like ls, grep, find");
	} else if (hasBash && (hasGrep || hasFind || hasLs)) {
		guidelinesList.push("Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)");
	}

	// Read before edit guideline
	if (hasRead && hasEdit) {
		guidelinesList.push("Use read to examine files before editing");
	}

	// Edit guideline
	if (hasEdit) {
		guidelinesList.push("Use edit for precise changes (old text must match exactly)");
	}

	// Write guideline
	if (hasWrite) {
		guidelinesList.push("Use write only for new files or complete rewrites");
	}

	// Output guideline (only when actually writing/executing)
	if (hasEdit || hasWrite) {
		guidelinesList.push(
			"When summarizing your actions, output plain text directly - do NOT use cat or bash to display what you did",
		);
	}

	// Always include these
	guidelinesList.push("Be concise in your responses");
	guidelinesList.push("Show file paths clearly when working with files");

	const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

	let prompt = `You are an expert coding assistant. You help users with coding tasks by reading files, executing commands, editing code, and writing new files.

Available tools:
${toolsList}

Guidelines:
${guidelines}

Documentation:
- Main documentation: ${readmePath}
- Additional docs: ${docsPath}
- When asked about: custom models/providers (README sufficient), themes (docs/theme.md), skills (docs/skills.md), hooks (docs/hooks.md), custom tools (docs/custom-tools.md), RPC (docs/rpc.md)`;

	if (appendSection) {
		prompt += appendSection;
	}

	// Append project context files
	const contextFiles = loadProjectContextFiles();
	if (contextFiles.length > 0) {
		prompt += "\n\n# Project Context\n\n";
		prompt += "The following project context files have been loaded:\n\n";
		for (const { path: filePath, content } of contextFiles) {
			prompt += `## ${filePath}\n\n${content}\n\n`;
		}
	}

	// Append skills section (only if read tool is available)
	if (skillsEnabled && hasRead) {
		const { skills } = loadSkills();
		prompt += formatSkillsForPrompt(skills);
	}

	// Add date/time and working directory last
	prompt += `\nCurrent date and time: ${dateTime}`;
	prompt += `\nCurrent working directory: ${process.cwd()}`;

	return prompt;
}
