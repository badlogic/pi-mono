import { Chalk } from "chalk";
import stringWidth from "string-width";

const colorChalk = new Chalk({ level: 3 });

/**
 * Calculate the visible width of a string in terminal columns.
 */
export function visibleWidth(str: string): number {
	const normalized = str.replace(/\t/g, "   ");
	return stringWidth(normalized);
}

/**
 * Extract ANSI escape sequences from a string at the given position.
 */
function extractAnsiCode(str: string, pos: number): { code: string; length: number } | null {
	if (pos >= str.length || str[pos] !== "\x1b" || str[pos + 1] !== "[") {
		return null;
	}

	let j = pos + 2;
	while (j < str.length && str[j] && !/[mGKHJ]/.test(str[j]!)) {
		j++;
	}

	if (j < str.length) {
		return {
			code: str.substring(pos, j + 1),
			length: j + 1 - pos,
		};
	}

	return null;
}

/**
 * Track active ANSI SGR codes to preserve styling across line breaks.
 */
class AnsiCodeTracker {
	private activeAnsiCodes: string[] = [];

	process(ansiCode: string): void {
		if (!ansiCode.endsWith("m")) {
			return;
		}

		// Full reset clears everything
		if (ansiCode === "\x1b[0m" || ansiCode === "\x1b[m") {
			this.activeAnsiCodes.length = 0;
		} else {
			this.activeAnsiCodes.push(ansiCode);
		}
	}

	getActiveCodes(): string {
		return this.activeAnsiCodes.join("");
	}

	hasActiveCodes(): boolean {
		return this.activeAnsiCodes.length > 0;
	}
}

function updateTrackerFromText(text: string, tracker: AnsiCodeTracker): void {
	let i = 0;
	while (i < text.length) {
		const ansiResult = extractAnsiCode(text, i);
		if (ansiResult) {
			tracker.process(ansiResult.code);
			i += ansiResult.length;
		} else {
			i++;
		}
	}
}

/**
 * Split text into words while keeping ANSI codes attached.
 */
function splitIntoWordsWithAnsi(text: string): string[] {
	const words: string[] = [];
	let currentWord = "";
	let i = 0;

	while (i < text.length) {
		const char = text[i];

		const ansiResult = extractAnsiCode(text, i);
		if (ansiResult) {
			currentWord += ansiResult.code;
			i += ansiResult.length;
			continue;
		}

		if (char === " ") {
			if (currentWord) {
				words.push(currentWord);
				currentWord = "";
			}
			i++;
			continue;
		}

		currentWord += char;
		i++;
	}

	if (currentWord) {
		words.push(currentWord);
	}

	return words;
}

/**
 * Wrap text with ANSI codes preserved.
 *
 * ONLY does word wrapping - NO padding, NO background colors.
 * Returns lines where each line is <= width visible chars.
 * Active ANSI codes are preserved across line breaks.
 *
 * @param text - Text to wrap (may contain ANSI codes and newlines)
 * @param width - Maximum visible width per line
 * @returns Array of wrapped lines (NOT padded to width)
 */
export function wrapTextWithAnsi(text: string, width: number): string[] {
	if (!text) {
		return [""];
	}

	// Handle newlines by processing each line separately
	const inputLines = text.split("\n");
	const result: string[] = [];

	for (const inputLine of inputLines) {
		result.push(...wrapSingleLine(inputLine, width));
	}

	return result.length > 0 ? result : [""];
}

function wrapSingleLine(line: string, width: number): string[] {
	if (!line) {
		return [""];
	}

	const visibleLength = visibleWidth(line);
	if (visibleLength <= width) {
		return [line];
	}

	const wrapped: string[] = [];
	const tracker = new AnsiCodeTracker();
	const words = splitIntoWordsWithAnsi(line);

	let currentLine = "";
	let currentVisibleLength = 0;

	for (const word of words) {
		const wordVisibleLength = visibleWidth(word);

		// Word itself is too long - break it character by character
		if (wordVisibleLength > width) {
			if (currentLine) {
				wrapped.push(currentLine);
				currentLine = "";
				currentVisibleLength = 0;
			}

			// Break long word
			const broken = breakLongWord(word, width, tracker);
			wrapped.push(...broken.slice(0, -1));
			currentLine = broken[broken.length - 1];
			currentVisibleLength = visibleWidth(currentLine);
			continue;
		}

		// Check if adding this word would exceed width
		const spaceNeeded = currentVisibleLength > 0 ? 1 : 0;
		const totalNeeded = currentVisibleLength + spaceNeeded + wordVisibleLength;

		if (totalNeeded > width && currentVisibleLength > 0) {
			// Wrap to next line
			wrapped.push(currentLine);
			currentLine = tracker.getActiveCodes() + word;
			currentVisibleLength = wordVisibleLength;
		} else {
			// Add to current line
			if (currentVisibleLength > 0) {
				currentLine += " " + word;
				currentVisibleLength += 1 + wordVisibleLength;
			} else {
				currentLine += word;
				currentVisibleLength = wordVisibleLength;
			}
		}

		updateTrackerFromText(word, tracker);
	}

	if (currentLine) {
		wrapped.push(currentLine);
	}

	return wrapped.length > 0 ? wrapped : [""];
}

function breakLongWord(word: string, width: number, tracker: AnsiCodeTracker): string[] {
	const lines: string[] = [];
	let currentLine = tracker.getActiveCodes();
	let currentWidth = 0;
	let i = 0;

	while (i < word.length) {
		const ansiResult = extractAnsiCode(word, i);
		if (ansiResult) {
			currentLine += ansiResult.code;
			tracker.process(ansiResult.code);
			i += ansiResult.length;
			continue;
		}

		const char = word[i];
		const charWidth = visibleWidth(char);

		if (currentWidth + charWidth > width) {
			lines.push(currentLine);
			currentLine = tracker.getActiveCodes();
			currentWidth = 0;
		}

		currentLine += char;
		currentWidth += charWidth;
		i++;
	}

	if (currentLine) {
		lines.push(currentLine);
	}

	return lines.length > 0 ? lines : [""];
}

/**
 * Apply background color to a line, padding to full width.
 *
 * Handles the tricky case where content contains \x1b[0m resets that would
 * kill the background color. We reapply the background after any reset.
 *
 * @param line - Line of text (may contain ANSI codes)
 * @param width - Total width to pad to
 * @param bgRgb - Background RGB color
 * @returns Line with background applied and padded to width
 */
export function applyBackgroundToLine(line: string, width: number, bgRgb: { r: number; g: number; b: number }): string {
	const bgStart = `\x1b[48;2;${bgRgb.r};${bgRgb.g};${bgRgb.b}m`;
	const bgEnd = "\x1b[49m";

	// Calculate padding needed
	const visibleLen = visibleWidth(line);
	const paddingNeeded = Math.max(0, width - visibleLen);
	const padding = " ".repeat(paddingNeeded);

	// Strategy: wrap content + padding in background, then fix any 0m resets
	const withPadding = line + padding;
	const withBg = bgStart + withPadding + bgEnd;

	// Find all \x1b[0m or \x1b[49m that would kill background
	// Replace with reset + background reapplication
	const fixedBg = withBg.replace(/\x1b\[0m/g, `\x1b[0m${bgStart}`);

	return fixedBg;
}
