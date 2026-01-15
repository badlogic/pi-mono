import { spawnSync } from "child_process";
import { type Dirent, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { basename, delimiter, dirname, extname, join } from "path";
import { bashCompletionScript } from "./bash-completion-script.js";
import { fuzzyFilter } from "./fuzzy.js";

// Use fd to walk directory tree (fast, respects .gitignore)
function walkDirectoryWithFd(
	baseDir: string,
	fdPath: string,
	query: string,
	maxResults: number,
): Array<{ path: string; isDirectory: boolean }> {
	const args = ["--base-directory", baseDir, "--max-results", String(maxResults), "--type", "f", "--type", "d"];

	// Add query as pattern if provided
	if (query) {
		args.push(query);
	}

	const result = spawnSync(fdPath, args, {
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
		maxBuffer: 10 * 1024 * 1024,
	});

	if (result.status !== 0 || !result.stdout) {
		return [];
	}

	const lines = result.stdout.trim().split("\n").filter(Boolean);
	const results: Array<{ path: string; isDirectory: boolean }> = [];

	for (const line of lines) {
		// fd outputs directories with trailing /
		const isDirectory = line.endsWith("/");
		results.push({
			path: line,
			isDirectory,
		});
	}

	return results;
}

export interface AutocompleteItem {
	value: string;
	label: string;
	description?: string;
}

export interface SlashCommand {
	name: string;
	description?: string;
	// Function to get argument completions for this command
	// Returns null if no argument completion is available
	getArgumentCompletions?(argumentPrefix: string): AutocompleteItem[] | null;
}

export interface AutocompleteProvider {
	// Get autocomplete suggestions for current text/cursor position
	// Returns null if no suggestions available
	getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
	): {
		items: AutocompleteItem[];
		prefix: string; // What we're matching against (e.g., "/" or "src/")
	} | null;

	// Apply the selected item
	// Returns the new text and cursor position
	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): {
		lines: string[];
		cursorLine: number;
		cursorCol: number;
	};
}

// Combined provider that handles both slash commands and file paths
export class CombinedAutocompleteProvider implements AutocompleteProvider {
	private commands: (SlashCommand | AutocompleteItem)[];
	private basePath: string;
	private fdPath: string | null;
	private shellPath: string | undefined;
	private commandCache: { pathValue: string; commands: string[] } | null = null;

	constructor(
		commands: (SlashCommand | AutocompleteItem)[] = [],
		basePath: string = process.cwd(),
		fdPath: string | null = null,
		shellPath?: string,
	) {
		this.commands = commands;
		this.basePath = basePath;
		this.fdPath = fdPath;
		this.shellPath = shellPath;
	}

	getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
	): { items: AutocompleteItem[]; prefix: string } | null {
		const currentLine = lines[cursorLine] || "";
		const textBeforeCursor = currentLine.slice(0, cursorCol);

		// Check for @ file reference (fuzzy search) - must be after a space or at start
		const atMatch = textBeforeCursor.match(/(?:^|[\s])(@[^\s]*)$/);
		if (atMatch) {
			const prefix = atMatch[1] ?? "@"; // The @... part
			const query = prefix.slice(1); // Remove the @
			const suggestions = this.getFuzzyFileSuggestions(query);
			if (suggestions.length === 0) return null;

			return {
				items: suggestions,
				prefix: prefix,
			};
		}

		const shellSuggestions = this.getShellSuggestions(currentLine, cursorCol);
		if (shellSuggestions) {
			return shellSuggestions;
		}

		// Check for slash commands
		if (textBeforeCursor.startsWith("/")) {
			const spaceIndex = textBeforeCursor.indexOf(" ");

			if (spaceIndex === -1) {
				// No space yet - complete command names with fuzzy matching
				const prefix = textBeforeCursor.slice(1); // Remove the "/"
				const commandItems = this.commands.map((cmd) => ({
					name: "name" in cmd ? cmd.name : cmd.value,
					label: "name" in cmd ? cmd.name : cmd.label,
					description: cmd.description,
				}));

				const filtered = fuzzyFilter(commandItems, prefix, (item) => item.name).map((item) => ({
					value: item.name,
					label: item.label,
					...(item.description && { description: item.description }),
				}));

				if (filtered.length === 0) return null;

				return {
					items: filtered,
					prefix: textBeforeCursor,
				};
			} else {
				// Space found - complete command arguments
				const commandName = textBeforeCursor.slice(1, spaceIndex); // Command without "/"
				const argumentText = textBeforeCursor.slice(spaceIndex + 1); // Text after space

				const command = this.commands.find((cmd) => {
					const name = "name" in cmd ? cmd.name : cmd.value;
					return name === commandName;
				});
				if (!command || !("getArgumentCompletions" in command) || !command.getArgumentCompletions) {
					return null; // No argument completion for this command
				}

				const argumentSuggestions = command.getArgumentCompletions(argumentText);
				if (!argumentSuggestions || argumentSuggestions.length === 0) {
					return null;
				}

				return {
					items: argumentSuggestions,
					prefix: argumentText,
				};
			}
		}

		// Check for file paths - triggered by Tab or if we detect a path pattern
		const pathMatch = this.extractPathPrefix(textBeforeCursor, false);

		if (pathMatch !== null) {
			const suggestions = this.getFileSuggestions(pathMatch);
			if (suggestions.length === 0) return null;

			// Check if we have an exact match that is a directory
			// In that case, we might want to return suggestions for the directory content instead
			// But only if the prefix ends with /
			if (suggestions.length === 1 && suggestions[0]?.value === pathMatch && !pathMatch.endsWith("/")) {
				// Exact match found (e.g. user typed "src" and "src/" is the only match)
				// We still return it so user can select it and add /
				return {
					items: suggestions,
					prefix: pathMatch,
				};
			}

			return {
				items: suggestions,
				prefix: pathMatch,
			};
		}

		return null;
	}

	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): { lines: string[]; cursorLine: number; cursorCol: number } {
		const currentLine = lines[cursorLine] || "";
		const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
		const afterCursor = currentLine.slice(cursorCol);

		// Check if we're completing a slash command (prefix starts with "/" but NOT a file path)
		// Slash commands are at the start of the line and don't contain path separators after the first /
		const isSlashCommand = prefix.startsWith("/") && beforePrefix.trim() === "" && !prefix.slice(1).includes("/");
		if (isSlashCommand) {
			// This is a command name completion
			const newLine = `${beforePrefix}/${item.value} ${afterCursor}`;
			const newLines = [...lines];
			newLines[cursorLine] = newLine;

			return {
				lines: newLines,
				cursorLine,
				cursorCol: beforePrefix.length + item.value.length + 2, // +2 for "/" and space
			};
		}

		// Check if we're completing a file attachment (prefix starts with "@")
		if (prefix.startsWith("@")) {
			// This is a file attachment completion
			const newLine = `${beforePrefix + item.value} ${afterCursor}`;
			const newLines = [...lines];
			newLines[cursorLine] = newLine;

			return {
				lines: newLines,
				cursorLine,
				cursorCol: beforePrefix.length + item.value.length + 1, // +1 for space
			};
		}

		// Check if we're in a slash command context (beforePrefix contains "/command ")
		const textBeforeCursor = currentLine.slice(0, cursorCol);
		if (textBeforeCursor.includes("/") && textBeforeCursor.includes(" ")) {
			// This is likely a command argument completion
			const newLine = beforePrefix + item.value + afterCursor;
			const newLines = [...lines];
			newLines[cursorLine] = newLine;

			return {
				lines: newLines,
				cursorLine,
				cursorCol: beforePrefix.length + item.value.length,
			};
		}

		// For file paths, complete the path
		const newLine = beforePrefix + item.value + afterCursor;
		const newLines = [...lines];
		newLines[cursorLine] = newLine;

		return {
			lines: newLines,
			cursorLine,
			cursorCol: beforePrefix.length + item.value.length,
		};
	}

	private getShellSuggestions(
		currentLine: string,
		cursorCol: number,
	): { items: AutocompleteItem[]; prefix: string } | null {
		const context = this.getShellCompletionContext(currentLine, cursorCol);
		if (!context) {
			return null;
		}

		const { commandLine, commandCursor, prefix } = context;
		const shellSuggestions = this.getBashCompletions(commandLine, commandCursor);

		if (shellSuggestions.length > 0) {
			const unique = Array.from(new Set(shellSuggestions));
			const filtered = prefix
				? unique.filter((value) => value.toLowerCase().startsWith(prefix.toLowerCase()))
				: unique;
			if (filtered.length > 0) {
				return {
					items: filtered.map((value) => ({ value, label: value })),
					prefix,
				};
			}
		}

		if (!prefix) {
			return null;
		}

		if (this.isPathLike(prefix)) {
			const suggestions = this.getFileSuggestions(prefix);
			if (suggestions.length === 0) return null;

			return { items: suggestions, prefix };
		}

		const suggestions = this.getCommandSuggestions(prefix);
		if (suggestions.length === 0) return null;

		return { items: suggestions, prefix };
	}

	private getShellCompletionContext(
		currentLine: string,
		cursorCol: number,
	): { commandLine: string; commandCursor: number; prefix: string } | null {
		const trimmedLine = currentLine.trimStart();
		if (!trimmedLine.startsWith("!")) {
			return null;
		}

		const leadingWhitespace = currentLine.length - trimmedLine.length;
		const bangCount = trimmedLine.startsWith("!!") ? 2 : 1;
		const commandStart = leadingWhitespace + bangCount;

		if (cursorCol < commandStart) {
			return null;
		}

		const rawCommandLine = currentLine.slice(commandStart);
		const rawCursor = cursorCol - commandStart;
		const trimmedCommandLine = rawCommandLine.trimStart();
		const trimOffset = rawCommandLine.length - trimmedCommandLine.length;
		const commandCursor = Math.max(0, rawCursor - trimOffset);
		const commandLine = trimmedCommandLine;
		const boundedCursor = Math.min(commandCursor, commandLine.length);
		const commandBeforeCursor = commandLine.slice(0, boundedCursor);
		const prefix = this.getShellCompletionPrefix(commandBeforeCursor);

		return {
			commandLine,
			commandCursor: boundedCursor,
			prefix,
		};
	}

	private getShellCompletionPrefix(commandBeforeCursor: string): string {
		const lastDelimiterIndex = Math.max(
			commandBeforeCursor.lastIndexOf(" "),
			commandBeforeCursor.lastIndexOf("\t"),
			commandBeforeCursor.lastIndexOf('"'),
			commandBeforeCursor.lastIndexOf("'"),
			commandBeforeCursor.lastIndexOf("="),
		);

		return lastDelimiterIndex === -1 ? commandBeforeCursor : commandBeforeCursor.slice(lastDelimiterIndex + 1);
	}

	private getBashCompletions(commandLine: string, cursorCol: number): string[] {
		if (!commandLine.trim()) {
			return [];
		}

		const shellPath = this.shellPath ?? "bash";
		if (!shellPath) {
			return [];
		}

		const script = bashCompletionScript;

		const result = spawnSync(shellPath, ["--noprofile", "--norc", "-ic", script], {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
			env: {
				...process.env,
				PI_BASH_COMPLETION_LINE: commandLine,
				PI_BASH_COMPLETION_POINT: String(cursorCol),
			},
			maxBuffer: 1024 * 1024,
		});

		if (result.error || result.status !== 0 || !result.stdout) {
			return [];
		}

		const suggestions = result.stdout.split(/\r?\n/).filter((line) => line.length > 0);
		const seen = new Set<string>();
		for (const suggestion of suggestions) {
			if (!seen.has(suggestion)) {
				seen.add(suggestion);
			}
		}

		return Array.from(seen).slice(0, 200);
	}

	private isPathLike(prefix: string): boolean {
		return prefix.includes("/") || prefix.startsWith(".") || prefix.startsWith("~");
	}

	private getCommandSuggestions(prefix: string): AutocompleteItem[] {
		if (!prefix) return [];

		const commands = this.getCommandList();
		if (commands.length === 0) return [];

		const filtered = fuzzyFilter(commands, prefix, (command) => command).slice(0, 100);
		return filtered.map((command) => ({
			value: command,
			label: command,
		}));
	}

	private getCommandList(): string[] {
		const pathValue = process.env.PATH ?? "";
		if (this.commandCache && this.commandCache.pathValue === pathValue) {
			return this.commandCache.commands;
		}

		const commandSet = new Set<string>();
		const directories = pathValue.split(delimiter).filter((dir) => dir.length > 0);
		const windowsExtensions = this.getWindowsPathExtensions();

		for (const dir of directories) {
			let entries: Dirent[];
			try {
				entries = readdirSync(dir, { withFileTypes: true });
			} catch {
				continue;
			}

			for (const entry of entries) {
				if (entry.isDirectory()) {
					continue;
				}

				const name = entry.name;
				const fullPath = join(dir, name);

				let stats: ReturnType<typeof statSync>;
				try {
					stats = statSync(fullPath);
				} catch {
					continue;
				}

				if (!stats.isFile()) {
					continue;
				}

				if (process.platform === "win32") {
					const normalized = this.normalizeWindowsCommandName(name, windowsExtensions);
					if (normalized) {
						commandSet.add(normalized);
					}
					continue;
				}

				if ((stats.mode & 0o111) === 0) {
					continue;
				}

				commandSet.add(name);
			}
		}

		const commands = Array.from(commandSet).sort((a, b) => a.localeCompare(b));
		this.commandCache = { pathValue, commands };
		return commands;
	}

	private getWindowsPathExtensions(): string[] {
		const pathext = process.env.PATHEXT;
		const extensions = pathext ? pathext.split(";") : [".COM", ".EXE", ".BAT", ".CMD"];
		return extensions.map((ext) => ext.trim().toLowerCase()).filter((ext) => ext.length > 0);
	}

	private normalizeWindowsCommandName(fileName: string, extensions: string[]): string | null {
		const extension = extname(fileName).toLowerCase();
		if (!extension) {
			return fileName;
		}

		if (extensions.includes(extension)) {
			return fileName.slice(0, -extension.length);
		}

		return null;
	}

	// Extract a path-like prefix from the text before cursor
	private extractPathPrefix(text: string, forceExtract: boolean = false): string | null {
		// Check for @ file attachment syntax first
		const atMatch = text.match(/@([^\s]*)$/);
		if (atMatch) {
			return atMatch[0]; // Return the full @path pattern
		}

		// Simple approach: find the last whitespace/delimiter and extract the word after it
		// This avoids catastrophic backtracking from nested quantifiers
		const lastDelimiterIndex = Math.max(
			text.lastIndexOf(" "),
			text.lastIndexOf("\t"),
			text.lastIndexOf('"'),
			text.lastIndexOf("'"),
			text.lastIndexOf("="),
		);

		const pathPrefix = lastDelimiterIndex === -1 ? text : text.slice(lastDelimiterIndex + 1);

		// For forced extraction (Tab key), always return something
		if (forceExtract) {
			return pathPrefix;
		}

		// For natural triggers, return if it looks like a path, ends with /, starts with ~/, .
		// Only return empty string if the text looks like it's starting a path context
		if (pathPrefix.includes("/") || pathPrefix.startsWith(".") || pathPrefix.startsWith("~/")) {
			return pathPrefix;
		}

		// Return empty string only if we're at the beginning of the line or after a space
		// (not after quotes or other delimiters that don't suggest file paths)
		if (pathPrefix === "" && (text === "" || text.endsWith(" "))) {
			return pathPrefix;
		}

		return null;
	}

	// Expand home directory (~/) to actual home path
	private expandHomePath(path: string): string {
		if (path.startsWith("~/")) {
			const expandedPath = join(homedir(), path.slice(2));
			// Preserve trailing slash if original path had one
			return path.endsWith("/") && !expandedPath.endsWith("/") ? `${expandedPath}/` : expandedPath;
		} else if (path === "~") {
			return homedir();
		}
		return path;
	}

	// Get file/directory suggestions for a given path prefix
	private getFileSuggestions(prefix: string): AutocompleteItem[] {
		try {
			let searchDir: string;
			let searchPrefix: string;
			let expandedPrefix = prefix;
			let isAtPrefix = false;

			// Handle @ file attachment prefix
			if (prefix.startsWith("@")) {
				isAtPrefix = true;
				expandedPrefix = prefix.slice(1); // Remove the @
			}

			// Handle home directory expansion
			if (expandedPrefix.startsWith("~")) {
				expandedPrefix = this.expandHomePath(expandedPrefix);
			}

			if (
				expandedPrefix === "" ||
				expandedPrefix === "./" ||
				expandedPrefix === "../" ||
				expandedPrefix === "~" ||
				expandedPrefix === "~/" ||
				expandedPrefix === "/" ||
				prefix === "@"
			) {
				// Complete from specified position
				if (prefix.startsWith("~") || expandedPrefix === "/") {
					searchDir = expandedPrefix;
				} else {
					searchDir = join(this.basePath, expandedPrefix);
				}
				searchPrefix = "";
			} else if (expandedPrefix.endsWith("/")) {
				// If prefix ends with /, show contents of that directory
				if (prefix.startsWith("~") || expandedPrefix.startsWith("/")) {
					searchDir = expandedPrefix;
				} else {
					searchDir = join(this.basePath, expandedPrefix);
				}
				searchPrefix = "";
			} else {
				// Split into directory and file prefix
				const dir = dirname(expandedPrefix);
				const file = basename(expandedPrefix);
				if (prefix.startsWith("~") || expandedPrefix.startsWith("/")) {
					searchDir = dir;
				} else {
					searchDir = join(this.basePath, dir);
				}
				searchPrefix = file;
			}

			const entries = readdirSync(searchDir, { withFileTypes: true });
			const suggestions: AutocompleteItem[] = [];

			for (const entry of entries) {
				if (!entry.name.toLowerCase().startsWith(searchPrefix.toLowerCase())) {
					continue;
				}

				// Check if entry is a directory (or a symlink pointing to a directory)
				let isDirectory = entry.isDirectory();
				if (!isDirectory && entry.isSymbolicLink()) {
					try {
						const fullPath = join(searchDir, entry.name);
						isDirectory = statSync(fullPath).isDirectory();
					} catch {
						// Broken symlink or permission error - treat as file
					}
				}

				let relativePath: string;
				const name = entry.name;

				// Handle @ prefix path construction
				if (isAtPrefix) {
					const pathWithoutAt = expandedPrefix;
					if (pathWithoutAt.endsWith("/")) {
						relativePath = `@${pathWithoutAt}${name}`;
					} else if (pathWithoutAt.includes("/")) {
						if (pathWithoutAt.startsWith("~/")) {
							const homeRelativeDir = pathWithoutAt.slice(2); // Remove ~/
							const dir = dirname(homeRelativeDir);
							relativePath = `@~/${dir === "." ? name : join(dir, name)}`;
						} else {
							relativePath = `@${join(dirname(pathWithoutAt), name)}`;
						}
					} else {
						if (pathWithoutAt.startsWith("~")) {
							relativePath = `@~/${name}`;
						} else {
							relativePath = `@${name}`;
						}
					}
				} else if (prefix.endsWith("/")) {
					// If prefix ends with /, append entry to the prefix
					relativePath = prefix + name;
				} else if (prefix.includes("/")) {
					// Preserve ~/ format for home directory paths
					if (prefix.startsWith("~/")) {
						const homeRelativeDir = prefix.slice(2); // Remove ~/
						const dir = dirname(homeRelativeDir);
						relativePath = `~/${dir === "." ? name : join(dir, name)}`;
					} else if (prefix.startsWith("/")) {
						// Absolute path - construct properly
						const dir = dirname(prefix);
						if (dir === "/") {
							relativePath = `/${name}`;
						} else {
							relativePath = `${dir}/${name}`;
						}
					} else {
						relativePath = join(dirname(prefix), name);
					}
				} else {
					// For standalone entries, preserve ~/ if original prefix was ~/
					if (prefix.startsWith("~")) {
						relativePath = `~/${name}`;
					} else {
						relativePath = name;
					}
				}

				suggestions.push({
					value: isDirectory ? `${relativePath}/` : relativePath,
					label: name + (isDirectory ? "/" : ""),
				});
			}

			// Sort directories first, then alphabetically
			suggestions.sort((a, b) => {
				const aIsDir = a.value.endsWith("/");
				const bIsDir = b.value.endsWith("/");
				if (aIsDir && !bIsDir) return -1;
				if (!aIsDir && bIsDir) return 1;
				return a.label.localeCompare(b.label);
			});

			return suggestions;
		} catch (_e) {
			// Directory doesn't exist or not accessible
			return [];
		}
	}

	// Score an entry against the query (higher = better match)
	// isDirectory adds bonus to prioritize folders
	private scoreEntry(filePath: string, query: string, isDirectory: boolean): number {
		const fileName = basename(filePath);
		const lowerFileName = fileName.toLowerCase();
		const lowerQuery = query.toLowerCase();

		let score = 0;

		// Exact filename match (highest)
		if (lowerFileName === lowerQuery) score = 100;
		// Filename starts with query
		else if (lowerFileName.startsWith(lowerQuery)) score = 80;
		// Substring match in filename
		else if (lowerFileName.includes(lowerQuery)) score = 50;
		// Substring match in full path
		else if (filePath.toLowerCase().includes(lowerQuery)) score = 30;

		// Directories get a bonus to appear first
		if (isDirectory && score > 0) score += 10;

		return score;
	}

	// Fuzzy file search using fd (fast, respects .gitignore)
	private getFuzzyFileSuggestions(query: string): AutocompleteItem[] {
		if (!this.fdPath) {
			// fd not available, return empty results
			return [];
		}

		try {
			const entries = walkDirectoryWithFd(this.basePath, this.fdPath, query, 100);

			// Score entries
			const scoredEntries = entries
				.map((entry) => ({
					...entry,
					score: query ? this.scoreEntry(entry.path, query, entry.isDirectory) : 1,
				}))
				.filter((entry) => entry.score > 0);

			// Sort by score (descending) and take top 20
			scoredEntries.sort((a, b) => b.score - a.score);
			const topEntries = scoredEntries.slice(0, 20);

			// Build suggestions
			const suggestions: AutocompleteItem[] = [];
			for (const { path: entryPath, isDirectory } of topEntries) {
				// fd already includes trailing / for directories
				const pathWithoutSlash = isDirectory ? entryPath.slice(0, -1) : entryPath;
				const entryName = basename(pathWithoutSlash);

				suggestions.push({
					value: `@${entryPath}`,
					label: entryName + (isDirectory ? "/" : ""),
					description: pathWithoutSlash,
				});
			}

			return suggestions;
		} catch {
			return [];
		}
	}

	// Force file completion (called on Tab key) - always returns suggestions
	getForceFileSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
	): { items: AutocompleteItem[]; prefix: string } | null {
		const currentLine = lines[cursorLine] || "";
		const textBeforeCursor = currentLine.slice(0, cursorCol);

		// Don't trigger if we're typing a slash command at the start of the line
		if (textBeforeCursor.trim().startsWith("/") && !textBeforeCursor.trim().includes(" ")) {
			return null;
		}

		const shellSuggestions = this.getShellSuggestions(currentLine, cursorCol);
		if (shellSuggestions) {
			return shellSuggestions;
		}

		// Force extract path prefix - this will always return something
		const pathMatch = this.extractPathPrefix(textBeforeCursor, true);
		if (pathMatch !== null) {
			const suggestions = this.getFileSuggestions(pathMatch);
			if (suggestions.length === 0) return null;

			return {
				items: suggestions,
				prefix: pathMatch,
			};
		}

		return null;
	}

	// Check if we should trigger file completion (called on Tab key)
	shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number): boolean {
		const currentLine = lines[cursorLine] || "";
		const textBeforeCursor = currentLine.slice(0, cursorCol);

		// Don't trigger if we're typing a slash command at the start of the line
		if (textBeforeCursor.trim().startsWith("/") && !textBeforeCursor.trim().includes(" ")) {
			return false;
		}

		return true;
	}
}
