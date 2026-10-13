// INV-1 interactive-mode.ts (#4167): thinking toggles retain unresolved replayed tool identities.
// INV-2 interactive-mode.ts (#4167): historical results never remain pending, in either display mode.
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import { Container } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { AgentSessionEvent } from "../../../src/core/agent-session.ts";
import type { SessionEntry } from "../../../src/core/session-manager.ts";
import type { ToolExecutionComponent } from "../../../src/modes/interactive/components/tool-execution.ts";
import { ToolGroupComponent } from "../../../src/modes/interactive/components/tool-group.ts";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../../src/utils/ansi.ts";
import { createHarness, type Harness } from "../harness.ts";

const TOOL_CALL_ID = "tool-4167";
const TOOL_NAME = "slow_tool";

const EMPTY_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
	},
};

interface TestInteractiveMode {
	pendingTools: Map<string, ToolExecutionComponent>;
	chatContainer: Container;
	renderSessionEntries(entries: SessionEntry[]): void;
	handleEvent(event: AgentSessionEvent): Promise<void>;
	toggleThinkingBlockVisibility(): void;
}

const harnesses: Harness[] = [];

async function createTestInteractiveMode(compactToolCalls: boolean) {
	const harness = await createHarness({
		tools: [],
		settings: { compactToolCalls, terminal: { showImages: false } },
	});
	harnesses.push(harness);
	const mode = Object.assign(Object.create(InteractiveMode.prototype), {
		runtimeHost: { session: harness.session },
		pendingTools: new Map<string, ToolExecutionComponent>(),
		chatContainer: new Container(),
		footer: { invalidate: vi.fn() },
		programStatus: { handleEvent: vi.fn() },
		ui: { requestRender: vi.fn(), terminal: { columns: 120 } },
		toolOutputExpanded: false,
		toolGroupsExpanded: false,
		hideThinkingBlock: false,
		hiddenThinkingLabel: "Thinking...",
		outputPad: 1,
		mermaidMarkdownTransformer: (markdown: string) => markdown,
		isInitialized: true,
	}) as TestInteractiveMode;
	return { mode, harness };
}

function createAssistantToolCallMessage(harness: Harness): AssistantMessage {
	const model = harness.getModel();
	return {
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: TOOL_CALL_ID,
				name: TOOL_NAME,
				arguments: { delayMs: 10_000 },
			},
		],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: EMPTY_USAGE,
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
}

function createToolResultMessage(text: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: TOOL_CALL_ID,
		toolName: TOOL_NAME,
		content: [{ type: "text", text }],
		isError: false,
		timestamp: Date.now(),
	};
}

function createSessionEntries(messages: AgentMessage[]): SessionEntry[] {
	let parentId: string | null = null;
	return messages.map((message, index) => {
		const entry: SessionEntry = {
			type: "message",
			id: `entry-${index}`,
			parentId,
			timestamp: new Date().toISOString(),
			message,
		};
		parentId = entry.id;
		return entry;
	});
}

function renderChat(container: Container): string {
	return stripAnsi(container.render(120).join("\n"));
}

describe("InteractiveMode.renderSessionEntries (#4167)", () => {
	beforeAll(() => initTheme("dark"));
	afterEach(() => {
		for (const harness of harnesses) harness.cleanup();
		harnesses.length = 0;
	});

	test.each([false, true])(
		"keeps replayed tool identity through thinking toggles and live completion (compactToolCalls=%s)",
		async (compact) => {
			const { mode, harness } = await createTestInteractiveMode(compact);
			mode.renderSessionEntries(createSessionEntries([createAssistantToolCallMessage(harness)]));
			const component = mode.pendingTools.get(TOOL_CALL_ID);
			expect(component).toBeDefined();

			mode.toggleThinkingBlockVisibility();
			expect(harness.settingsManager.getHideThinkingBlock()).toBe(true);
			expect(mode.pendingTools.get(TOOL_CALL_ID)).toBe(component);

			await mode.handleEvent({
				type: "tool_execution_end",
				toolCallId: TOOL_CALL_ID,
				toolName: TOOL_NAME,
				result: { content: [{ type: "text", text: "FINAL_RESULT" }], details: undefined },
				isError: false,
			});

			expect(mode.pendingTools.has(TOOL_CALL_ID)).toBe(false);
			for (const child of mode.chatContainer.children) {
				if (child instanceof ToolGroupComponent) {
					expect(child.tools).toContain(component);
					child.setExpanded(true);
				}
			}
			expect(renderChat(mode.chatContainer)).toContain("FINAL_RESULT");
		},
	);

	test.each([false, true])(
		"does not keep completed historical calls pending (compactToolCalls=%s)",
		async (compact) => {
			const { mode, harness } = await createTestInteractiveMode(compact);
			mode.renderSessionEntries(
				createSessionEntries([
					createAssistantToolCallMessage(harness),
					createToolResultMessage("HISTORICAL_RESULT"),
				]),
			);

			expect(mode.pendingTools.size).toBe(0);
			for (const child of mode.chatContainer.children) {
				if (child instanceof ToolGroupComponent) child.setExpanded(true);
			}
			expect(renderChat(mode.chatContainer)).toContain("HISTORICAL_RESULT");
		},
	);
});
