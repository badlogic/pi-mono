import { getEditorKeybindings } from "../keybindings.js";
import { type Component, CURSOR_MARKER, type Focusable } from "../tui.js";
import { getSegmenter, isPunctuationChar, isWhitespaceChar, visibleWidth } from "../utils.js";

const segmenter = getSegmenter();

/**
 * Input component - single-line text input with horizontal scrolling
 */
export class Input implements Component, Focusable {
	private value: string = "";
	private cursor: number = 0; // Cursor position in the value
	public onSubmit?: (value: string) => void;
	public onEscape?: () => void;

	/** Focusable interface - set by TUI when focus changes */
	focused: boolean = false;

	// Bracketed paste mode buffering
	private pasteBuffer: string = "";
	private isInPaste: boolean = false;
	private pendingShiftEnter: boolean = false;

	getValue(): string {
		return this.value;
	}

	setValue(value: string): void {
		this.value = value;
		this.cursor = Math.min(this.cursor, value.length);
	}

	handleInput(data: string): void {
		// Handle bracketed paste mode
		// Start of paste: \x1b[200~
		// End of paste: \x1b[201~

		// Check if we're starting a bracketed paste
		if (data.includes("\x1b[200~")) {
			this.isInPaste = true;
			this.pasteBuffer = "";
			data = data.replace("\x1b[200~", "");
		}

		// If we're in a paste, buffer the data
		if (this.isInPaste) {
			// Check if this chunk contains the end marker
			this.pasteBuffer += data;

			const endIndex = this.pasteBuffer.indexOf("\x1b[201~");
			if (endIndex !== -1) {
				// Extract the pasted content
				const pasteContent = this.pasteBuffer.substring(0, endIndex);

				// Process the complete paste
				this.handlePaste(pasteContent);

				// Reset paste state
				this.isInPaste = false;

				// Handle any remaining input after the paste marker
				const remaining = this.pasteBuffer.substring(endIndex + 6); // 6 = length of \x1b[201~
				this.pasteBuffer = "";
				if (remaining) {
					this.handleInput(remaining);
				}
			}
			return;
		}

		if (this.pendingShiftEnter) {
			if (data === "\r") {
				this.pendingShiftEnter = false;
				if (this.onSubmit) this.onSubmit(this.value);
				return;
			}
			this.pendingShiftEnter = false;
			this.value = `${this.value.slice(0, this.cursor)}\\${this.value.slice(this.cursor)}`;
			this.cursor += 1;
		}

		if (data === "\\") {
			this.pendingShiftEnter = true;
			return;
		}

		const kb = getEditorKeybindings();

		// Escape/Cancel
		if (kb.matches(data, "selectCancel")) {
			if (this.onEscape) this.onEscape();
			return;
		}

		// Submit
		if (kb.matches(data, "submit") || data === "\n") {
			if (this.onSubmit) this.onSubmit(this.value);
			return;
		}

		// Deletion
		if (kb.matches(data, "deleteCharBackward")) {
			if (this.cursor > 0) {
				const beforeCursor = this.value.slice(0, this.cursor);
				const graphemes = [...segmenter.segment(beforeCursor)];
				const lastGrapheme = graphemes[graphemes.length - 1];
				const graphemeLength = lastGrapheme ? lastGrapheme.segment.length : 1;
				this.value = this.value.slice(0, this.cursor - graphemeLength) + this.value.slice(this.cursor);
				this.cursor -= graphemeLength;
			}
			return;
		}

		if (kb.matches(data, "deleteCharForward")) {
			if (this.cursor < this.value.length) {
				const afterCursor = this.value.slice(this.cursor);
				const graphemes = [...segmenter.segment(afterCursor)];
				const firstGrapheme = graphemes[0];
				const graphemeLength = firstGrapheme ? firstGrapheme.segment.length : 1;
				this.value = this.value.slice(0, this.cursor) + this.value.slice(this.cursor + graphemeLength);
			}
			return;
		}

		if (kb.matches(data, "deleteWordBackward")) {
			this.deleteWordBackwards();
			return;
		}

		if (kb.matches(data, "deleteToLineStart")) {
			this.value = this.value.slice(this.cursor);
			this.cursor = 0;
			return;
		}

		if (kb.matches(data, "deleteToLineEnd")) {
			this.value = this.value.slice(0, this.cursor);
			return;
		}

		// Cursor movement
		if (kb.matches(data, "cursorLeft")) {
			if (this.cursor > 0) {
				const beforeCursor = this.value.slice(0, this.cursor);
				const graphemes = [...segmenter.segment(beforeCursor)];
				const lastGrapheme = graphemes[graphemes.length - 1];
				this.cursor -= lastGrapheme ? lastGrapheme.segment.length : 1;
			}
			return;
		}

		if (kb.matches(data, "cursorRight")) {
			if (this.cursor < this.value.length) {
				const afterCursor = this.value.slice(this.cursor);
				const graphemes = [...segmenter.segment(afterCursor)];
				const firstGrapheme = graphemes[0];
				this.cursor += firstGrapheme ? firstGrapheme.segment.length : 1;
			}
			return;
		}

		if (kb.matches(data, "cursorLineStart")) {
			this.cursor = 0;
			return;
		}

		if (kb.matches(data, "cursorLineEnd")) {
			this.cursor = this.value.length;
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

		// Regular character input - accept printable characters including Unicode,
		// but reject control characters (C0: 0x00-0x1F, DEL: 0x7F, C1: 0x80-0x9F)
		const hasControlChars = [...data].some((ch) => {
			const code = ch.charCodeAt(0);
			return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
		});
		if (!hasControlChars) {
			this.value = this.value.slice(0, this.cursor) + data + this.value.slice(this.cursor);
			this.cursor += data.length;
		}
	}

	private deleteWordBackwards(): void {
		if (this.cursor === 0) {
			return;
		}

		const oldCursor = this.cursor;
		this.moveWordBackwards();
		const deleteFrom = this.cursor;
		this.cursor = oldCursor;

		this.value = this.value.slice(0, deleteFrom) + this.value.slice(this.cursor);
		this.cursor = deleteFrom;
	}

	private moveWordBackwards(): void {
		if (this.cursor === 0) {
			return;
		}

		const textBeforeCursor = this.value.slice(0, this.cursor);
		const graphemes = [...segmenter.segment(textBeforeCursor)];

		// Skip trailing whitespace
		while (graphemes.length > 0 && isWhitespaceChar(graphemes[graphemes.length - 1]?.segment || "")) {
			this.cursor -= graphemes.pop()?.segment.length || 0;
		}

		if (graphemes.length > 0) {
			const lastGrapheme = graphemes[graphemes.length - 1]?.segment || "";
			if (isPunctuationChar(lastGrapheme)) {
				// Skip punctuation run
				while (graphemes.length > 0 && isPunctuationChar(graphemes[graphemes.length - 1]?.segment || "")) {
					this.cursor -= graphemes.pop()?.segment.length || 0;
				}
			} else {
				// Skip word run
				while (
					graphemes.length > 0 &&
					!isWhitespaceChar(graphemes[graphemes.length - 1]?.segment || "") &&
					!isPunctuationChar(graphemes[graphemes.length - 1]?.segment || "")
				) {
					this.cursor -= graphemes.pop()?.segment.length || 0;
				}
			}
		}
	}

	private moveWordForwards(): void {
		if (this.cursor >= this.value.length) {
			return;
		}

		const textAfterCursor = this.value.slice(this.cursor);
		const segments = segmenter.segment(textAfterCursor);
		const iterator = segments[Symbol.iterator]();
		let next = iterator.next();

		// Skip leading whitespace
		while (!next.done && isWhitespaceChar(next.value.segment)) {
			this.cursor += next.value.segment.length;
			next = iterator.next();
		}

		if (!next.done) {
			const firstGrapheme = next.value.segment;
			if (isPunctuationChar(firstGrapheme)) {
				// Skip punctuation run
				while (!next.done && isPunctuationChar(next.value.segment)) {
					this.cursor += next.value.segment.length;
					next = iterator.next();
				}
			} else {
				// Skip word run
				while (!next.done && !isWhitespaceChar(next.value.segment) && !isPunctuationChar(next.value.segment)) {
					this.cursor += next.value.segment.length;
					next = iterator.next();
				}
			}
		}
	}

	private handlePaste(pastedText: string): void {
		// Clean the pasted text - remove newlines and carriage returns
		const cleanText = pastedText.replace(/\r\n/g, "").replace(/\r/g, "").replace(/\n/g, "");

		// Insert at cursor position
		this.value = this.value.slice(0, this.cursor) + cleanText + this.value.slice(this.cursor);
		this.cursor += cleanText.length;
	}

	invalidate(): void {
		// No cached state to invalidate currently
	}

	render(width: number): string[] {
		// Calculate visible window
		const prompt = "> ";
		const availableWidth = width - prompt.length;

		if (availableWidth <= 0) {
			return [prompt];
		}

		let visibleText = "";
		let cursorDisplay = this.cursor;

		if (this.value.length < availableWidth) {
			// Everything fits (leave room for cursor at end)
			visibleText = this.value;
		} else {
			// Need horizontal scrolling
			// Reserve one character for cursor if it's at the end
			const scrollWidth = this.cursor === this.value.length ? availableWidth - 1 : availableWidth;
			const halfWidth = Math.floor(scrollWidth / 2);

			if (this.cursor < halfWidth) {
				// Cursor near start
				visibleText = this.value.slice(0, scrollWidth);
				cursorDisplay = this.cursor;
			} else if (this.cursor > this.value.length - halfWidth) {
				// Cursor near end
				visibleText = this.value.slice(this.value.length - scrollWidth);
				cursorDisplay = scrollWidth - (this.value.length - this.cursor);
			} else {
				// Cursor in middle
				const start = this.cursor - halfWidth;
				visibleText = this.value.slice(start, start + scrollWidth);
				cursorDisplay = halfWidth;
			}
		}

		// Build line with fake cursor
		// Insert cursor character at cursor position
		const beforeCursor = visibleText.slice(0, cursorDisplay);
		const atCursor = visibleText[cursorDisplay] || " "; // Character at cursor, or space if at end
		const afterCursor = visibleText.slice(cursorDisplay + 1);

		// Hardware cursor marker (zero-width, emitted before fake cursor for IME positioning)
		const marker = this.focused ? CURSOR_MARKER : "";

		// Use inverse video to show cursor
		const cursorChar = `\x1b[7m${atCursor}\x1b[27m`; // ESC[7m = reverse video, ESC[27m = normal
		const textWithCursor = beforeCursor + marker + cursorChar + afterCursor;

		// Calculate visual width
		const visualLength = visibleWidth(textWithCursor);
		const padding = " ".repeat(Math.max(0, availableWidth - visualLength));
		const line = prompt + textWithCursor + padding;

		return [line];
	}
}
