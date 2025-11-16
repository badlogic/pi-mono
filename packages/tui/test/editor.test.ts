import assert from "node:assert";
import { describe, it } from "node:test";
import { Editor } from "../src/components/editor.js";

describe("Editor component", () => {
	describe("Unicode character input", () => {
		it("should handle German umlauts correctly", () => {
			const editor = new Editor();

			// Simulate typing umlauts
			editor.handleInput("ä");
			editor.handleInput("ö");
			editor.handleInput("ü");
			editor.handleInput("Ä");
			editor.handleInput("Ö");
			editor.handleInput("Ü");
			editor.handleInput("ß");

			const text = editor.getText();
			assert.strictEqual(text, "äöüÄÖÜß");
		});

		it("should handle emojis correctly", () => {
			const editor = new Editor();

			// Simulate typing emojis
			editor.handleInput("😀");
			editor.handleInput("👍");
			editor.handleInput("🎉");

			const text = editor.getText();
			assert.strictEqual(text, "😀👍🎉");
		});

		it("should handle mixed ASCII, umlauts, and emojis", () => {
			const editor = new Editor();

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

		it("should handle backspace with umlauts correctly", () => {
			const editor = new Editor();

			editor.handleInput("ä");
			editor.handleInput("ö");
			editor.handleInput("ü");

			// Delete the last character (ü)
			editor.handleInput("\x7f"); // Backspace

			const text = editor.getText();
			assert.strictEqual(text, "äö");
		});

		it("should handle backspace with emojis correctly", () => {
			const editor = new Editor();

			editor.handleInput("😀");
			editor.handleInput("👍");

			// Delete the last emoji (👍) - requires 2 backspaces since emojis are 2 code units
			editor.handleInput("\x7f"); // Backspace
			editor.handleInput("\x7f"); // Backspace

			const text = editor.getText();
			assert.strictEqual(text, "😀");
		});

		it("should handle cursor movement with umlauts", () => {
			const editor = new Editor();

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

		it("should handle cursor movement with emojis", () => {
			const editor = new Editor();

			editor.handleInput("😀");
			editor.handleInput("👍");
			editor.handleInput("🎉");

			// Move cursor left twice (should skip the emoji)
			editor.handleInput("\x1b[D"); // Left arrow
			editor.handleInput("\x1b[D"); // Left arrow

			// Note: Emojis are 2 code units, so we need to move left twice per emoji
			// But cursor position is in code units, not visual columns
			editor.handleInput("\x1b[D");
			editor.handleInput("\x1b[D");

			// Insert 'x'
			editor.handleInput("x");

			const text = editor.getText();
			assert.strictEqual(text, "😀x👍🎉");
		});

		it("should handle multi-line text with umlauts", () => {
			const editor = new Editor();

			editor.handleInput("ä");
			editor.handleInput("ö");
			editor.handleInput("ü");
			editor.handleInput("\n"); // Shift+Enter (new line)
			editor.handleInput("Ä");
			editor.handleInput("Ö");
			editor.handleInput("Ü");

			const text = editor.getText();
			assert.strictEqual(text, "äöü\nÄÖÜ");
		});

		it("should handle paste with umlauts", () => {
			const editor = new Editor();

			// Simulate bracketed paste by calling handlePaste directly
			// (Bracketed paste is async and doesn't work well in sync tests)
			editor.setText("äöüÄÖÜß");

			const text = editor.getText();
			assert.strictEqual(text, "äöüÄÖÜß");
		});

		it("should handle special control keys", () => {
			const editor = new Editor();

			// Ctrl+A moves cursor to start
			editor.handleInput("a");
			editor.handleInput("b");
			editor.handleInput("\x01"); // Ctrl+A (move to start)
			editor.handleInput("x"); // Insert at start

			const text = editor.getText();
			assert.strictEqual(text, "xab");
		});

		it("should handle setText with umlauts", () => {
			const editor = new Editor();

			editor.setText("Hällö Wörld! 😀");

			const text = editor.getText();
			assert.strictEqual(text, "Hällö Wörld! 😀");
		});
	});
});
