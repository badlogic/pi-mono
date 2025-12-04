/**
 * Agent Registration
 * Handles registration of tools to AGENTS.md files
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { resolvePath } from "./output.js";

const LOCAL_FILE_PRIORITY = ["AGENTS.md", "CLAUDE.md"];

/**
 * Get the global AGENTS.md path
 * @returns Path to ~/.pi/agent/AGENTS.md
 */
export function getGlobalAgentsPath(): string {
	return join(homedir(), ".pi", "agent", "AGENTS.md");
}

/**
 * Detect which agent file to use in local directory
 * Checks for existing AGENTS.md or CLAUDE.md
 * @param cwd - Current working directory
 * @returns Full path to local agent file (creates AGENTS.md if neither exists)
 */
export function detectLocalAgentsFile(cwd: string = process.cwd()): string {
	for (const filename of LOCAL_FILE_PRIORITY) {
		const fullPath = join(cwd, filename);
		if (existsSync(fullPath)) {
			return fullPath;
		}
	}
	// Return path to AGENTS.md (will be created)
	return join(cwd, "AGENTS.md");
}

/**
 * Register entry to a target file
 * Appends content to the file, creating it if necessary
 * @param targetPath - Path to target file (may contain ~)
 * @param entryContent - Content to append
 * @returns Result object
 */
export function registerEntry(
	targetPath: string,
	entryContent: string,
): { success: boolean; path: string; error?: string } {
	const resolvedPath = resolvePath(targetPath);

	try {
		const dir = dirname(resolvedPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}

		let existingContent = "";
		if (existsSync(resolvedPath)) {
			existingContent = readFileSync(resolvedPath, "utf-8");
		}

		// Determine separator based on existing content
		let separator = "";
		if (existingContent.length > 0) {
			if (existingContent.endsWith("\n\n")) {
				separator = "";
			} else if (existingContent.endsWith("\n")) {
				separator = "\n";
			} else {
				separator = "\n\n";
			}
		}

		const newContent = existingContent + separator + entryContent.trim() + "\n";
		writeFileSync(resolvedPath, newContent, "utf-8");

		return { success: true, path: targetPath };
	} catch (error: any) {
		return { success: false, path: targetPath, error: error.message };
	}
}
