import assert from "node:assert";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";
import type { AutocompleteProvider } from "../src/autocomplete.js";
import { Editor, wordWrapLine } from "../src/components/editor.js";
import { TUI } from "../src/tui.js";
import { visibleWidth } from "../src/utils.js";
import { defaultEditorTheme } from "./test-themes.js";
import { VirtualTerminal } from "./virtual-terminal.js";

/** Create a TUI with a virtual terminal for testing */
function createTestTUI(cols = 80, rows = 24): TUI {
	return new TUI(new VirtualTerminal(cols, rows));
}

describe("Editor component", () => {
	describe("Prompt history navigation", () => {
		it("does nothing on Up arrow when history is empty", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("\x1b[A"); // Up arrow

			assert.strictEqual(editor.getText(), "");
		});

		it("shows most recent history entry on Up arrow when editor is empty", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.addToHistory("first prompt");
			editor.addToHistory("second prompt");

			editor.handleInput("\x1b[A"); // Up arrow

			assert.strictEqual(editor.getText(), "second prompt");
		});

		it("cycles through history entries on repeated Up arrow", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

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
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.addToHistory("prompt");

			editor.handleInput("\x1b[A"); // Up - shows "prompt"
			assert.strictEqual(editor.getText(), "prompt");

			editor.handleInput("\x1b[B"); // Down - clears editor
			assert.strictEqual(editor.getText(), "");
		});

		it("navigates forward through history with Down arrow", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

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
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.addToHistory("old prompt");

			editor.handleInput("\x1b[A"); // Up - shows "old prompt"
			editor.handleInput("x"); // Type a character - exits history mode

			assert.strictEqual(editor.getText(), "old promptx");
		});

		it("exits history mode on setText", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.addToHistory("first");
			editor.addToHistory("second");

			editor.handleInput("\x1b[A"); // Up - shows "second"
			editor.setText(""); // External clear

			// Up should start fresh from most recent
			editor.handleInput("\x1b[A");
			assert.strictEqual(editor.getText(), "second");
		});

		it("does not add empty strings to history", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

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
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.addToHistory("same");
			editor.addToHistory("same");
			editor.addToHistory("same");

			editor.handleInput("\x1b[A"); // "same"
			assert.strictEqual(editor.getText(), "same");

			editor.handleInput("\x1b[A"); // stays at "same" (only one entry)
			assert.strictEqual(editor.getText(), "same");
		});

		it("allows non-consecutive duplicates in history", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

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
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

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
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

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
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.addToHistory("line1\nline2\nline3");

			// Browse to the multi-line entry
			editor.handleInput("\x1b[A"); // Up - shows entry, cursor at end of line3
			assert.strictEqual(editor.getText(), "line1\nline2\nline3");

			// Down should exit history since cursor is on last line
			editor.handleInput("\x1b[B"); // Down
			assert.strictEqual(editor.getText(), ""); // Exited to empty
		});

		it("allows cursor movement within multi-line history entry with Up", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

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
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

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
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

			editor.handleInput("a");
			editor.handleInput("b");
			editor.handleInput("c");

			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

			editor.handleInput("\x1b[D"); // Left
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 2 });
		});

		it("returns lines as a defensive copy", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);
			editor.setText("a\nb");

			const lines = editor.getLines();
			assert.deepStrictEqual(lines, ["a", "b"]);

			lines[0] = "mutated";
			assert.deepStrictEqual(editor.getLines(), ["a", "b"]);
		});
	});

	describe("Shift+Enter handling", () => {
		it("treats split VS Code Shift+Enter as a newline", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("\\");
			editor.handleInput("\r");

			assert.strictEqual(editor.getText(), "\n");
		});

		it("inserts a literal backslash when not followed by Enter", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("\\");
			editor.handleInput("x");

			assert.strictEqual(editor.getText(), "\\x");
		});
	});

	describe("Unicode text editing behavior", () => {
		it("inserts mixed ASCII, umlauts, and emojis as literal text", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

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
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("ä");
			editor.handleInput("ö");
			editor.handleInput("ü");

			// Delete the last character (ü)
			editor.handleInput("\x7f"); // Backspace

			const text = editor.getText();
			assert.strictEqual(text, "äö");
		});

		it("deletes multi-code-unit emojis with single Backspace", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("😀");
			editor.handleInput("👍");

			// Delete the last emoji (👍) - single backspace deletes whole grapheme cluster
			editor.handleInput("\x7f"); // Backspace

			const text = editor.getText();
			assert.strictEqual(text, "😀");
		});

		it("inserts characters at the correct position after cursor movement over umlauts", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

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
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

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
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

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
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			// Simulate bracketed paste / programmatic replacement
			editor.setText("Hällö Wörld! 😀 äöüÄÖÜß");

			const text = editor.getText();
			assert.strictEqual(text, "Hällö Wörld! 😀 äöüÄÖÜß");
		});

		it("moves cursor to document start on Ctrl+A and inserts at the beginning", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("a");
			editor.handleInput("b");
			editor.handleInput("\x01"); // Ctrl+A (move to start)
			editor.handleInput("x"); // Insert at start

			const text = editor.getText();
			assert.strictEqual(text, "xab");
		});

		it("deletes words correctly with Ctrl+W and Alt+Backspace", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			// Basic word deletion
			editor.setText("foo bar baz");
			editor.handleInput("\x17"); // Ctrl+W
			assert.strictEqual(editor.getText(), "foo bar ");

			// Trailing whitespace
			editor.setText("foo bar   ");
			editor.handleInput("\x17");
			assert.strictEqual(editor.getText(), "foo ");

			// Punctuation run
			editor.setText("foo bar...");
			editor.handleInput("\x17");
			assert.strictEqual(editor.getText(), "foo bar");

			// Delete across multiple lines
			editor.setText("line one\nline two");
			editor.handleInput("\x17");
			assert.strictEqual(editor.getText(), "line one\nline ");

			// Delete empty line (merge)
			editor.setText("line one\n");
			editor.handleInput("\x17");
			assert.strictEqual(editor.getText(), "line one");

			// Grapheme safety (emoji as a word)
			editor.setText("foo 😀😀 bar");
			editor.handleInput("\x17");
			assert.strictEqual(editor.getText(), "foo 😀😀 ");
			editor.handleInput("\x17");
			assert.strictEqual(editor.getText(), "foo ");

			// Alt+Backspace
			editor.setText("foo bar");
			editor.handleInput("\x1b\x7f"); // Alt+Backspace (legacy)
			assert.strictEqual(editor.getText(), "foo ");
		});

		it("navigates words correctly with Ctrl+Left/Right", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("foo bar... baz");
			// Cursor at end

			// Move left over baz
			editor.handleInput("\x1b[1;5D"); // Ctrl+Left
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 }); // after '...'

			// Move left over punctuation
			editor.handleInput("\x1b[1;5D"); // Ctrl+Left
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 }); // after 'bar'

			// Move left over bar
			editor.handleInput("\x1b[1;5D"); // Ctrl+Left
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 }); // after 'foo '

			// Move right over bar
			editor.handleInput("\x1b[1;5C"); // Ctrl+Right
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 }); // at end of 'bar'

			// Move right over punctuation run
			editor.handleInput("\x1b[1;5C"); // Ctrl+Right
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 }); // after '...'

			// Move right skips space and lands after baz
			editor.handleInput("\x1b[1;5C"); // Ctrl+Right
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 14 }); // end of line

			// Test forward from start with leading whitespace
			editor.setText("   foo bar");
			editor.handleInput("\x01"); // Ctrl+A to go to start
			editor.handleInput("\x1b[1;5C"); // Ctrl+Right
			assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 }); // after 'foo'
		});
	});

	describe("Grapheme-aware text wrapping", () => {
		it("wraps lines correctly when text contains wide emojis", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);
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
			const editor = new Editor(createTestTUI(), defaultEditorTheme);
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
			const editor = new Editor(createTestTUI(), defaultEditorTheme);
			const width = 10 + 1; // +1 col reserved for cursor

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
			const editor = new Editor(createTestTUI(), defaultEditorTheme);
			const width = 15 + 1; // +1 col reserved for cursor

			// "Test ✅ OK 日本" = 4 + 1 + 2 + 1 + 2 + 1 + 4 = 15 columns (fits in width-1=15)
			editor.setText("Test ✅ OK 日本");
			const lines = editor.render(width);

			// Should fit in one content line
			const contentLines = lines.slice(1, -1);
			assert.strictEqual(contentLines.length, 1);

			const lineWidth = visibleWidth(contentLines[0]!);
			assert.strictEqual(lineWidth, width);
		});

		it("renders cursor correctly on wide characters", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);
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
			const editor = new Editor(createTestTUI(), defaultEditorTheme);
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

		it("shows cursor at end of line before wrap, wraps on next char", () => {
			const width = 10;
			for (const paddingX of [0, 1]) {
				const editor = new Editor(createTestTUI(width + paddingX), defaultEditorTheme, { paddingX });

				// Type 9 chars → fills layoutWidth exactly, cursor at end on same line
				for (const ch of "aaaaaaaaa") editor.handleInput(ch);
				let lines = editor.render(width + paddingX);
				let contentLines = lines.slice(1, -1);
				assert.strictEqual(contentLines.length, 1, "Should be 1 content line before wrap");
				assert.ok(contentLines[0]!.endsWith("\x1b[7m \x1b[0m"), "Cursor should be at end of line");

				// Type 1 more → text wraps to second line
				editor.handleInput("a");
				lines = editor.render(width + paddingX);
				contentLines = lines.slice(1, -1);
				assert.strictEqual(contentLines.length, 2, "Should wrap to 2 content lines");
			}
		});
	});

	describe("Word wrapping", () => {
		it("wraps at word boundaries instead of mid-word", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);
			const width = 40;

			editor.setText("Hello world this is a test of word wrapping functionality");
			const lines = editor.render(width);

			// Get content lines (between borders)
			const contentLines = lines.slice(1, -1).map((l) => stripVTControlCharacters(l).trim());

			// Should NOT break mid-word
			// Line 1 should end with a complete word
			assert.ok(!contentLines[0]!.endsWith("-"), "Line should not end with hyphen (mid-word break)");

			// Each content line should be complete words
			for (const line of contentLines) {
				// Words at end of line should be complete (no partial words)
				const lastChar = line.trimEnd().slice(-1);
				assert.ok(lastChar === "" || /[\w.,!?;:]/.test(lastChar), `Line ends unexpectedly with: "${lastChar}"`);
			}
		});

		it("does not start lines with leading whitespace after word wrap", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);
			const width = 20;

			editor.setText("Word1 Word2 Word3 Word4 Word5 Word6");
			const lines = editor.render(width);

			// Get content lines (between borders)
			const contentLines = lines.slice(1, -1);

			// No line should start with whitespace (except for padding at the end)
			for (let i = 0; i < contentLines.length; i++) {
				const line = stripVTControlCharacters(contentLines[i]!);
				const trimmedStart = line.trimStart();
				// The line should either be all padding or start with a word character
				if (trimmedStart.length > 0) {
					assert.ok(!/^\s+\S/.test(line.trimEnd()), `Line ${i} starts with unexpected whitespace before content`);
				}
			}
		});

		it("breaks long words (URLs) at character level", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);
			const width = 30;

			editor.setText("Check https://example.com/very/long/path/that/exceeds/width here");
			const lines = editor.render(width);

			// All lines should fit within width
			for (let i = 1; i < lines.length - 1; i++) {
				const lineWidth = visibleWidth(lines[i]!);
				assert.strictEqual(lineWidth, width, `Line ${i} has width ${lineWidth}, expected ${width}`);
			}
		});

		it("preserves multiple spaces within words on same line", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);
			const width = 50;

			editor.setText("Word1   Word2    Word3");
			const lines = editor.render(width);

			const contentLine = stripVTControlCharacters(lines[1]!).trim();
			// Multiple spaces should be preserved
			assert.ok(contentLine.includes("Word1   Word2"), "Multiple spaces should be preserved");
		});

		it("handles empty string", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);
			const width = 40;

			editor.setText("");
			const lines = editor.render(width);

			// Should have border + empty content + border
			assert.strictEqual(lines.length, 3);
		});

		it("handles single word that fits exactly", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);
			const width = 10 + 1; // +1 col reserved for cursor

			editor.setText("1234567890");
			const lines = editor.render(width);

			// Should have exactly 3 lines (top border, content, bottom border)
			assert.strictEqual(lines.length, 3);
			const contentLine = stripVTControlCharacters(lines[1]!);
			assert.ok(contentLine.includes("1234567890"), "Content should contain the word");
		});

		it("wraps word to next line when it ends exactly at terminal width", () => {
			// "hello " (6) + "world" (5) = 11, but "world" is non-whitespace ending at width.
			// Thus, wrap it to next line. The trailing space stays with "hello" on line 1
			const chunks = wordWrapLine("hello world test", 11);

			assert.strictEqual(chunks.length, 2);
			assert.strictEqual(chunks[0]!.text, "hello ");
			assert.strictEqual(chunks[1]!.text, "world test");
		});

		it("keeps whitespace at terminal width boundary on same line", () => {
			// "hello world " is exactly 12 chars (including trailing space)
			// The space at position 12 should stay on the first line
			const chunks = wordWrapLine("hello world test", 12);

			assert.strictEqual(chunks.length, 2);
			assert.strictEqual(chunks[0]!.text, "hello world ");
			assert.strictEqual(chunks[1]!.text, "test");
		});

		it("handles unbreakable word filling width exactly followed by space", () => {
			const chunks = wordWrapLine("aaaaaaaaaaaa aaaa", 12);

			assert.strictEqual(chunks.length, 2);
			assert.strictEqual(chunks[0]!.text, "aaaaaaaaaaaa");
			assert.strictEqual(chunks[1]!.text, " aaaa");
		});

		it("wraps word to next line when it fits width but not remaining space", () => {
			const chunks = wordWrapLine("      aaaaaaaaaaaa", 12);

			assert.strictEqual(chunks.length, 2);
			assert.strictEqual(chunks[0]!.text, "      ");
			assert.strictEqual(chunks[1]!.text, "aaaaaaaaaaaa");
		});

		it("keeps word with multi-space and following word together when they fit", () => {
			const chunks = wordWrapLine("Lorem ipsum dolor sit amet,    consectetur", 30);

			assert.strictEqual(chunks.length, 2);
			assert.strictEqual(chunks[0]!.text, "Lorem ipsum dolor sit ");
			assert.strictEqual(chunks[1]!.text, "amet,    consectetur");
		});

		it("keeps word with multi-space and following word when they fill width exactly", () => {
			const chunks = wordWrapLine("Lorem ipsum dolor sit amet,              consectetur", 30);

			assert.strictEqual(chunks.length, 2);
			assert.strictEqual(chunks[0]!.text, "Lorem ipsum dolor sit ");
			assert.strictEqual(chunks[1]!.text, "amet,              consectetur");
		});

		it("splits when word plus multi-space plus word exceeds width", () => {
			const chunks = wordWrapLine("Lorem ipsum dolor sit amet,               consectetur", 30);

			assert.strictEqual(chunks.length, 3);
			assert.strictEqual(chunks[0]!.text, "Lorem ipsum dolor sit ");
			assert.strictEqual(chunks[1]!.text, "amet,               ");
			assert.strictEqual(chunks[2]!.text, "consectetur");
		});

		it("breaks long whitespace at line boundary", () => {
			const chunks = wordWrapLine("Lorem ipsum dolor sit amet,                         consectetur", 30);

			assert.strictEqual(chunks.length, 3);
			assert.strictEqual(chunks[0]!.text, "Lorem ipsum dolor sit ");
			assert.strictEqual(chunks[1]!.text, "amet,                         ");
			assert.strictEqual(chunks[2]!.text, "consectetur");
		});

		it("breaks long whitespace at line boundary 2", () => {
			const chunks = wordWrapLine("Lorem ipsum dolor sit amet,                          consectetur", 30);

			assert.strictEqual(chunks.length, 3);
			assert.strictEqual(chunks[0]!.text, "Lorem ipsum dolor sit ");
			assert.strictEqual(chunks[1]!.text, "amet,                         ");
			assert.strictEqual(chunks[2]!.text, " consectetur");
		});

		it("breaks whitespace spanning full lines", () => {
			const chunks = wordWrapLine("Lorem ipsum dolor sit amet,                                     consectetur", 30);

			assert.strictEqual(chunks.length, 3);
			assert.strictEqual(chunks[0]!.text, "Lorem ipsum dolor sit ");
			assert.strictEqual(chunks[1]!.text, "amet,                         ");
			assert.strictEqual(chunks[2]!.text, "            consectetur");
		});
	});

	describe("Kill ring", () => {
		it("Ctrl+W saves deleted text to kill ring and Ctrl+Y yanks it", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("foo bar baz");
			editor.handleInput("\x17"); // Ctrl+W - deletes "baz"
			assert.strictEqual(editor.getText(), "foo bar ");

			// Move to beginning and yank
			editor.handleInput("\x01"); // Ctrl+A
			editor.handleInput("\x19"); // Ctrl+Y
			assert.strictEqual(editor.getText(), "bazfoo bar ");
		});

		it("Ctrl+U saves deleted text to kill ring", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("hello world");
			// Move cursor to middle
			editor.handleInput("\x01"); // Ctrl+A (start)
			editor.handleInput("\x1b[C"); // Right 5 times
			editor.handleInput("\x1b[C");
			editor.handleInput("\x1b[C");
			editor.handleInput("\x1b[C");
			editor.handleInput("\x1b[C");
			editor.handleInput("\x1b[C"); // After "hello "

			editor.handleInput("\x15"); // Ctrl+U - deletes "hello "
			assert.strictEqual(editor.getText(), "world");

			editor.handleInput("\x19"); // Ctrl+Y
			assert.strictEqual(editor.getText(), "hello world");
		});

		it("Ctrl+K saves deleted text to kill ring", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("hello world");
			editor.handleInput("\x01"); // Ctrl+A (start)
			editor.handleInput("\x0b"); // Ctrl+K - deletes "hello world"

			assert.strictEqual(editor.getText(), "");

			editor.handleInput("\x19"); // Ctrl+Y
			assert.strictEqual(editor.getText(), "hello world");
		});

		it("Ctrl+Y does nothing when kill ring is empty", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("test");
			editor.handleInput("\x19"); // Ctrl+Y
			assert.strictEqual(editor.getText(), "test");
		});

		it("Alt+Y cycles through kill ring after Ctrl+Y", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			// Create kill ring with multiple entries
			editor.setText("first");
			editor.handleInput("\x17"); // Ctrl+W - deletes "first"
			editor.setText("second");
			editor.handleInput("\x17"); // Ctrl+W - deletes "second"
			editor.setText("third");
			editor.handleInput("\x17"); // Ctrl+W - deletes "third"

			// Kill ring now has: [first, second, third]
			assert.strictEqual(editor.getText(), "");

			editor.handleInput("\x19"); // Ctrl+Y - yanks "third" (most recent)
			assert.strictEqual(editor.getText(), "third");

			editor.handleInput("\x1by"); // Alt+Y - cycles to "second"
			assert.strictEqual(editor.getText(), "second");

			editor.handleInput("\x1by"); // Alt+Y - cycles to "first"
			assert.strictEqual(editor.getText(), "first");

			editor.handleInput("\x1by"); // Alt+Y - cycles back to "third"
			assert.strictEqual(editor.getText(), "third");
		});

		it("Alt+Y does nothing if not preceded by yank", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("test");
			editor.handleInput("\x17"); // Ctrl+W - deletes "test"
			editor.setText("other");

			// Type something to break the yank chain
			editor.handleInput("x");
			assert.strictEqual(editor.getText(), "otherx");

			// Alt+Y should do nothing
			editor.handleInput("\x1by"); // Alt+Y
			assert.strictEqual(editor.getText(), "otherx");
		});

		it("Alt+Y does nothing if kill ring has ≤1 entry", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("only");
			editor.handleInput("\x17"); // Ctrl+W - deletes "only"

			editor.handleInput("\x19"); // Ctrl+Y - yanks "only"
			assert.strictEqual(editor.getText(), "only");

			editor.handleInput("\x1by"); // Alt+Y - should do nothing (only 1 entry)
			assert.strictEqual(editor.getText(), "only");
		});

		it("consecutive Ctrl+W accumulates into one kill ring entry", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("one two three");
			editor.handleInput("\x17"); // Ctrl+W - deletes "three"
			editor.handleInput("\x17"); // Ctrl+W - deletes "two " (prepended)
			editor.handleInput("\x17"); // Ctrl+W - deletes "one " (prepended)

			assert.strictEqual(editor.getText(), "");

			// Should be one combined entry
			editor.handleInput("\x19"); // Ctrl+Y
			assert.strictEqual(editor.getText(), "one two three");
		});

		it("Ctrl+U accumulates multiline deletes including newlines", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			// Start with multiline text, cursor at end
			editor.setText("line1\nline2\nline3");
			// Cursor is at end of line3 (line 2, col 5)

			// Delete "line3"
			editor.handleInput("\x15"); // Ctrl+U
			assert.strictEqual(editor.getText(), "line1\nline2\n");

			// Delete newline (at start of empty line 2, merges with line1)
			editor.handleInput("\x15"); // Ctrl+U
			assert.strictEqual(editor.getText(), "line1\nline2");

			// Delete "line2"
			editor.handleInput("\x15"); // Ctrl+U
			assert.strictEqual(editor.getText(), "line1\n");

			// Delete newline
			editor.handleInput("\x15"); // Ctrl+U
			assert.strictEqual(editor.getText(), "line1");

			// Delete "line1"
			editor.handleInput("\x15"); // Ctrl+U
			assert.strictEqual(editor.getText(), "");

			// All deletions accumulated into one entry: "line1\nline2\nline3"
			editor.handleInput("\x19"); // Ctrl+Y
			assert.strictEqual(editor.getText(), "line1\nline2\nline3");
		});

		it("backward deletions prepend, forward deletions append during accumulation", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("prefix|suffix");
			// Position cursor at |
			editor.handleInput("\x01"); // Ctrl+A
			for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C"); // Move right 6 times

			editor.handleInput("\x0b"); // Ctrl+K - deletes "suffix" (forward)
			editor.handleInput("\x0b"); // Ctrl+K - deletes "|" (forward, appended)
			assert.strictEqual(editor.getText(), "prefix");

			editor.handleInput("\x19"); // Ctrl+Y
			assert.strictEqual(editor.getText(), "prefix|suffix");
		});

		it("non-delete actions break kill accumulation", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			// Delete "baz", then type "x" to break accumulation, then delete "x"
			editor.setText("foo bar baz");
			editor.handleInput("\x17"); // Ctrl+W - deletes "baz"
			assert.strictEqual(editor.getText(), "foo bar ");

			editor.handleInput("x"); // Typing breaks accumulation
			assert.strictEqual(editor.getText(), "foo bar x");

			editor.handleInput("\x17"); // Ctrl+W - deletes "x" (separate entry, not accumulated)
			assert.strictEqual(editor.getText(), "foo bar ");

			// Yank most recent - should be "x", not "xbaz"
			editor.handleInput("\x19"); // Ctrl+Y
			assert.strictEqual(editor.getText(), "foo bar x");

			// Cycle to previous - should be "baz" (separate entry)
			editor.handleInput("\x1by"); // Alt+Y
			assert.strictEqual(editor.getText(), "foo bar baz");
		});

		it("non-yank actions break Alt+Y chain", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("first");
			editor.handleInput("\x17"); // Ctrl+W
			editor.setText("second");
			editor.handleInput("\x17"); // Ctrl+W
			editor.setText("");

			editor.handleInput("\x19"); // Ctrl+Y - yanks "second"
			assert.strictEqual(editor.getText(), "second");

			editor.handleInput("x"); // Type breaks yank chain
			assert.strictEqual(editor.getText(), "secondx");

			editor.handleInput("\x1by"); // Alt+Y - should do nothing
			assert.strictEqual(editor.getText(), "secondx");
		});

		it("kill ring rotation persists after cycling", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("first");
			editor.handleInput("\x17"); // deletes "first"
			editor.setText("second");
			editor.handleInput("\x17"); // deletes "second"
			editor.setText("third");
			editor.handleInput("\x17"); // deletes "third"
			editor.setText("");

			// Ring: [first, second, third]

			editor.handleInput("\x19"); // Ctrl+Y - yanks "third"
			editor.handleInput("\x1by"); // Alt+Y - cycles to "second", ring rotates

			// Now ring is: [third, first, second]
			assert.strictEqual(editor.getText(), "second");

			// Do something else
			editor.handleInput("x");
			editor.setText("");

			// New yank should get "second" (now at end after rotation)
			editor.handleInput("\x19"); // Ctrl+Y
			assert.strictEqual(editor.getText(), "second");
		});

		it("consecutive deletions across lines coalesce into one entry", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			// "1\n2\n3" with cursor at end, delete everything with Ctrl+W
			editor.setText("1\n2\n3");
			editor.handleInput("\x17"); // Ctrl+W - deletes "3"
			assert.strictEqual(editor.getText(), "1\n2\n");

			editor.handleInput("\x17"); // Ctrl+W - deletes newline (merge with prev line)
			assert.strictEqual(editor.getText(), "1\n2");

			editor.handleInput("\x17"); // Ctrl+W - deletes "2"
			assert.strictEqual(editor.getText(), "1\n");

			editor.handleInput("\x17"); // Ctrl+W - deletes newline
			assert.strictEqual(editor.getText(), "1");

			editor.handleInput("\x17"); // Ctrl+W - deletes "1"
			assert.strictEqual(editor.getText(), "");

			// All deletions should have accumulated into one entry
			editor.handleInput("\x19"); // Ctrl+Y
			assert.strictEqual(editor.getText(), "1\n2\n3");
		});

		it("Ctrl+K at line end deletes newline and coalesces", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			// "ab" on line 1, "cd" on line 2, cursor at end of line 1
			editor.setText("");
			editor.handleInput("a");
			editor.handleInput("b");
			editor.handleInput("\n");
			editor.handleInput("c");
			editor.handleInput("d");
			// Move to end of first line
			editor.handleInput("\x1b[A"); // Up arrow
			editor.handleInput("\x05"); // Ctrl+E - end of line

			// Now at end of "ab", Ctrl+K should delete newline (merge with "cd")
			editor.handleInput("\x0b"); // Ctrl+K - deletes newline
			assert.strictEqual(editor.getText(), "abcd");

			// Continue deleting
			editor.handleInput("\x0b"); // Ctrl+K - deletes "cd"
			assert.strictEqual(editor.getText(), "ab");

			// Both deletions should accumulate
			editor.handleInput("\x19"); // Ctrl+Y
			assert.strictEqual(editor.getText(), "ab\ncd");
		});

		it("handles yank in middle of text", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("word");
			editor.handleInput("\x17"); // Ctrl+W - deletes "word"
			editor.setText("hello world");

			// Move to middle (after "hello ")
			editor.handleInput("\x01"); // Ctrl+A
			for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");

			editor.handleInput("\x19"); // Ctrl+Y
			assert.strictEqual(editor.getText(), "hello wordworld");
		});

		it("handles yank-pop in middle of text", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			// Create two kill ring entries
			editor.setText("FIRST");
			editor.handleInput("\x17"); // Ctrl+W - deletes "FIRST"
			editor.setText("SECOND");
			editor.handleInput("\x17"); // Ctrl+W - deletes "SECOND"

			// Ring: ["FIRST", "SECOND"]

			// Set up "hello world" and position cursor after "hello "
			editor.setText("hello world");
			editor.handleInput("\x01"); // Ctrl+A - go to start of line
			for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C"); // Move right 6

			// Yank "SECOND" in the middle
			editor.handleInput("\x19"); // Ctrl+Y
			assert.strictEqual(editor.getText(), "hello SECONDworld");

			// Yank-pop replaces "SECOND" with "FIRST"
			editor.handleInput("\x1by"); // Alt+Y
			assert.strictEqual(editor.getText(), "hello FIRSTworld");
		});

		it("multiline yank and yank-pop in middle of text", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			// Create single-line entry
			editor.setText("SINGLE");
			editor.handleInput("\x17"); // Ctrl+W - deletes "SINGLE"

			// Create multiline entry via consecutive Ctrl+U
			editor.setText("A\nB");
			editor.handleInput("\x15"); // Ctrl+U - deletes "B"
			editor.handleInput("\x15"); // Ctrl+U - deletes newline
			editor.handleInput("\x15"); // Ctrl+U - deletes "A"
			// Ring: ["SINGLE", "A\nB"]

			// Insert in middle of "hello world"
			editor.setText("hello world");
			editor.handleInput("\x01"); // Ctrl+A
			for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");

			// Yank multiline "A\nB"
			editor.handleInput("\x19"); // Ctrl+Y
			assert.strictEqual(editor.getText(), "hello A\nBworld");

			// Yank-pop replaces with "SINGLE"
			editor.handleInput("\x1by"); // Alt+Y
			assert.strictEqual(editor.getText(), "hello SINGLEworld");
		});

		it("Alt+D deletes word forward and saves to kill ring", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("hello world test");
			editor.handleInput("\x01"); // Ctrl+A - go to start

			editor.handleInput("\x1bd"); // Alt+D - deletes "hello"
			assert.strictEqual(editor.getText(), " world test");

			editor.handleInput("\x1bd"); // Alt+D - deletes " world" (skips whitespace, then word)
			assert.strictEqual(editor.getText(), " test");

			// Yank should get accumulated text
			editor.handleInput("\x19"); // Ctrl+Y
			assert.strictEqual(editor.getText(), "hello world test");
		});

		it("Alt+D at end of line deletes newline", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("line1\nline2");
			// Move to start of document, then to end of first line
			editor.handleInput("\x1b[A"); // Up arrow - go to first line
			editor.handleInput("\x05"); // Ctrl+E - end of line

			editor.handleInput("\x1bd"); // Alt+D - deletes newline (merges lines)
			assert.strictEqual(editor.getText(), "line1line2");

			editor.handleInput("\x19"); // Ctrl+Y
			assert.strictEqual(editor.getText(), "line1\nline2");
		});
	});

	describe("Undo", () => {
		it("does nothing when undo stack is empty", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "");
		});

		it("coalesces consecutive word characters into one undo unit", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("h");
			editor.handleInput("e");
			editor.handleInput("l");
			editor.handleInput("l");
			editor.handleInput("o");
			editor.handleInput(" ");
			editor.handleInput("w");
			editor.handleInput("o");
			editor.handleInput("r");
			editor.handleInput("l");
			editor.handleInput("d");
			assert.strictEqual(editor.getText(), "hello world");

			// Undo removes " world" (space captured state before it, so we restore to "hello")
			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "hello");

			// Undo removes "hello"
			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "");
		});

		it("undoes spaces one at a time", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("h");
			editor.handleInput("e");
			editor.handleInput("l");
			editor.handleInput("l");
			editor.handleInput("o");
			editor.handleInput(" ");
			editor.handleInput(" ");
			assert.strictEqual(editor.getText(), "hello  ");

			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo) - removes second " "
			assert.strictEqual(editor.getText(), "hello ");

			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo) - removes first " "
			assert.strictEqual(editor.getText(), "hello");

			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo) - removes "hello"
			assert.strictEqual(editor.getText(), "");
		});

		it("undoes newlines and signals next word to capture state", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("h");
			editor.handleInput("e");
			editor.handleInput("l");
			editor.handleInput("l");
			editor.handleInput("o");
			editor.handleInput("\n");
			editor.handleInput("w");
			editor.handleInput("o");
			editor.handleInput("r");
			editor.handleInput("l");
			editor.handleInput("d");
			assert.strictEqual(editor.getText(), "hello\nworld");

			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "hello\n");

			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "hello");

			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "");
		});

		it("undoes backspace", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("h");
			editor.handleInput("e");
			editor.handleInput("l");
			editor.handleInput("l");
			editor.handleInput("o");
			editor.handleInput("\x7f"); // Backspace
			assert.strictEqual(editor.getText(), "hell");

			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "hello");
		});

		it("undoes forward delete", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("h");
			editor.handleInput("e");
			editor.handleInput("l");
			editor.handleInput("l");
			editor.handleInput("o");
			editor.handleInput("\x01"); // Ctrl+A - go to start
			editor.handleInput("\x1b[C"); // Right arrow
			editor.handleInput("\x1b[3~"); // Delete key
			assert.strictEqual(editor.getText(), "hllo");

			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "hello");
		});

		it("undoes Ctrl+W (delete word backward)", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("h");
			editor.handleInput("e");
			editor.handleInput("l");
			editor.handleInput("l");
			editor.handleInput("o");
			editor.handleInput(" ");
			editor.handleInput("w");
			editor.handleInput("o");
			editor.handleInput("r");
			editor.handleInput("l");
			editor.handleInput("d");
			assert.strictEqual(editor.getText(), "hello world");

			editor.handleInput("\x17"); // Ctrl+W
			assert.strictEqual(editor.getText(), "hello ");

			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "hello world");
		});

		it("undoes Ctrl+K (delete to line end)", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("h");
			editor.handleInput("e");
			editor.handleInput("l");
			editor.handleInput("l");
			editor.handleInput("o");
			editor.handleInput(" ");
			editor.handleInput("w");
			editor.handleInput("o");
			editor.handleInput("r");
			editor.handleInput("l");
			editor.handleInput("d");
			editor.handleInput("\x01"); // Ctrl+A - go to start
			for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C"); // Move right 6 times

			editor.handleInput("\x0b"); // Ctrl+K
			assert.strictEqual(editor.getText(), "hello ");

			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "hello world");

			editor.handleInput("|");
			assert.strictEqual(editor.getText(), "hello |world");
		});

		it("undoes Ctrl+U (delete to line start)", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("h");
			editor.handleInput("e");
			editor.handleInput("l");
			editor.handleInput("l");
			editor.handleInput("o");
			editor.handleInput(" ");
			editor.handleInput("w");
			editor.handleInput("o");
			editor.handleInput("r");
			editor.handleInput("l");
			editor.handleInput("d");
			editor.handleInput("\x01"); // Ctrl+A - go to start
			for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C"); // Move right 6 times

			editor.handleInput("\x15"); // Ctrl+U
			assert.strictEqual(editor.getText(), "world");

			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "hello world");
		});

		it("undoes yank", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("h");
			editor.handleInput("e");
			editor.handleInput("l");
			editor.handleInput("l");
			editor.handleInput("o");
			editor.handleInput(" ");
			editor.handleInput("\x17"); // Ctrl+W - delete "hello "
			editor.handleInput("\x19"); // Ctrl+Y - yank
			assert.strictEqual(editor.getText(), "hello ");

			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "");
		});

		it("undoes single-line paste atomically", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("hello world");
			editor.handleInput("\x01"); // Ctrl+A - go to start
			for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C"); // Move right 5 (after "hello", before space)

			// Simulate bracketed paste of "beep boop"
			editor.handleInput("\x1b[200~beep boop\x1b[201~");
			assert.strictEqual(editor.getText(), "hellobeep boop world");

			// Single undo should restore entire pre-paste state
			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "hello world");

			editor.handleInput("|");
			assert.strictEqual(editor.getText(), "hello| world");
		});

		it("undoes multi-line paste atomically", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("hello world");
			editor.handleInput("\x01"); // Ctrl+A - go to start
			for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C"); // Move right 5 (after "hello", before space)

			// Simulate bracketed paste of multi-line text
			editor.handleInput("\x1b[200~line1\nline2\nline3\x1b[201~");
			assert.strictEqual(editor.getText(), "helloline1\nline2\nline3 world");

			// Single undo should restore entire pre-paste state
			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "hello world");

			editor.handleInput("|");
			assert.strictEqual(editor.getText(), "hello| world");
		});

		it("undoes insertTextAtCursor atomically", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("hello world");
			editor.handleInput("\x01"); // Ctrl+A - go to start
			for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C"); // Move right 5 (after "hello", before space)

			// Programmatic insertion (e.g., clipboard image path)
			editor.insertTextAtCursor("/tmp/image.png");
			assert.strictEqual(editor.getText(), "hello/tmp/image.png world");

			// Single undo should restore entire pre-insert state
			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "hello world");

			editor.handleInput("|");
			assert.strictEqual(editor.getText(), "hello| world");
		});

		it("insertTextAtCursor handles multiline text", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("hello world");
			editor.handleInput("\x01"); // Ctrl+A - go to start
			for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C"); // Move right 5 (after "hello", before space)

			// Insert multiline text
			editor.insertTextAtCursor("line1\nline2\nline3");
			assert.strictEqual(editor.getText(), "helloline1\nline2\nline3 world");

			// Cursor should be at end of inserted text (after "line3", before " world")
			const cursor = editor.getCursor();
			assert.strictEqual(cursor.line, 2);
			assert.strictEqual(cursor.col, 5); // "line3".length

			// Single undo should restore entire pre-insert state
			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "hello world");
		});

		it("insertTextAtCursor normalizes CRLF and CR line endings", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.setText("");

			// Insert text with CRLF
			editor.insertTextAtCursor("a\r\nb\r\nc");
			assert.strictEqual(editor.getText(), "a\nb\nc");

			editor.handleInput("\x1b[45;5u"); // Undo
			assert.strictEqual(editor.getText(), "");

			// Insert text with CR only
			editor.insertTextAtCursor("x\ry\rz");
			assert.strictEqual(editor.getText(), "x\ny\nz");
		});

		it("undoes setText to empty string", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("h");
			editor.handleInput("e");
			editor.handleInput("l");
			editor.handleInput("l");
			editor.handleInput("o");
			editor.handleInput(" ");
			editor.handleInput("w");
			editor.handleInput("o");
			editor.handleInput("r");
			editor.handleInput("l");
			editor.handleInput("d");
			assert.strictEqual(editor.getText(), "hello world");

			editor.setText("");
			assert.strictEqual(editor.getText(), "");

			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "hello world");
		});

		it("clears undo stack on submit", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);
			let submitted = "";
			editor.onSubmit = (text) => {
				submitted = text;
			};

			editor.handleInput("h");
			editor.handleInput("e");
			editor.handleInput("l");
			editor.handleInput("l");
			editor.handleInput("o");
			editor.handleInput("\r"); // Enter - submit

			assert.strictEqual(submitted, "hello");
			assert.strictEqual(editor.getText(), "");

			// Undo should do nothing - stack was cleared
			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "");
		});

		it("exits history browsing mode on undo", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			// Add "hello" to history
			editor.addToHistory("hello");
			assert.strictEqual(editor.getText(), "");

			// Type "world"
			editor.handleInput("w");
			editor.handleInput("o");
			editor.handleInput("r");
			editor.handleInput("l");
			editor.handleInput("d");
			assert.strictEqual(editor.getText(), "world");

			// Ctrl+W - delete word
			editor.handleInput("\x17"); // Ctrl+W
			assert.strictEqual(editor.getText(), "");

			// Press Up - enter history browsing, shows "hello"
			editor.handleInput("\x1b[A"); // Up arrow
			assert.strictEqual(editor.getText(), "hello");

			// Undo should restore to "" (state before entering history browsing)
			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "");

			// Undo again should restore to "world" (state before Ctrl+W)
			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "world");
		});

		it("undo restores to pre-history state even after multiple history navigations", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			// Add history entries
			editor.addToHistory("first");
			editor.addToHistory("second");
			editor.addToHistory("third");

			// Type something
			editor.handleInput("c");
			editor.handleInput("u");
			editor.handleInput("r");
			editor.handleInput("r");
			editor.handleInput("e");
			editor.handleInput("n");
			editor.handleInput("t");
			assert.strictEqual(editor.getText(), "current");

			// Clear editor
			editor.handleInput("\x17"); // Ctrl+W
			assert.strictEqual(editor.getText(), "");

			// Navigate through history multiple times
			editor.handleInput("\x1b[A"); // Up - "third"
			assert.strictEqual(editor.getText(), "third");
			editor.handleInput("\x1b[A"); // Up - "second"
			assert.strictEqual(editor.getText(), "second");
			editor.handleInput("\x1b[A"); // Up - "first"
			assert.strictEqual(editor.getText(), "first");

			// Undo should go back to "" (state before we started browsing), not intermediate states
			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "");

			// Another undo goes back to "current"
			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "current");
		});

		it("cursor movement starts new undo unit", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("h");
			editor.handleInput("e");
			editor.handleInput("l");
			editor.handleInput("l");
			editor.handleInput("o");
			editor.handleInput(" ");
			editor.handleInput("w");
			editor.handleInput("o");
			editor.handleInput("r");
			editor.handleInput("l");
			editor.handleInput("d");
			assert.strictEqual(editor.getText(), "hello world");

			// Move cursor left 5 (to after "hello ")
			for (let i = 0; i < 5; i++) editor.handleInput("\x1b[D");

			// Type "lol" in the middle
			editor.handleInput("l");
			editor.handleInput("o");
			editor.handleInput("l");
			assert.strictEqual(editor.getText(), "hello lolworld");

			// Undo should restore to "hello world" (before inserting "lol")
			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "hello world");

			editor.handleInput("|");
			assert.strictEqual(editor.getText(), "hello |world");
		});

		it("no-op delete operations do not push undo snapshots", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			editor.handleInput("h");
			editor.handleInput("e");
			editor.handleInput("l");
			editor.handleInput("l");
			editor.handleInput("o");
			assert.strictEqual(editor.getText(), "hello");

			// Delete word on empty - multiple times (should be no-ops)
			editor.handleInput("\x17"); // Ctrl+W - deletes "hello"
			assert.strictEqual(editor.getText(), "");
			editor.handleInput("\x17"); // Ctrl+W - no-op (nothing to delete)
			editor.handleInput("\x17"); // Ctrl+W - no-op

			// Single undo should restore "hello"
			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "hello");
		});

		it("undoes autocomplete", () => {
			const editor = new Editor(createTestTUI(), defaultEditorTheme);

			// Create a mock autocomplete provider
			const mockProvider: AutocompleteProvider = {
				getSuggestions: (lines, _cursorLine, cursorCol) => {
					const text = lines[0] || "";
					const prefix = text.slice(0, cursorCol);
					if (prefix === "di") {
						return {
							items: [{ value: "dist/", label: "dist/" }],
							prefix: "di",
						};
					}
					return null;
				},
				applyCompletion: (lines, cursorLine, cursorCol, item, prefix) => {
					const line = lines[cursorLine] || "";
					const before = line.slice(0, cursorCol - prefix.length);
					const after = line.slice(cursorCol);
					const newLines = [...lines];
					newLines[cursorLine] = before + item.value + after;
					return {
						lines: newLines,
						cursorLine,
						cursorCol: cursorCol - prefix.length + item.value.length,
					};
				},
			};

			editor.setAutocompleteProvider(mockProvider);

			// Type "di"
			editor.handleInput("d");
			editor.handleInput("i");
			assert.strictEqual(editor.getText(), "di");

			// Press Tab to trigger autocomplete
			editor.handleInput("\t");
			// Autocomplete should be showing with "dist/" suggestion
			assert.strictEqual(editor.isShowingAutocomplete(), true);

			// Press Tab again to accept the suggestion
			editor.handleInput("\t");
			assert.strictEqual(editor.getText(), "dist/");
			assert.strictEqual(editor.isShowingAutocomplete(), false);

			// Undo should restore to "di"
			editor.handleInput("\x1b[45;5u"); // Ctrl+- (undo)
			assert.strictEqual(editor.getText(), "di");
		});
	});
});
