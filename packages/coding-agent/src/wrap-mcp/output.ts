/**
 * Output Writer
 * Handles writing generated files to disk
 */

import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

/**
 * Resolve output path, expanding ~ to home directory
 * @param path - Path that may contain ~
 * @returns Resolved absolute path
 */
export function resolvePath(path: string): string {
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

/**
 * Check if output directory exists
 * @param outputDir - Output directory path
 * @returns true if directory exists
 */
export function outputExists(outputDir: string): boolean {
	return existsSync(resolvePath(outputDir));
}

/**
 * Write files to output directory
 * @param outputDir - Output directory path
 * @param files - Map of filename to content
 * @param options - Options
 * @param options.force - Overwrite existing directory
 */
export function writeOutput(outputDir: string, files: Record<string, string>, options: { force?: boolean } = {}): void {
	const { force = false } = options;
	const resolvedDir = resolvePath(outputDir);

	// Check if directory exists
	if (existsSync(resolvedDir)) {
		if (!force) {
			throw new Error(`Output directory exists: ${outputDir}\nUse --force to overwrite`);
		}
		// Remove existing directory
		rmSync(resolvedDir, { recursive: true });
	}

	// Create output directory
	mkdirSync(resolvedDir, { recursive: true });

	// Write each file
	for (const [filename, content] of Object.entries(files)) {
		const filePath = join(resolvedDir, filename);

		// Ensure parent directory exists (for nested files)
		const parentDir = dirname(filePath);
		if (!existsSync(parentDir)) {
			mkdirSync(parentDir, { recursive: true });
		}

		writeFileSync(filePath, content, "utf-8");

		// Make .js and .sh files executable
		if (filename.endsWith(".js") || filename.endsWith(".sh")) {
			chmodSync(filePath, 0o755);
		}
	}
}

/**
 * Get the default output directory for agent tools
 * @param name - Tool name
 * @returns Path like ~/agent-tools/<name>
 */
export function getDefaultOutputDir(name: string): string {
	return `~/agent-tools/${name}`;
}
