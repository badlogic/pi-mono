import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.js";
import { defaultEditorTheme } from "./test-themes.js";

describe("Editor component", () => {
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

		it("deletes multi-code-unit emojis with repeated Backspace", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.handleInput("😀");
			editor.handleInput("👍");

			// Delete the last emoji (👍) - requires 2 backspaces since emojis are 2 code units
			editor.handleInput("\x7f"); // Backspace
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

		it("moves cursor in code units across multi-code-unit emojis before insertion", () => {
			const editor = new Editor(defaultEditorTheme);

			editor.handleInput("😀");
			editor.handleInput("👍");
			editor.handleInput("🎉");

			// Move cursor left over last emoji (🎉)
			editor.handleInput("\x1b[D"); // Left arrow
			editor.handleInput("\x1b[D"); // Left arrow

			// Move cursor left over second emoji (👍)
			editor.handleInput("\x1b[D");
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

	describe("Word-by-word navigation", () => {
		it("moves cursor left by word with Option+Left (ESC+b)", () => {
			const editor = new Editor(defaultEditorTheme);
			editor.setText("hello world test");

			// Cursor is at end (position 16)
			editor.handleInput("\x1bb"); // Option+Left (ESC+b) - move to start of "test"

			// Insert 'X' to verify cursor position
			editor.handleInput("X");

			const text = editor.getText();
			assert.strictEqual(text, "hello world Xtest");
		});

		it("moves cursor right by word with Option+Right (ESC+f)", () => {
			const editor = new Editor(defaultEditorTheme);
			editor.setText("hello world test");

			// Move cursor to beginning
			editor.handleInput("\x01"); // Ctrl+A

			editor.handleInput("\x1bf"); // Option+Right (ESC+f) - move past "hello "

			// Insert 'X' to verify cursor position
			editor.handleInput("X");

			const text = editor.getText();
			assert.strictEqual(text, "hello Xworld test");
		});

		it("moves cursor left by word with Ctrl+Left (CSI 1;5D)", () => {
			const editor = new Editor(defaultEditorTheme);
			editor.setText("foo bar baz");

			// Cursor is at end
			editor.handleInput("\x1b[1;5D"); // Ctrl+Left - move to start of "baz"

			editor.handleInput("X");

			const text = editor.getText();
			assert.strictEqual(text, "foo bar Xbaz");
		});

		it("moves cursor right by word with Ctrl+Right (CSI 1;5C)", () => {
			const editor = new Editor(defaultEditorTheme);
			editor.setText("foo bar baz");

			editor.handleInput("\x01"); // Ctrl+A - move to start

			editor.handleInput("\x1b[1;5C"); // Ctrl+Right - move past "foo "

			editor.handleInput("X");

			const text = editor.getText();
			assert.strictEqual(text, "foo Xbar baz");
		});

		it("handles punctuation as word boundaries when moving left", () => {
			const editor = new Editor(defaultEditorTheme);
			editor.setText("hello.world");

			// Cursor at end (position 11)
			editor.handleInput("\x1bb"); // move to start of "world"

			editor.handleInput("X");

			const text = editor.getText();
			assert.strictEqual(text, "hello.Xworld");
		});

		it("handles punctuation as word boundaries when moving right", () => {
			const editor = new Editor(defaultEditorTheme);
			editor.setText("hello.world");

			editor.handleInput("\x01"); // move to start

			editor.handleInput("\x1bf"); // move past "hello"

			editor.handleInput("X");

			const text = editor.getText();
			assert.strictEqual(text, "helloX.world");
		});

		it("moves to previous line when at start of line (word left)", () => {
			const editor = new Editor(defaultEditorTheme);
			editor.setText("line one\nline two");

			// Move to start of second line
			editor.handleInput("\x1b[B"); // Down arrow
			editor.handleInput("\x01"); // Ctrl+A - start of line

			editor.handleInput("\x1bb"); // Option+Left - should go to end of first line

			editor.handleInput("X");

			const text = editor.getText();
			assert.strictEqual(text, "line oneX\nline two");
		});

		it("moves to next line when at end of line (word right)", () => {
			const editor = new Editor(defaultEditorTheme);
			editor.setText("line one\nline two");

			// Cursor is at end of second line after setText
			// Move up to first line
			editor.handleInput("\x1b[A"); // Up arrow
			// Move to end of first line
			editor.handleInput("\x05"); // Ctrl+E - end of line

			// First word-right moves to start of second line
			editor.handleInput("\x1bf"); // Option+Right - should go to start of second line
			// Second word-right moves past "line "
			editor.handleInput("\x1bf"); // Option+Right - move past "line "

			editor.handleInput("X");

			const text = editor.getText();
			assert.strictEqual(text, "line one\nline Xtwo");
		});

		it("skips multiple spaces when moving by word", () => {
			const editor = new Editor(defaultEditorTheme);
			editor.setText("hello    world");

			editor.handleInput("\x1bb"); // move left by word

			editor.handleInput("X");

			const text = editor.getText();
			assert.strictEqual(text, "hello    Xworld");
		});
	});
});
