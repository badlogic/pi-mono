/**
 * Tests for AgentSession queue editing functionality.
 *
 * These tests verify:
 * - Queued messages have unique timestamps
 * - Queue update and remove operations work correctly
 * - Race condition handling when messages are consumed
 * - clearQueue returns texts and clears the queue
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.js";
import { AuthStorage } from "../src/core/auth-storage.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { codingTools } from "../src/core/tools/index.js";

describe("AgentSession queue editing", () => {
	let session: AgentSession;
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-queue-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (session) {
			session.dispose();
		}
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	function createSession(): AgentSession {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: "Test assistant.",
				tools: codingTools,
			},
		});

		const sessionManager = SessionManager.inMemory();
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = new AuthStorage(join(tempDir, "auth.json"));
		const modelRegistry = new ModelRegistry(authStorage, tempDir);

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			modelRegistry,
		});

		session.subscribe(() => {});
		return session;
	}

	describe("queueMessage with timestamps", () => {
		it("assigns unique timestamps to queued messages", async () => {
			createSession();

			await session.queueMessage("first");
			await session.queueMessage("second");

			const queued = session.getQueuedUserMessages();
			expect(queued.length).toBe(2);
			expect(queued[0].timestamp).toBeDefined();
			expect(queued[1].timestamp).toBeDefined();
			expect(queued[0].timestamp).not.toBe(queued[1].timestamp);
		});

		it("ensures monotonic timestamps even in same millisecond", async () => {
			createSession();

			// Queue multiple messages in rapid succession
			await Promise.all([session.queueMessage("a"), session.queueMessage("b"), session.queueMessage("c")]);

			const queued = session.getQueuedUserMessages();
			const timestamps = queued.map((q) => q.timestamp);
			const uniqueTimestamps = new Set(timestamps);
			expect(uniqueTimestamps.size).toBe(3);

			// Timestamps should be strictly increasing
			expect(timestamps[0]).toBeLessThan(timestamps[1]);
			expect(timestamps[1]).toBeLessThan(timestamps[2]);
		});

		it("preserves text content in queued messages", async () => {
			createSession();

			await session.queueMessage("hello world");
			await session.queueMessage("goodbye world");

			const queued = session.getQueuedUserMessages();
			expect(queued[0].text).toBe("hello world");
			expect(queued[1].text).toBe("goodbye world");
		});
	});

	describe("updateQueuedUserMessage", () => {
		it("updates text and preserves timestamp", async () => {
			createSession();

			await session.queueMessage("original");
			const before = session.getQueuedUserMessages()[0];

			const success = session.updateQueuedUserMessage(0, "edited");
			expect(success).toBe(true);

			const after = session.getQueuedUserMessages()[0];
			expect(after.text).toBe("edited");
			expect(after.timestamp).toBe(before.timestamp);
		});

		it("returns false for out-of-bounds index", () => {
			createSession();

			const success = session.updateQueuedUserMessage(5, "nope");
			expect(success).toBe(false);
		});

		it("returns false for negative index", () => {
			createSession();

			const success = session.updateQueuedUserMessage(-1, "nope");
			expect(success).toBe(false);
		});

		it("updates correct message in queue", async () => {
			createSession();

			await session.queueMessage("first");
			await session.queueMessage("second");
			await session.queueMessage("third");

			session.updateQueuedUserMessage(1, "modified second");

			const queued = session.getQueuedUserMessages();
			expect(queued[0].text).toBe("first");
			expect(queued[1].text).toBe("modified second");
			expect(queued[2].text).toBe("third");
		});
	});

	describe("removeQueuedUserMessage", () => {
		it("removes message at index", async () => {
			createSession();

			await session.queueMessage("first");
			await session.queueMessage("second");

			const success = session.removeQueuedUserMessage(0);
			expect(success).toBe(true);

			const remaining = session.getQueuedUserMessages();
			expect(remaining.length).toBe(1);
			expect(remaining[0].text).toBe("second");
		});

		it("returns false for out-of-bounds index", () => {
			createSession();

			const success = session.removeQueuedUserMessage(5);
			expect(success).toBe(false);
		});

		it("returns false for negative index", () => {
			createSession();

			const success = session.removeQueuedUserMessage(-1);
			expect(success).toBe(false);
		});

		it("removes middle message correctly", async () => {
			createSession();

			await session.queueMessage("first");
			await session.queueMessage("second");
			await session.queueMessage("third");

			session.removeQueuedUserMessage(1);

			const remaining = session.getQueuedUserMessages();
			expect(remaining.length).toBe(2);
			expect(remaining[0].text).toBe("first");
			expect(remaining[1].text).toBe("third");
		});

		it("removes last message correctly", async () => {
			createSession();

			await session.queueMessage("first");
			await session.queueMessage("second");

			session.removeQueuedUserMessage(1);

			const remaining = session.getQueuedUserMessages();
			expect(remaining.length).toBe(1);
			expect(remaining[0].text).toBe("first");
		});
	});

	describe("race condition handling", () => {
		it("update returns false if message already consumed by agent", async () => {
			createSession();

			await session.queueMessage("will be consumed");
			const queued = session.getQueuedUserMessages();
			const timestamp = queued[0].timestamp;

			// Simulate the agent consuming the message directly
			session.agent.removeQueuedUserMessageByTimestamp(timestamp);

			const success = session.updateQueuedUserMessage(0, "too late");
			expect(success).toBe(false);

			// Session queue should also be cleared
			expect(session.getQueuedUserMessages().length).toBe(0);
		});
	});

	describe("clearQueue", () => {
		it("returns texts and clears queue", async () => {
			createSession();

			await session.queueMessage("first");
			await session.queueMessage("second");

			const texts = session.clearQueue();
			expect(texts).toEqual(["first", "second"]);
			expect(session.getQueuedUserMessages().length).toBe(0);
		});

		it("returns empty array when queue is empty", () => {
			createSession();

			const texts = session.clearQueue();
			expect(texts).toEqual([]);
		});
	});

	describe("queuedMessageCount", () => {
		it("returns correct count", async () => {
			createSession();

			expect(session.queuedMessageCount).toBe(0);

			await session.queueMessage("one");
			expect(session.queuedMessageCount).toBe(1);

			await session.queueMessage("two");
			expect(session.queuedMessageCount).toBe(2);

			session.removeQueuedUserMessage(0);
			expect(session.queuedMessageCount).toBe(1);

			session.clearQueue();
			expect(session.queuedMessageCount).toBe(0);
		});
	});
});
