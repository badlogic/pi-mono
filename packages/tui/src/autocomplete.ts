import { spawn, spawnSync } from "child_process";
import { readdirSync, statSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join } from "path";
import { createInterface } from "readline";
import { fuzzyFilter } from "./fuzzy.js";

const PATH_DELIMITERS = new Set([" ", "\t", '"', "'", "="]);

function findLastDelimiter(text: string): number {
	for (let i = text.length - 1; i >= 0; i -= 1) {
		if (PATH_DELIMITERS.has(text[i] ?? "")) {
			return i;
		}
	}
	return -1;
}

function findUnclosedQuoteStart(text: string): number | null {
	let inQuotes = false;
	let quoteStart = -1;

	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === '"') {
			inQuotes = !inQuotes;
			if (inQuotes) {
				quoteStart = i;
			}
		}
	}

	return inQuotes ? quoteStart : null;
}

function isTokenStart(text: string, index: number): boolean {
	return index === 0 || PATH_DELIMITERS.has(text[index - 1] ?? "");
}

function extractQuotedPrefix(text: string): string | null {
	const quoteStart = findUnclosedQuoteStart(text);
	if (quoteStart === null) {
		return null;
	}

	if (quoteStart > 0 && text[quoteStart - 1] === "@") {
		if (!isTokenStart(text, quoteStart - 1)) {
			return null;
		}
		return text.slice(quoteStart - 1);
	}

	if (!isTokenStart(text, quoteStart)) {
		return null;
	}

	return text.slice(quoteStart);
}

function parsePathPrefix(prefix: string): { rawPrefix: string; isAtPrefix: boolean; isQuotedPrefix: boolean } {
	if (prefix.startsWith('@"')) {
		return { rawPrefix: prefix.slice(2), isAtPrefix: true, isQuotedPrefix: true };
	}
	if (prefix.startsWith('"')) {
		return { rawPrefix: prefix.slice(1), isAtPrefix: false, isQuotedPrefix: true };
	}
	if (prefix.startsWith("@")) {
		return { rawPrefix: prefix.slice(1), isAtPrefix: true, isQuotedPrefix: false };
	}
	return { rawPrefix: prefix, isAtPrefix: false, isQuotedPrefix: false };
}

function buildCompletionValue(
	path: string,
	options: { isDirectory: boolean; isAtPrefix: boolean; isQuotedPrefix: boolean },
): string {
	const needsQuotes = options.isQuotedPrefix || path.includes(" ");
	const prefix = options.isAtPrefix ? "@" : "";

	if (!needsQuotes) {
		return `${prefix}${path}`;
	}

	const openQuote = `${prefix}"`;
	const closeQuote = '"';
	return `${openQuote}${path}${closeQuote}`;
}

function extractAttachmentPrefix(text: string): string | null {
	const quotedPrefix = extractQuotedPrefix(text);
	if (quotedPrefix?.startsWith('@"')) {
		return quotedPrefix;
	}

	const lastDelimiterIndex = findLastDelimiter(text);
	const tokenStart = lastDelimiterIndex === -1 ? 0 : lastDelimiterIndex + 1;

	if (text[tokenStart] === "@") {
		return text.slice(tokenStart);
	}

	return null;
}

function extractPathPrefix(text: string, forceExtract: boolean = false): string | null {
	const quotedPrefix = extractQuotedPrefix(text);
	if (quotedPrefix) {
		return quotedPrefix;
	}

	const lastDelimiterIndex = findLastDelimiter(text);
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

	// Return empty string only after a space (not for completely empty text)
	// Empty text should not trigger file suggestions - that's for forced Tab completion
	if (pathPrefix === "" && text.endsWith(" ")) {
		return pathPrefix;
	}

	return null;
}

type AutocompleteContext = {
	kind: "attachment" | "slash-command" | "command-argument" | "path";
	prefix: string;
};

function getAutocompleteContextFromText(textBeforeCursor: string): AutocompleteContext | null {
	const attachmentPrefix = extractAttachmentPrefix(textBeforeCursor);
	if (attachmentPrefix) {
		return {
			kind: "attachment",
			prefix: attachmentPrefix,
		};
	}

	if (textBeforeCursor.startsWith("/")) {
		const spaceIndex = textBeforeCursor.indexOf(" ");
		if (spaceIndex === -1) {
			return {
				kind: "slash-command",
				prefix: textBeforeCursor,
			};
		}

		return {
			kind: "command-argument",
			prefix: textBeforeCursor.slice(spaceIndex + 1),
		};
	}

	const pathPrefix = extractPathPrefix(textBeforeCursor);
	if (pathPrefix !== null) {
		return {
			kind: "path",
			prefix: pathPrefix,
		};
	}

	return null;
}

export function getAutocompleteContext(
	lines: string[],
	cursorLine: number,
	cursorCol: number,
): AutocompleteContext | null {
	const currentLine = lines[cursorLine] || "";
	const textBeforeCursor = currentLine.slice(0, cursorCol);
	return getAutocompleteContextFromText(textBeforeCursor);
}

function buildFdArgs(baseDir: string, query: string, maxResults: number): string[] {
	const args = [
		"--base-directory",
		baseDir,
		"--max-results",
		String(maxResults),
		"--type",
		"f",
		"--type",
		"d",
		"--full-path",
		"--hidden",
		"--exclude",
		".git",
		"--exclude",
		".git/*",
		"--exclude",
		".git/**",
	];

	if (query) {
		args.push(query);
	}

	return args;
}

// Use fd to walk directory tree (fast, respects .gitignore)
function walkDirectoryWithFd(
	baseDir: string,
	fdPath: string,
	query: string,
	maxResults: number,
): Array<{ path: string; isDirectory: boolean }> {
	const args = buildFdArgs(baseDir, query, maxResults);

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
		const normalizedPath = line.endsWith("/") ? line.slice(0, -1) : line;
		if (normalizedPath === ".git" || normalizedPath.startsWith(".git/") || normalizedPath.includes("/.git/")) {
			continue;
		}

		// fd outputs directories with trailing /
		const isDirectory = line.endsWith("/");
		results.push({
			path: line,
			isDirectory,
		});
	}

	return results;
}

// Stream fd output so async attachment autocomplete can publish incremental updates
function streamDirectoryWithFd(
	baseDir: string,
	fdPath: string,
	query: string,
	maxResults: number,
	options: {
		onEntry: (entry: { path: string; isDirectory: boolean }) => void;
		signal: AbortSignal;
	},
): Promise<void> {
	const args = buildFdArgs(baseDir, query, maxResults);

	return new Promise((resolve) => {
		let finished = false;
		const child = spawn(fdPath, args, {
			stdio: ["ignore", "pipe", "ignore"],
		});
		const stdout = child.stdout;
		const lineReader = stdout ? createInterface({ input: stdout, crlfDelay: Infinity }) : null;

		const finalize = (): void => {
			if (finished) {
				return;
			}

			finished = true;
			options.signal.removeEventListener("abort", handleAbort);
			if (lineReader) {
				lineReader.removeAllListeners();
				lineReader.close();
			}
			resolve();
		};

		const handleAbort = (): void => {
			if (!child.killed) {
				child.kill();
			}
			finalize();
		};

		if (options.signal.aborted) {
			handleAbort();
			return;
		}

		options.signal.addEventListener("abort", handleAbort, { once: true });

		if (!stdout || !lineReader) {
			finalize();
			return;
		}

		lineReader.on("line", (line: string) => {
			if (!line) {
				return;
			}

			const normalizedPath = line.endsWith("/") ? line.slice(0, -1) : line;
			if (normalizedPath === ".git" || normalizedPath.startsWith(".git/") || normalizedPath.includes("/.git/")) {
				return;
			}

			options.onEntry({
				path: line,
				isDirectory: line.endsWith("/"),
			});
		});

		child.on("close", finalize);
		child.on("error", finalize);
	});
}

export interface AutocompleteItem {
	value: string;
	label: string;
	description?: string;
}

export interface AutocompleteSuggestions {
	items: AutocompleteItem[];
	prefix: string;
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
	getSuggestions(lines: string[], cursorLine: number, cursorCol: number): AutocompleteSuggestions | null;

	// Stream async autocomplete suggestions for slow providers
	getSuggestionsAsync?(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		signal: AbortSignal,
		onUpdate: (suggestions: AutocompleteSuggestions) => void,
	): Promise<AutocompleteSuggestions | null>;

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

	constructor(
		commands: (SlashCommand | AutocompleteItem)[] = [],
		basePath: string = process.cwd(),
		fdPath: string | null = null,
	) {
		this.commands = commands;
		this.basePath = basePath;
		this.fdPath = fdPath;
	}

	getSuggestions(lines: string[], cursorLine: number, cursorCol: number): AutocompleteSuggestions | null {
		const currentLine = lines[cursorLine] || "";
		const textBeforeCursor = currentLine.slice(0, cursorCol);
		const context = getAutocompleteContext(lines, cursorLine, cursorCol);
		if (!context) return null;

		switch (context.kind) {
			case "attachment": {
				const { rawPrefix, isQuotedPrefix } = parsePathPrefix(context.prefix);
				const suggestions = this.getFuzzyFileSuggestions(rawPrefix, { isQuotedPrefix });
				if (suggestions.length === 0) return null;

				return {
					items: suggestions,
					prefix: context.prefix,
				};
			}

			case "slash-command": {
				const prefix = context.prefix.slice(1);
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
					prefix: context.prefix,
				};
			}

			case "command-argument": {
				const spaceIndex = textBeforeCursor.indexOf(" ");
				const commandName = textBeforeCursor.slice(1, spaceIndex);
				const argumentText = context.prefix;

				const command = this.commands.find((cmd) => {
					const name = "name" in cmd ? cmd.name : cmd.value;
					return name === commandName;
				});
				if (!command || !("getArgumentCompletions" in command) || !command.getArgumentCompletions) {
					return null;
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

			case "path": {
				const suggestions = this.getFileSuggestions(context.prefix);
				if (suggestions.length === 0) return null;

				return {
					items: suggestions,
					prefix: context.prefix,
				};
			}
		}
	}

	async getSuggestionsAsync(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		signal: AbortSignal,
		onUpdate: (suggestions: AutocompleteSuggestions) => void,
	): Promise<AutocompleteSuggestions | null> {
		if (!this.fdPath) {
			return null;
		}

		const context = getAutocompleteContext(lines, cursorLine, cursorCol);
		if (!context || context.kind !== "attachment") {
			return null;
		}

		const { rawPrefix, isQuotedPrefix } = parsePathPrefix(context.prefix);
		return this.getFuzzyFileSuggestionsAsync(rawPrefix, {
			isQuotedPrefix,
			prefix: context.prefix,
			signal,
			onUpdate,
		});
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
		const isQuotedPrefix = prefix.startsWith('"') || prefix.startsWith('@"');
		const hasLeadingQuoteAfterCursor = afterCursor.startsWith('"');
		const hasTrailingQuoteInItem = item.value.endsWith('"');
		const adjustedAfterCursor =
			isQuotedPrefix && hasTrailingQuoteInItem && hasLeadingQuoteAfterCursor ? afterCursor.slice(1) : afterCursor;

		// Check if we're completing a slash command (prefix starts with "/" but NOT a file path)
		// Slash commands are at the start of the line and don't contain path separators after the first /
		const isSlashCommand = prefix.startsWith("/") && beforePrefix.trim() === "" && !prefix.slice(1).includes("/");
		if (isSlashCommand) {
			// This is a command name completion
			const newLine = `${beforePrefix}/${item.value} ${adjustedAfterCursor}`;
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
			// Don't add space after directories so user can continue autocompleting
			const isDirectory = item.label.endsWith("/");
			const suffix = isDirectory ? "" : " ";
			const newLine = `${beforePrefix + item.value}${suffix}${adjustedAfterCursor}`;
			const newLines = [...lines];
			newLines[cursorLine] = newLine;

			const hasTrailingQuote = item.value.endsWith('"');
			const cursorOffset = isDirectory && hasTrailingQuote ? item.value.length - 1 : item.value.length;

			return {
				lines: newLines,
				cursorLine,
				cursorCol: beforePrefix.length + cursorOffset + suffix.length,
			};
		}

		// Check if we're in a slash command context (beforePrefix contains "/command ")
		const textBeforeCursor = currentLine.slice(0, cursorCol);
		if (textBeforeCursor.includes("/") && textBeforeCursor.includes(" ")) {
			// This is likely a command argument completion
			const newLine = beforePrefix + item.value + adjustedAfterCursor;
			const newLines = [...lines];
			newLines[cursorLine] = newLine;

			const isDirectory = item.label.endsWith("/");
			const hasTrailingQuote = item.value.endsWith('"');
			const cursorOffset = isDirectory && hasTrailingQuote ? item.value.length - 1 : item.value.length;

			return {
				lines: newLines,
				cursorLine,
				cursorCol: beforePrefix.length + cursorOffset,
			};
		}

		// For file paths, complete the path
		const newLine = beforePrefix + item.value + adjustedAfterCursor;
		const newLines = [...lines];
		newLines[cursorLine] = newLine;

		const isDirectory = item.label.endsWith("/");
		const hasTrailingQuote = item.value.endsWith('"');
		const cursorOffset = isDirectory && hasTrailingQuote ? item.value.length - 1 : item.value.length;

		return {
			lines: newLines,
			cursorLine,
			cursorCol: beforePrefix.length + cursorOffset,
		};
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

	private resolveScopedFuzzyQuery(rawQuery: string): { baseDir: string; query: string; displayBase: string } | null {
		const slashIndex = rawQuery.lastIndexOf("/");
		if (slashIndex === -1) {
			return null;
		}

		const displayBase = rawQuery.slice(0, slashIndex + 1);
		const query = rawQuery.slice(slashIndex + 1);

		let baseDir: string;
		if (displayBase.startsWith("~/")) {
			baseDir = this.expandHomePath(displayBase);
		} else if (displayBase.startsWith("/")) {
			baseDir = displayBase;
		} else {
			baseDir = join(this.basePath, displayBase);
		}

		try {
			if (!statSync(baseDir).isDirectory()) {
				return null;
			}
		} catch {
			return null;
		}

		return { baseDir, query, displayBase };
	}

	private scopedPathForDisplay(displayBase: string, relativePath: string): string {
		if (displayBase === "/") {
			return `/${relativePath}`;
		}
		return `${displayBase}${relativePath}`;
	}

	// Get file/directory suggestions for a given path prefix
	private getFileSuggestions(prefix: string): AutocompleteItem[] {
		try {
			let searchDir: string;
			let searchPrefix: string;
			const { rawPrefix, isAtPrefix, isQuotedPrefix } = parsePathPrefix(prefix);
			let expandedPrefix = rawPrefix;

			// Handle home directory expansion
			if (expandedPrefix.startsWith("~")) {
				expandedPrefix = this.expandHomePath(expandedPrefix);
			}

			const isRootPrefix =
				rawPrefix === "" ||
				rawPrefix === "./" ||
				rawPrefix === "../" ||
				rawPrefix === "~" ||
				rawPrefix === "~/" ||
				rawPrefix === "/" ||
				(isAtPrefix && rawPrefix === "");

			if (isRootPrefix) {
				// Complete from specified position
				if (rawPrefix.startsWith("~") || expandedPrefix.startsWith("/")) {
					searchDir = expandedPrefix;
				} else {
					searchDir = join(this.basePath, expandedPrefix);
				}
				searchPrefix = "";
			} else if (rawPrefix.endsWith("/")) {
				// If prefix ends with /, show contents of that directory
				if (rawPrefix.startsWith("~") || expandedPrefix.startsWith("/")) {
					searchDir = expandedPrefix;
				} else {
					searchDir = join(this.basePath, expandedPrefix);
				}
				searchPrefix = "";
			} else {
				// Split into directory and file prefix
				const dir = dirname(expandedPrefix);
				const file = basename(expandedPrefix);
				if (rawPrefix.startsWith("~") || expandedPrefix.startsWith("/")) {
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
				const displayPrefix = rawPrefix;

				if (displayPrefix.endsWith("/")) {
					// If prefix ends with /, append entry to the prefix
					relativePath = displayPrefix + name;
				} else if (displayPrefix.includes("/")) {
					// Preserve ~/ format for home directory paths
					if (displayPrefix.startsWith("~/")) {
						const homeRelativeDir = displayPrefix.slice(2); // Remove ~/
						const dir = dirname(homeRelativeDir);
						relativePath = `~/${dir === "." ? name : join(dir, name)}`;
					} else if (displayPrefix.startsWith("/")) {
						// Absolute path - construct properly
						const dir = dirname(displayPrefix);
						if (dir === "/") {
							relativePath = `/${name}`;
						} else {
							relativePath = `${dir}/${name}`;
						}
					} else {
						relativePath = join(dirname(displayPrefix), name);
					}
				} else {
					// For standalone entries, preserve ~/ if original prefix was ~/
					if (displayPrefix.startsWith("~")) {
						relativePath = `~/${name}`;
					} else {
						relativePath = name;
					}
				}

				const pathValue = isDirectory ? `${relativePath}/` : relativePath;
				const value = buildCompletionValue(pathValue, {
					isDirectory,
					isAtPrefix,
					isQuotedPrefix,
				});

				suggestions.push({
					value,
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

	// Reuse the same ranking and formatting for sync and streamed fd suggestions
	private buildFuzzyFileSuggestions(
		entries: Array<{ path: string; isDirectory: boolean }>,
		query: string,
		options: {
			isQuotedPrefix: boolean;
			scopedQuery: { baseDir: string; query: string; displayBase: string } | null;
		},
	): AutocompleteItem[] {
		const scoredEntries = entries
			.map((entry) => ({
				...entry,
				score: query ? this.scoreEntry(entry.path, query, entry.isDirectory) : 1,
			}))
			.filter((entry) => entry.score > 0);

		scoredEntries.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

		return scoredEntries.slice(0, 20).map(({ path: entryPath, isDirectory }) => {
			const pathWithoutSlash = isDirectory ? entryPath.slice(0, -1) : entryPath;
			const displayPath = options.scopedQuery
				? this.scopedPathForDisplay(options.scopedQuery.displayBase, pathWithoutSlash)
				: pathWithoutSlash;
			const entryName = basename(pathWithoutSlash);
			const completionPath = isDirectory ? `${displayPath}/` : displayPath;

			return {
				value: buildCompletionValue(completionPath, {
					isDirectory,
					isAtPrefix: true,
					isQuotedPrefix: options.isQuotedPrefix,
				}),
				label: entryName + (isDirectory ? "/" : ""),
				description: displayPath,
			};
		});
	}

	// Fuzzy file search using fd (fast, respects .gitignore)
	private getFuzzyFileSuggestions(query: string, options: { isQuotedPrefix: boolean }): AutocompleteItem[] {
		if (!this.fdPath) {
			// fd not available, return empty results
			return [];
		}

		try {
			const scopedQuery = this.resolveScopedFuzzyQuery(query);
			const fdBaseDir = scopedQuery?.baseDir ?? this.basePath;
			const fdQuery = scopedQuery?.query ?? query;
			const entries = walkDirectoryWithFd(fdBaseDir, this.fdPath, fdQuery, 100);
			return this.buildFuzzyFileSuggestions(entries, fdQuery, {
				isQuotedPrefix: options.isQuotedPrefix,
				scopedQuery,
			});
		} catch {
			return [];
		}
	}

	private async getFuzzyFileSuggestionsAsync(
		query: string,
		options: {
			isQuotedPrefix: boolean;
			prefix: string;
			signal: AbortSignal;
			onUpdate: (suggestions: AutocompleteSuggestions) => void;
		},
	): Promise<AutocompleteSuggestions | null> {
		if (!this.fdPath || options.signal.aborted) {
			return null;
		}

		const scopedQuery = this.resolveScopedFuzzyQuery(query);
		const fdBaseDir = scopedQuery?.baseDir ?? this.basePath;
		const fdQuery = scopedQuery?.query ?? query;
		const entries = new Map<string, { path: string; isDirectory: boolean }>();
		let lastKey = "";
		let lastSuggestions: AutocompleteSuggestions | null = null;

		const emitSuggestions = (): void => {
			if (options.signal.aborted) {
				return;
			}

			const items = this.buildFuzzyFileSuggestions([...entries.values()], fdQuery, {
				isQuotedPrefix: options.isQuotedPrefix,
				scopedQuery,
			});
			if (items.length === 0) {
				return;
			}

			const suggestions = {
				items,
				prefix: options.prefix,
			};
			const key = suggestions.items.map((item) => item.value).join("\n");
			if (key === lastKey) {
				return;
			}

			lastKey = key;
			lastSuggestions = suggestions;
			options.onUpdate(suggestions);
		};

		try {
			await streamDirectoryWithFd(fdBaseDir, this.fdPath, fdQuery, 100, {
				signal: options.signal,
				onEntry: (entry) => {
					if (options.signal.aborted) {
						return;
					}

					entries.set(entry.path, entry);
					emitSuggestions();
				},
			});
		} catch {
			return null;
		}

		if (options.signal.aborted) {
			return null;
		}

		if (lastSuggestions) {
			return lastSuggestions;
		}

		const items = this.buildFuzzyFileSuggestions([...entries.values()], fdQuery, {
			isQuotedPrefix: options.isQuotedPrefix,
			scopedQuery,
		});
		return items.length > 0
			? {
					items,
					prefix: options.prefix,
				}
			: null;
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

		// Force extract path prefix - this will always return something
		const pathMatch = extractPathPrefix(textBeforeCursor, true);
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
