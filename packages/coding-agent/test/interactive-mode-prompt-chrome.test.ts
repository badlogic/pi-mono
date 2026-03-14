import type { Component, EditorComponent } from "@apholdings/jensen-tui";
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
	promptAreaComponent?: Component;
	promptWidgetsVisible?: boolean;
	editorContainer: {
		children?: Component[];
		clear(): void;
		addChild(component: Component): void;
	};
	widgetContainerAbove?: {
		clear(): void;
	};
	widgetContainerBelow?: {
		clear(): void;
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
	setPromptWidgetsVisible?(visible: boolean): void;
	restorePromptEditor?(options?: { text?: string; focus?: boolean; requestRender?: boolean }): void;
	updatePromptChrome(): void;
	renderWidgets?(requestRender?: boolean): void;
};

function bindPromptAreaHelpers(harness: PromptChromeHarness): void {
	harness.setPromptWidgetsVisible = (visible: boolean) => {
		(InteractiveMode as any).prototype.setPromptWidgetsVisible.call(harness, visible);
	};
	harness.restorePromptEditor = (options?: { text?: string; focus?: boolean; requestRender?: boolean }) => {
		(InteractiveMode as any).prototype.restorePromptEditor.call(harness, options);
	};
}

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
		bindPromptAreaHelpers(harness);

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
		bindPromptAreaHelpers(harness);

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

	test("prompt area helper hides widgets and is idempotent", () => {
		const editor = new FakeEditor();
		const replacement = { render: () => ["loader"], invalidate: () => {} };
		const children: Component[] = [editor];
		let focusedComponent: Component | null = editor;
		const widgetContainerAbove = { clear: vi.fn() };
		const widgetContainerBelow = { clear: vi.fn() };
		const harness: PromptChromeHarness = {
			editor,
			defaultEditor: new FakeDefaultEditor(),
			promptAreaComponent: editor,
			promptWidgetsVisible: true,
			editorContainer: {
				children,
				clear: () => {
					children.length = 0;
				},
				addChild: (component) => {
					children.push(component);
				},
			},
			widgetContainerAbove,
			widgetContainerBelow,
			ui: {
				isWindowFocused: () => true,
				getFocusedComponent: () => focusedComponent,
				setFocus: (component) => {
					focusedComponent = component;
				},
				requestRender: vi.fn(),
			},
			session: { thinkingLevel: "off" },
			keybindings: {} as KeybindingsManager,
			autocompleteProvider: undefined,
			isBashMode: false,
			getActivePromptBorderColor: () => theme.getThinkingBorderColor("off"),
			isPromptActive: () => true,
			updatePromptChrome: () => callUpdatePromptChrome(harness),
			renderWidgets: vi.fn(),
		};
		bindPromptAreaHelpers(harness);

		(InteractiveMode as any).prototype.showPromptAreaComponent.call(harness, replacement);
		(InteractiveMode as any).prototype.showPromptAreaComponent.call(harness, replacement);

		expect(children).toEqual([replacement]);
		expect(harness.promptAreaComponent).toBe(replacement);
		expect(harness.promptWidgetsVisible).toBe(false);
		expect(widgetContainerAbove.clear).toHaveBeenCalledOnce();
		expect(widgetContainerBelow.clear).toHaveBeenCalledOnce();
		expect(focusedComponent).toBe(replacement);
	});

	test("restorePromptEditor remounts the canonical editor and restores widgets", () => {
		const editor = new FakeEditor("D");
		const replacement = { render: () => ["loader"], invalidate: () => {} };
		const children: Component[] = [replacement];
		let focusedComponent: Component | null = replacement;
		const harness: PromptChromeHarness = {
			editor,
			defaultEditor: new FakeDefaultEditor(),
			promptAreaComponent: replacement,
			promptWidgetsVisible: false,
			editorContainer: {
				children,
				clear: () => {
					children.length = 0;
				},
				addChild: (component) => {
					children.push(component);
				},
			},
			ui: {
				isWindowFocused: () => true,
				getFocusedComponent: () => focusedComponent,
				setFocus: (component) => {
					focusedComponent = component;
				},
				requestRender: vi.fn(),
			},
			session: { thinkingLevel: "off" },
			keybindings: {} as KeybindingsManager,
			autocompleteProvider: undefined,
			isBashMode: false,
			getActivePromptBorderColor: () => theme.getThinkingBorderColor("off"),
			isPromptActive: () => true,
			updatePromptChrome: () => callUpdatePromptChrome(harness),
			renderWidgets: vi.fn(),
		};
		bindPromptAreaHelpers(harness);

		(InteractiveMode as any).prototype.restorePromptEditor.call(harness, { requestRender: false });
		(InteractiveMode as any).prototype.restorePromptEditor.call(harness, { requestRender: false });

		expect(children).toEqual([editor]);
		expect(harness.promptAreaComponent).toBe(editor);
		expect(harness.promptWidgetsVisible).toBe(true);
		expect(harness.renderWidgets).toHaveBeenCalledOnce();
		expect(focusedComponent).toBe(editor);
	});
});
