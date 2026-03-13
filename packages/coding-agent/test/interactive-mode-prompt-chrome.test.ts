import type { Component, EditorComponent } from "@mariozechner/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { AppAction, KeybindingsManager } from "../src/core/keybindings.js";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.js";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.js";

class FakeEditor implements EditorComponent {
	public borderColor?: (str: string) => string;
	public onSubmit?: (text: string) => void;
	public onChange?: (text: string) => void;
	public paddingX = 0;

	constructor(private text = "") {}

	getText(): string {
		return this.text;
	}

	setText(text: string): void {
		this.text = text;
	}

	handleInput(_data: string): void {}

	render(_width: number): string[] {
		return [];
	}

	invalidate(): void {}

	setPaddingX(padding: number): void {
		this.paddingX = padding;
	}
}

class FakeDefaultEditor extends FakeEditor {
	public actionHandlers = new Map<AppAction, () => void>();
	public onEscape?: () => void;
	public onCtrlD?: () => void;
	public onPasteImage?: () => void;
	public onExtensionShortcut?: (data: string) => boolean;

	getPaddingX(): number {
		return 3;
	}
}

type UiStub = {
	isWindowFocused(): boolean;
	getFocusedComponent(): Component | null;
	setFocus(component: Component | null): void;
	requestRender: ReturnType<typeof vi.fn>;
};

type PromptChromeHarness = {
	editor: EditorComponent;
	defaultEditor: FakeDefaultEditor;
	editorContainer: {
		clear(): void;
		addChild(component: Component): void;
	};
	ui: UiStub;
	session: {
		thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	};
	keybindings: KeybindingsManager;
	autocompleteProvider: undefined;
	isBashMode: boolean;
	getActivePromptBorderColor(): (str: string) => string;
	isPromptActive(): boolean;
	updatePromptChrome(): void;
};

function callUpdatePromptChrome(harness: PromptChromeHarness): void {
	(
		InteractiveMode as unknown as {
			prototype: { updatePromptChrome(this: PromptChromeHarness): void };
		}
	).prototype.updatePromptChrome.call(harness);
}

describe("InteractiveMode prompt chrome", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("uses active or inactive prompt colors based on focus state", () => {
		const editor = new FakeEditor();
		let focusedComponent: Component | null = editor;
		let windowFocused = true;
		const harness: PromptChromeHarness = {
			editor,
			defaultEditor: new FakeDefaultEditor(),
			editorContainer: {
				clear: () => {},
				addChild: () => {},
			},
			ui: {
				isWindowFocused: () => windowFocused,
				getFocusedComponent: () => focusedComponent,
				setFocus: (component) => {
					focusedComponent = component;
				},
				requestRender: vi.fn(),
			},
			session: { thinkingLevel: "medium" },
			keybindings: {} as KeybindingsManager,
			autocompleteProvider: undefined,
			isBashMode: false,
			getActivePromptBorderColor: () =>
				harness.isBashMode
					? theme.getBashModeBorderColor()
					: theme.getThinkingBorderColor(harness.session.thinkingLevel),
			isPromptActive: () => harness.ui.isWindowFocused() && harness.ui.getFocusedComponent() === harness.editor,
			updatePromptChrome: () => callUpdatePromptChrome(harness),
		};

		callUpdatePromptChrome(harness);
		expect(editor.borderColor?.("x")).toBe(theme.getThinkingBorderColor("medium")("x"));

		windowFocused = false;
		callUpdatePromptChrome(harness);
		expect(editor.borderColor?.("x")).toBe(theme.getInactivePromptBorderColor()("x"));

		windowFocused = true;
		harness.isBashMode = true;
		callUpdatePromptChrome(harness);
		expect(editor.borderColor?.("x")).toBe(theme.getBashModeBorderColor()("x"));
	});

	test("recomputes prompt chrome after swapping editors", () => {
		const defaultEditor = new FakeDefaultEditor("!echo hi");
		const originalEditor = new FakeEditor("!echo hi");
		let focusedComponent: Component | null = originalEditor;
		let mountedEditor: Component | null = null;
		const harness: PromptChromeHarness = {
			editor: originalEditor,
			defaultEditor,
			editorContainer: {
				clear: () => {
					mountedEditor = null;
				},
				addChild: (component) => {
					mountedEditor = component;
				},
			},
			ui: {
				isWindowFocused: () => false,
				getFocusedComponent: () => focusedComponent,
				setFocus: (component) => {
					focusedComponent = component;
				},
				requestRender: vi.fn(),
			},
			session: { thinkingLevel: "low" },
			keybindings: {} as KeybindingsManager,
			autocompleteProvider: undefined,
			isBashMode: true,
			getActivePromptBorderColor: () =>
				harness.isBashMode
					? theme.getBashModeBorderColor()
					: theme.getThinkingBorderColor(harness.session.thinkingLevel),
			isPromptActive: () => harness.ui.isWindowFocused() && harness.ui.getFocusedComponent() === harness.editor,
			updatePromptChrome: () => callUpdatePromptChrome(harness),
		};

		const swappedEditor = new FakeEditor();
		(
			InteractiveMode as unknown as {
				prototype: {
					setCustomEditorComponent(
						this: PromptChromeHarness,
						factory: ((...args: unknown[]) => EditorComponent) | undefined,
					): void;
				};
			}
		).prototype.setCustomEditorComponent.call(harness, () => swappedEditor);

		expect(harness.editor).toBe(swappedEditor);
		expect(swappedEditor.getText()).toBe("!echo hi");
		expect(swappedEditor.paddingX).toBe(3);
		expect(swappedEditor.borderColor?.("x")).toBe(theme.getInactivePromptBorderColor()("x"));
		expect(focusedComponent).toBe(swappedEditor);
		expect(mountedEditor).toBe(swappedEditor);
		expect(harness.ui.requestRender).toHaveBeenCalled();
	});
});
