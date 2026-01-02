/**
 * Multi-line editor component for hooks.
 * Supports Ctrl+G for external editor.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Container, Editor, isCtrlC, isCtrlG, isEscape, Spacer, Text, type TUI } from "@mariozechner/pi-tui";
import { getEditorTheme, theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

export class HookEditorComponent extends Container {
	private editor: Editor;
	private onSubmitCallback: (value: string) => void;
	private onCancelCallback: () => void;
	private tui: TUI;

	constructor(
		tui: TUI,
		title: string,
		prefill: string | undefined,
		onSubmit: (value: string) => void,
		onCancel: () => void,
	) {
		super();

		this.tui = tui;
		this.onSubmitCallback = onSubmit;
		this.onCancelCallback = onCancel;

		// Add top border
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		// Add title
		this.addChild(new Text(theme.fg("accent", title), 1, 0));
		this.addChild(new Spacer(1));

		// Create editor
		this.editor = new Editor(getEditorTheme());
		if (prefill) {
			this.editor.setText(prefill);
		}
		this.addChild(this.editor);

		this.addChild(new Spacer(1));

		// Add hint
		const hasExternalEditor = !!(process.env.VISUAL || process.env.EDITOR);
		const hint = hasExternalEditor
			? "ctrl+enter submit  esc cancel  ctrl+g external editor"
			: "ctrl+enter submit  esc cancel";
		this.addChild(new Text(theme.fg("dim", hint), 1, 0));

		this.addChild(new Spacer(1));

		// Add bottom border
		this.addChild(new DynamicBorder());
	}

	handleInput(keyData: string): void {
		// Ctrl+Enter to submit
		if (keyData === "\x1b[13;5u" || keyData === "\x1b[27;5;13~") {
			this.onSubmitCallback(this.editor.getText());
			return;
		}

		// Escape or Ctrl+C to cancel
		if (isEscape(keyData) || isCtrlC(keyData)) {
			this.onCancelCallback();
			return;
		}

		// Ctrl+G for external editor
		if (isCtrlG(keyData)) {
			this.openExternalEditor();
			return;
		}

		// Forward to editor
		this.editor.handleInput(keyData);
	}

	private openExternalEditor(): void {
		const editorCmd = process.env.VISUAL || process.env.EDITOR;
		if (!editorCmd) {
			return;
		}

		const currentText = this.editor.getText();
		const tmpFile = path.join(os.tmpdir(), `pi-hook-editor-${Date.now()}.md`);

		try {
			fs.writeFileSync(tmpFile, currentText, "utf-8");
			this.tui.stop();

			const [editor, ...editorArgs] = editorCmd.split(" ");
			const result = spawnSync(editor, [...editorArgs, tmpFile], {
				stdio: "inherit",
			});

			if (result.status === 0) {
				const newContent = fs.readFileSync(tmpFile, "utf-8").replace(/\n$/, "");
				this.editor.setText(newContent);
			}
		} finally {
			try {
				fs.unlinkSync(tmpFile);
			} catch {
				// Ignore cleanup errors
			}
			this.tui.start();
			this.tui.requestRender();
		}
	}
}
