import stringWidth from "string-width";

/**
 * Calculate the visible width of a string in terminal columns.
 * This correctly handles:
 * - ANSI escape codes (ignored)
 * - Emojis and wide characters (counted as 2 columns)
 * - Combining characters (counted correctly)
 * - Tabs (replaced with 3 spaces for consistent width)
 */
export function visibleWidth(str: string): number {
	// Replace tabs with 3 spaces before measuring
	const normalized = str.replace(/\t/g, "   ");
	return stringWidth(normalized);
}

/**
 * Extract ANSI escape sequences from a string at the given position.
 * Returns the ANSI code and the length consumed, or null if no ANSI code found.
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
 * Track and manage active ANSI codes for preserving styling across wrapped lines.
 */
class AnsiCodeTracker {
	private activeAnsiCodes: string[] = [];

	/**
	 * Process an ANSI code and update the active codes.
	 */
	process(ansiCode: string): void {
		// Check if it's a styling code (ends with 'm')
		if (!ansiCode.endsWith("m")) {
			return;
		}

		// Reset code clears all active codes
		if (ansiCode === "\x1b[0m" || ansiCode === "\x1b[m") {
			this.activeAnsiCodes.length = 0;
		} else {
			// Add to active codes
			this.activeAnsiCodes.push(ansiCode);
		}
	}

	/**
	 * Get all active ANSI codes as a single string.
	 */
	getActiveCodes(): string {
		return this.activeAnsiCodes.join("");
	}

	/**
	 * Check if there are any active codes.
	 */
	hasActiveCodes(): boolean {
		return this.activeAnsiCodes.length > 0;
	}

	/**
	 * Get the reset code.
	 */
	getResetCode(): string {
		return "\x1b[0m";
	}
}

/**
 * Wrap text lines with word-based wrapping while preserving ANSI escape codes.
 * This function properly handles:
 * - ANSI escape codes (preserved and tracked across lines)
 * - Word-based wrapping (breaks at spaces when possible)
 * - Multi-byte characters (emoji, surrogate pairs)
 * - Newlines within text
 *
 * @param text - The text to wrap (can contain ANSI codes and newlines)
 * @param width - The maximum width in terminal columns
 * @returns Array of wrapped lines with ANSI codes preserved
 */
export function wrapTextWithAnsi(text: string, width: number): string[] {
	if (!text) {
		return [""];
	}

	// Handle newlines by processing each line separately
	const inputLines = text.split("\n");
	const result: string[] = [];

	for (const inputLine of inputLines) {
		result.push(...wrapSingleLineWithAnsi(inputLine, width));
	}

	return result.length > 0 ? result : [""];
}

/**
 * Wrap a single line (no newlines) with word-based wrapping while preserving ANSI codes.
 */
function wrapSingleLineWithAnsi(line: string, width: number): string[] {
	if (!line) {
		return [""];
	}

	const visibleLength = visibleWidth(line);
	if (visibleLength <= width) {
		return [line];
	}

	const wrapped: string[] = [];
	const tracker = new AnsiCodeTracker();

	// First, split the line into words while preserving ANSI codes with their words
	const words = splitIntoWordsWithAnsi(line);

	let currentLine = "";
	let currentVisibleLength = 0;

	for (const word of words) {
		const wordVisibleLength = visibleWidth(word);

		// If the word itself is longer than the width, we need to break it character by character
		if (wordVisibleLength > width) {
			// Flush current line if any
			if (currentLine) {
				wrapped.push(closeLineAndPrepareNext(currentLine, tracker));
				currentLine = tracker.getActiveCodes();
				currentVisibleLength = 0;
			}

			// Break the long word
			const brokenLines = breakLongWordWithAnsi(word, width, tracker);
			wrapped.push(...brokenLines.slice(0, -1));
			currentLine = brokenLines[brokenLines.length - 1];
			currentVisibleLength = visibleWidth(currentLine);
		} else {
			// Check if adding this word would exceed the width
			const spaceNeeded = currentVisibleLength > 0 ? 1 : 0; // Space before word if not at line start
			const totalNeeded = currentVisibleLength + spaceNeeded + wordVisibleLength;

			if (totalNeeded > width) {
				// Word doesn't fit, wrap to next line
				if (currentLine) {
					wrapped.push(closeLineAndPrepareNext(currentLine, tracker));
				}
				currentLine = tracker.getActiveCodes() + word;
				currentVisibleLength = wordVisibleLength;
			} else {
				// Word fits, add it
				if (currentVisibleLength > 0) {
					currentLine += " " + word;
					currentVisibleLength += 1 + wordVisibleLength;
				} else {
					currentLine += word;
					currentVisibleLength = wordVisibleLength;
				}
			}

			// Update tracker with ANSI codes from this word
			updateTrackerFromText(word, tracker);
		}
	}

	// Add final line
	if (currentLine) {
		wrapped.push(currentLine);
	}

	return wrapped.length > 0 ? wrapped : [""];
}

/**
 * Close current line with reset code if needed, and prepare the next line with active codes.
 */
function closeLineAndPrepareNext(line: string, tracker: AnsiCodeTracker): string {
	if (tracker.hasActiveCodes()) {
		return line + tracker.getResetCode();
	}
	return line;
}

/**
 * Update the ANSI code tracker by scanning through text.
 */
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
 * Split text into words while keeping ANSI codes attached to their words.
 */
function splitIntoWordsWithAnsi(text: string): string[] {
	const words: string[] = [];
	let currentWord = "";
	let i = 0;

	while (i < text.length) {
		const char = text[i];

		// Check for ANSI code
		const ansiResult = extractAnsiCode(text, i);
		if (ansiResult) {
			currentWord += ansiResult.code;
			i += ansiResult.length;
			continue;
		}

		// Check for space (word boundary)
		if (char === " ") {
			if (currentWord) {
				words.push(currentWord);
				currentWord = "";
			}
			i++;
			continue;
		}

		// Regular character
		currentWord += char;
		i++;
	}

	// Add final word
	if (currentWord) {
		words.push(currentWord);
	}

	return words;
}

/**
 * Break a long word that doesn't fit on a single line, character by character.
 */
function breakLongWordWithAnsi(word: string, width: number, tracker: AnsiCodeTracker): string[] {
	const lines: string[] = [];
	let currentLine = tracker.getActiveCodes();
	let currentVisibleLength = 0;
	let i = 0;

	while (i < word.length) {
		// Check for ANSI code
		const ansiResult = extractAnsiCode(word, i);
		if (ansiResult) {
			currentLine += ansiResult.code;
			tracker.process(ansiResult.code);
			i += ansiResult.length;
			continue;
		}

		// Get character (handle surrogate pairs)
		const codePoint = word.charCodeAt(i);
		let char: string;
		let charByteLength: number;

		if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < word.length) {
			// High surrogate - get the pair
			char = word.substring(i, i + 2);
			charByteLength = 2;
		} else {
			// Regular character
			char = word[i];
			charByteLength = 1;
		}

		const charWidth = visibleWidth(char);

		// Check if adding this character would exceed width
		if (currentVisibleLength + charWidth > width) {
			// Need to wrap
			if (tracker.hasActiveCodes()) {
				lines.push(currentLine + tracker.getResetCode());
				currentLine = tracker.getActiveCodes();
			} else {
				lines.push(currentLine);
				currentLine = "";
			}
			currentVisibleLength = 0;
		}

		currentLine += char;
		currentVisibleLength += charWidth;
		i += charByteLength;
	}

	// Add final line (don't close it, let the caller handle that)
	if (currentLine || lines.length === 0) {
		lines.push(currentLine);
	}

	return lines;
}
