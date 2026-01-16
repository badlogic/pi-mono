import type { AutocompleteProvider, CombinedAutocompleteProvider } from "../autocomplete.js";
import { getEditorKeybindings } from "../keybindings.js";
import { matchesKey } from "../keys.js";
import { type Component, CURSOR_MARKER, type Focusable, type TUI } from "../tui.js";
import { getSegmenter, isPunctuationChar, isWhitespaceChar, visibleWidth } from "../utils.js";
import { SelectList, type SelectListTheme } from "./select-list.js";

const segmenter = getSegmenter();

/**
 * Represents a chunk of text for word-wrap layout.
 * Tracks both the text content and its position in the original line.
 */
interface TextChunk {
	text: string;
	startIndex: number;
	endIndex: number;
}

/**
 * Split a line into word-wrapped chunks.
 * Wraps at word boundaries when possible, falling back to character-level
 * wrapping for words longer than the available width.
 *
 * @param line - The text line to wrap
 * @param maxWidth - Maximum visible width per chunk
 * @returns Array of chunks with text and position information
 */
function wordWrapLine(line: string, maxWidth: number): TextChunk[] {
	if (!line || maxWidth <= 0) {
		return [{ text: "", startIndex: 0, endIndex: 0 }];
	}

	const lineWidth = visibleWidth(line);
	if (lineWidth <= maxWidth) {
		return [{ text: line, startIndex: 0, endIndex: line.length }];
	}

	const chunks: TextChunk[] = [];

	// Split into tokens (words and whitespace runs)
	const tokens: { text: string; startIndex: number; endIndex: number; isWhitespace: boolean }[] = [];
	let currentToken = "";
	let tokenStart = 0;
	let inWhitespace = false;
	let charIndex = 0;

	for (const seg of segmenter.segment(line)) {
		const grapheme = seg.segment;
		const graphemeIsWhitespace = isWhitespaceChar(grapheme);

		if (currentToken === "") {
			inWhitespace = graphemeIsWhitespace;
			tokenStart = charIndex;
		} else if (graphemeIsWhitespace !== inWhitespace) {
			// Token type changed - save current token
			tokens.push({
				text: currentToken,
				startIndex: tokenStart,
				endIndex: charIndex,
				isWhitespace: inWhitespace,
			});
			currentToken = "";
			tokenStart = charIndex;
			inWhitespace = graphemeIsWhitespace;
		}

		currentToken += grapheme;
		charIndex += grapheme.length;
	}

	// Push final token
	if (currentToken) {
		tokens.push({
			text: currentToken,
			startIndex: tokenStart,
			endIndex: charIndex,
			isWhitespace: inWhitespace,
		});
	}

	// Build chunks using word wrapping
	let currentChunk = "";
	let currentWidth = 0;
	let chunkStartIndex = 0;
	let atLineStart = true; // Track if we're at the start of a line (for skipping whitespace)

	for (const token of tokens) {
		const tokenWidth = visibleWidth(token.text);

		// Skip leading whitespace at line start
		if (atLineStart && token.isWhitespace) {
			chunkStartIndex = token.endIndex;
			continue;
		}
		atLineStart = false;

		// If this single token is wider than maxWidth, we need to break it
		if (tokenWidth > maxWidth) {
			// First, push any accumulated chunk
			if (currentChunk) {
				chunks.push({
					text: currentChunk,
					startIndex: chunkStartIndex,
					endIndex: token.startIndex,
				});
				currentChunk = "";
				currentWidth = 0;
				chunkStartIndex = token.startIndex;
			}

			// Break the long token by grapheme
			let tokenChunk = "";
			let tokenChunkWidth = 0;
			let tokenChunkStart = token.startIndex;
			let tokenCharIndex = token.startIndex;

			for (const seg of segmenter.segment(token.text)) {
				const grapheme = seg.segment;
				const graphemeWidth = visibleWidth(grapheme);

				if (tokenChunkWidth + graphemeWidth > maxWidth && tokenChunk) {
					chunks.push({
						text: tokenChunk,
						startIndex: tokenChunkStart,
						endIndex: tokenCharIndex,
					});
					tokenChunk = grapheme;
					tokenChunkWidth = graphemeWidth;
					tokenChunkStart = tokenCharIndex;
				} else {
					tokenChunk += grapheme;
					tokenChunkWidth += graphemeWidth;
				}
				tokenCharIndex += grapheme.length;
			}

			// Keep remainder as start of next chunk
			if (tokenChunk) {
				currentChunk = tokenChunk;
				currentWidth = tokenChunkWidth;
				chunkStartIndex = tokenChunkStart;
			}
			continue;
		}

		// Check if adding this token would exceed width
		if (currentWidth + tokenWidth > maxWidth) {
			// Push current chunk (trimming trailing whitespace for display)
			const trimmedChunk = currentChunk.trimEnd();
			if (trimmedChunk || chunks.length === 0) {
				chunks.push({
					text: trimmedChunk,
					startIndex: chunkStartIndex,
					endIndex: chunkStartIndex + currentChunk.length,
				});
			}

			// Start new line - skip leading whitespace
			atLineStart = true;
			if (token.isWhitespace) {
				currentChunk = "";
				currentWidth = 0;
				chunkStartIndex = token.endIndex;
			} else {
				currentChunk = token.text;
				currentWidth = tokenWidth;
				chunkStartIndex = token.startIndex;
				atLineStart = false;
			}
		} else {
			// Add token to current chunk
			currentChunk += token.text;
			currentWidth += tokenWidth;
		}
	}

	// Push final chunk
	if (currentChunk) {
		chunks.push({
			text: currentChunk,
			startIndex: chunkStartIndex,
			endIndex: line.length,
		});
	}

	return chunks.length > 0 ? chunks : [{ text: "", startIndex: 0, endIndex: 0 }];
}

interface EditorState {
	lines: string[];
	cursorLine: number;
	cursorCol: number;
}

interface LayoutLine {
	text: string;
	hasCursor: boolean;
	cursorPos?: number;
}

export interface EditorTheme {
	borderColor: (str: string) => string;
	selectList: SelectListTheme;
}

export class Editor implements Component, Focusable {
	private state: EditorState = {
		lines: [""],
		cursorLine: 0,
		cursorCol: 0,
	};

	/** Focusable interface - set by TUI when focus changes */
	focused: boolean = false;

	protected tui: TUI;
	private theme: EditorTheme;

	// Store last render width for cursor navigation
	private lastWidth: number = 80;

	// Vertical scrolling support
	private scrollOffset: number = 0;

	// Border color (can be changed dynamically)
	public borderColor: (str: string) => string;

	// Autocomplete support
	private autocompleteProvider?: AutocompleteProvider;
	private autocompleteList?: SelectList;
	private isAutocompleting: boolean = false;
	private autocompletePrefix: string = "";

	// Paste tracking for large pastes
	private pastes: Map<number, string> = new Map();
	private pasteCounter: number = 0;

	// Bracketed paste mode buffering
	private pasteBuffer: string = "";
	private isInPaste: boolean = false;
	private pendingShiftEnter: boolean = false;

	// Prompt history for up/down navigation
	private history: string[] = [];
	private historyIndex: number = -1; // -1 = not browsing, 0 = most recent, 1 = older, etc.

	public onSubmit?: (text: string) => void;
	public onChange?: (text: string) => void;
	public disableSubmit: boolean = false;

	constructor(tui: TUI, theme: EditorTheme) {
		this.tui = tui;
		this.theme = theme;
		this.borderColor = theme.borderColor;
	}

	setAutocompleteProvider(provider: AutocompleteProvider): void {
		this.autocompleteProvider = provider;
	}

	/**
	 * Add a prompt to history for up/down arrow navigation.
	 * Called after successful submission.
	 */
	addToHistory(text: string): void {
		const trimmed = text.trim();
		if (!trimmed) return;
		// Don't add consecutive duplicates
		if (this.history.length > 0 && this.history[0] === trimmed) return;
		this.history.unshift(trimmed);
		// Limit history size
		if (this.history.length > 100) {
			this.history.pop();
		}
	}

	private isEditorEmpty(): boolean {
		return this.state.lines.length === 1 && this.state.lines[0] === "";
	}

	private isOnFirstVisualLine(): boolean {
		const visualLines = this.buildVisualLineMap(this.lastWidth);
		const currentVisualLine = this.findCurrentVisualLine(visualLines);
		return currentVisualLine === 0;
	}

	private isOnLastVisualLine(): boolean {
		const visualLines = this.buildVisualLineMap(this.lastWidth);
		const currentVisualLine = this.findCurrentVisualLine(visualLines);
		return currentVisualLine === visualLines.length - 1;
	}

	private navigateHistory(direction: 1 | -1): void {
		if (this.history.length === 0) return;

		const newIndex = this.historyIndex - direction; // Up(-1) increases index, Down(1) decreases
		if (newIndex < -1 || newIndex >= this.history.length) return;

		this.historyIndex = newIndex;

		if (this.historyIndex === -1) {
			// Returned to "current" state - clear editor
			this.setTextInternal("");
		} else {
			this.setTextInternal(this.history[this.historyIndex] || "");
		}
	}

	/** Internal setText that doesn't reset history state - used by navigateHistory */
	private setTextInternal(text: string): void {
		const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
		this.state.lines = lines.length === 0 ? [""] : lines;
		this.state.cursorLine = this.state.lines.length - 1;
		this.state.cursorCol = this.state.lines[this.state.cursorLine]?.length || 0;
		// Reset scroll - render() will adjust to show cursor
		this.scrollOffset = 0;

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	invalidate(): void {
		// No cached state to invalidate currently
	}

	render(width: number): string[] {
		// Store width for cursor navigation
		this.lastWidth = width;

		const horizontal = this.borderColor("─");

		// Layout the text - use full width
		const layoutLines = this.layoutText(width);

		// Calculate max visible lines: 30% of terminal height, minimum 5 lines
		const terminalRows = this.tui.terminal.rows;
		const maxVisibleLines = Math.max(5, Math.floor(terminalRows * 0.3));

		// Find the cursor line index in layoutLines
		let cursorLineIndex = layoutLines.findIndex((line) => line.hasCursor);
		if (cursorLineIndex === -1) cursorLineIndex = 0;

		// Adjust scroll offset to keep cursor visible
		if (cursorLineIndex < this.scrollOffset) {
			this.scrollOffset = cursorLineIndex;
		} else if (cursorLineIndex >= this.scrollOffset + maxVisibleLines) {
			this.scrollOffset = cursorLineIndex - maxVisibleLines + 1;
		}

		// Clamp scroll offset to valid range
		const maxScrollOffset = Math.max(0, layoutLines.length - maxVisibleLines);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScrollOffset));

		// Get visible lines slice
		const visibleLines = layoutLines.slice(this.scrollOffset, this.scrollOffset + maxVisibleLines);

		const result: string[] = [];

		// Render top border (with scroll indicator if scrolled down)
		if (this.scrollOffset > 0) {
			const indicator = `─── ↑ ${this.scrollOffset} more `;
			const remaining = width - visibleWidth(indicator);
			result.push(this.borderColor(indicator + "─".repeat(Math.max(0, remaining))));
		} else {
			result.push(horizontal.repeat(width));
		}

		// Render each visible layout line
		// Emit hardware cursor marker only when focused and not showing autocomplete
		const emitCursorMarker = this.focused && !this.isAutocompleting;

		for (const layoutLine of visibleLines) {
			let displayText = layoutLine.text;
			let lineVisibleWidth = visibleWidth(layoutLine.text);

			// Add cursor if this line has it
			if (layoutLine.hasCursor && layoutLine.cursorPos !== undefined) {
				const before = displayText.slice(0, layoutLine.cursorPos);
				const after = displayText.slice(layoutLine.cursorPos);

				// Hardware cursor marker (zero-width, emitted before fake cursor for IME positioning)
				const marker = emitCursorMarker ? CURSOR_MARKER : "";

				if (after.length > 0) {
					// Cursor is on a character (grapheme) - replace it with highlighted version
					// Get the first grapheme from 'after'
					const afterGraphemes = [...segmenter.segment(after)];
					const firstGrapheme = afterGraphemes[0]?.segment || "";
					const restAfter = after.slice(firstGrapheme.length);
					const cursor = `\x1b[7m${firstGrapheme}\x1b[0m`;
					displayText = before + marker + cursor + restAfter;
					// lineVisibleWidth stays the same - we're replacing, not adding
				} else {
					// Cursor is at the end - check if we have room for the space
					if (lineVisibleWidth < width) {
						// We have room - add highlighted space
						const cursor = "\x1b[7m \x1b[0m";
						displayText = before + marker + cursor;
						// lineVisibleWidth increases by 1 - we're adding a space
						lineVisibleWidth = lineVisibleWidth + 1;
					} else {
						// Line is at full width - use reverse video on last grapheme if possible
						// or just show cursor at the end without adding space
						const beforeGraphemes = [...segmenter.segment(before)];
						if (beforeGraphemes.length > 0) {
							const lastGrapheme = beforeGraphemes[beforeGraphemes.length - 1]?.segment || "";
							const cursor = `\x1b[7m${lastGrapheme}\x1b[0m`;
							// Rebuild 'before' without the last grapheme
							const beforeWithoutLast = beforeGraphemes
								.slice(0, -1)
								.map((g) => g.segment)
								.join("");
							displayText = beforeWithoutLast + marker + cursor;
						}
						// lineVisibleWidth stays the same
					}
				}
			}

			// Calculate padding based on actual visible width
			const padding = " ".repeat(Math.max(0, width - lineVisibleWidth));

			// Render the line (no side borders, just horizontal lines above and below)
			result.push(displayText + padding);
		}

		// Render bottom border (with scroll indicator if more content below)
		const linesBelow = layoutLines.length - (this.scrollOffset + visibleLines.length);
		if (linesBelow > 0) {
			const indicator = `─── ↓ ${linesBelow} more `;
			const remaining = width - visibleWidth(indicator);
			result.push(this.borderColor(indicator + "─".repeat(Math.max(0, remaining))));
		} else {
			result.push(horizontal.repeat(width));
		}

		// Add autocomplete list if active
		if (this.isAutocompleting && this.autocompleteList) {
			const autocompleteResult = this.autocompleteList.render(width);
			result.push(...autocompleteResult);
		}

		return result;
	}

	handleInput(data: string): void {
		const kb = getEditorKeybindings();

		// Handle bracketed paste mode
		if (data.includes("\x1b[200~")) {
			this.isInPaste = true;
			this.pasteBuffer = "";
			data = data.replace("\x1b[200~", "");
		}

		if (this.isInPaste) {
			this.pasteBuffer += data;
			const endIndex = this.pasteBuffer.indexOf("\x1b[201~");
			if (endIndex !== -1) {
				const pasteContent = this.pasteBuffer.substring(0, endIndex);
				if (pasteContent.length > 0) {
					this.handlePaste(pasteContent);
				}
				this.isInPaste = false;
				const remaining = this.pasteBuffer.substring(endIndex + 6);
				this.pasteBuffer = "";
				if (remaining.length > 0) {
					this.handleInput(remaining);
				}
				return;
			}
			return;
		}

		if (this.pendingShiftEnter) {
			if (data === "\r") {
				this.pendingShiftEnter = false;
				this.addNewLine();
				return;
			}
			this.pendingShiftEnter = false;
			this.insertCharacter("\\");
		}

		if (data === "\\") {
			this.pendingShiftEnter = true;
			return;
		}

		// Ctrl+C - let parent handle (exit/clear)
		if (kb.matches(data, "copy")) {
			return;
		}

		// Handle autocomplete mode
		if (this.isAutocompleting && this.autocompleteList) {
			if (kb.matches(data, "selectCancel")) {
				this.cancelAutocomplete();
				return;
			}

			if (kb.matches(data, "selectUp") || kb.matches(data, "selectDown")) {
				this.autocompleteList.handleInput(data);
				return;
			}

			if (kb.matches(data, "tab")) {
				const selected = this.autocompleteList.getSelectedItem();
				if (selected && this.autocompleteProvider) {
					const result = this.autocompleteProvider.applyCompletion(
						this.state.lines,
						this.state.cursorLine,
						this.state.cursorCol,
						selected,
						this.autocompletePrefix,
					);
					this.state.lines = result.lines;
					this.state.cursorLine = result.cursorLine;
					this.state.cursorCol = result.cursorCol;
					this.cancelAutocomplete();
					if (this.onChange) this.onChange(this.getText());
				}
				return;
			}

			if (kb.matches(data, "selectConfirm")) {
				const selected = this.autocompleteList.getSelectedItem();
				if (selected && this.autocompleteProvider) {
					const result = this.autocompleteProvider.applyCompletion(
						this.state.lines,
						this.state.cursorLine,
						this.state.cursorCol,
						selected,
						this.autocompletePrefix,
					);
					this.state.lines = result.lines;
					this.state.cursorLine = result.cursorLine;
					this.state.cursorCol = result.cursorCol;

					if (this.autocompletePrefix.startsWith("/")) {
						this.cancelAutocomplete();
						// Fall through to submit
					} else {
						this.cancelAutocomplete();
						if (this.onChange) this.onChange(this.getText());
						return;
					}
				}
			}
		}

		// Tab - trigger completion
		if (kb.matches(data, "tab") && !this.isAutocompleting) {
			this.handleTabCompletion();
			return;
		}

		// Deletion actions
		if (kb.matches(data, "deleteToLineEnd")) {
			this.deleteToEndOfLine();
			return;
		}
		if (kb.matches(data, "deleteToLineStart")) {
			this.deleteToStartOfLine();
			return;
		}
		if (kb.matches(data, "deleteWordBackward")) {
			this.deleteWordBackwards();
			return;
		}
		if (kb.matches(data, "deleteCharBackward") || matchesKey(data, "shift+backspace")) {
			this.handleBackspace();
			return;
		}
		if (kb.matches(data, "deleteCharForward") || matchesKey(data, "shift+delete")) {
			this.handleForwardDelete();
			return;
		}

		// Cursor movement actions
		if (kb.matches(data, "cursorLineStart")) {
			this.moveToLineStart();
			return;
		}
		if (kb.matches(data, "cursorLineEnd")) {
			this.moveToLineEnd();
			return;
		}
		if (kb.matches(data, "cursorWordLeft")) {
			this.moveWordBackwards();
			return;
		}
		if (kb.matches(data, "cursorWordRight")) {
			this.moveWordForwards();
			return;
		}

		// New line (Shift+Enter, Alt+Enter, etc.)
		if (
			kb.matches(data, "newLine") ||
			(data.charCodeAt(0) === 10 && data.length > 1) ||
			data === "\x1b\r" ||
			data === "\x1b[13;2~" ||
			(data.length > 1 && data.includes("\x1b") && data.includes("\r")) ||
			(data === "\n" && data.length === 1) ||
			data === "\\\r"
		) {
			this.addNewLine();
			return;
		}

		// Submit (Enter)
		if (kb.matches(data, "submit")) {
			if (this.disableSubmit) return;

			let result = this.state.lines.join("\n").trim();
			for (const [pasteId, pasteContent] of this.pastes) {
				const markerRegex = new RegExp(`\\[paste #${pasteId}( (\\+\\d+ lines|\\d+ chars))?\\]`, "g");
				result = result.replace(markerRegex, pasteContent);
			}

			this.state = { lines: [""], cursorLine: 0, cursorCol: 0 };
			this.pastes.clear();
			this.pasteCounter = 0;
			this.historyIndex = -1;
			this.scrollOffset = 0;

			if (this.onChange) this.onChange("");
			if (this.onSubmit) this.onSubmit(result);
			return;
		}

		// Arrow key navigation (with history support)
		if (kb.matches(data, "cursorUp")) {
			if (this.isEditorEmpty()) {
				this.navigateHistory(-1);
			} else if (this.historyIndex > -1 && this.isOnFirstVisualLine()) {
				this.navigateHistory(-1);
			} else {
				this.moveCursor(-1, 0);
			}
			return;
		}
		if (kb.matches(data, "cursorDown")) {
			if (this.historyIndex > -1 && this.isOnLastVisualLine()) {
				this.navigateHistory(1);
			} else {
				this.moveCursor(1, 0);
			}
			return;
		}
		if (kb.matches(data, "cursorRight")) {
			this.moveCursor(0, 1);
			return;
		}
		if (kb.matches(data, "cursorLeft")) {
			this.moveCursor(0, -1);
			return;
		}

		// Page up/down - scroll by page and move cursor
		if (kb.matches(data, "pageUp")) {
			this.pageScroll(-1);
			return;
		}
		if (kb.matches(data, "pageDown")) {
			this.pageScroll(1);
			return;
		}

		// Shift+Space - insert regular space
		if (matchesKey(data, "shift+space")) {
			this.insertCharacter(" ");
			return;
		}

		// Regular characters
		if (data.charCodeAt(0) >= 32) {
			this.insertCharacter(data);
		}
	}

	private layoutText(contentWidth: number): LayoutLine[] {
		const layoutLines: LayoutLine[] = [];

		if (this.state.lines.length === 0 || (this.state.lines.length === 1 && this.state.lines[0] === "")) {
			// Empty editor
			layoutLines.push({
				text: "",
				hasCursor: true,
				cursorPos: 0,
			});
			return layoutLines;
		}

		// Process each logical line
		for (let i = 0; i < this.state.lines.length; i++) {
			const line = this.state.lines[i] || "";
			const isCurrentLine = i === this.state.cursorLine;
			const lineVisibleWidth = visibleWidth(line);

			if (lineVisibleWidth <= contentWidth) {
				// Line fits in one layout line
				if (isCurrentLine) {
					layoutLines.push({
						text: line,
						hasCursor: true,
						cursorPos: this.state.cursorCol,
					});
				} else {
					layoutLines.push({
						text: line,
						hasCursor: false,
					});
				}
			} else {
				// Line needs wrapping - use word-aware wrapping
				const chunks = wordWrapLine(line, contentWidth);

				for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
					const chunk = chunks[chunkIndex];
					if (!chunk) continue;

					const cursorPos = this.state.cursorCol;
					const isLastChunk = chunkIndex === chunks.length - 1;

					// Determine if cursor is in this chunk
					// For word-wrapped chunks, we need to handle the case where
					// cursor might be in trimmed whitespace at end of chunk
					let hasCursorInChunk = false;
					let adjustedCursorPos = 0;

					if (isCurrentLine) {
						if (isLastChunk) {
							// Last chunk: cursor belongs here if >= startIndex
							hasCursorInChunk = cursorPos >= chunk.startIndex;
							adjustedCursorPos = cursorPos - chunk.startIndex;
						} else {
							// Non-last chunk: cursor belongs here if in range [startIndex, endIndex)
							// But we need to handle the visual position in the trimmed text
							hasCursorInChunk = cursorPos >= chunk.startIndex && cursorPos < chunk.endIndex;
							if (hasCursorInChunk) {
								adjustedCursorPos = cursorPos - chunk.startIndex;
								// Clamp to text length (in case cursor was in trimmed whitespace)
								if (adjustedCursorPos > chunk.text.length) {
									adjustedCursorPos = chunk.text.length;
								}
							}
						}
					}

					if (hasCursorInChunk) {
						layoutLines.push({
							text: chunk.text,
							hasCursor: true,
							cursorPos: adjustedCursorPos,
						});
					} else {
						layoutLines.push({
							text: chunk.text,
							hasCursor: false,
						});
					}
				}
			}
		}

		return layoutLines;
	}

	getText(): string {
		return this.state.lines.join("\n");
	}

	/**
	 * Get text with paste markers expanded to their actual content.
	 * Use this when you need the full content (e.g., for external editor).
	 */
	getExpandedText(): string {
		let result = this.state.lines.join("\n");
		for (const [pasteId, pasteContent] of this.pastes) {
			const markerRegex = new RegExp(`\\[paste #${pasteId}( (\\+\\d+ lines|\\d+ chars))?\\]`, "g");
			result = result.replace(markerRegex, pasteContent);
		}
		return result;
	}

	getLines(): string[] {
		return [...this.state.lines];
	}

	getCursor(): { line: number; col: number } {
		return { line: this.state.cursorLine, col: this.state.cursorCol };
	}

	setText(text: string): void {
		this.historyIndex = -1; // Exit history browsing mode
		this.setTextInternal(text);
	}

	/**
	 * Insert text at the current cursor position.
	 * Used for programmatic insertion (e.g., clipboard image markers).
	 */
	insertTextAtCursor(text: string): void {
		for (const char of text) {
			this.insertCharacter(char);
		}
	}

	// All the editor methods from before...
	private insertCharacter(char: string): void {
		this.historyIndex = -1; // Exit history browsing mode

		const line = this.state.lines[this.state.cursorLine] || "";

		const before = line.slice(0, this.state.cursorCol);
		const after = line.slice(this.state.cursorCol);

		this.state.lines[this.state.cursorLine] = before + char + after;
		this.state.cursorCol += char.length; // Fix: increment by the length of the inserted string

		if (this.onChange) {
			this.onChange(this.getText());
		}

		// Check if we should trigger or update autocomplete
		if (!this.isAutocompleting) {
			// Auto-trigger for "/" at the start of a line (slash commands)
			if (char === "/" && this.isAtStartOfMessage()) {
				this.tryTriggerAutocomplete();
			}
			// Auto-trigger for "@" file reference (fuzzy search)
			else if (char === "@") {
				const currentLine = this.state.lines[this.state.cursorLine] || "";
				const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);
				// Only trigger if @ is after whitespace or at start of line
				const charBeforeAt = textBeforeCursor[textBeforeCursor.length - 2];
				if (textBeforeCursor.length === 1 || charBeforeAt === " " || charBeforeAt === "\t") {
					this.tryTriggerAutocomplete();
				}
			}
			// Also auto-trigger when typing letters in a slash command context
			else if (/[a-zA-Z0-9.\-_]/.test(char)) {
				const currentLine = this.state.lines[this.state.cursorLine] || "";
				const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);
				// Check if we're in a slash command (with or without space for arguments)
				if (textBeforeCursor.trimStart().startsWith("/")) {
					this.tryTriggerAutocomplete();
				}
				// Check if we're in an @ file reference context
				else if (textBeforeCursor.match(/(?:^|[\s])@[^\s]*$/)) {
					this.tryTriggerAutocomplete();
				}
			}
		} else {
			this.updateAutocomplete();
		}
	}

	private handlePaste(pastedText: string): void {
		this.historyIndex = -1; // Exit history browsing mode

		// Clean the pasted text
		const cleanText = pastedText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

		// Convert tabs to spaces (4 spaces per tab)
		const tabExpandedText = cleanText.replace(/\t/g, "    ");

		// Filter out non-printable characters except newlines
		let filteredText = tabExpandedText
			.split("")
			.filter((char) => char === "\n" || char.charCodeAt(0) >= 32)
			.join("");

		// If pasting a file path (starts with /, ~, or .) and the character before
		// the cursor is a word character, prepend a space for better readability
		if (/^[/~.]/.test(filteredText)) {
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			const charBeforeCursor = this.state.cursorCol > 0 ? currentLine[this.state.cursorCol - 1] : "";
			if (charBeforeCursor && /\w/.test(charBeforeCursor)) {
				filteredText = ` ${filteredText}`;
			}
		}

		// Split into lines
		const pastedLines = filteredText.split("\n");

		// Check if this is a large paste (> 10 lines or > 1000 characters)
		const totalChars = filteredText.length;
		if (pastedLines.length > 10 || totalChars > 1000) {
			// Store the paste and insert a marker
			this.pasteCounter++;
			const pasteId = this.pasteCounter;
			this.pastes.set(pasteId, filteredText);

			// Insert marker like "[paste #1 +123 lines]" or "[paste #1 1234 chars]"
			const marker =
				pastedLines.length > 10
					? `[paste #${pasteId} +${pastedLines.length} lines]`
					: `[paste #${pasteId} ${totalChars} chars]`;
			for (const char of marker) {
				this.insertCharacter(char);
			}

			return;
		}

		if (pastedLines.length === 1) {
			// Single line - just insert each character
			const text = pastedLines[0] || "";
			for (const char of text) {
				this.insertCharacter(char);
			}

			return;
		}

		// Multi-line paste - be very careful with array manipulation
		const currentLine = this.state.lines[this.state.cursorLine] || "";
		const beforeCursor = currentLine.slice(0, this.state.cursorCol);
		const afterCursor = currentLine.slice(this.state.cursorCol);

		// Build the new lines array step by step
		const newLines: string[] = [];

		// Add all lines before current line
		for (let i = 0; i < this.state.cursorLine; i++) {
			newLines.push(this.state.lines[i] || "");
		}

		// Add the first pasted line merged with before cursor text
		newLines.push(beforeCursor + (pastedLines[0] || ""));

		// Add all middle pasted lines
		for (let i = 1; i < pastedLines.length - 1; i++) {
			newLines.push(pastedLines[i] || "");
		}

		// Add the last pasted line with after cursor text
		newLines.push((pastedLines[pastedLines.length - 1] || "") + afterCursor);

		// Add all lines after current line
		for (let i = this.state.cursorLine + 1; i < this.state.lines.length; i++) {
			newLines.push(this.state.lines[i] || "");
		}

		// Replace the entire lines array
		this.state.lines = newLines;

		// Update cursor position to end of pasted content
		this.state.cursorLine += pastedLines.length - 1;
		this.state.cursorCol = (pastedLines[pastedLines.length - 1] || "").length;

		// Notify of change
		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	private addNewLine(): void {
		this.historyIndex = -1; // Exit history browsing mode

		const currentLine = this.state.lines[this.state.cursorLine] || "";

		const before = currentLine.slice(0, this.state.cursorCol);
		const after = currentLine.slice(this.state.cursorCol);

		// Split current line
		this.state.lines[this.state.cursorLine] = before;
		this.state.lines.splice(this.state.cursorLine + 1, 0, after);

		// Move cursor to start of new line
		this.state.cursorLine++;
		this.state.cursorCol = 0;

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	private handleBackspace(): void {
		this.historyIndex = -1; // Exit history browsing mode

		if (this.state.cursorCol > 0) {
			// Delete grapheme before cursor (handles emojis, combining characters, etc.)
			const line = this.state.lines[this.state.cursorLine] || "";
			const beforeCursor = line.slice(0, this.state.cursorCol);

			// Find the last grapheme in the text before cursor
			const graphemes = [...segmenter.segment(beforeCursor)];
			const lastGrapheme = graphemes[graphemes.length - 1];
			const graphemeLength = lastGrapheme ? lastGrapheme.segment.length : 1;

			const before = line.slice(0, this.state.cursorCol - graphemeLength);
			const after = line.slice(this.state.cursorCol);

			this.state.lines[this.state.cursorLine] = before + after;
			this.state.cursorCol -= graphemeLength;
		} else if (this.state.cursorLine > 0) {
			// Merge with previous line
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			const previousLine = this.state.lines[this.state.cursorLine - 1] || "";

			this.state.lines[this.state.cursorLine - 1] = previousLine + currentLine;
			this.state.lines.splice(this.state.cursorLine, 1);

			this.state.cursorLine--;
			this.state.cursorCol = previousLine.length;
		}

		if (this.onChange) {
			this.onChange(this.getText());
		}

		// Update or re-trigger autocomplete after backspace
		if (this.isAutocompleting) {
			this.updateAutocomplete();
		} else {
			// If autocomplete was cancelled (no matches), re-trigger if we're in a completable context
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);
			// Slash command context
			if (textBeforeCursor.trimStart().startsWith("/")) {
				this.tryTriggerAutocomplete();
			}
			// @ file reference context
			else if (textBeforeCursor.match(/(?:^|[\s])@[^\s]*$/)) {
				this.tryTriggerAutocomplete();
			}
		}
	}

	private moveToLineStart(): void {
		this.state.cursorCol = 0;
	}

	private moveToLineEnd(): void {
		const currentLine = this.state.lines[this.state.cursorLine] || "";
		this.state.cursorCol = currentLine.length;
	}

	private deleteToStartOfLine(): void {
		this.historyIndex = -1; // Exit history browsing mode

		const currentLine = this.state.lines[this.state.cursorLine] || "";

		if (this.state.cursorCol > 0) {
			// Delete from start of line up to cursor
			this.state.lines[this.state.cursorLine] = currentLine.slice(this.state.cursorCol);
			this.state.cursorCol = 0;
		} else if (this.state.cursorLine > 0) {
			// At start of line - merge with previous line
			const previousLine = this.state.lines[this.state.cursorLine - 1] || "";
			this.state.lines[this.state.cursorLine - 1] = previousLine + currentLine;
			this.state.lines.splice(this.state.cursorLine, 1);
			this.state.cursorLine--;
			this.state.cursorCol = previousLine.length;
		}

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	private deleteToEndOfLine(): void {
		this.historyIndex = -1; // Exit history browsing mode

		const currentLine = this.state.lines[this.state.cursorLine] || "";

		if (this.state.cursorCol < currentLine.length) {
			// Delete from cursor to end of line
			this.state.lines[this.state.cursorLine] = currentLine.slice(0, this.state.cursorCol);
		} else if (this.state.cursorLine < this.state.lines.length - 1) {
			// At end of line - merge with next line
			const nextLine = this.state.lines[this.state.cursorLine + 1] || "";
			this.state.lines[this.state.cursorLine] = currentLine + nextLine;
			this.state.lines.splice(this.state.cursorLine + 1, 1);
		}

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	private deleteWordBackwards(): void {
		this.historyIndex = -1; // Exit history browsing mode

		const currentLine = this.state.lines[this.state.cursorLine] || "";

		// If at start of line, behave like backspace at column 0 (merge with previous line)
		if (this.state.cursorCol === 0) {
			if (this.state.cursorLine > 0) {
				const previousLine = this.state.lines[this.state.cursorLine - 1] || "";
				this.state.lines[this.state.cursorLine - 1] = previousLine + currentLine;
				this.state.lines.splice(this.state.cursorLine, 1);
				this.state.cursorLine--;
				this.state.cursorCol = previousLine.length;
			}
		} else {
			const oldCursorCol = this.state.cursorCol;
			this.moveWordBackwards();
			const deleteFrom = this.state.cursorCol;
			this.state.cursorCol = oldCursorCol;

			this.state.lines[this.state.cursorLine] =
				currentLine.slice(0, deleteFrom) + currentLine.slice(this.state.cursorCol);
			this.state.cursorCol = deleteFrom;
		}

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	private handleForwardDelete(): void {
		this.historyIndex = -1; // Exit history browsing mode

		const currentLine = this.state.lines[this.state.cursorLine] || "";

		if (this.state.cursorCol < currentLine.length) {
			// Delete grapheme at cursor position (handles emojis, combining characters, etc.)
			const afterCursor = currentLine.slice(this.state.cursorCol);

			// Find the first grapheme at cursor
			const graphemes = [...segmenter.segment(afterCursor)];
			const firstGrapheme = graphemes[0];
			const graphemeLength = firstGrapheme ? firstGrapheme.segment.length : 1;

			const before = currentLine.slice(0, this.state.cursorCol);
			const after = currentLine.slice(this.state.cursorCol + graphemeLength);
			this.state.lines[this.state.cursorLine] = before + after;
		} else if (this.state.cursorLine < this.state.lines.length - 1) {
			// At end of line - merge with next line
			const nextLine = this.state.lines[this.state.cursorLine + 1] || "";
			this.state.lines[this.state.cursorLine] = currentLine + nextLine;
			this.state.lines.splice(this.state.cursorLine + 1, 1);
		}

		if (this.onChange) {
			this.onChange(this.getText());
		}

		// Update or re-trigger autocomplete after forward delete
		if (this.isAutocompleting) {
			this.updateAutocomplete();
		} else {
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);
			// Slash command context
			if (textBeforeCursor.trimStart().startsWith("/")) {
				this.tryTriggerAutocomplete();
			}
			// @ file reference context
			else if (textBeforeCursor.match(/(?:^|[\s])@[^\s]*$/)) {
				this.tryTriggerAutocomplete();
			}
		}
	}

	/**
	 * Build a mapping from visual lines to logical positions.
	 * Returns an array where each element represents a visual line with:
	 * - logicalLine: index into this.state.lines
	 * - startCol: starting column in the logical line
	 * - length: length of this visual line segment
	 */
	private buildVisualLineMap(width: number): Array<{ logicalLine: number; startCol: number; length: number }> {
		const visualLines: Array<{ logicalLine: number; startCol: number; length: number }> = [];

		for (let i = 0; i < this.state.lines.length; i++) {
			const line = this.state.lines[i] || "";
			const lineVisWidth = visibleWidth(line);
			if (line.length === 0) {
				// Empty line still takes one visual line
				visualLines.push({ logicalLine: i, startCol: 0, length: 0 });
			} else if (lineVisWidth <= width) {
				visualLines.push({ logicalLine: i, startCol: 0, length: line.length });
			} else {
				// Line needs wrapping - use word-aware wrapping
				const chunks = wordWrapLine(line, width);
				for (const chunk of chunks) {
					visualLines.push({
						logicalLine: i,
						startCol: chunk.startIndex,
						length: chunk.endIndex - chunk.startIndex,
					});
				}
			}
		}

		return visualLines;
	}

	/**
	 * Find the visual line index for the current cursor position.
	 */
	private findCurrentVisualLine(
		visualLines: Array<{ logicalLine: number; startCol: number; length: number }>,
	): number {
		for (let i = 0; i < visualLines.length; i++) {
			const vl = visualLines[i];
			if (!vl) continue;
			if (vl.logicalLine === this.state.cursorLine) {
				const colInSegment = this.state.cursorCol - vl.startCol;
				// Cursor is in this segment if it's within range
				// For the last segment of a logical line, cursor can be at length (end position)
				const isLastSegmentOfLine =
					i === visualLines.length - 1 || visualLines[i + 1]?.logicalLine !== vl.logicalLine;
				if (colInSegment >= 0 && (colInSegment < vl.length || (isLastSegmentOfLine && colInSegment <= vl.length))) {
					return i;
				}
			}
		}
		// Fallback: return last visual line
		return visualLines.length - 1;
	}

	private moveCursor(deltaLine: number, deltaCol: number): void {
		const width = this.lastWidth;

		if (deltaLine !== 0) {
			// Build visual line map for navigation
			const visualLines = this.buildVisualLineMap(width);
			const currentVisualLine = this.findCurrentVisualLine(visualLines);

			// Calculate column position within current visual line
			const currentVL = visualLines[currentVisualLine];
			const visualCol = currentVL ? this.state.cursorCol - currentVL.startCol : 0;

			// Move to target visual line
			const targetVisualLine = currentVisualLine + deltaLine;

			if (targetVisualLine >= 0 && targetVisualLine < visualLines.length) {
				const targetVL = visualLines[targetVisualLine];
				if (targetVL) {
					this.state.cursorLine = targetVL.logicalLine;
					// Try to maintain visual column position, clamped to line length
					const targetCol = targetVL.startCol + Math.min(visualCol, targetVL.length);
					const logicalLine = this.state.lines[targetVL.logicalLine] || "";
					this.state.cursorCol = Math.min(targetCol, logicalLine.length);
				}
			}
		}

		if (deltaCol !== 0) {
			const currentLine = this.state.lines[this.state.cursorLine] || "";

			if (deltaCol > 0) {
				// Moving right - move by one grapheme (handles emojis, combining characters, etc.)
				if (this.state.cursorCol < currentLine.length) {
					const afterCursor = currentLine.slice(this.state.cursorCol);
					const graphemes = [...segmenter.segment(afterCursor)];
					const firstGrapheme = graphemes[0];
					this.state.cursorCol += firstGrapheme ? firstGrapheme.segment.length : 1;
				} else if (this.state.cursorLine < this.state.lines.length - 1) {
					// Wrap to start of next logical line
					this.state.cursorLine++;
					this.state.cursorCol = 0;
				}
			} else {
				// Moving left - move by one grapheme (handles emojis, combining characters, etc.)
				if (this.state.cursorCol > 0) {
					const beforeCursor = currentLine.slice(0, this.state.cursorCol);
					const graphemes = [...segmenter.segment(beforeCursor)];
					const lastGrapheme = graphemes[graphemes.length - 1];
					this.state.cursorCol -= lastGrapheme ? lastGrapheme.segment.length : 1;
				} else if (this.state.cursorLine > 0) {
					// Wrap to end of previous logical line
					this.state.cursorLine--;
					const prevLine = this.state.lines[this.state.cursorLine] || "";
					this.state.cursorCol = prevLine.length;
				}
			}
		}
	}

	/**
	 * Scroll by a page (direction: -1 for up, 1 for down).
	 * Moves cursor by the page size while keeping it in bounds.
	 */
	private pageScroll(direction: -1 | 1): void {
		const width = this.lastWidth;
		const terminalRows = this.tui.terminal.rows;
		const pageSize = Math.max(5, Math.floor(terminalRows * 0.3));

		// Build visual line map
		const visualLines = this.buildVisualLineMap(width);
		const currentVisualLine = this.findCurrentVisualLine(visualLines);

		// Calculate target visual line
		const targetVisualLine = Math.max(0, Math.min(visualLines.length - 1, currentVisualLine + direction * pageSize));

		// Move cursor to target visual line
		const targetVL = visualLines[targetVisualLine];
		if (targetVL) {
			// Preserve column position within the line
			const currentVL = visualLines[currentVisualLine];
			const visualCol = currentVL ? this.state.cursorCol - currentVL.startCol : 0;

			this.state.cursorLine = targetVL.logicalLine;
			const targetCol = targetVL.startCol + Math.min(visualCol, targetVL.length);
			const logicalLine = this.state.lines[targetVL.logicalLine] || "";
			this.state.cursorCol = Math.min(targetCol, logicalLine.length);
		}
	}

	private moveWordBackwards(): void {
		const currentLine = this.state.lines[this.state.cursorLine] || "";

		// If at start of line, move to end of previous line
		if (this.state.cursorCol === 0) {
			if (this.state.cursorLine > 0) {
				this.state.cursorLine--;
				const prevLine = this.state.lines[this.state.cursorLine] || "";
				this.state.cursorCol = prevLine.length;
			}
			return;
		}

		const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);
		const graphemes = [...segmenter.segment(textBeforeCursor)];
		let newCol = this.state.cursorCol;

		// Skip trailing whitespace
		while (graphemes.length > 0 && isWhitespaceChar(graphemes[graphemes.length - 1]?.segment || "")) {
			newCol -= graphemes.pop()?.segment.length || 0;
		}

		if (graphemes.length > 0) {
			const lastGrapheme = graphemes[graphemes.length - 1]?.segment || "";
			if (isPunctuationChar(lastGrapheme)) {
				// Skip punctuation run
				while (graphemes.length > 0 && isPunctuationChar(graphemes[graphemes.length - 1]?.segment || "")) {
					newCol -= graphemes.pop()?.segment.length || 0;
				}
			} else {
				// Skip word run
				while (
					graphemes.length > 0 &&
					!isWhitespaceChar(graphemes[graphemes.length - 1]?.segment || "") &&
					!isPunctuationChar(graphemes[graphemes.length - 1]?.segment || "")
				) {
					newCol -= graphemes.pop()?.segment.length || 0;
				}
			}
		}

		this.state.cursorCol = newCol;
	}

	private moveWordForwards(): void {
		const currentLine = this.state.lines[this.state.cursorLine] || "";

		// If at end of line, move to start of next line
		if (this.state.cursorCol >= currentLine.length) {
			if (this.state.cursorLine < this.state.lines.length - 1) {
				this.state.cursorLine++;
				this.state.cursorCol = 0;
			}
			return;
		}

		const textAfterCursor = currentLine.slice(this.state.cursorCol);
		const segments = segmenter.segment(textAfterCursor);
		const iterator = segments[Symbol.iterator]();
		let next = iterator.next();

		// Skip leading whitespace
		while (!next.done && isWhitespaceChar(next.value.segment)) {
			this.state.cursorCol += next.value.segment.length;
			next = iterator.next();
		}

		if (!next.done) {
			const firstGrapheme = next.value.segment;
			if (isPunctuationChar(firstGrapheme)) {
				// Skip punctuation run
				while (!next.done && isPunctuationChar(next.value.segment)) {
					this.state.cursorCol += next.value.segment.length;
					next = iterator.next();
				}
			} else {
				// Skip word run
				while (!next.done && !isWhitespaceChar(next.value.segment) && !isPunctuationChar(next.value.segment)) {
					this.state.cursorCol += next.value.segment.length;
					next = iterator.next();
				}
			}
		}
	}

	// Helper method to check if cursor is at start of message (for slash command detection)
	private isAtStartOfMessage(): boolean {
		const currentLine = this.state.lines[this.state.cursorLine] || "";
		const beforeCursor = currentLine.slice(0, this.state.cursorCol);

		// At start if line is empty, only contains whitespace, or is just "/"
		return beforeCursor.trim() === "" || beforeCursor.trim() === "/";
	}

	// Autocomplete methods
	private tryTriggerAutocomplete(explicitTab: boolean = false): void {
		if (!this.autocompleteProvider) return;

		// Check if we should trigger file completion on Tab
		if (explicitTab) {
			const provider = this.autocompleteProvider as CombinedAutocompleteProvider;
			const shouldTrigger =
				!provider.shouldTriggerFileCompletion ||
				provider.shouldTriggerFileCompletion(this.state.lines, this.state.cursorLine, this.state.cursorCol);
			if (!shouldTrigger) {
				return;
			}
		}

		const suggestions = this.autocompleteProvider.getSuggestions(
			this.state.lines,
			this.state.cursorLine,
			this.state.cursorCol,
		);

		if (suggestions && suggestions.items.length > 0) {
			this.autocompletePrefix = suggestions.prefix;
			this.autocompleteList = new SelectList(suggestions.items, 5, this.theme.selectList);
			this.isAutocompleting = true;
		} else {
			this.cancelAutocomplete();
		}
	}

	private handleTabCompletion(): void {
		if (!this.autocompleteProvider) return;

		const currentLine = this.state.lines[this.state.cursorLine] || "";
		const beforeCursor = currentLine.slice(0, this.state.cursorCol);

		// Check if we're in a slash command context
		if (beforeCursor.trimStart().startsWith("/") && !beforeCursor.trimStart().includes(" ")) {
			this.handleSlashCommandCompletion();
		} else {
			this.forceFileAutocomplete();
		}
	}

	private handleSlashCommandCompletion(): void {
		this.tryTriggerAutocomplete(true);
	}

	/*
https://github.com/EsotericSoftware/spine-runtimes/actions/runs/19536643416/job/559322883
17 this job fails with https://github.com/EsotericSoftware/spine-runtimes/actions/runs/19
536643416/job/55932288317 havea  look at .gi
	 */
	private forceFileAutocomplete(): void {
		if (!this.autocompleteProvider) return;

		// Check if provider supports force file suggestions via runtime check
		const provider = this.autocompleteProvider as {
			getForceFileSuggestions?: CombinedAutocompleteProvider["getForceFileSuggestions"];
		};
		if (typeof provider.getForceFileSuggestions !== "function") {
			this.tryTriggerAutocomplete(true);
			return;
		}

		const suggestions = provider.getForceFileSuggestions(
			this.state.lines,
			this.state.cursorLine,
			this.state.cursorCol,
		);

		if (suggestions && suggestions.items.length > 0) {
			this.autocompletePrefix = suggestions.prefix;
			this.autocompleteList = new SelectList(suggestions.items, 5, this.theme.selectList);
			this.isAutocompleting = true;
		} else {
			this.cancelAutocomplete();
		}
	}

	private cancelAutocomplete(): void {
		this.isAutocompleting = false;
		this.autocompleteList = undefined;
		this.autocompletePrefix = "";
	}

	public isShowingAutocomplete(): boolean {
		return this.isAutocompleting;
	}

	private updateAutocomplete(): void {
		if (!this.isAutocompleting || !this.autocompleteProvider) return;

		const suggestions = this.autocompleteProvider.getSuggestions(
			this.state.lines,
			this.state.cursorLine,
			this.state.cursorCol,
		);

		if (suggestions && suggestions.items.length > 0) {
			this.autocompletePrefix = suggestions.prefix;
			// Always create new SelectList to ensure update
			this.autocompleteList = new SelectList(suggestions.items, 5, this.theme.selectList);
		} else {
			this.cancelAutocomplete();
		}
	}
}
