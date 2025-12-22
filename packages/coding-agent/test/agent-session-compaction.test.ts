/**
 * E2E tests for AgentSession compaction behavior.
 *
 * These tests use real LLM calls (no mocking) to verify:
 * - Manual compaction works correctly
 * - Session persistence during compaction
 * - Compaction entry is saved to session file
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, ProviderTransport } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession, type AgentSessionEvent } from "../src/core/agent-session.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { codingTools } from "../src/core/tools/index.js";

const API_KEY = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN;

describe.skipIf(!API_KEY)("AgentSession compaction e2e", () => {
	let session: AgentSession;
	let tempDir: string;
	let sessionManager: SessionManager;
	let events: AgentSessionEvent[];

	beforeEach(() => {
		// Create temp directory for session files
		tempDir = join(tmpdir(), `pi-compaction-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });

		// Track events
		events = [];
	});

	afterEach(async () => {
		if (session) {
			session.dispose();
		}
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	function createSession() {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;

		const transport = new ProviderTransport({
			getApiKey: () => API_KEY,
		});

		const agent = new Agent({
			transport,
			initialState: {
				model,
				systemPrompt: "You are a helpful assistant. Be concise.",
				tools: codingTools,
			},
		});

		sessionManager = SessionManager.create(tempDir);
		const settingsManager = new SettingsManager(tempDir);

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
		});

		// Subscribe to track events
		session.subscribe((event) => {
			events.push(event);
		});

		return session;
	}

	it("should trigger manual compaction via compact()", async () => {
		createSession();

		// Send a few prompts to build up history
		await session.prompt("What is 2+2? Reply with just the number.");
		await session.agent.waitForIdle();

		await session.prompt("What is 3+3? Reply with just the number.");
		await session.agent.waitForIdle();

		// Manually compact
		const result = await session.compact();

		expect(result.summary).toBeDefined();
		expect(result.summary.length).toBeGreaterThan(0);
		expect(result.tokensBefore).toBeGreaterThan(0);

		// Verify messages were compacted (should have summary + recent)
		const messages = session.messages;
		expect(messages.length).toBeGreaterThan(0);

		// First message should be the summary (a user message with summary content)
		const firstMsg = messages[0];
		expect(firstMsg.role).toBe("user");
	}, 120000);

	it("should maintain valid session state after compaction", async () => {
		createSession();

		// Build up history
		await session.prompt("What is the capital of France? One word answer.");
		await session.agent.waitForIdle();

		await session.prompt("What is the capital of Germany? One word answer.");
		await session.agent.waitForIdle();

		// Compact
		await session.compact();

		// Session should still be usable
		await session.prompt("What is the capital of Italy? One word answer.");
		await session.agent.waitForIdle();

		// Should have messages after compaction
		expect(session.messages.length).toBeGreaterThan(0);

		// The agent should have responded
		const assistantMessages = session.messages.filter((m) => m.role === "assistant");
		expect(assistantMessages.length).toBeGreaterThan(0);
	}, 180000);

	it("should persist compaction to session file", async () => {
		createSession();

		await session.prompt("Say hello");
		await session.agent.waitForIdle();

		await session.prompt("Say goodbye");
		await session.agent.waitForIdle();

		// Compact
		await session.compact();

		// Load entries from session manager
		const entries = sessionManager.loadEntries();

		// Should have a compaction entry
		const compactionEntries = entries.filter((e) => e.type === "compaction");
		expect(compactionEntries.length).toBe(1);

		const compaction = compactionEntries[0];
		expect(compaction.type).toBe("compaction");
		if (compaction.type === "compaction") {
			expect(compaction.summary.length).toBeGreaterThan(0);
			// firstKeptEntryIndex can be 0 if all messages fit within keepRecentTokens
			// (which is the case for small conversations)
			expect(compaction.firstKeptEntryIndex).toBeGreaterThanOrEqual(0);
			expect(compaction.tokensBefore).toBeGreaterThan(0);
		}
	}, 120000);

	it("should work with --no-session mode (in-memory only)", async () => {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;

		const transport = new ProviderTransport({
			getApiKey: () => API_KEY,
		});

		const agent = new Agent({
			transport,
			initialState: {
				model,
				systemPrompt: "You are a helpful assistant. Be concise.",
				tools: codingTools,
			},
		});

		// Create in-memory session manager
		const noSessionManager = SessionManager.inMemory();

		const settingsManager = new SettingsManager(tempDir);

		const noSessionSession = new AgentSession({
			agent,
			sessionManager: noSessionManager,
			settingsManager,
		});

		try {
			// Send prompts
			await noSessionSession.prompt("What is 2+2? Reply with just the number.");
			await noSessionSession.agent.waitForIdle();

			await noSessionSession.prompt("What is 3+3? Reply with just the number.");
			await noSessionSession.agent.waitForIdle();

			// Compact should work even without file persistence
			const result = await noSessionSession.compact();

			expect(result.summary).toBeDefined();
			expect(result.summary.length).toBeGreaterThan(0);

			// In-memory entries should have the compaction
			const entries = noSessionManager.loadEntries();
			const compactionEntries = entries.filter((e) => e.type === "compaction");
			expect(compactionEntries.length).toBe(1);
		} finally {
			noSessionSession.dispose();
		}
	}, 120000);

	it("should emit correct events during auto-compaction", async () => {
		createSession();

		// Build some history
		await session.prompt("Say hello");
		await session.agent.waitForIdle();

		// Manually trigger compaction and check events
		await session.compact();

		// Check that no auto_compaction events were emitted for manual compaction
		const autoCompactionEvents = events.filter(
			(e) => e.type === "auto_compaction_start" || e.type === "auto_compaction_end",
		);
		// Manual compaction doesn't emit auto_compaction events
		expect(autoCompactionEvents.length).toBe(0);

		// Regular events should have been emitted
		const messageEndEvents = events.filter((e) => e.type === "message_end");
		expect(messageEndEvents.length).toBeGreaterThan(0);
	}, 120000);
});
