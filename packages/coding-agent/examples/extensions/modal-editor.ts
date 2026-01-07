/**
 * Modal Editor - Example custom editor with vim-like modes
 *
 * This demonstrates how to use pi.ui.setEditorComponent() to create
 * a custom editor with modal editing (normal/insert modes).
 *
 * Usage: pi --extension ./examples/extensions/modal-editor.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, matchesKey } from "@mariozechner/pi-tui";

type Mode = "normal" | "insert";

/**
 * A simple modal editor that wraps the default Editor.
 * - Press Escape to enter normal mode
 * - Press 'i' in normal mode to enter insert mode
 * - Basic hjkl navigation in normal mode
 */
class ModalEditor extends Editor {
	private mode: Mode = "insert";

	handleInput(data: string): void {
		// Escape switches to normal mode
		if (matchesKey(data, "escape")) {
			if (this.mode === "insert") {
				this.mode = "normal";
				return;
			}
			// In normal mode, let escape pass through (for app handling)
			super.handleInput(data);
			return;
		}

		// In insert mode, pass everything to the base editor
		if (this.mode === "insert") {
			super.handleInput(data);
			return;
		}

		// Normal mode key handling
		switch (data) {
			case "i":
				this.mode = "insert";
				break;
			case "a":
				this.mode = "insert";
				// Move cursor right before inserting
				super.handleInput("\x1b[C"); // Right arrow
				break;
			case "h":
				super.handleInput("\x1b[D"); // Left arrow
				break;
			case "j":
				super.handleInput("\x1b[B"); // Down arrow
				break;
			case "k":
				super.handleInput("\x1b[A"); // Up arrow
				break;
			case "l":
				super.handleInput("\x1b[C"); // Right arrow
				break;
			case "0":
				super.handleInput("\x01"); // Ctrl+A (line start)
				break;
			case "$":
				super.handleInput("\x05"); // Ctrl+E (line end)
				break;
			case "x":
				// Delete char under cursor (forward delete)
				super.handleInput("\x1b[3~"); // Delete key
				break;
			case "d":
				// dd would need state tracking, simplified here
				break;
			default:
				// Consume other keys in normal mode (don't insert them)
				break;
		}
	}

	render(width: number): string[] {
		const lines = super.render(width);
		// Add mode indicator to the bottom border line
		if (lines.length > 0) {
			const lastIndex = lines.length - 1;
			const modeLabel = this.mode === "normal" ? " NORMAL " : " INSERT ";
			const lastLine = lines[lastIndex]!;
			// Replace end of last line with mode indicator
			if (lastLine.length >= modeLabel.length) {
				lines[lastIndex] = lastLine.slice(0, -modeLabel.length) + modeLabel;
			}
		}
		return lines;
	}
}

// Simple identity function for unstyled text
const identity = (s: string) => s;

export default function (pi: ExtensionAPI) {
	// Create and set the custom editor on session start
	pi.on("session_start", (_event, ctx) => {
		// Create a simple editor theme
		const editorTheme: EditorTheme = {
			borderColor: (s: string) => ctx.ui.theme.fg("muted", s),
			selectList: {
				selectedPrefix: identity,
				selectedText: identity,
				description: identity,
				scrollInfo: identity,
				noMatch: identity,
			},
		};
		const modalEditor = new ModalEditor(editorTheme);
		ctx.ui.setEditorComponent(modalEditor);
	});
}
