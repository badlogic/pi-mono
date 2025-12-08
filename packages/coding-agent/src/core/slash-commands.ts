import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { CONFIG_DIR_NAME, getCommandsDir } from "../utils/config.js";

/**
 * Represents a custom slash command loaded from a file
 */
export interface FileSlashCommand {
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
 * Substitute argument placeholders in command content
 * Supports $1, $2, ... for positional args and $@ for all args
 */
export function substituteArgs(content: string, args: string[]): string {
	let result = content;

	// Replace $@ with all args joined
	result = result.replace(/\$@/g, args.join(" "));

	// Replace $1, $2, etc. with positional args
	result = result.replace(/\$(\d+)/g, (_, num) => {
		const index = parseInt(num, 10) - 1;
		return args[index] ?? "";
	});

	return result;
}

/**
 * Recursively scan a directory for .md files and load them as slash commands
 */
function loadCommandsFromDir(dir: string, source: "user" | "project", subdir: string = ""): FileSlashCommand[] {
	const commands: FileSlashCommand[] = [];

	if (!existsSync(dir)) {
		return commands;
	}

	try {
		const entries = readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = join(dir, entry.name);

			if (entry.isDirectory()) {
				// Recurse into subdirectory
				const newSubdir = subdir ? `${subdir}:${entry.name}` : entry.name;
				commands.push(...loadCommandsFromDir(fullPath, source, newSubdir));
			} else if (entry.isFile() && entry.name.endsWith(".md")) {
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

					commands.push({
						name,
						description,
						content,
						source: sourceStr,
					});
				} catch (error) {
					// Silently skip files that can't be read
				}
			}
		}
	} catch (error) {
		// Silently skip directories that can't be read
	}

	return commands;
}

/**
 * Load all custom slash commands from:
 * 1. Global: ~/{CONFIG_DIR_NAME}/agent/commands/
 * 2. Project: ./{CONFIG_DIR_NAME}/commands/
 */
export function loadSlashCommands(): FileSlashCommand[] {
	const commands: FileSlashCommand[] = [];

	// 1. Load global commands from ~/{CONFIG_DIR_NAME}/agent/commands/
	const globalCommandsDir = getCommandsDir();
	commands.push(...loadCommandsFromDir(globalCommandsDir, "user"));

	// 2. Load project commands from ./{CONFIG_DIR_NAME}/commands/
	const projectCommandsDir = resolve(process.cwd(), CONFIG_DIR_NAME, "commands");
	commands.push(...loadCommandsFromDir(projectCommandsDir, "project"));

	return commands;
}

/**
 * Expand a slash command if it matches a file-based command.
 * Returns the expanded content or the original text if not a slash command.
 */
export function expandSlashCommand(text: string, fileCommands: FileSlashCommand[]): string {
	if (!text.startsWith("/")) return text;

	const spaceIndex = text.indexOf(" ");
	const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
	const argsString = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);

	const fileCommand = fileCommands.find((cmd) => cmd.name === commandName);
	if (fileCommand) {
		const args = parseCommandArgs(argsString);
		return substituteArgs(fileCommand.content, args);
	}

	return text;
}
