import type { MockInstance } from "vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentSessionEvent } from "../src/core/agent-session.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";
import { shouldShowProgress } from "../src/modes/print-mode.js";
import { PrintModeProgress } from "../src/modes/print-mode-progress.js";

/** Strip ANSI escape codes for easier assertions */
function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\[\?25[hl]/g, "");
}

/** Create a mock model */
function createMockModel(contextWindow = 200000) {
	return {
		id: "test-model",
		contextWindow,
		reasoning: false,
	} as any;
}

/** Create a mock assistant message */
function createMockAssistantMessage(overrides: Record<string, any> = {}): any {
	return {
		role: "assistant" as const,
		content: [],
		usage: {
			input: 1000,
			output: 500,
			cacheRead: 2000,
			cacheWrite: 100,
			cost: { total: 0.05 },
		},
		...overrides,
	};
}

describe("PrintModeProgress", () => {
	let stderrOutput: string;
	let stderrSpy: MockInstance;
	let progress: PrintModeProgress;

	beforeAll(() => {
		// Initialize theme (required by PrintModeProgress)
		initTheme("dark");
	});

	beforeEach(() => {
		stderrOutput = "";
		stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
			stderrOutput += chunk;
			return true;
		});
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
		progress = new PrintModeProgress();
	});

	afterEach(() => {
		progress.stop();
		stderrSpy.mockRestore();
		vi.useRealTimers();
	});

	describe("placeholder stats", () => {
		test("shows placeholder stats (---) before first message_end", () => {
			progress.start(createMockModel(), "off");

			const output = stripAnsi(stderrOutput);
			expect(output).toContain("↑---");
			expect(output).toContain("↓---");
			expect(output).toContain("R---");
			expect(output).toContain("W---");
			expect(output).toContain("$---");
		});

		test("shows placeholder for context percentage before first message_end", () => {
			progress.start(createMockModel(200000), "off");

			const output = stripAnsi(stderrOutput);
			expect(output).toContain("---/200k");
		});

		test("shows actual stats after message_end event", () => {
			progress.start(createMockModel(), "off");
			stderrOutput = ""; // Clear initial render

			const event = {
				type: "message_end",
				message: createMockAssistantMessage(),
			};
			progress.handleEvent(event as AgentSessionEvent);

			const output = stripAnsi(stderrOutput);
			// Token counts are formatted (e.g., 1000 -> "1.0k", 2000 -> "2.0k")
			expect(output).toContain("↑1.0k");
			expect(output).toContain("↓500");
			expect(output).toContain("R2.0k");
			expect(output).toContain("W100");
			expect(output).toContain("$0.050");
		});
	});

	describe("context percentage", () => {
		test("calculates context percentage from last message", () => {
			const model = createMockModel(100000); // 100k context
			progress.start(model, "off");
			stderrOutput = "";

			// Message uses 10k tokens total (10% of context)
			const event = {
				type: "message_end",
				message: createMockAssistantMessage({
					usage: {
						input: 5000,
						output: 2000,
						cacheRead: 2500,
						cacheWrite: 500,
						cost: { total: 0.01 },
					},
				}),
			};
			progress.handleEvent(event as AgentSessionEvent);

			const output = stripAnsi(stderrOutput);
			expect(output).toContain("10.0%/100k");
		});

		test("does not show context percentage when context window is 0", () => {
			progress.start(createMockModel(0), "off");

			const output = stripAnsi(stderrOutput);
			expect(output).not.toContain("%/");
		});
	});

	describe("activity display", () => {
		test("shows 'Starting...' initially", () => {
			progress.start(createMockModel(), "off");

			const output = stripAnsi(stderrOutput);
			expect(output).toContain("Starting...");
		});

		test("shows 'Working...' on message_start", () => {
			progress.start(createMockModel(), "off");
			stderrOutput = "";

			const event = {
				type: "message_start",
				message: { role: "assistant", content: [] } as any,
			};
			progress.handleEvent(event as AgentSessionEvent);

			const output = stripAnsi(stderrOutput);
			expect(output).toContain("Working...");
		});

		test("shows tool name for tool calls", () => {
			progress.start(createMockModel(), "off");
			stderrOutput = "";

			const event = {
				type: "message_update",
				message: createMockAssistantMessage({
					content: [
						{
							type: "toolCall",
							name: "bash",
							arguments: { command: "npm run check" },
						},
					],
				}),
			};
			progress.handleEvent(event as AgentSessionEvent);

			const output = stripAnsi(stderrOutput);
			expect(output).toContain("[bash]");
			expect(output).toContain("npm run check");
		});

		test("shows [thinking] for thinking content", () => {
			progress.start(createMockModel(), "off");
			stderrOutput = "";

			const event = {
				type: "message_update",
				message: createMockAssistantMessage({
					content: [
						{
							type: "thinking",
							thinking: "Let me analyze this problem...",
						},
					],
				}),
			};
			progress.handleEvent(event as AgentSessionEvent);

			const output = stripAnsi(stderrOutput);
			expect(output).toContain("[thinking]");
			expect(output).toContain("Let me analyze this problem...");
		});

		test("shows text content preview", () => {
			progress.start(createMockModel(), "off");
			stderrOutput = "";

			const event = {
				type: "message_update",
				message: createMockAssistantMessage({
					content: [
						{
							type: "text",
							text: "Here is my response to your question",
						},
					],
				}),
			};
			progress.handleEvent(event as AgentSessionEvent);

			const output = stripAnsi(stderrOutput);
			expect(output).toContain("Here is my response to your question");
		});

		test("shows 'Compacting context...' on auto_compaction_start", () => {
			progress.start(createMockModel(), "off");
			stderrOutput = "";

			const event = {
				type: "auto_compaction_start",
			} as any;
			progress.handleEvent(event as AgentSessionEvent);

			const output = stripAnsi(stderrOutput);
			expect(output).toContain("Compacting context...");
		});

		test("shows retry message on auto_retry_start", () => {
			progress.start(createMockModel(), "off");
			stderrOutput = "";

			const event = {
				type: "auto_retry_start",
				attempt: 2,
				maxAttempts: 3,
			} as any;
			progress.handleEvent(event as AgentSessionEvent);

			const output = stripAnsi(stderrOutput);
			expect(output).toContain("Retrying (2/3)...");
		});
	});

	describe("model display", () => {
		test("shows model ID", () => {
			progress.start(createMockModel(), "off");

			const output = stripAnsi(stderrOutput);
			expect(output).toContain("test-model");
		});

		test("shows thinking level when model supports reasoning", () => {
			const model = {
				id: "reasoning-model",
				contextWindow: 200000,
				reasoning: true,
			} as any;
			progress.start(model, "high");

			const output = stripAnsi(stderrOutput);
			expect(output).toContain("reasoning-model:high");
		});

		test("does not show thinking level when off", () => {
			const model = {
				id: "reasoning-model",
				contextWindow: 200000,
				reasoning: true,
			} as any;
			progress.start(model, "off");

			const output = stripAnsi(stderrOutput);
			expect(output).toContain("reasoning-model");
			expect(output).not.toContain("reasoning-model:");
		});
	});

	describe("elapsed time", () => {
		test("shows elapsed seconds", () => {
			progress.start(createMockModel(), "off");
			stderrOutput = "";

			vi.advanceTimersByTime(5080); // 5 seconds + one spinner frame

			const output = stripAnsi(stderrOutput);
			expect(output).toMatch(/[45]s/); // May show 4s or 5s depending on timing
		});

		test("shows minutes and seconds for longer durations", () => {
			progress.start(createMockModel(), "off");
			stderrOutput = "";

			vi.advanceTimersByTime(125080); // 2 minutes 5 seconds + one spinner frame

			const output = stripAnsi(stderrOutput);
			expect(output).toMatch(/2m [45]s/); // May show 2m 4s or 2m 5s
		});
	});

	describe("cumulative stats", () => {
		test("accumulates stats across multiple messages", () => {
			progress.start(createMockModel(), "off");

			// First message
			progress.handleEvent({
				type: "message_end",
				message: createMockAssistantMessage({
					usage: {
						input: 100,
						output: 50,
						cacheRead: 0,
						cacheWrite: 0,
						cost: { total: 0.01 },
					},
				}),
			});

			// Second message
			progress.handleEvent({
				type: "message_end",
				message: createMockAssistantMessage({
					usage: {
						input: 200,
						output: 100,
						cacheRead: 0,
						cacheWrite: 0,
						cost: { total: 0.02 },
					},
				}),
			});

			stderrOutput = "";
			vi.advanceTimersByTime(80); // Trigger re-render

			const output = stripAnsi(stderrOutput);
			expect(output).toContain("↑300"); // 100 + 200
			expect(output).toContain("↓150"); // 50 + 100
			expect(output).toContain("$0.030"); // 0.01 + 0.02
		});
	});

	describe("tool formatting", () => {
		test("formats read tool with path", () => {
			progress.start(createMockModel(), "off");
			stderrOutput = "";

			progress.handleEvent({
				type: "message_update",
				message: createMockAssistantMessage({
					content: [
						{
							type: "toolCall",
							name: "read",
							arguments: { path: "/home/user/file.ts" },
						},
					],
				}),
			} as AgentSessionEvent);

			const output = stripAnsi(stderrOutput);
			expect(output).toContain("[read]");
		});

		test("formats grep tool with pattern and path", () => {
			progress.start(createMockModel(), "off");
			stderrOutput = "";

			progress.handleEvent({
				type: "message_update",
				message: createMockAssistantMessage({
					content: [
						{
							type: "toolCall",
							name: "grep",
							arguments: { pattern: "TODO", path: "./src" },
						},
					],
				}),
			} as AgentSessionEvent);

			const output = stripAnsi(stderrOutput);
			expect(output).toContain("[grep]");
			expect(output).toContain("/TODO/");
			expect(output).toContain("./src");
		});

		test("shows full bash command (truncation happens at render based on terminal width)", () => {
			progress.start(createMockModel(), "off");
			stderrOutput = "";

			const longCommand = "npm run build && npm run test && npm run lint && npm run format";
			progress.handleEvent({
				type: "message_update",
				message: createMockAssistantMessage({
					content: [
						{
							type: "toolCall",
							name: "bash",
							arguments: { command: longCommand },
						},
					],
				}),
			} as AgentSessionEvent);

			const output = stripAnsi(stderrOutput);
			expect(output).toContain("[bash]");
			// Full command is included (truncation at render time based on terminal width)
			expect(output).toContain(longCommand);
		});
	});

	describe("lifecycle", () => {
		test("does not render after stop()", () => {
			progress.start(createMockModel(), "off");
			progress.stop();
			stderrOutput = "";

			progress.handleEvent({
				type: "message_start",
				message: { role: "assistant", content: [] } as any,
			});

			// Should not have rendered anything after stop
			// (only the clear sequence from stop itself)
			expect(stripAnsi(stderrOutput)).toBe("");
		});

		test("clears lines on stop()", () => {
			progress.start(createMockModel(), "off");
			stderrOutput = "";

			progress.stop();

			// Should contain cursor movement/clear sequences
			expect(stderrOutput).toContain("\x1b[");
		});
	});
});

describe("shouldShowProgress", () => {
	test("returns true for text mode on TTY without quiet", () => {
		expect(shouldShowProgress("text", true, false)).toBe(true);
		expect(shouldShowProgress("text", true, undefined)).toBe(true);
	});

	test("returns false for json mode", () => {
		expect(shouldShowProgress("json", true, false)).toBe(false);
		expect(shouldShowProgress("json", true, undefined)).toBe(false);
	});

	test("returns false when not a TTY", () => {
		expect(shouldShowProgress("text", false, false)).toBe(false);
		expect(shouldShowProgress("text", false, undefined)).toBe(false);
	});

	test("returns false when quiet flag is set", () => {
		expect(shouldShowProgress("text", true, true)).toBe(false);
	});

	test("returns false when multiple conditions fail", () => {
		// json mode + non-TTY
		expect(shouldShowProgress("json", false, false)).toBe(false);
		// json mode + quiet
		expect(shouldShowProgress("json", true, true)).toBe(false);
		// non-TTY + quiet
		expect(shouldShowProgress("text", false, true)).toBe(false);
		// all conditions fail
		expect(shouldShowProgress("json", false, true)).toBe(false);
	});
});
