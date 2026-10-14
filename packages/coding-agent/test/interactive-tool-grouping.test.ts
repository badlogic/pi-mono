// INV-1 interactive-mode.ts: live, fallback, and replay group only consecutive tool rows.
// INV-2 interactive-mode.ts: late visible assistant content splits groups without replacing tools.
// INV-3 interactive-mode.ts: Ctrl+O cycles compact display; standalone visibility/output controls stay independent.
// Revert interactive-mode.ts -> all compact-mode assertions fail.
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { Container, Text, type TUI } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentSessionEvent } from "../src/core/agent-session.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { type SessionEntry, SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import type { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import type { SettingsSelectorComponent } from "../src/modes/interactive/components/settings-selector.ts";
import { ThemedText } from "../src/modes/interactive/components/themed-text.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { getEditorTheme, initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import type { ToolStatus } from "../src/utils/tools-manager.ts";

function assistant(id: string, content: AssistantMessage["content"] = []): AssistantMessage {
	return {
		role: "assistant",
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test",
		content: [...content, { type: "toolCall", id, name: "read", arguments: { path: `${id}.txt` } }],
		stopReason: "toolUse",
		timestamp: 1,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

interface GroupView {
	tools: readonly ToolExecutionComponent[];
	expanded: boolean;
	setExpanded(expanded: boolean): void;
	render(width: number): string[];
}
interface TestMode {
	chatContainer: Container;
	pendingTools: Map<string, ToolExecutionComponent>;
	streamingComponent?: AssistantMessageComponent;
	handleEvent(event: AgentSessionEvent): Promise<void>;
	renderSessionItems(items: readonly AgentMessage[]): void;
	renderSessionEntries(entries: SessionEntry[]): void;
	setToolsExpanded(expanded: boolean): void;
	toggleToolGroupExpansion(): void;
	setCompactToolCalls(compact: boolean): void;
	showStatus(message: string): void;
	showManagedToolStatus(status: ToolStatus): void;
	addMessageToChat(message: AgentMessage): void;
	showSettingsSelector(): void;
	rebuildChatFromMessages(): void;
	setupKeyHandlers(): void;
	handleHotkeysCommand(): void;
	prepareStreamingToolGroup(): void;
}

function createMode(compact = true) {
	const settings = SettingsManager.inMemory({ compactToolCalls: compact });
	const sessionManager = SessionManager.inMemory();
	const mode = Object.assign(Object.create(InteractiveMode.prototype), {
		runtimeHost: {
			session: {
				settingsManager: settings,
				sessionManager,
				retryAttempt: 0,
				getToolDefinition: () => undefined,
				extensionRunner: {
					resolveToolRenderers: (_name: string, next: () => unknown) => next(),
					getMarkdownTransformers: () => [],
					getMessageRenderer: () => undefined,
					getEntryRenderer: () => () => new Text("custom entry", 0, 0),
				},
			},
		},
		isInitialized: true,
		outputPad: 1,
		hideThinkingBlock: false,
		hiddenThinkingLabel: "Thinking...",
		toolOutputExpanded: false,
		toolGroupsExpanded: false,
		chatContainer: new Container(),
		loadedResourcesContainer: new Container(),
		pendingMessagesContainer: new Container(),
		pendingTools: new Map<string, ToolExecutionComponent>(),
		entriesRenderedByBoundaryCompaction: new Set<string>(),
		footer: { invalidate: vi.fn() },
		programStatus: { handleEvent: vi.fn() },
		editor: { addToHistory: vi.fn() },
		ui: { requestRender: vi.fn(), terminal: { columns: 100 } },
		getMarkdownTransformers: () => [],
	}) as TestMode;
	return { mode, settings, sessionManager };
}

function groups(mode: TestMode): GroupView[] {
	return mode.chatContainer.children.filter((child) => "tools" in child) as unknown as GroupView[];
}

async function stream(mode: TestMode, message: AssistantMessage) {
	await mode.handleEvent({ type: "message_start", message: { ...message, content: [] } });
	await mode.handleEvent({
		type: "message_update",
		message,
		assistantMessageEvent: { type: "done", reason: "toolUse", message },
	});
	await mode.handleEvent({ type: "message_end", message });
}

async function finish(mode: TestMode, id: string, isError = false) {
	await mode.handleEvent({
		type: "tool_execution_start",
		toolCallId: id,
		toolName: "read",
		args: { path: `${id}.txt` },
	});
	await mode.handleEvent({
		type: "tool_execution_end",
		toolCallId: id,
		toolName: "read",
		isError,
		result: { content: [{ type: "text", text: `output ${id}` }], details: undefined },
	});
}

describe("InteractiveMode tool grouping", () => {
	beforeEach(() => initTheme("dark"));

	test("groups adjacent tool-only messages after every pending tool has finished", async () => {
		const { mode } = createMode();
		await stream(mode, assistant("one"));
		await finish(mode, "one");
		expect(mode.pendingTools.size).toBe(0);
		await stream(mode, assistant("two"));
		await finish(mode, "two", true);
		expect(groups(mode)).toHaveLength(1);
		expect(groups(mode)[0].tools).toHaveLength(2);
		const output = stripAnsi(mode.chatContainer.render(100).join("\n"));
		expect(output).toContain("2 tools");
		expect(output).toContain("1 error");
		expect(output).not.toContain("output one");
	});

	test("fallback execution starts reuse existing tool identities and exclude nested calls", async () => {
		const { mode } = createMode();
		await mode.handleEvent({
			type: "tool_execution_start",
			toolCallId: "parent/1",
			parentToolCallId: "parent",
			toolName: "read",
			args: {},
		});
		expect(groups(mode)).toHaveLength(0);
		await finish(mode, "fallback");
		await stream(mode, assistant("next"));
		const child = mode.pendingTools.get("next");
		await mode.handleEvent({ type: "tool_execution_start", toolCallId: "next", toolName: "read", args: {} });
		expect(mode.pendingTools.get("next")).toBe(child);
		expect(groups(mode)[0].tools).toHaveLength(2);
	});

	test("replay folds results into calls and honors visible transcript boundaries", () => {
		const { mode } = createMode();
		mode.renderSessionItems([
			assistant("a"),
			{
				role: "toolResult",
				toolCallId: "a",
				toolName: "read",
				content: [{ type: "text", text: "saved output" }],
				isError: false,
				timestamp: 2,
			},
			assistant("b"),
			assistant("c", [{ type: "text", text: "visible prose" }]),
			assistant("d"),
			{ role: "user", content: "next question", timestamp: 3 },
			assistant("e"),
			{ role: "custom", customType: "note", display: true, content: "custom content", timestamp: 4 },
			assistant("f"),
			{ role: "compactionSummary", summary: "summary", tokensBefore: 100, timestamp: 5 },
			assistant("g"),
			assistant("h", [{ type: "thinking", thinking: "visible thought" }]),
		]);
		expect(groups(mode).map((group) => group.tools.length)).toEqual([2, 2, 1, 1, 1, 1]);
		groups(mode)[0].setExpanded(true);
		mode.setToolsExpanded(true);
		expect(stripAnsi(mode.chatContainer.render(100).join("\n"))).toContain("saved output");
	});

	test("late assistant text splits the current message out of a prior group", async () => {
		const { mode } = createMode();
		await stream(mode, assistant("old"));
		await finish(mode, "old");
		const message = assistant("new");
		await mode.handleEvent({ type: "message_start", message: { ...message, content: [] } });
		await mode.handleEvent({
			type: "message_update",
			message,
			assistantMessageEvent: { type: "done", reason: "toolUse", message },
		});
		const child = mode.pendingTools.get("new");
		expect(groups(mode)[0].tools).toHaveLength(2);
		const visible = assistant("new", [{ type: "text", text: "late prose" }]);
		await mode.handleEvent({
			type: "message_update",
			message: visible,
			assistantMessageEvent: { type: "done", reason: "toolUse", message: visible },
		});
		expect(groups(mode).map((group) => group.tools.length)).toEqual([1, 1]);
		expect(groups(mode)[1].tools[0]).toBe(child);
		expect(mode.pendingTools.get("new")).toBe(child);
		const output = stripAnsi(mode.chatContainer.render(100).join("\n"));
		expect(output.indexOf("late prose")).toBeGreaterThan(output.indexOf("1 tool ·"));
		expect(output.lastIndexOf("1 tool ·")).toBeGreaterThan(output.indexOf("late prose"));
	});

	test.each([false, true])(
		"reused call IDs cannot relocate completed tools from an earlier turn (compact=%s)",
		async (compact) => {
			const { mode } = createMode(compact);
			await stream(mode, assistant("shared"));
			const originalTool = mode.pendingTools.get("shared")!;
			const originalRow = mode.chatContainer.children.at(-1)!;
			await finish(mode, "shared");
			const originalRender = originalRow.render(100);
			mode.addMessageToChat({ role: "user", content: "new turn", timestamp: 2 });
			const userRow = mode.chatContainer.children.at(-1)!;
			await mode.handleEvent({ type: "agent_start" });
			expect(mode.pendingTools.size).toBe(0);
			const message = assistant("shared", [{ type: "text", text: "new turn commentary" }]);
			await mode.handleEvent({ type: "message_start", message: { ...message, content: [] } });
			await mode.handleEvent({
				type: "message_update",
				message,
				assistantMessageEvent: { type: "done", reason: "toolUse", message },
			});
			const currentTool = mode.pendingTools.get("shared")!;
			expect(currentTool).not.toBe(originalTool);
			expect(currentTool.getStatus()).toBe("pending");
			expect(originalTool.getStatus()).toBe("success");
			expect(mode.chatContainer.children).toContain(originalRow);
			expect(mode.chatContainer.children.indexOf(originalRow)).toBeLessThan(
				mode.chatContainer.children.indexOf(userRow),
			);
			expect(originalRow.render(100)).toEqual(originalRender);
			await mode.handleEvent({ type: "message_end", message });
			await finish(mode, "shared", true);
			expect(originalTool.getStatus()).toBe("success");
			expect(currentTool.getStatus()).toBe("error");
			if (compact) {
				expect(groups(mode).map((group) => group.tools)).toEqual([[originalTool], [currentTool]]);
				expect(stripAnsi(groups(mode)[0].render(100)[1])).toContain("done");
				expect(stripAnsi(groups(mode)[1].render(100)[1])).toContain("1 error");
			} else {
				expect(mode.chatContainer.children.filter((child) => child instanceof ToolExecutionComponent)).toEqual([
					originalTool,
					currentTool,
				]);
			}
		},
	);

	test("warnings and empty user messages break groups without using execution state", async () => {
		const { mode } = createMode();
		await stream(mode, assistant("a"));
		mode.showManagedToolStatus({ type: "warning", message: "notice" });
		await stream(mode, assistant("b"));
		mode.addMessageToChat({ role: "user", content: "", timestamp: 3 });
		await stream(mode, assistant("c"));
		expect(groups(mode)).toHaveLength(3);
	});

	test("group toggles never alter child output and output toggles never open groups", async () => {
		const { mode } = createMode();
		await stream(mode, assistant("a"));
		await finish(mode, "a");
		const group = groups(mode)[0];
		mode.setToolsExpanded(true);
		expect(group.expanded).toBe(false);
		mode.toggleToolGroupExpansion();
		expect(group.expanded).toBe(true);
		expect(stripAnsi(group.render(100).join("\n"))).toContain("output a");
		mode.toggleToolGroupExpansion();
		mode.setToolsExpanded(false);
		expect(group.expanded).toBe(false);
		mode.toggleToolGroupExpansion();
		expect(stripAnsi(group.render(100).join("\n"))).not.toContain("output a");
	});

	test("changing compact mode while streaming keeps components and pending execution updates", async () => {
		const { mode } = createMode(false);
		const message = assistant("a");
		await mode.handleEvent({ type: "message_start", message: { ...message, content: [] } });
		await mode.handleEvent({
			type: "message_update",
			message,
			assistantMessageEvent: { type: "done", reason: "toolUse", message },
		});
		const child = mode.pendingTools.get("a");
		mode.setCompactToolCalls(true);
		expect(groups(mode)[0].tools[0]).toBe(child);
		mode.setCompactToolCalls(false);
		expect(mode.chatContainer.children).toContain(child);
		expect(groups(mode)).toHaveLength(0);
		await finish(mode, "a");
		mode.setCompactToolCalls(true);
		mode.setToolsExpanded(true);
		groups(mode)[0].setExpanded(true);
		expect(stripAnsi(mode.chatContainer.render(100).join("\n"))).toContain("output a");
	});

	test("disabling grouping before late text restores the streaming tool below its assistant row", async () => {
		const { mode } = createMode();
		await stream(mode, assistant("old"));
		const message = assistant("new");
		await mode.handleEvent({ type: "message_start", message: { ...message, content: [] } });
		await mode.handleEvent({
			type: "message_update",
			message,
			assistantMessageEvent: { type: "done", reason: "toolUse", message },
		});
		const child = mode.pendingTools.get("new")!;
		mode.setCompactToolCalls(false);
		expect(mode.chatContainer.children.indexOf(child)).toBeGreaterThan(
			mode.chatContainer.children.indexOf(mode.streamingComponent!),
		);
		const visible = assistant("new", [{ type: "text", text: "late text" }]);
		await mode.handleEvent({ type: "message_end", message: visible });
		expect(mode.chatContainer.children.indexOf(child)).toBeGreaterThan(
			mode.chatContainer.children.findIndex((row) => stripAnsi(row.render(100).join("\n")).includes("late text")),
		);
	});

	test("empty user boundaries survive regrouping and replay reads the reloaded setting", () => {
		const { mode, settings, sessionManager } = createMode(false);
		sessionManager.appendMessage(assistant("a"));
		sessionManager.appendMessage({ role: "user", content: "", timestamp: 2 });
		sessionManager.appendMessage(assistant("b"));
		mode.renderSessionEntries(sessionManager.getEntries());
		mode.setCompactToolCalls(true);
		expect(groups(mode).map((group) => group.tools.length)).toEqual([1, 1]);
		settings.applyOverrides({ compactToolCalls: false });
		mode.rebuildChatFromMessages();
		expect(groups(mode)).toHaveLength(0);
		settings.applyOverrides({ compactToolCalls: true });
		mode.rebuildChatFromMessages();
		expect(groups(mode).map((group) => group.tools.length)).toEqual([1, 1]);
	});

	test("final-only text and aborted results reach grouped tools without stale running status", async () => {
		const { mode } = createMode();
		await stream(mode, assistant("old"));
		const message = assistant("new");
		await mode.handleEvent({ type: "message_start", message: { ...message, content: [] } });
		await mode.handleEvent({
			type: "message_update",
			message,
			assistantMessageEvent: { type: "done", reason: "toolUse", message },
		});
		await mode.handleEvent({
			type: "message_end",
			message: { ...assistant("new", [{ type: "text", text: "final text" }]), stopReason: "aborted" },
		});
		expect(groups(mode).map((group) => group.tools.length)).toEqual([1, 1]);
		expect(mode.pendingTools.size).toBe(0);
		for (const group of groups(mode)) {
			expect(stripAnsi(group.render(100)[1])).toContain("1 error");
			expect(stripAnsi(group.render(100)[1])).not.toContain("running");
			expect(stripAnsi(group.render(100)[1])).not.toContain("pending");
		}
	});

	test("partial execution output followed by an aborted final result clears running status", async () => {
		const { mode } = createMode();
		await stream(mode, assistant("a"));
		const child = mode.pendingTools.get("a")!;
		const group = groups(mode)[0];
		const args = { path: "a.txt" };
		await mode.handleEvent({ type: "tool_execution_start", toolCallId: "a", toolName: "read", args });
		await mode.handleEvent({
			type: "tool_execution_update",
			toolCallId: "a",
			toolName: "read",
			args,
			partialResult: { content: [{ type: "text", text: "partial before abort" }], details: undefined },
		});
		expect(mode.pendingTools.get("a")).toBe(child);
		expect(stripAnsi(group.render(100)[1])).toContain("1 running");
		group.setExpanded(true);
		mode.setToolsExpanded(true);
		expect(stripAnsi(group.render(100).join("\n"))).toContain("partial before abort");
		group.setExpanded(false);
		await mode.handleEvent({
			type: "tool_execution_end",
			toolCallId: "a",
			toolName: "read",
			isError: true,
			result: { content: [{ type: "text", text: "Operation aborted" }], details: undefined },
		});
		expect(mode.pendingTools.has("a")).toBe(false);
		expect(group.tools[0]).toBe(child);
		expect(group.expanded).toBe(false);
		const summary = stripAnsi(group.render(100)[1]);
		expect(summary).toContain("1 error");
		expect(summary).not.toMatch(/running|pending|done/);
		group.setExpanded(true);
		expect(stripAnsi(group.render(100).join("\n"))).toContain("Operation aborted");
	});

	test("the settings selector wires compact mode, padding, and images into grouped children", async () => {
		const { mode, settings } = createMode();
		Object.assign(Reflect.get(mode, "session"), { modelRuntime: { getAvailableSnapshot: () => [] } });
		let selector: SettingsSelectorComponent | undefined;
		Object.assign(mode, {
			themeController: { getThemeSelection: () => "dark", getTerminalTheme: () => undefined },
			showSelector: (create: (done: () => void) => { component: SettingsSelectorComponent }) => {
				selector = create(() => {}).component;
			},
		});
		await stream(mode, assistant("a"));
		const child = mode.pendingTools.get("a")!;
		const padding = vi.spyOn(child, "setOutputPad");
		const images = vi.spyOn(child, "setShowImages");
		const width = vi.spyOn(child, "setImageWidthCells");
		mode.showSettingsSelector();
		const list = selector!.getSettingsList();
		list.selectItem("compact-tool-calls");
		expect(stripAnsi(list.render(100).join("\n"))).toMatch(/Compact tool calls\s+true/i);
		list.handleInput("\r");
		expect(settings.getCompactToolCalls()).toBe(false);
		expect(groups(mode)).toHaveLength(0);
		list.handleInput("\r");
		expect(groups(mode)[0].tools[0]).toBe(child);
		const change = Reflect.get(list, "onChange") as (id: string, value: string) => void;
		change("output-padding", "0");
		change("show-images", "false");
		change("image-width-cells", "12");
		expect(padding).toHaveBeenCalledWith(0);
		expect(images).toHaveBeenCalledWith(false);
		expect(width).toHaveBeenCalledWith(12);
		expect(groups(mode)[0].expanded).toBe(false);
	});

	test.each([
		["ctrl+o", "\x0f"],
		["alt+o", "\x1bo"],
	] as const)("%s cycles summaries, previews, and full output without replacing tools", async (key, data) => {
		const { mode } = createMode();
		const editor = new CustomEditor(
			Reflect.get(mode, "ui") as TUI,
			getEditorTheme(),
			new KeybindingsManager({ "app.tools.expand": key }),
		);
		Object.assign(mode, { editor, defaultEditor: editor });
		mode.setupKeyHandlers();
		await stream(mode, assistant("a"));
		await finish(mode, "a");
		mode.addMessageToChat({ role: "user", content: "boundary", timestamp: 2 });
		await stream(mode, assistant("b"));
		await finish(mode, "b");
		const originalGroups = groups(mode);
		const originalTools = originalGroups.flatMap((group) => group.tools);
		expect(originalGroups.every((group) => !group.expanded)).toBe(true);
		editor.handleInput("\x1bOQ");
		expect(originalGroups.every((group) => !group.expanded)).toBe(true);
		for (let cycle = 0; cycle < 2; cycle++) {
			for (const state of ["previews", "all", "groups collapsed"]) {
				editor.handleInput(data);
				expect(originalGroups.map((group) => group.expanded)).toEqual([
					state !== "groups collapsed",
					state !== "groups collapsed",
				]);
				for (const group of originalGroups) {
					const output = stripAnsi(group.render(100).join("\n"));
					expect(group.render(100).length > 2).toBe(state !== "groups collapsed");
					expect(output.includes("output ")).toBe(state === "all");
				}
				expect(groups(mode)).toEqual(originalGroups);
				expect(originalGroups.flatMap((group) => group.tools)).toEqual(originalTools);
				expect(stripAnsi(mode.chatContainer.render(100).join("\n"))).toContain(`Tool display: ${state}`);
			}
		}
	});

	test.each([0, 1, 2, 3])("new live groups inherit display after %s Ctrl+O presses", async (presses) => {
		const { mode } = createMode();
		const editor = new CustomEditor(Reflect.get(mode, "ui") as TUI, getEditorTheme(), new KeybindingsManager());
		Object.assign(mode, { editor, defaultEditor: editor });
		mode.setupKeyHandlers();
		await stream(mode, assistant("a"));
		const child = mode.pendingTools.get("a");
		for (let i = 0; i < presses; i++) editor.handleInput("\x0f");
		expect(mode.pendingTools.get("a")).toBe(child);
		await finish(mode, "a");
		mode.addMessageToChat({ role: "user", content: "boundary", timestamp: 2 });
		await stream(mode, assistant("b"));
		await finish(mode, "b");
		for (const group of groups(mode)) {
			expect(group.expanded).toBe(presses % 3 !== 0);
			expect(stripAnsi(group.render(100).join("\n")).includes("output ")).toBe(presses % 3 === 2);
		}
	});

	test("Ctrl+O normalizes individually opened or closed groups on each display step", async () => {
		const { mode } = createMode();
		const editor = new CustomEditor(Reflect.get(mode, "ui") as TUI, getEditorTheme(), new KeybindingsManager());
		Object.assign(mode, { editor, defaultEditor: editor });
		mode.setupKeyHandlers();
		await stream(mode, assistant("a"));
		await finish(mode, "a");
		mode.addMessageToChat({ role: "user", content: "boundary", timestamp: 2 });
		await stream(mode, assistant("b"));
		await finish(mode, "b");
		const [first, second] = groups(mode);
		first.setExpanded(true);
		editor.handleInput("\x0f");
		expect([first.expanded, second.expanded]).toEqual([true, true]);
		second.setExpanded(false);
		editor.handleInput("\x0f");
		expect([first.expanded, second.expanded]).toEqual([true, true]);
		for (const group of [first, second]) expect(stripAnsi(group.render(100).join("\n"))).toContain("output ");
		first.setExpanded(false);
		editor.handleInput("\x0f");
		expect([first.expanded, second.expanded]).toEqual([false, false]);
	});

	test("the preview step collapses individually expanded output even when the global flag is false", async () => {
		const { mode } = createMode();
		const editor = new CustomEditor(Reflect.get(mode, "ui") as TUI, getEditorTheme(), new KeybindingsManager());
		Object.assign(mode, { editor, defaultEditor: editor });
		mode.setupKeyHandlers();
		await stream(mode, assistant("a"));
		await finish(mode, "a");
		const group = groups(mode)[0];
		const child = group.tools[0];
		child.setExpanded(true);
		expect(stripAnsi(child.render(100).join("\n"))).toContain("output a");
		editor.handleInput("\x0f");
		expect(group.expanded).toBe(true);
		expect(stripAnsi(group.render(100).join("\n"))).not.toContain("output a");
		editor.handleInput("\x0f");
		expect(stripAnsi(group.render(100).join("\n"))).toContain("output a");
	});

	test("standard Ctrl+O keeps its two-state output and header/resource behavior", async () => {
		const { mode } = createMode(false);
		const editor = new CustomEditor(Reflect.get(mode, "ui") as TUI, getEditorTheme(), new KeybindingsManager());
		let headerExpanded = false;
		let resourceExpanded = false;
		const header = Object.assign(new Text("header", 0, 0), {
			setExpanded: (expanded: boolean) => {
				headerExpanded = expanded;
			},
		});
		const resource = Object.assign(new Text("resource", 0, 0), {
			setExpanded: (expanded: boolean) => {
				resourceExpanded = expanded;
			},
		});
		Object.assign(mode, { editor, defaultEditor: editor, builtInHeader: header });
		(Reflect.get(mode, "loadedResourcesContainer") as Container).addChild(resource);
		mode.setupKeyHandlers();
		await stream(mode, assistant("a"));
		await finish(mode, "a");
		for (const expanded of [true, false, true, false]) {
			editor.handleInput("\x0f");
			expect(groups(mode)).toHaveLength(0);
			expect([headerExpanded, resourceExpanded]).toEqual([expanded, expanded]);
			expect(stripAnsi(mode.chatContainer.render(100).join("\n")).includes("output a")).toBe(expanded);
		}
	});

	test.each([
		[false, false],
		[false, true],
		[true, false],
		[true, true],
	] as const)("hotkeys stays a table with compact=%s and a standalone group binding=%s", (compact, bound) => {
		const { mode } = createMode(compact);
		Object.assign(mode, {
			keybindings: new KeybindingsManager(bound ? { "app.tools.toggleGroups": "alt+g" } : {}),
		});
		Object.assign(Reflect.get(mode, "session").extensionRunner, { getShortcuts: () => new Map<string, never>() });
		mode.handleHotkeysCommand();
		const rows = stripAnsi(mode.chatContainer.render(240).join("\n")).split("\n");
		const thinkingRow = rows.find((row) => row.includes("Toggle thinking block visibility"));
		expect(thinkingRow).toMatch(/^\s*│.*│\s*$/);
		const groupRow = rows.find((row) => row.includes("Toggle tool group visibility"));
		expect(Boolean(groupRow)).toBe(bound);
		if (bound) expect(groupRow).toMatch(/^\s*│.*│\s*$/);
		expect(rows.join("\n")).toContain(compact ? "Cycle tool display:" : "Toggle tool output expansion");
	});

	test.each([false, true])(
		"Ctrl+O preserves grouping for the next tool call (adjacent assistant=%s)",
		async (adjacentAssistant) => {
			const { mode } = createMode();
			const editor = new CustomEditor(Reflect.get(mode, "ui") as TUI, getEditorTheme(), new KeybindingsManager());
			Object.assign(mode, { editor, defaultEditor: editor });
			mode.setupKeyHandlers();
			const first = assistant("first");
			await mode.handleEvent({ type: "message_start", message: { ...first, content: [] } });
			await mode.handleEvent({
				type: "message_update",
				message: first,
				assistantMessageEvent: { type: "done", reason: "toolUse", message: first },
			});
			const originalGroup = groups(mode)[0];
			const originalChild = originalGroup.tools[0];
			if (adjacentAssistant) {
				await mode.handleEvent({ type: "message_end", message: first });
				await finish(mode, "first");
			}
			editor.handleInput("\x0f");
			expect(originalGroup.expanded).toBe(true);
			const second = assistant("second", adjacentAssistant ? [] : first.content);
			if (adjacentAssistant) {
				await mode.handleEvent({ type: "message_start", message: { ...second, content: [] } });
			}
			await mode.handleEvent({
				type: "message_update",
				message: second,
				assistantMessageEvent: { type: "done", reason: "toolUse", message: second },
			});
			await mode.handleEvent({ type: "message_end", message: second });
			expect(groups(mode)[0]).toBe(originalGroup);
			expect(originalGroup.tools[0]).toBe(originalChild);
			expect(groups(mode).map((group) => group.tools.map((tool) => tool.getToolCallId()))).toEqual([
				["first", "second"],
			]);
		},
	);

	test.each([false, true])(
		"multiple status rows retain feedback across adjacent batches (compact=%s)",
		async (compact) => {
			const { mode } = createMode(compact);
			await stream(mode, assistant("first"));
			await finish(mode, "first");
			const originalGroup = groups(mode)[0];
			mode.setToolsExpanded(true);
			expect(stripAnsi(mode.chatContainer.render(100).join("\n"))).toContain("Tool output: expanded");
			const second = assistant("second");
			await mode.handleEvent({ type: "message_start", message: { ...second, content: [] } });
			mode.setToolsExpanded(false);
			const feedback = stripAnsi(mode.chatContainer.render(100).join("\n"));
			expect(feedback).toContain("Tool output: expanded");
			expect(feedback).toContain("Tool output: collapsed");
			expect(mode.chatContainer.children.filter((child) => child instanceof ThemedText)).toHaveLength(2);
			await mode.handleEvent({
				type: "message_update",
				message: second,
				assistantMessageEvent: { type: "done", reason: "toolUse", message: second },
			});
			await mode.handleEvent({ type: "message_end", message: second });
			await finish(mode, "second");
			await stream(mode, assistant("third"));
			await finish(mode, "third");
			const output = stripAnsi(mode.chatContainer.render(100).join("\n"));
			expect(output).toContain("Tool output: expanded");
			expect(output).toContain("Tool output: collapsed");
			expect(mode.chatContainer.children.filter((child) => child instanceof ThemedText)).toHaveLength(2);
			if (compact) {
				expect(groups(mode)).toEqual([originalGroup]);
				expect(originalGroup.tools.map((tool) => tool.getToolCallId())).toEqual(["first", "second", "third"]);
			} else {
				expect(groups(mode)).toHaveLength(0);
				expect(mode.chatContainer.children.filter((child) => child instanceof ToolExecutionComponent)).toHaveLength(
					3,
				);
			}
		},
	);

	test("late text preserves call order when a custom row has already split streamed calls", async () => {
		const { mode } = createMode();
		await stream(mode, assistant("old"));
		const first = assistant("first");
		await mode.handleEvent({ type: "message_start", message: { ...first, content: [] } });
		await mode.handleEvent({
			type: "message_update",
			message: first,
			assistantMessageEvent: { type: "done", reason: "toolUse", message: first },
		});
		await mode.handleEvent({
			type: "entry_appended",
			entry: {
				type: "custom",
				id: "custom",
				parentId: null,
				timestamp: new Date(0).toISOString(),
				customType: "note",
				data: {},
			},
		});
		const second = assistant("second", first.content);
		await mode.handleEvent({
			type: "message_update",
			message: second,
			assistantMessageEvent: { type: "done", reason: "toolUse", message: second },
		});
		const visible = { ...second, content: [{ type: "text" as const, text: "late text" }, ...second.content] };
		await mode.handleEvent({
			type: "message_update",
			message: visible,
			assistantMessageEvent: { type: "done", reason: "toolUse", message: visible },
		});
		expect(groups(mode).map((group) => group.tools.map((tool) => tool.getToolCallId()))).toEqual([
			["old"],
			["first", "second"],
		]);
	});

	test.each([false, true])(
		"custom entry visibility gives live/replay parity without prose (visible=%s)",
		async (visible) => {
			const { mode, sessionManager } = createMode();
			const { mode: replay } = createMode();
			if (!visible) {
				for (const target of [mode, replay]) {
					Reflect.get(target, "session").extensionRunner.getEntryRenderer = () => () => undefined;
				}
			}
			const first = assistant("a");
			const second = assistant("b");
			await stream(mode, first);
			await mode.handleEvent({ type: "message_start", message: { ...second, content: [] } });
			await mode.handleEvent({
				type: "message_update",
				message: second,
				assistantMessageEvent: { type: "done", reason: "toolUse", message: second },
			});
			const child = mode.pendingTools.get("b");
			expect(groups(mode)).toHaveLength(1);
			sessionManager.appendMessage(first);
			const customId = sessionManager.appendCustomEntry("note", {});
			const entry = sessionManager.getEntry(customId);
			if (!entry || entry.type !== "custom") throw new Error("Missing custom entry fixture");
			await mode.handleEvent({ type: "entry_appended", entry });
			expect(mode.pendingTools.get("b")).toBe(child);
			await mode.handleEvent({ type: "message_end", message: second });
			sessionManager.appendMessage(second);
			replay.renderSessionEntries(sessionManager.getEntries());
			const expected = visible ? [["a"], ["b"]] : [["a", "b"]];
			for (const target of [mode, replay]) {
				expect(groups(target).map((group) => group.tools.map((tool) => tool.getToolCallId()))).toEqual(expected);
			}
			expect(stripAnsi(mode.chatContainer.render(100).join("\n"))).toBe(
				stripAnsi(replay.chatContainer.render(100).join("\n")),
			);
		},
	);

	test.each([false, true])("image-only user boundaries add no rows (compactToolCalls=%s)", async (compact) => {
		const { mode } = createMode(compact);
		await stream(mode, assistant("a"));
		const before = mode.chatContainer.render(100);
		mode.addMessageToChat({
			role: "user",
			content: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
			timestamp: 2,
		});
		expect(mode.chatContainer.render(100)).toEqual(before);
		await stream(mode, assistant("b"));
		mode.setCompactToolCalls(true);
		expect(groups(mode).map((group) => group.tools.map((tool) => tool.getToolCallId()))).toEqual([["a"], ["b"]]);
	});

	test("Alt toggle closes clicked-open groups and opens all groups when their states differ", () => {
		const { mode } = createMode();
		mode.renderSessionItems([assistant("a"), { role: "user", content: "boundary", timestamp: 2 }, assistant("b")]);
		const [first, second] = groups(mode);
		first.setExpanded(true);
		mode.toggleToolGroupExpansion();
		expect([first.expanded, second.expanded]).toEqual([true, true]);
		mode.toggleToolGroupExpansion();
		expect([first.expanded, second.expanded]).toEqual([false, false]);
		first.setExpanded(true);
		second.setExpanded(true);
		mode.toggleToolGroupExpansion();
		expect([first.expanded, second.expanded]).toEqual([false, false]);
	});

	test.each([false, true])(
		"text-only streaming never scans transcript prefixes (compactToolCalls=%s)",
		async (compact) => {
			const { mode } = createMode(compact);
			const prefix = vi.spyOn(mode.chatContainer.children, "slice");
			const message: AssistantMessage = { ...assistant("unused"), content: [], stopReason: "stop" };
			await mode.handleEvent({ type: "message_start", message });
			for (const text of ["one", "one two", "one two three"]) {
				const update = { ...message, content: [{ type: "text" as const, text }] };
				await mode.handleEvent({
					type: "message_update",
					message: update,
					assistantMessageEvent: { type: "done", reason: "stop", message: update },
				});
			}
			await mode.handleEvent({ type: "message_end", message });
			expect(prefix).not.toHaveBeenCalled();
		},
	);

	test("standard streaming does not invoke group relocation", async () => {
		const { mode } = createMode(false);
		const relocation = vi.spyOn(mode, "prepareStreamingToolGroup");
		await stream(mode, assistant("a", [{ type: "text", text: "visible commentary" }]));
		expect(relocation).not.toHaveBeenCalled();
	});

	test("later text deltas do not rescan transcript prefixes after relocation", async () => {
		const { mode } = createMode();
		await stream(mode, assistant("old"));
		const message = assistant("new");
		await mode.handleEvent({ type: "message_start", message: { ...message, content: [] } });
		await mode.handleEvent({
			type: "message_update",
			message,
			assistantMessageEvent: { type: "done", reason: "toolUse", message },
		});
		const visible = assistant("new", [{ type: "text", text: "late prose" }]);
		await mode.handleEvent({
			type: "message_update",
			message: visible,
			assistantMessageEvent: { type: "done", reason: "toolUse", message: visible },
		});
		expect(groups(mode).map((group) => group.tools.length)).toEqual([1, 1]);
		mode.showStatus("output feedback");
		const prefix = vi.spyOn(mode.chatContainer.children, "slice");
		const position = vi.spyOn(mode.chatContainer.children, "indexOf");
		for (const text of ["late prose grows", "late prose grows again"]) {
			const update = assistant("new", [{ type: "text", text }]);
			await mode.handleEvent({
				type: "message_update",
				message: update,
				assistantMessageEvent: { type: "done", reason: "toolUse", message: update },
			});
		}
		await mode.handleEvent({ type: "message_end", message: visible });
		expect(prefix).not.toHaveBeenCalled();
		expect(position).not.toHaveBeenCalled();
		expect(groups(mode).map((group) => group.tools.map((tool) => tool.getToolCallId()))).toEqual([["old"], ["new"]]);
	});

	test("standard mode leaves individual tool rows and their output behavior unchanged", async () => {
		const { mode } = createMode(false);
		await stream(mode, assistant("a"));
		await finish(mode, "a");
		await stream(mode, assistant("b"));
		expect(groups(mode)).toHaveLength(0);
		expect(mode.chatContainer.children.filter((child) => child instanceof ToolExecutionComponent)).toHaveLength(2);
		mode.setToolsExpanded(true);
		expect(stripAnsi(mode.chatContainer.render(100).join("\n"))).toContain("output a");
	});
});
