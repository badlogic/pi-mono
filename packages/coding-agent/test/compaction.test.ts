import type { AppMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Usage } from "@mariozechner/pi-ai";
import { getModel } from "@mariozechner/pi-ai";
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
	type CompactionSettings,
	calculateContextTokens,
	compact,
	DEFAULT_COMPACTION_SETTINGS,
	findCutPoint,
	getLastAssistantUsage,
	shouldCompact,
} from "../src/compaction.js";
import {
	type CompactionEntry,
	createSummaryMessage,
	loadSessionFromEntries,
	parseSessionEntries,
	type SessionEntry,
	type SessionMessageEntry,
} from "../src/session-manager.js";

// ============================================================================
// Test fixtures
// ============================================================================

function loadLargeSessionEntries(): SessionEntry[] {
	const sessionPath = join(__dirname, "fixtures/large-session.jsonl");
	const content = readFileSync(sessionPath, "utf-8");
	return parseSessionEntries(content);
}

function createMockUsage(input: number, output: number, cacheRead = 0, cacheWrite = 0): Usage {
	return {
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens: input + output + cacheRead + cacheWrite,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createUserMessage(text: string): AppMessage {
	return { role: "user", content: text, timestamp: Date.now() };
}

function createAssistantMessage(text: string, usage?: Usage): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		usage: usage || createMockUsage(100, 50),
		stopReason: "stop",
		timestamp: Date.now(),
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
	};
}

function createMessageEntry(message: AppMessage): SessionMessageEntry {
	return { type: "message", timestamp: new Date().toISOString(), message };
}

function createCompactionEntry(summary: string, firstKeptEntryIndex: number): CompactionEntry {
	return {
		type: "compaction",
		timestamp: new Date().toISOString(),
		summary,
		firstKeptEntryIndex,
		tokensBefore: 10000,
	};
}

// ============================================================================
// Unit tests
// ============================================================================

describe("Token calculation", () => {
	it("should calculate total context tokens from usage", () => {
		const usage = createMockUsage(1000, 500, 200, 100);
		expect(calculateContextTokens(usage)).toBe(1800);
	});

	it("should handle zero values", () => {
		const usage = createMockUsage(0, 0, 0, 0);
		expect(calculateContextTokens(usage)).toBe(0);
	});
});

describe("getLastAssistantUsage", () => {
	it("should find the last non-aborted assistant message usage", () => {
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("Hello")),
			createMessageEntry(createAssistantMessage("Hi", createMockUsage(100, 50))),
			createMessageEntry(createUserMessage("How are you?")),
			createMessageEntry(createAssistantMessage("Good", createMockUsage(200, 100))),
		];

		const usage = getLastAssistantUsage(entries);
		expect(usage).not.toBeNull();
		expect(usage!.input).toBe(200);
	});

	it("should skip aborted messages", () => {
		const abortedMsg: AssistantMessage = {
			...createAssistantMessage("Aborted", createMockUsage(300, 150)),
			stopReason: "aborted",
		};

		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("Hello")),
			createMessageEntry(createAssistantMessage("Hi", createMockUsage(100, 50))),
			createMessageEntry(createUserMessage("How are you?")),
			createMessageEntry(abortedMsg),
		];

		const usage = getLastAssistantUsage(entries);
		expect(usage).not.toBeNull();
		expect(usage!.input).toBe(100);
	});

	it("should return null if no assistant messages", () => {
		const entries: SessionEntry[] = [createMessageEntry(createUserMessage("Hello"))];
		expect(getLastAssistantUsage(entries)).toBeNull();
	});
});

describe("shouldCompact", () => {
	it("should return true when context exceeds threshold", () => {
		const settings: CompactionSettings = {
			enabled: true,
			reserveTokens: 10000,
			keepRecentTokens: 20000,
		};

		expect(shouldCompact(95000, 100000, settings)).toBe(true);
		expect(shouldCompact(89000, 100000, settings)).toBe(false);
	});

	it("should return false when disabled", () => {
		const settings: CompactionSettings = {
			enabled: false,
			reserveTokens: 10000,
			keepRecentTokens: 20000,
		};

		expect(shouldCompact(95000, 100000, settings)).toBe(false);
	});
});

describe("findCutPoint", () => {
	it("should find cut point based on actual token differences", () => {
		// Create entries with cumulative token counts
		const entries: SessionEntry[] = [];
		for (let i = 0; i < 10; i++) {
			entries.push(createMessageEntry(createUserMessage(`User ${i}`)));
			entries.push(
				createMessageEntry(createAssistantMessage(`Assistant ${i}`, createMockUsage(0, 100, (i + 1) * 1000, 0))),
			);
		}

		// 20 entries, last assistant has 10000 tokens
		// keepRecentTokens = 2500: keep entries where diff < 2500
		const cutPoint = findCutPoint(entries, 0, entries.length, 2500);

		// Should cut at a user message entry
		expect(entries[cutPoint].type).toBe("message");
		expect((entries[cutPoint] as SessionMessageEntry).message.role).toBe("user");
	});

	it("should return startIndex if no user messages in range", () => {
		const entries: SessionEntry[] = [createMessageEntry(createAssistantMessage("a"))];
		expect(findCutPoint(entries, 0, entries.length, 1000)).toBe(0);
	});

	it("should keep everything if all messages fit within budget", () => {
		const entries: SessionEntry[] = [
			createMessageEntry(createUserMessage("1")),
			createMessageEntry(createAssistantMessage("a", createMockUsage(0, 50, 500, 0))),
			createMessageEntry(createUserMessage("2")),
			createMessageEntry(createAssistantMessage("b", createMockUsage(0, 50, 1000, 0))),
		];

		const cutPoint = findCutPoint(entries, 0, entries.length, 50000);
		expect(cutPoint).toBe(0);
	});
});

describe("createSummaryMessage", () => {
	it("should create user message with prefix", () => {
		const msg = createSummaryMessage("This is the summary");
		expect(msg.role).toBe("user");
		if (msg.role === "user") {
			expect(msg.content).toContain(
				"The conversation history before this point was compacted into the following summary:",
			);
			expect(msg.content).toContain("This is the summary");
		}
	});
});

describe("loadSessionFromEntries", () => {
	it("should load all messages when no compaction", () => {
		const entries: SessionEntry[] = [
			{
				type: "session",
				id: "1",
				timestamp: "",
				cwd: "",
				provider: "anthropic",
				modelId: "claude",
				thinkingLevel: "off",
			},
			createMessageEntry(createUserMessage("1")),
			createMessageEntry(createAssistantMessage("a")),
			createMessageEntry(createUserMessage("2")),
			createMessageEntry(createAssistantMessage("b")),
		];

		const loaded = loadSessionFromEntries(entries);
		expect(loaded.messages.length).toBe(4);
		expect(loaded.thinkingLevel).toBe("off");
		expect(loaded.model).toEqual({ provider: "anthropic", modelId: "claude" });
	});

	it("should handle single compaction", () => {
		// indices: 0=session, 1=u1, 2=a1, 3=u2, 4=a2, 5=compaction, 6=u3, 7=a3
		const entries: SessionEntry[] = [
			{
				type: "session",
				id: "1",
				timestamp: "",
				cwd: "",
				provider: "anthropic",
				modelId: "claude",
				thinkingLevel: "off",
			},
			createMessageEntry(createUserMessage("1")),
			createMessageEntry(createAssistantMessage("a")),
			createMessageEntry(createUserMessage("2")),
			createMessageEntry(createAssistantMessage("b")),
			createCompactionEntry("Summary of 1,a,2,b", 3), // keep from index 3 (u2) onwards
			createMessageEntry(createUserMessage("3")),
			createMessageEntry(createAssistantMessage("c")),
		];

		const loaded = loadSessionFromEntries(entries);
		// summary + kept (u2,a2 from idx 3-4) + after (u3,a3 from idx 6-7) = 5
		expect(loaded.messages.length).toBe(5);
		expect(loaded.messages[0].role).toBe("user");
		expect((loaded.messages[0] as any).content).toContain("Summary of 1,a,2,b");
	});

	it("should handle multiple compactions (only latest matters)", () => {
		// indices: 0=session, 1=u1, 2=a1, 3=compact1, 4=u2, 5=b, 6=u3, 7=c, 8=compact2, 9=u4, 10=d
		const entries: SessionEntry[] = [
			{
				type: "session",
				id: "1",
				timestamp: "",
				cwd: "",
				provider: "anthropic",
				modelId: "claude",
				thinkingLevel: "off",
			},
			createMessageEntry(createUserMessage("1")),
			createMessageEntry(createAssistantMessage("a")),
			createCompactionEntry("First summary", 1), // keep from index 1
			createMessageEntry(createUserMessage("2")),
			createMessageEntry(createAssistantMessage("b")),
			createMessageEntry(createUserMessage("3")),
			createMessageEntry(createAssistantMessage("c")),
			createCompactionEntry("Second summary", 6), // keep from index 6 (u3) onwards
			createMessageEntry(createUserMessage("4")),
			createMessageEntry(createAssistantMessage("d")),
		];

		const loaded = loadSessionFromEntries(entries);
		// summary + kept from idx 6 (u3,c) + after (u4,d) = 5
		expect(loaded.messages.length).toBe(5);
		expect((loaded.messages[0] as any).content).toContain("Second summary");
	});

	it("should clamp firstKeptEntryIndex to valid range", () => {
		// indices: 0=session, 1=u1, 2=a1, 3=compact1, 4=u2, 5=b, 6=compact2
		const entries: SessionEntry[] = [
			{
				type: "session",
				id: "1",
				timestamp: "",
				cwd: "",
				provider: "anthropic",
				modelId: "claude",
				thinkingLevel: "off",
			},
			createMessageEntry(createUserMessage("1")),
			createMessageEntry(createAssistantMessage("a")),
			createCompactionEntry("First summary", 1),
			createMessageEntry(createUserMessage("2")),
			createMessageEntry(createAssistantMessage("b")),
			createCompactionEntry("Second summary", 0), // index 0 is before compaction1, should still work
		];

		const loaded = loadSessionFromEntries(entries);
		// Keeps from index 0, but compaction entries are skipped, so u1,a1,u2,b = 4 + summary = 5
		// Actually index 0 is session header, so messages are u1,a1,u2,b
		expect(loaded.messages.length).toBe(5); // summary + 4 messages
	});

	it("should track model and thinking level changes", () => {
		const entries: SessionEntry[] = [
			{
				type: "session",
				id: "1",
				timestamp: "",
				cwd: "",
				provider: "anthropic",
				modelId: "claude",
				thinkingLevel: "off",
			},
			createMessageEntry(createUserMessage("1")),
			{ type: "model_change", timestamp: "", provider: "openai", modelId: "gpt-4" },
			createMessageEntry(createAssistantMessage("a")),
			{ type: "thinking_level_change", timestamp: "", thinkingLevel: "high" },
		];

		const loaded = loadSessionFromEntries(entries);
		expect(loaded.model).toEqual({ provider: "openai", modelId: "gpt-4" });
		expect(loaded.thinkingLevel).toBe("high");
	});
});

// ============================================================================
// Integration tests with real session data
// ============================================================================

describe("Large session fixture", () => {
	it("should parse the large session", () => {
		const entries = loadLargeSessionEntries();
		expect(entries.length).toBeGreaterThan(100);

		const messageCount = entries.filter((e) => e.type === "message").length;
		expect(messageCount).toBeGreaterThan(100);
	});

	it("should find cut point in large session", () => {
		const entries = loadLargeSessionEntries();
		const cutPoint = findCutPoint(entries, 0, entries.length, DEFAULT_COMPACTION_SETTINGS.keepRecentTokens);

		// Cut point should be at a message entry with user role
		expect(entries[cutPoint].type).toBe("message");
		expect((entries[cutPoint] as SessionMessageEntry).message.role).toBe("user");
	});

	it("should load session correctly", () => {
		const entries = loadLargeSessionEntries();
		const loaded = loadSessionFromEntries(entries);

		expect(loaded.messages.length).toBeGreaterThan(100);
		expect(loaded.model).not.toBeNull();
	});
});

// ============================================================================
// LLM integration tests (skipped without API key)
// ============================================================================

describe.skipIf(!process.env.ANTHROPIC_OAUTH_TOKEN)("LLM summarization", () => {
	it("should generate a compaction event for the large session", async () => {
		const entries = loadLargeSessionEntries();
		const model = getModel("anthropic", "claude-sonnet-4-5")!;

		const compactionEvent = await compact(
			entries,
			model,
			DEFAULT_COMPACTION_SETTINGS,
			process.env.ANTHROPIC_OAUTH_TOKEN!,
		);

		expect(compactionEvent.type).toBe("compaction");
		expect(compactionEvent.summary.length).toBeGreaterThan(100);
		expect(compactionEvent.firstKeptEntryIndex).toBeGreaterThan(0);
		expect(compactionEvent.tokensBefore).toBeGreaterThan(0);

		console.log("Summary length:", compactionEvent.summary.length);
		console.log("First kept entry index:", compactionEvent.firstKeptEntryIndex);
		console.log("Tokens before:", compactionEvent.tokensBefore);
		console.log("\n--- SUMMARY ---\n");
		console.log(compactionEvent.summary);
	}, 60000);

	it("should produce valid session after compaction", async () => {
		const entries = loadLargeSessionEntries();
		const loaded = loadSessionFromEntries(entries);
		const model = getModel("anthropic", "claude-sonnet-4-5")!;

		const compactionEvent = await compact(
			entries,
			model,
			DEFAULT_COMPACTION_SETTINGS,
			process.env.ANTHROPIC_OAUTH_TOKEN!,
		);

		// Simulate appending compaction to entries
		const newEntries = [...entries, compactionEvent];
		const reloaded = loadSessionFromEntries(newEntries);

		// Should have summary + kept messages
		expect(reloaded.messages.length).toBeLessThan(loaded.messages.length);
		expect(reloaded.messages[0].role).toBe("user");
		expect((reloaded.messages[0] as any).content).toContain(compactionEvent.summary);

		console.log("Original messages:", loaded.messages.length);
		console.log("After compaction:", reloaded.messages.length);
	}, 60000);
});
