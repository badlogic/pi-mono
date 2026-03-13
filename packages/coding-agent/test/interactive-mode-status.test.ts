import { Container } from "@mariozechner/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function renderLastLine(container: Container, width = 120): string {
	const last = container.children[container.children.length - 1];
	if (!last) return "";
	return last.render(width).join("\n");
}

function renderAll(container: Container, width = 120): string {
	return container.children.flatMap((child) => child.render(width)).join("\n");
}

describe("InteractiveMode.showStatus", () => {
	beforeAll(() => {
		// showStatus uses the global theme instance
		initTheme("dark");
	});

	test("coalesces immediately-sequential status messages", () => {
		const fakeThis: any = {
			chatContainer: new Container(),
			ui: { requestRender: vi.fn() },
			lastStatusSpacer: undefined,
			lastStatusText: undefined,
		};

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_ONE");
		expect(fakeThis.chatContainer.children).toHaveLength(2);
		expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_ONE");

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_TWO");
		// second status updates the previous line instead of appending
		expect(fakeThis.chatContainer.children).toHaveLength(2);
		expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_TWO");
		expect(renderLastLine(fakeThis.chatContainer)).not.toContain("STATUS_ONE");
	});

	test("appends a new status line if something else was added in between", () => {
		const fakeThis: any = {
			chatContainer: new Container(),
			ui: { requestRender: vi.fn() },
			lastStatusSpacer: undefined,
			lastStatusText: undefined,
		};

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_ONE");
		expect(fakeThis.chatContainer.children).toHaveLength(2);

		// Something else gets added to the chat in between status updates
		fakeThis.chatContainer.addChild({ render: () => ["OTHER"], invalidate: () => {} });
		expect(fakeThis.chatContainer.children).toHaveLength(3);

		(InteractiveMode as any).prototype.showStatus.call(fakeThis, "STATUS_TWO");
		// adds spacer + text
		expect(fakeThis.chatContainer.children).toHaveLength(5);
		expect(renderLastLine(fakeThis.chatContainer)).toContain("STATUS_TWO");
	});
});

describe("InteractiveMode.createExtensionUIContext setTheme", () => {
	test("persists theme changes to settings manager", () => {
		initTheme("dark");

		let currentTheme = "dark";
		const settingsManager = {
			getTheme: vi.fn(() => currentTheme),
			setTheme: vi.fn((theme: string) => {
				currentTheme = theme;
			}),
		};
		const fakeThis: any = {
			session: { settingsManager },
			settingsManager,
			ui: { requestRender: vi.fn() },
		};

		const uiContext = (InteractiveMode as any).prototype.createExtensionUIContext.call(fakeThis);
		const result = uiContext.setTheme("light");

		expect(result.success).toBe(true);
		expect(settingsManager.setTheme).toHaveBeenCalledWith("light");
		expect(currentTheme).toBe("light");
		expect(fakeThis.ui.requestRender).toHaveBeenCalledTimes(1);
	});

	test("does not persist invalid theme names", () => {
		initTheme("dark");

		const settingsManager = {
			getTheme: vi.fn(() => "dark"),
			setTheme: vi.fn(),
		};
		const fakeThis: any = {
			session: { settingsManager },
			settingsManager,
			ui: { requestRender: vi.fn() },
		};

		const uiContext = (InteractiveMode as any).prototype.createExtensionUIContext.call(fakeThis);
		const result = uiContext.setTheme("__missing_theme__");

		expect(result.success).toBe(false);
		expect(settingsManager.setTheme).not.toHaveBeenCalled();
		expect(fakeThis.ui.requestRender).not.toHaveBeenCalled();
	});
});

describe("InteractiveMode.showLoadedResources", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	function createShowLoadedResourcesThis(options: {
		quietStartup: boolean;
		verbose?: boolean;
		skills?: Array<{ filePath: string }>;
		skillDiagnostics?: Array<{ type: "warning" | "error" | "collision"; message: string }>;
	}) {
		const fakeThis: any = {
			options: { verbose: options.verbose ?? false },
			chatContainer: new Container(),
			settingsManager: {
				getQuietStartup: () => options.quietStartup,
			},
			session: {
				promptTemplates: [],
				extensionRunner: undefined,
				resourceLoader: {
					getPathMetadata: () => new Map(),
					getAgentsFiles: () => ({ agentsFiles: [] }),
					getSkills: () => ({
						skills: options.skills ?? [],
						diagnostics: options.skillDiagnostics ?? [],
					}),
					getPrompts: () => ({ prompts: [], diagnostics: [] }),
					getExtensions: () => ({ errors: [] }),
					getThemes: () => ({ themes: [], diagnostics: [] }),
				},
			},
			formatDisplayPath: (p: string) => p,
			buildScopeGroups: () => [],
			formatScopeGroups: () => "resource-list",
			getShortPath: (p: string) => p,
			formatDiagnostics: () => "diagnostics",
		};

		return fakeThis;
	}

	test("does not show verbose listing on quiet startup during reload", () => {
		const fakeThis = createShowLoadedResourcesThis({
			quietStartup: true,
			skills: [{ filePath: "/tmp/skill/SKILL.md" }],
		});

		(InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
			extensionPaths: ["/tmp/ext/index.ts"],
			force: false,
			showDiagnosticsWhenQuiet: true,
		});

		expect(fakeThis.chatContainer.children).toHaveLength(0);
	});

	test("still shows diagnostics on quiet startup when requested", () => {
		const fakeThis = createShowLoadedResourcesThis({
			quietStartup: true,
			skills: [{ filePath: "/tmp/skill/SKILL.md" }],
			skillDiagnostics: [{ type: "warning", message: "duplicate skill name" }],
		});

		(InteractiveMode as any).prototype.showLoadedResources.call(fakeThis, {
			force: false,
			showDiagnosticsWhenQuiet: true,
		});

		const output = renderAll(fakeThis.chatContainer);
		expect(output).toContain("[Skill conflicts]");
		expect(output).not.toContain("[Skills]");
	});
});

describe("InteractiveMode help and session reset", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("renders expanded operational help sections", () => {
		const fakeThis: any = {
			version: "0.57.1",
			chatContainer: new Container(),
			helpContainer: undefined,
			ui: { requestRender: vi.fn() },
			session: {
				extensionRunner: {
					getExtensionPaths: () => [],
				},
			},
			buildStartupInstructionsText: () => "startup shortcuts",
			buildHelpReferenceText: (InteractiveMode as any).prototype.buildHelpReferenceText,
			showLoadedResources: vi.fn(),
			clearHelpContainer: (InteractiveMode as any).prototype.clearHelpContainer,
		};

		(InteractiveMode as any).prototype.handleHelpCommand.call(fakeThis);

		const output = renderAll(fakeThis.helpContainer);
		expect(output).toContain("Operational Reference");
		expect(output).toContain("Built-in tools:");
		expect(output).toContain("Modes:");
		expect(output).toContain("Slash Commands");
		expect(output).toContain("/tree, /fork, /compact, /reload");
		expect(output).toContain("Customization");
		expect(fakeThis.showLoadedResources).toHaveBeenCalledOnce();
	});

	test("resetSessionUiState clears help and stale UI state", () => {
		const editor = {
			text: "/new",
			setText(text: string) {
				this.text = text;
			},
		};
		const helpContainer = new Container();
		helpContainer.addChild({ render: () => ["HELP"], invalidate: () => {} });
		const fakeThis: any = {
			chatContainer: new Container(),
			pendingMessagesContainer: new Container(),
			statusContainer: new Container(),
			helpContainer,
			compactionQueuedMessages: ["queued"],
			streamingComponent: { id: "stream" },
			streamingMessage: { id: "message" },
			pendingTools: new Map([["tool", { id: "tool" }]]),
			pendingBashComponents: [{ id: "bash" }],
			bashComponent: { id: "bash-active" },
			pendingWorkingMessage: "Working...",
			isBashMode: true,
			editor,
			ui: {
				invalidate: vi.fn(),
				requestRender: vi.fn(),
			},
			clearChatContainer: (InteractiveMode as any).prototype.clearChatContainer,
			updatePromptChrome: vi.fn(),
			renderInitialMessages: vi.fn(),
		};

		fakeThis.chatContainer.addChild(helpContainer);
		fakeThis.chatContainer.addChild({ render: () => ["OTHER"], invalidate: () => {} });
		fakeThis.pendingMessagesContainer.addChild({ render: () => ["PENDING"], invalidate: () => {} });
		fakeThis.statusContainer.addChild({ render: () => ["STATUS"], invalidate: () => {} });

		(InteractiveMode as any).prototype.resetSessionUiState.call(fakeThis, false);

		expect(fakeThis.chatContainer.children).toHaveLength(0);
		expect(fakeThis.pendingMessagesContainer.children).toHaveLength(0);
		expect(fakeThis.statusContainer.children).toHaveLength(0);
		expect(fakeThis.helpContainer).toBeUndefined();
		expect(fakeThis.compactionQueuedMessages).toEqual([]);
		expect(fakeThis.streamingComponent).toBeUndefined();
		expect(fakeThis.streamingMessage).toBeUndefined();
		expect(fakeThis.pendingTools.size).toBe(0);
		expect(fakeThis.pendingBashComponents).toEqual([]);
		expect(fakeThis.bashComponent).toBeUndefined();
		expect(fakeThis.pendingWorkingMessage).toBeUndefined();
		expect(fakeThis.isBashMode).toBe(false);
		expect(editor.text).toBe("");
		expect(fakeThis.updatePromptChrome).toHaveBeenCalledOnce();
		expect(fakeThis.renderInitialMessages).not.toHaveBeenCalled();
		expect(fakeThis.ui.invalidate).toHaveBeenCalledOnce();
	});
});
