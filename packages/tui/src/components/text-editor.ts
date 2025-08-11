import chalk from "chalk";
import type { AutocompleteProvider, CombinedAutocompleteProvider } from "../autocomplete.js";
import { type Component, type ComponentRenderResult, getNextComponentId } from "../tui.js";
import { SelectList } from "./select-list.js";

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

export interface TextEditorConfig {
	// Configuration options for text editor (none currently)
}

export class TextEditor implements Component {
	readonly id = getNextComponentId();
	private state: EditorState = {
		lines: [""],
		cursorLine: 0,
		cursorCol: 0,
	};

	private config: TextEditorConfig = {};

	// Autocomplete support
	private autocompleteProvider?: AutocompleteProvider;
	private autocompleteList?: SelectList;
	private isAutocompleting: boolean = false;
	private autocompletePrefix: string = "";

	public onSubmit?: (text: string) => void;
	public onChange?: (text: string) => void;
	public disableSubmit: boolean = false;

	constructor(config?: TextEditorConfig) {
		if (config) {
			this.config = { ...this.config, ...config };
		}
	}

	configure(config: Partial<TextEditorConfig>): void {
		this.config = { ...this.config, ...config };
	}

	setAutocompleteProvider(provider: AutocompleteProvider): void {
		this.autocompleteProvider = provider;
	}

	render(width: number): ComponentRenderResult {
		// Box drawing characters
		const topLeft = chalk.gray("╭");
		const topRight = chalk.gray("╮");
		const bottomLeft = chalk.gray("╰");
		const bottomRight = chalk.gray("╯");
		const horizontal = chalk.gray("─");
		const vertical = chalk.gray("│");

		// Calculate box width - leave 1 char margin to avoid edge wrapping
		const boxWidth = width - 1;
		const contentWidth = boxWidth - 4; // Account for "│ " and " │"

		// Layout the text
		const layoutLines = this.layoutText(contentWidth);

		const result: string[] = [];

		// Render top border
		result.push(topLeft + horizontal.repeat(boxWidth - 2) + topRight);

		// Render each layout line
		for (const layoutLine of layoutLines) {
			let displayText = layoutLine.text;
			let visibleLength = layoutLine.text.length;

			// Add cursor if this line has it
			if (layoutLine.hasCursor && layoutLine.cursorPos !== undefined) {
				const before = displayText.slice(0, layoutLine.cursorPos);
				const after = displayText.slice(layoutLine.cursorPos);

				if (after.length > 0) {
					// Cursor is on a character - replace it with highlighted version
					const cursor = `\x1b[7m${after[0]}\x1b[0m`;
					const restAfter = after.slice(1);
					displayText = before + cursor + restAfter;
					// visibleLength stays the same - we're replacing, not adding
				} else {
					// Cursor is at the end - add highlighted space
					const cursor = "\x1b[7m \x1b[0m";
					displayText = before + cursor;
					// visibleLength increases by 1 - we're adding a space
					visibleLength = layoutLine.text.length + 1;
				}
			}

			// Calculate padding based on actual visible length
			const padding = " ".repeat(Math.max(0, contentWidth - visibleLength));

			// Render the line
			result.push(`${vertical} ${displayText}${padding} ${vertical}`);
		}

		// Render bottom border
		result.push(bottomLeft + horizontal.repeat(boxWidth - 2) + bottomRight);

		// Add autocomplete list if active
		if (this.isAutocompleting && this.autocompleteList) {
			const autocompleteResult = this.autocompleteList.render(width);
			result.push(...autocompleteResult.lines);
		}

		// For interactive components like text editors, always assume changed
		// This ensures cursor position updates are always reflected
		return {
			lines: result,
			changed: true,
		};
	}

	handleInput(data: string): void {
		// Handle special key combinations first

		// Ctrl+C - Exit (let parent handle this)
		if (data.charCodeAt(0) === 3) {
			return;
		}

		// Handle paste - detect when we get a lot of text at once
		const isPaste = data.length > 10 || (data.length > 2 && data.includes("\n"));
		if (isPaste) {
			this.handlePaste(data);
			return;
		}

		// Handle autocomplete special keys first (but don't block other input)
		if (this.isAutocompleting && this.autocompleteList) {
			// Escape - cancel autocomplete
			if (data === "\x1b") {
				this.cancelAutocomplete();
				return;
			}
			// Let the autocomplete list handle navigation and selection
			else if (data === "\x1b[A" || data === "\x1b[B" || data === "\r" || data === "\t") {
				// Only pass arrow keys to the list, not Enter/Tab (we handle those directly)
				if (data === "\x1b[A" || data === "\x1b[B") {
					this.autocompleteList.handleInput(data);
				}

				// If Tab was pressed, apply the selection
				if (data === "\t") {
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
				// If Enter was pressed, cancel autocomplete and let it fall through to submission
				else if (data === "\r") {
					this.cancelAutocomplete();
					// Don't return here - let Enter fall through to normal submission handling
				} else {
					// For other keys, handle normally within autocomplete
					return;
				}
			}
			// For other keys (like regular typing), DON'T return here
			// Let them fall through to normal character handling
		}

		// Tab key - context-aware completion (but not when already autocompleting)
		if (data === "\t" && !this.isAutocompleting) {
			this.handleTabCompletion();
			return;
		}

		// Continue with rest of input handling
		// Ctrl+K - Delete current line
		if (data.charCodeAt(0) === 11) {
			this.deleteCurrentLine();
		}
		// Ctrl+A - Move to start of line
		else if (data.charCodeAt(0) === 1) {
			this.moveToLineStart();
		}
		// Ctrl+E - Move to end of line
		else if (data.charCodeAt(0) === 5) {
			this.moveToLineEnd();
		}
		// New line shortcuts (but not plain LF/CR which should be submit)
		else if (
			(data.charCodeAt(0) === 10 && data.length > 1) || // Ctrl+Enter with modifiers
			data === "\x1b\r" || // Option+Enter in some terminals
			data === "\x1b[13;2~" || // Shift+Enter in some terminals
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

			// Plain Enter = submit
			const result = this.state.lines.join("\n").trim();

			// Reset editor
			this.state = {
				lines: [""],
				cursorLine: 0,
				cursorCol: 0,
			};

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
		// Arrow keys
		else if (data === "\x1b[A") {
			// Up
			this.moveCursor(-1, 0);
		} else if (data === "\x1b[B") {
			// Down
			this.moveCursor(1, 0);
		} else if (data === "\x1b[C") {
			// Right
			this.moveCursor(0, 1);
		} else if (data === "\x1b[D") {
			// Left
			this.moveCursor(0, -1);
		}
		// Regular characters (printable ASCII)
		else if (data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126) {
			this.insertCharacter(data);
		}
	}

	private layoutText(contentWidth: number): LayoutLine[] {
		const layoutLines: LayoutLine[] = [];

		if (this.state.lines.length === 0 || (this.state.lines.length === 1 && this.state.lines[0] === "")) {
			// Empty editor
			layoutLines.push({
				text: "> ",
				hasCursor: true,
				cursorPos: 2,
			});
			return layoutLines;
		}

		// Process each logical line
		for (let i = 0; i < this.state.lines.length; i++) {
			const line = this.state.lines[i] || "";
			const isCurrentLine = i === this.state.cursorLine;
			const prefix = i === 0 ? "> " : "  ";
			const prefixedLine = prefix + line;
			const maxLineLength = contentWidth;

			if (prefixedLine.length <= maxLineLength) {
				// Line fits in one layout line
				if (isCurrentLine) {
					layoutLines.push({
						text: prefixedLine,
						hasCursor: true,
						cursorPos: prefix.length + this.state.cursorCol,
					});
				} else {
					layoutLines.push({
						text: prefixedLine,
						hasCursor: false,
					});
				}
			} else {
				// Line needs wrapping
				const chunks = [];
				for (let pos = 0; pos < prefixedLine.length; pos += maxLineLength) {
					chunks.push(prefixedLine.slice(pos, pos + maxLineLength));
				}

				for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
					const chunk = chunks[chunkIndex];
					if (!chunk) continue;

					const chunkStart = chunkIndex * maxLineLength;
					const chunkEnd = chunkStart + chunk.length;
					const cursorPos = prefix.length + this.state.cursorCol;
					const hasCursorInChunk = isCurrentLine && cursorPos >= chunkStart && cursorPos < chunkEnd;

					if (hasCursorInChunk) {
						layoutLines.push({
							text: chunk,
							hasCursor: true,
							cursorPos: cursorPos - chunkStart,
						});
					} else {
						layoutLines.push({
							text: chunk,
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

	setText(text: string): void {
		// Split text into lines, handling different line endings
		const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

		// Ensure at least one empty line
		this.state.lines = lines.length === 0 ? [""] : lines;

		// Reset cursor to end of text
		this.state.cursorLine = this.state.lines.length - 1;
		this.state.cursorCol = this.state.lines[this.state.cursorLine]?.length || 0;

		// Notify of change
		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	// All the editor methods from before...
	private insertCharacter(char: string): void {
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
			// Also auto-trigger when typing letters in a slash command context
			else if (/[a-zA-Z0-9]/.test(char)) {
				const currentLine = this.state.lines[this.state.cursorLine] || "";
				const textBeforeCursor = currentLine.slice(0, this.state.cursorCol);
				// Check if we're in a slash command with a space (i.e., typing arguments)
				if (textBeforeCursor.startsWith("/") && textBeforeCursor.includes(" ")) {
					this.tryTriggerAutocomplete();
				}
			}
		} else {
			this.updateAutocomplete();
		}
	}

	private handlePaste(pastedText: string): void {
		// Clean the pasted text
		const cleanText = pastedText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

		// Convert tabs to spaces (4 spaces per tab)
		const tabExpandedText = cleanText.replace(/\t/g, "    ");

		// Filter out non-printable characters except newlines
		const filteredText = tabExpandedText
			.split("")
			.filter((char) => char === "\n" || (char >= " " && char <= "~"))
			.join("");

		// Split into lines
		const pastedLines = filteredText.split("\n");

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
		if (this.state.cursorCol > 0) {
			// Delete character in current line
			const line = this.state.lines[this.state.cursorLine] || "";

			const before = line.slice(0, this.state.cursorCol - 1);
			const after = line.slice(this.state.cursorCol);

			this.state.lines[this.state.cursorLine] = before + after;
			this.state.cursorCol--;
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

		// Update autocomplete after backspace
		if (this.isAutocompleting) {
			this.updateAutocomplete();
		}
	}

	private moveToLineStart(): void {
		this.state.cursorCol = 0;
	}

	private moveToLineEnd(): void {
		const currentLine = this.state.lines[this.state.cursorLine] || "";
		this.state.cursorCol = currentLine.length;
	}

	private handleForwardDelete(): void {
		const currentLine = this.state.lines[this.state.cursorLine] || "";

		if (this.state.cursorCol < currentLine.length) {
			// Delete character at cursor position (forward delete)
			const before = currentLine.slice(0, this.state.cursorCol);
			const after = currentLine.slice(this.state.cursorCol + 1);
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
	}

	private deleteCurrentLine(): void {
		if (this.state.lines.length === 1) {
			// Only one line - just clear it
			this.state.lines[0] = "";
			this.state.cursorCol = 0;
		} else {
			// Multiple lines - remove current line
			this.state.lines.splice(this.state.cursorLine, 1);

			// Adjust cursor position
			if (this.state.cursorLine >= this.state.lines.length) {
				// Was on last line, move to new last line
				this.state.cursorLine = this.state.lines.length - 1;
			}

			// Clamp cursor column to new line length
			const newLine = this.state.lines[this.state.cursorLine] || "";
			this.state.cursorCol = Math.min(this.state.cursorCol, newLine.length);
		}

		if (this.onChange) {
			this.onChange(this.getText());
		}
	}

	private moveCursor(deltaLine: number, deltaCol: number): void {
		if (deltaLine !== 0) {
			const newLine = this.state.cursorLine + deltaLine;
			if (newLine >= 0 && newLine < this.state.lines.length) {
				this.state.cursorLine = newLine;
				// Clamp cursor column to new line length
				const line = this.state.lines[this.state.cursorLine] || "";
				this.state.cursorCol = Math.min(this.state.cursorCol, line.length);
			}
		}

		if (deltaCol !== 0) {
			// Move column
			const newCol = this.state.cursorCol + deltaCol;
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			const maxCol = currentLine.length;
			this.state.cursorCol = Math.max(0, Math.min(maxCol, newCol));
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
			this.autocompleteList = new SelectList(suggestions.items, 5);
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
		}
	}

	private handleSlashCommandCompletion(): void {
		// For now, fall back to regular autocomplete (slash commands)
		// This can be extended later to handle command-specific argument completion
		this.tryTriggerAutocomplete(true);
	}

	private cancelAutocomplete(): void {
		this.isAutocompleting = false;
		this.autocompleteList = undefined as any;
		this.autocompletePrefix = "";
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
			if (this.autocompleteList) {
				// Update the existing list with new items
				this.autocompleteList = new SelectList(suggestions.items, 5);
			}
		} else {
			// No more matches, cancel autocomplete
			this.cancelAutocomplete();
		}
	}
}
