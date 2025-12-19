import assert from "node:assert";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { Editor } from "../src/components/editor.js";
import { visibleWidth } from "../src/utils.js";
import { defaultEditorTheme } from "./test-themes.js";

describe("Editor component", () => {
	describe("Prompt history navigation", () => {
		it("does nothing on Up arrow when history is empty", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.handleInput("\x1b[A"); // Up arrow

			assert.strictEqual(editor.getText(), "");
		});

		it("shows most recent history entry on Up arrow when editor is empty", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.addToHistory("first prompt");
			editor.addToHistory("second prompt");

			editor.handleInput("\x1b[A"); // Up arrow

			assert.strictEqual(editor.getText(), "second prompt");
		});

		it("cycles through history entries on repeated Up arrow", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.addToHistory("first");
			editor.addToHistory("second");
			editor.addToHistory("third");

			editor.handleInput("\x1b[A"); // Up - shows "third"
			assert.strictEqual(editor.getText(), "third");

			editor.handleInput("\x1b[A"); // Up - shows "second"
			assert.strictEqual(editor.getText(), "second");

			editor.handleInput("\x1b[A"); // Up - shows "first"
			assert.strictEqual(editor.getText(), "first");

			editor.handleInput("\x1b[A"); // Up - stays at "first" (oldest)
			assert.strictEqual(editor.getText(), "first");
		});

		it("returns to empty editor on Down arrow after browsing history", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.addToHistory("prompt");

			editor.handleInput("\x1b[A"); // Up - shows "prompt"
			assert.strictEqual(editor.getText(), "prompt");

			editor.handleInput("\x1b[B"); // Down - clears editor
			assert.strictEqual(editor.getText(), "");
		});

		it("navigates forward through history with Down arrow", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.addToHistory("first");
			editor.addToHistory("second");
			editor.addToHistory("third");

			// Go to oldest
			editor.handleInput("\x1b[A"); // third
			editor.handleInput("\x1b[A"); // second
			editor.handleInput("\x1b[A"); // first

			// Navigate back
			editor.handleInput("\x1b[B"); // second
			assert.strictEqual(editor.getText(), "second");

			editor.handleInput("\x1b[B"); // third
			assert.strictEqual(editor.getText(), "third");

			editor.handleInput("\x1b[B"); // empty
			assert.strictEqual(editor.getText(), "");
		});

		it("exits history mode when typing a character", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.addToHistory("old prompt");

			editor.handleInput("\x1b[A"); // Up - shows "old prompt"
			editor.handleInput("x"); // Type a character - exits history mode

			assert.strictEqual(editor.getText(), "old promptx");
		});

		it("exits history mode on setText", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.addToHistory("first");
			editor.addToHistory("second");

			editor.handleInput("\x1b[A"); // Up - shows "second"
			editor.setText(""); // External clear

			// Up should start fresh from most recent
			editor.handleInput("\x1b[A");
			assert.strictEqual(editor.getText(), "second");
		});

		it("does not add empty strings to history", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.addToHistory("");
			editor.addToHistory("   ");
			editor.addToHistory("valid");

			editor.handleInput("\x1b[A");
			assert.strictEqual(editor.getText(), "valid");

			// Should not have more entries
			editor.handleInput("\x1b[A");
			assert.strictEqual(editor.getText(), "valid");
		});

		it("does not add consecutive duplicates to history", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.addToHistory("same");
			editor.addToHistory("same");
			editor.addToHistory("same");

			editor.handleInput("\x1b[A"); // "same"
			assert.strictEqual(editor.getText(), "same");

			editor.handleInput("\x1b[A"); // stays at "same" (only one entry)
			assert.strictEqual(editor.getText(), "same");
		});

		it("allows non-consecutive duplicates in history", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.addToHistory("first");
			editor.addToHistory("second");
			editor.addToHistory("first"); // Not consecutive, should be added

			editor.handleInput("\x1b[A"); // "first"
			assert.strictEqual(editor.getText(), "first");

			editor.handleInput("\x1b[A"); // "second"
			assert.strictEqual(editor.getText(), "second");

			editor.handleInput("\x1b[A"); // "first" (older one)
			assert.strictEqual(editor.getText(), "first");
		});

		it("uses cursor movement instead of history when editor has content", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.addToHistory("history item");
			editor.setText("line1\nline2");

			// Cursor is at end of line2, Up should move to line1
			editor.handleInput("\x1b[A"); // Up - cursor movement

			// Insert character to verify cursor position
			editor.handleInput("X");

			// X should be inserted in line1, not replace with history
			assert.strictEqual(editor.getText(), "line1X\nline2");
		});

		it("limits history to 100 entries", () => {
			const editor = new Editor(defaultEditorTheme);

			// Add 105 entries
			for (let i = 0; i < 105; i++) {
				editor.addToHistory(`prompt ${i}`);
			}

			// Navigate to oldest
			for (let i = 0; i < 100; i++) {
				editor.handleInput("\x1b[A");
			}

			// Should be at entry 5 (oldest kept), not entry 0
			assert.strictEqual(editor.getText(), "prompt 5");

			// One more Up should not change anything
			editor.handleInput("\x1b[A");
			assert.strictEqual(editor.getText(), "prompt 5");
		});

		it("allows cursor movement within multi-line history entry with Down", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.addToHistory("line1\nline2\nline3");

			// Browse to the multi-line entry
			editor.handleInput("\x1b[A"); // Up - shows entry, cursor at end of line3
			assert.strictEqual(editor.getText(), "line1\nline2\nline3");

			// Down should exit history since cursor is on last line
			editor.handleInput("\x1b[B"); // Down
			assert.strictEqual(editor.getText(), ""); // Exited to empty
		});

		it("allows cursor movement within multi-line history entry with Up", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.addToHistory("older entry");
			editor.addToHistory("line1\nline2\nline3");

			// Browse to the multi-line entry
			editor.handleInput("\x1b[A"); // Up - shows multi-line, cursor at end of line3

			// Up should move cursor within the entry (not on first line yet)
			editor.handleInput("\x1b[A"); // Up - cursor moves to line2
			assert.strictEqual(editor.getText(), "line1\nline2\nline3"); // Still same entry

			editor.handleInput("\x1b[A"); // Up - cursor moves to line1 (now on first visual line)
			assert.strictEqual(editor.getText(), "line1\nline2\nline3"); // Still same entry

			// Now Up should navigate to older history entry
			editor.handleInput("\x1b[A"); // Up - navigate to older
			assert.strictEqual(editor.getText(), "older entry");
		});

		it("navigates from multi-line entry back to newer via Down after cursor movement", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.addToHistory("line1\nline2\nline3");

			// Browse to entry and move cursor up
			editor.handleInput("\x1b[A"); // Up - shows entry, cursor at end
			editor.handleInput("\x1b[A"); // Up - cursor to line2
			editor.handleInput("\x1b[A"); // Up - cursor to line1

			// Now Down should move cursor down within the entry
			editor.handleInput("\x1b[B"); // Down - cursor to line2
			assert.strictEqual(editor.getText(), "line1\nline2\nline3");

			editor.handleInput("\x1b[B"); // Down - cursor to line3
			assert.strictEqual(editor.getText(), "line1\nline2\nline3");

			// Now on last line, Down should exit history
			editor.handleInput("\x1b[B"); // Down - exit to empty
			assert.strictEqual(editor.getText(), "");
		});
	});

	describe("public state accessors", () => {
		it("returns cursor position", () => {
			const editor = new Editor(defaultEditorTheme);

			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

			editor.handleInput("a");
			editor.handleInput("b");
			editor.handleInput("c");

			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

			editor.handleInput("\x1b[D"); // Left
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 2 });
		});

		it("returns lines as a defensive copy", () => {
			const editor = new Editor(defaultEditorTheme);
			editor.setText("a\nb");

			const lines = editor.getLines();
			assert.deepStrictEqual(lines, ["a", "b"]);

			lines[0] = "mutated";
			assert.deepStrictEqual(editor.getLines(), ["a", "b"]);
		});
	});

	describe("Unicode text editing behavior", () => {
		it("inserts mixed ASCII, umlauts, and emojis as literal text", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.handleInput("H");
			editor.handleInput("e");
			editor.handleInput("l");
			editor.handleInput("l");
			editor.handleInput("o");
			editor.handleInput(" ");
			editor.handleInput("ä");
			editor.handleInput("ö");
			editor.handleInput("ü");
			editor.handleInput(" ");
			editor.handleInput("😀");

			const text = editor.getText();
			assert.strictEqual(text, "Hello äöü 😀");
		});

		it("deletes single-code-unit unicode characters (umlauts) with Backspace", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.handleInput("ä");
			editor.handleInput("ö");
			editor.handleInput("ü");

			// Delete the last character (ü)
			editor.handleInput("\x7f"); // Backspace

			const text = editor.getText();
			assert.strictEqual(text, "äö");
		});

		it("deletes multi-code-unit emojis with single Backspace", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.handleInput("😀");
			editor.handleInput("👍");

			// Delete the last emoji (👍) - single backspace deletes whole grapheme cluster
			editor.handleInput("\x7f"); // Backspace

			const text = editor.getText();
			assert.strictEqual(text, "😀");
		});

		it("inserts characters at the correct position after cursor movement over umlauts", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.handleInput("ä");
			editor.handleInput("ö");
			editor.handleInput("ü");

			// Move cursor left twice
			editor.handleInput("\x1b[D"); // Left arrow
			editor.handleInput("\x1b[D"); // Left arrow

			// Insert 'x' in the middle
			editor.handleInput("x");

			const text = editor.getText();
			assert.strictEqual(text, "äxöü");
		});

		it("moves cursor across multi-code-unit emojis with single arrow key", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.handleInput("😀");
			editor.handleInput("👍");
			editor.handleInput("🎉");

			// Move cursor left over last emoji (🎉) - single arrow moves over whole grapheme
			editor.handleInput("\x1b[D"); // Left arrow

			// Move cursor left over second emoji (👍)
			editor.handleInput("\x1b[D");

			// Insert 'x' between first and second emoji
			editor.handleInput("x");

			const text = editor.getText();
			assert.strictEqual(text, "😀x👍🎉");
		});

		it("preserves umlauts across line breaks", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.handleInput("ä");
			editor.handleInput("ö");
			editor.handleInput("ü");
			editor.handleInput("\n"); // new line
			editor.handleInput("Ä");
			editor.handleInput("Ö");
			editor.handleInput("Ü");

			const text = editor.getText();
			assert.strictEqual(text, "äöü\nÄÖÜ");
		});

		it("replaces the entire document with unicode text via setText (paste simulation)", () => {
			const editor = new Editor(defaultEditorTheme);

			// Simulate bracketed paste / programmatic replacement
			editor.setText("Hällö Wörld! 😀 äöüÄÖÜß");

			const text = editor.getText();
			assert.strictEqual(text, "Hällö Wörld! 😀 äöüÄÖÜß");
		});

		it("moves cursor to document start on Ctrl+A and inserts at the beginning", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.handleInput("a");
			editor.handleInput("b");
			editor.handleInput("\x01"); // Ctrl+A (move to start)
			editor.handleInput("x"); // Insert at start

			const text = editor.getText();
			assert.strictEqual(text, "xab");
		});
	});

	describe("Grapheme-aware text wrapping", () => {
		it("wraps lines correctly when text contains wide emojis", () => {
			const editor = new Editor(defaultEditorTheme);
			const width = 20;

			// ✅ is 2 columns wide, so "Hello ✅ World" is 14 columns
			editor.setText("Hello ✅ World");
			const lines = editor.render(width);

			// All content lines (between borders) should fit within width
			for (let i = 1; i < lines.length - 1; i++) {
				const lineWidth = visibleWidth(lines[i]!);
				assert.strictEqual(lineWidth, width, `Line ${i} has width ${lineWidth}, expected ${width}`);
			}
		});

		it("wraps long text with emojis at correct positions", () => {
			const editor = new Editor(defaultEditorTheme);
			const width = 10;

			// Each ✅ is 2 columns. "✅✅✅✅✅" = 10 columns, fits exactly
			// "✅✅✅✅✅✅" = 12 columns, needs wrap
			editor.setText("✅✅✅✅✅✅");
			const lines = editor.render(width);

			// Should have 2 content lines (plus 2 border lines)
			// First line: 5 emojis (10 cols), second line: 1 emoji (2 cols) + padding
			for (let i = 1; i < lines.length - 1; i++) {
				const lineWidth = visibleWidth(lines[i]!);
				assert.strictEqual(lineWidth, width, `Line ${i} has width ${lineWidth}, expected ${width}`);
			}
		});

		it("wraps CJK characters correctly (each is 2 columns wide)", () => {
			const editor = new Editor(defaultEditorTheme);
			const width = 10;

			// Each CJK char is 2 columns. "日本語テスト" = 6 chars = 12 columns
			editor.setText("日本語テスト");
			const lines = editor.render(width);

			for (let i = 1; i < lines.length - 1; i++) {
				const lineWidth = visibleWidth(lines[i]!);
				assert.strictEqual(lineWidth, width, `Line ${i} has width ${lineWidth}, expected ${width}`);
			}

			// Verify content split correctly
			const contentLines = lines.slice(1, -1).map((l) => stripVTControlCharacters(l).trim());
			assert.strictEqual(contentLines.length, 2);
			assert.strictEqual(contentLines[0], "日本語テス"); // 5 chars = 10 columns
			assert.strictEqual(contentLines[1], "ト"); // 1 char = 2 columns (+ padding)
		});

		it("handles mixed ASCII and wide characters in wrapping", () => {
			const editor = new Editor(defaultEditorTheme);
			const width = 15;

			// "Test ✅ OK 日本" = 4 + 1 + 2 + 1 + 2 + 1 + 4 = 15 columns (fits exactly)
			editor.setText("Test ✅ OK 日本");
			const lines = editor.render(width);

			// Should fit in one content line
			const contentLines = lines.slice(1, -1);
			assert.strictEqual(contentLines.length, 1);

			const lineWidth = visibleWidth(contentLines[0]!);
			assert.strictEqual(lineWidth, width);
		});

		it("renders cursor correctly on wide characters", () => {
			const editor = new Editor(defaultEditorTheme);
			const width = 20;

			editor.setText("A✅B");
			// Cursor should be at end (after B)
			const lines = editor.render(width);

			// The cursor (reverse video space) should be visible
			const contentLine = lines[1]!;
			assert.ok(contentLine.includes("\x1b[7m"), "Should have reverse video cursor");

			// Line should still be correct width
			assert.strictEqual(visibleWidth(contentLine), width);
		});

		it("does not exceed terminal width with emoji at wrap boundary", () => {
			const editor = new Editor(defaultEditorTheme);
			const width = 11;

			// "0123456789✅" = 10 ASCII + 2-wide emoji = 12 columns
			// Should wrap before the emoji since it would exceed width
			editor.setText("0123456789✅");
			const lines = editor.render(width);

			for (let i = 1; i < lines.length - 1; i++) {
				const lineWidth = visibleWidth(lines[i]!);
				assert.ok(lineWidth <= width, `Line ${i} has width ${lineWidth}, exceeds max ${width}`);
			}
		});
	});
});
