import type { AutocompleteProvider, CombinedAutocompleteProvider } from "../autocomplete.js";
import {
	isAltBackspace,
	isAltEnter,
	isAltLeft,
	isAltRight,
	isArrowDown,
	isArrowLeft,
	isArrowRight,
	isArrowUp,
	isCtrlA,
	isCtrlC,
	isCtrlE,
	isCtrlK,
	isCtrlLeft,
	isCtrlRight,
	isCtrlU,
	isCtrlW,
	isEnter,
	isEscape,
	isShiftEnter,
	isTab,
} from "../keys.js";
import type { Component } from "../tui.js";
import { visibleWidth } from "../utils.js";
import { SelectList, type SelectListTheme } from "./select-list.js";

// Grapheme segmenter for proper Unicode iteration (handles emojis, etc.)
const segmenter = new Intl.Segmenter();

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

export class Editor implements Component {
	private state: EditorState = {
		lines: [""],
		cursorLine: 0,
		cursorCol: 0,
	};

	private theme: EditorTheme;

	// Store last render width for cursor navigation
	private lastWidth: number = 80;

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

	// Prompt history for up/down navigation
	private history: string[] = [];
	private historyIndex: number = -1; // -1 = not browsing, 0 = most recent, 1 = older, etc.

	public onSubmit?: (text: string) => void;
	public onChange?: (text: string) => void;
	public disableSubmit: boolean = false;

	constructor(theme: EditorTheme) {
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

		const result: string[] = [];

		// Render top border
		result.push(horizontal.repeat(width));

		// Render each layout line
		for (const layoutLine of layoutLines) {
			let displayText = layoutLine.text;
			let lineVisibleWidth = visibleWidth(layoutLine.text);

			// Add cursor if this line has it
			if (layoutLine.hasCursor && layoutLine.cursorPos !== undefined) {
				const before = displayText.slice(0, layoutLine.cursorPos);
				const after = displayText.slice(layoutLine.cursorPos);

				if (after.length > 0) {
					// Cursor is on a character (grapheme) - replace it with highlighted version
					// Get the first grapheme from 'after'
					const afterGraphemes = [...segmenter.segment(after)];
					const firstGrapheme = afterGraphemes[0]?.segment || "";
					const restAfter = after.slice(firstGrapheme.length);
					const cursor = `\x1b[7m${firstGrapheme}\x1b[0m`;
					displayText = before + cursor + restAfter;
					// lineVisibleWidth stays the same - we're replacing, not adding
				} else {
					// Cursor is at the end - check if we have room for the space
					if (lineVisibleWidth < width) {
						// We have room - add highlighted space
						const cursor = "\x1b[7m \x1b[0m";
						displayText = before + cursor;
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
							displayText = beforeWithoutLast + cursor;
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

		// Render bottom border
		result.push(horizontal.repeat(width));

		// Add autocomplete list if active
		if (this.isAutocompleting && this.autocompleteList) {
			const autocompleteResult = this.autocompleteList.render(width);
			result.push(...autocompleteResult);
		}

		return result;
	}

	handleInput(data: string): void {
		// Handle bracketed paste mode
		// Start of paste: \x1b[200~
		// End of paste: \x1b[201~

		// Check if we're starting a bracketed paste
		if (data.includes("\x1b[200~")) {
			this.isInPaste = true;
			this.pasteBuffer = "";
			// Remove the start marker and keep the rest
			data = data.replace("\x1b[200~", "");
		}

		// If we're in a paste, buffer the data
		if (this.isInPaste) {
			// Append data to buffer first (end marker could be split across chunks)
			this.pasteBuffer += data;

			// Check if the accumulated buffer contains the end marker
			const endIndex = this.pasteBuffer.indexOf("\x1b[201~");
			if (endIndex !== -1) {
				// Extract content before the end marker
				const pasteContent = this.pasteBuffer.substring(0, endIndex);

				// Process the complete paste
				this.handlePaste(pasteContent);

				// Reset paste state
				this.isInPaste = false;

				// Process any remaining data after the end marker
				const remaining = this.pasteBuffer.substring(endIndex + 6); // 6 = length of \x1b[201~
				this.pasteBuffer = "";

				if (remaining.length > 0) {
					this.handleInput(remaining);
				}
				return;
			} else {
				// Still accumulating, wait for more data
				return;
			}
		}

		// Handle special key combinations first

		// Ctrl+C - Exit (let parent handle this)
		if (isCtrlC(data)) {
			return;
		}

		// Handle autocomplete special keys first (but don't block other input)
		if (this.isAutocompleting && this.autocompleteList) {
			// Escape - cancel autocomplete
			if (isEscape(data)) {
				this.cancelAutocomplete();
				return;
			}
			// Let the autocomplete list handle navigation and selection
			else if (isArrowUp(data) || isArrowDown(data) || isEnter(data) || isTab(data)) {
				// Only pass arrow keys to the list, not Enter/Tab (we handle those directly)
				if (isArrowUp(data) || isArrowDown(data)) {
					this.autocompleteList.handleInput(data);
					return;
				}

				// If Tab was pressed, always apply the selection
				if (isTab(data)) {
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

						if (this.onChange) {
							this.onChange(this.getText());
						}
					}
					return;
				}

				// If Enter was pressed on a slash command, apply completion and submit
				if (isEnter(data) && this.autocompletePrefix.startsWith("/")) {
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
					}
					this.cancelAutocomplete();
					// Don't return - fall through to submission logic
				}
				// If Enter was pressed on a file path, apply completion
				else if (isEnter(data)) {
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

						if (this.onChange) {
							this.onChange(this.getText());
						}
					}
					return;
				}
			}
			// For other keys (like regular typing), DON'T return here
			// Let them fall through to normal character handling
		}

		// Tab key - context-aware completion (but not when already autocompleting)
		if (isTab(data) && !this.isAutocompleting) {
			this.handleTabCompletion();
			return;
		}

		// Continue with rest of input handling
		// Ctrl+K - Delete to end of line
		if (isCtrlK(data)) {
			this.deleteToEndOfLine();
		}
		// Ctrl+U - Delete to start of line
		else if (isCtrlU(data)) {
			this.deleteToStartOfLine();
		}
		// Ctrl+W - Delete word backwards
		else if (isCtrlW(data)) {
			this.deleteWordBackwards();
		}
		// Option/Alt+Backspace - Delete word backwards
		else if (isAltBackspace(data)) {
			this.deleteWordBackwards();
		}
		// Ctrl+A - Move to start of line
		else if (isCtrlA(data)) {
			this.moveToLineStart();
		}
		// Ctrl+E - Move to end of line
		else if (isCtrlE(data)) {
			this.moveToLineEnd();
		}
		// New line shortcuts (but not plain LF/CR which should be submit)
		else if (
			(data.charCodeAt(0) === 10 && data.length > 1) || // Ctrl+Enter with modifiers
			data === "\x1b\r" || // Option+Enter in some terminals (legacy)
			data === "\x1b[13;2~" || // Shift+Enter in some terminals (legacy format)
			isShiftEnter(data) || // Shift+Enter (Kitty protocol, handles lock bits)
			isAltEnter(data) || // Alt+Enter (Kitty protocol, handles lock bits)
			(data.length > 1 && data.includes("\x1b") && data.includes("\r")) ||
			(data === "\n" && data.length === 1) || // Shift+Enter from iTerm2 mapping
			data === "\\\r" // Shift+Enter in VS Code terminal
		) {
			// Modifier + Enter = new line
			this.addNewLine();
		}
		// Plain Enter (char code 13 for CR) - only CR submits, LF adds new line
		else if (data.charCodeAt(0) === 13 && data.length === 1) {
			// If submit is disabled, do nothing
			if (this.disableSubmit) {
				return;
			}

			// Get text and substitute paste markers with actual content
			let result = this.state.lines.join("\n").trim();

			// Replace all [paste #N +xxx lines] or [paste #N xxx chars] markers with actual paste content
			for (const [pasteId, pasteContent] of this.pastes) {
				// Match formats: [paste #N], [paste #N +xxx lines], or [paste #N xxx chars]
				const markerRegex = new RegExp(`\\[paste #${pasteId}( (\\+\\d+ lines|\\d+ chars))?\\]`, "g");
				result = result.replace(markerRegex, pasteContent);
			}

			// Reset editor and clear pastes
			this.state = {
				lines: [""],
				cursorLine: 0,
				cursorCol: 0,
			};
			this.pastes.clear();
			this.pasteCounter = 0;
			this.historyIndex = -1; // Exit history browsing mode

			// Notify that editor is now empty
			if (this.onChange) {
				this.onChange("");
			}

			if (this.onSubmit) {
				this.onSubmit(result);
			}
		}
		// Backspace
		else if (data.charCodeAt(0) === 127 || data.charCodeAt(0) === 8) {
			this.handleBackspace();
		}
		// Line navigation shortcuts (Home/End keys)
		else if (data === "\x1b[H" || data === "\x1b[1~" || data === "\x1b[7~") {
			// Home key
			this.moveToLineStart();
		} else if (data === "\x1b[F" || data === "\x1b[4~" || data === "\x1b[8~") {
			// End key
			this.moveToLineEnd();
		}
		// Forward delete (Fn+Backspace or Delete key)
		else if (data === "\x1b[3~") {
			// Delete key
			this.handleForwardDelete();
		}
		// Word navigation (Option/Alt + Arrow or Ctrl + Arrow)
		else if (isAltLeft(data) || isCtrlLeft(data)) {
			// Word left
			this.moveWordBackwards();
		} else if (isAltRight(data) || isCtrlRight(data)) {
			// Word right
			this.moveWordForwards();
		}
		// Arrow keys
		else if (isArrowUp(data)) {
			// Up - history navigation or cursor movement
			if (this.isEditorEmpty()) {
				this.navigateHistory(-1); // Start browsing history
			} else if (this.historyIndex > -1 && this.isOnFirstVisualLine()) {
				this.navigateHistory(-1); // Navigate to older history entry
			} else {
				this.moveCursor(-1, 0); // Cursor movement (within text or history entry)
			}
		} else if (isArrowDown(data)) {
			// Down - history navigation or cursor movement
			if (this.historyIndex > -1 && this.isOnLastVisualLine()) {
				this.navigateHistory(1); // Navigate to newer history entry or clear
			} else {
				this.moveCursor(1, 0); // Cursor movement (within text or history entry)
			}
		} else if (isArrowRight(data)) {
			// Right
			this.moveCursor(0, 1);
		} else if (isArrowLeft(data)) {
			// Left
			this.moveCursor(0, -1);
		}
		// Regular characters (printable characters and unicode, but not control characters)
		else if (data.charCodeAt(0) >= 32) {
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
				// Line needs wrapping - use grapheme-aware chunking
				const chunks: { text: string; startIndex: number; endIndex: number }[] = [];
				let currentChunk = "";
				let currentWidth = 0;
				let chunkStartIndex = 0;
				let currentIndex = 0;

				for (const seg of segmenter.segment(line)) {
					const grapheme = seg.segment;
					const graphemeWidth = visibleWidth(grapheme);

					if (currentWidth + graphemeWidth > contentWidth && currentChunk !== "") {
						// Start a new chunk
						chunks.push({
							text: currentChunk,
							startIndex: chunkStartIndex,
							endIndex: currentIndex,
						});
						currentChunk = grapheme;
						currentWidth = graphemeWidth;
						chunkStartIndex = currentIndex;
					} else {
						currentChunk += grapheme;
						currentWidth += graphemeWidth;
					}
					currentIndex += grapheme.length;
				}

				// Push the last chunk
				if (currentChunk !== "") {
					chunks.push({
						text: currentChunk,
						startIndex: chunkStartIndex,
						endIndex: currentIndex,
					});
				}

				for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
					const chunk = chunks[chunkIndex];
					if (!chunk) continue;

					const cursorPos = this.state.cursorCol;
					const isLastChunk = chunkIndex === chunks.length - 1;
					// For non-last chunks, cursor at endIndex belongs to the next chunk
					const hasCursorInChunk =
						isCurrentLine &&
						cursorPos >= chunk.startIndex &&
						(isLastChunk ? cursorPos <= chunk.endIndex : cursorPos < chunk.endIndex);

					if (hasCursorInChunk) {
						layoutLines.push({
							text: chunk.text,
							hasCursor: true,
							cursorPos: cursorPos - chunk.startIndex,
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
			else if (/[a-zA-Z0-9]/.test(char)) {
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
		const filteredText = tabExpandedText
			.split("")
			.filter((char) => char === "\n" || char.charCodeAt(0) >= 32)
			.join("");

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
			const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);

			const isWhitespace = (char: string): boolean => /\s/.test(char);
			const isPunctuation = (char: string): boolean => {
				// Treat obvious code punctuation as boundaries
				return /[(){}[\]<>.,;:'"!?+\-=*/\\|&%^$#@~`]/.test(char);
			};

			let deleteFrom = this.state.cursorCol;
			const lastChar = textBeforeCursor[deleteFrom - 1] ?? "";

			// If immediately on whitespace or punctuation, delete that single boundary char
			if (isWhitespace(lastChar) || isPunctuation(lastChar)) {
				deleteFrom -= 1;
			} else {
				// Otherwise, delete a run of non-boundary characters (the "word")
				while (deleteFrom > 0) {
					const ch = textBeforeCursor[deleteFrom - 1] ?? "";
					if (isWhitespace(ch) || isPunctuation(ch)) {
						break;
					}
					deleteFrom -= 1;
				}
			}

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
				// Line needs wrapping - use grapheme-aware chunking
				let currentWidth = 0;
				let chunkStartIndex = 0;
				let currentIndex = 0;

				for (const seg of segmenter.segment(line)) {
					const grapheme = seg.segment;
					const graphemeWidth = visibleWidth(grapheme);

					if (currentWidth + graphemeWidth > width && currentIndex > chunkStartIndex) {
						// Start a new chunk
						visualLines.push({
							logicalLine: i,
							startCol: chunkStartIndex,
							length: currentIndex - chunkStartIndex,
						});
						chunkStartIndex = currentIndex;
						currentWidth = graphemeWidth;
					} else {
						currentWidth += graphemeWidth;
					}
					currentIndex += grapheme.length;
				}

				// Push the last chunk
				if (currentIndex > chunkStartIndex) {
					visualLines.push({
						logicalLine: i,
						startCol: chunkStartIndex,
						length: currentIndex - chunkStartIndex,
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

	private isWordBoundary(char: string): boolean {
		return /\s/.test(char) || /[(){}[\]<>.,;:'"!?+\-=*/\\|&%^$#@~`]/.test(char);
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
		let newCol = this.state.cursorCol;
		const lastChar = textBeforeCursor[newCol - 1] ?? "";

		// If immediately on whitespace or punctuation, skip that single boundary char
		if (this.isWordBoundary(lastChar)) {
			newCol -= 1;
		}

		// Now skip the "word" (non-boundary characters)
		while (newCol > 0) {
			const ch = textBeforeCursor[newCol - 1] ?? "";
			if (this.isWordBoundary(ch)) {
				break;
			}
			newCol -= 1;
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

		let newCol = this.state.cursorCol;
		const charAtCursor = currentLine[newCol] ?? "";

		// If on whitespace or punctuation, skip it
		if (this.isWordBoundary(charAtCursor)) {
			newCol += 1;
		}

		// Skip the "word" (non-boundary characters)
		while (newCol < currentLine.length) {
			const ch = currentLine[newCol] ?? "";
			if (this.isWordBoundary(ch)) {
				break;
			}
			newCol += 1;
		}

		this.state.cursorCol = newCol;
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
		if (beforeCursor.trimStart().startsWith("/")) {
			this.handleSlashCommandCompletion();
		} else {
			this.forceFileAutocomplete();
		}
	}

	private handleSlashCommandCompletion(): void {
		// For now, fall back to regular autocomplete (slash commands)
		// This can be extended later to handle command-specific argument completion
		this.tryTriggerAutocomplete(true);
	}

	/*
https://github.com/EsotericSoftware/spine-runtimes/actions/runs/19536643416/job/559322883
17 this job fails with https://github.com/EsotericSoftware/spine-runtimes/actions/runs/19
536643416/job/55932288317 havea  look at .gi
	 */
	private forceFileAutocomplete(): void {
		if (!this.autocompleteProvider) return;

		// Check if provider has the force method
		const provider = this.autocompleteProvider as any;
		if (!provider.getForceFileSuggestions) {
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
		this.autocompleteList = undefined as any;
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
			// No matches - check if we're still in a valid context before cancelling
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);

			this.cancelAutocomplete();
		}
	}
}
