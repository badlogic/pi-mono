/**
 * Session Persistence System Tests
 */

import { existsSync, rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	addEvent,
	completeSession,
	failSession,
	getActiveSessions,
	getCompletedSessions,
	getFailedSessions,
	getPausedSessions,
	getSessionContext,
	getSessionDuration,
	getSessionProgress,
	incrementIteration,
	isSessionResumable,
	pauseSession,
	recordLearning,
	recordToolCall,
	resumeSession,
	startSession,
} from "./manager.js";
import {
	cleanupOldSessions,
	createSession,
	deleteSession,
	getSession,
	getSessionStats,
	listSessions,
	updateSession,
} from "./store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_SESSIONS_DIR = join(__dirname, "..", "sessions");

// Cleanup test sessions before and after
beforeEach(() => {
	if (existsSync(TEST_SESSIONS_DIR)) {
		rmSync(TEST_SESSIONS_DIR, { recursive: true, force: true });
	}
});

afterEach(() => {
	if (existsSync(TEST_SESSIONS_DIR)) {
		rmSync(TEST_SESSIONS_DIR, { recursive: true, force: true });
	}
});

describe("Session Store", () => {
	describe("createSession", () => {
		it("should create a new session with default values", () => {
			const session = createSession({
				task: "Test task",
				mode: "developer",
			});

			expect(session).toBeDefined();
			expect(session.id).toMatch(/^session_/);
			expect(session.task).toBe("Test task");
			expect(session.mode).toBe("developer");
			expect(session.status).toBe("active");
			expect(session.iterations).toBe(0);
			expect(session.maxIterations).toBe(100);
			expect(session.history).toHaveLength(1);
			expect(session.history[0].type).toBe("start");
		});

		it("should create session with custom options", () => {
			const session = createSession({
				task: "Custom task",
				mode: "code_review",
				userId: "user123",
				channelId: "channel456",
				workspace: "/test/workspace",
				maxIterations: 50,
				context: { customField: "value" },
			});

			expect(session.userId).toBe("user123");
			expect(session.channelId).toBe("channel456");
			expect(session.workspace).toBe("/test/workspace");
			expect(session.maxIterations).toBe(50);
			expect(session.context.customField).toBe("value");
		});

		it("should persist session to filesystem", () => {
			const session = createSession({
				task: "Persistence test",
				mode: "developer",
			});

			const loaded = getSession(session.id);
			expect(loaded).toBeDefined();
			expect(loaded?.id).toBe(session.id);
			expect(loaded?.task).toBe("Persistence test");
		});
	});

	describe("getSession", () => {
		it("should return null for non-existent session", () => {
			const session = getSession("nonexistent");
			expect(session).toBeNull();
		});

		it("should load existing session", () => {
			const created = createSession({
				task: "Load test",
				mode: "developer",
			});

			const loaded = getSession(created.id);
			expect(loaded).toBeDefined();
			expect(loaded?.id).toBe(created.id);
		});
	});

	describe("updateSession", () => {
		it("should update session status", () => {
			const session = createSession({
				task: "Update test",
				mode: "developer",
			});

			const updated = updateSession(session.id, { status: "paused" });
			expect(updated?.status).toBe("paused");
		});

		it("should update session context", () => {
			const session = createSession({
				task: "Context test",
				mode: "developer",
				context: { initial: "value" },
			});

			const updated = updateSession(session.id, {
				context: { additional: "data" },
			});

			expect(updated?.context.initial).toBe("value");
			expect(updated?.context.additional).toBe("data");
		});

		it("should update iterations", () => {
			const session = createSession({
				task: "Iteration test",
				mode: "developer",
			});

			const updated = updateSession(session.id, { iterations: 5 });
			expect(updated?.iterations).toBe(5);
		});

		it("should return null for non-existent session", () => {
			const result = updateSession("nonexistent", { status: "paused" });
			expect(result).toBeNull();
		});
	});

	describe("listSessions", () => {
		it("should list all sessions", () => {
			createSession({ task: "Task 1", mode: "developer" });
			createSession({ task: "Task 2", mode: "code_review" });
			createSession({ task: "Task 3", mode: "test_generation" });

			const sessions = listSessions();
			expect(sessions).toHaveLength(3);
		});

		it("should filter by userId", () => {
			createSession({ task: "Task 1", mode: "developer", userId: "user1" });
			createSession({ task: "Task 2", mode: "developer", userId: "user2" });
			createSession({ task: "Task 3", mode: "developer", userId: "user1" });

			const sessions = listSessions({ userId: "user1" });
			expect(sessions).toHaveLength(2);
		});

		it("should filter by mode", () => {
			createSession({ task: "Task 1", mode: "developer" });
			createSession({ task: "Task 2", mode: "code_review" });
			createSession({ task: "Task 3", mode: "developer" });

			const sessions = listSessions({ mode: "developer" });
			expect(sessions).toHaveLength(2);
		});

		it("should filter by status", () => {
			const s1 = createSession({ task: "Task 1", mode: "developer" });
			const s2 = createSession({ task: "Task 2", mode: "developer" });
			const s3 = createSession({ task: "Task 3", mode: "developer" });

			updateSession(s2.id, { status: "paused" });
			updateSession(s3.id, { status: "completed" });

			const active = listSessions({ status: "active" });
			expect(active).toHaveLength(1);

			const paused = listSessions({ status: "paused" });
			expect(paused).toHaveLength(1);
		});

		it("should apply pagination", () => {
			for (let i = 0; i < 10; i++) {
				createSession({ task: `Task ${i}`, mode: "developer" });
			}

			const page1 = listSessions({ limit: 5, offset: 0 });
			expect(page1).toHaveLength(5);

			const page2 = listSessions({ limit: 5, offset: 5 });
			expect(page2).toHaveLength(5);
		});
	});

	describe("deleteSession", () => {
		it("should delete existing session", () => {
			const session = createSession({
				task: "Delete test",
				mode: "developer",
			});

			const deleted = deleteSession(session.id);
			expect(deleted).toBe(true);

			const loaded = getSession(session.id);
			expect(loaded).toBeNull();
		});

		it("should return false for non-existent session", () => {
			const result = deleteSession("nonexistent");
			expect(result).toBe(false);
		});
	});

	describe("cleanupOldSessions", () => {
		it("should not delete active sessions", () => {
			createSession({ task: "Active", mode: "developer" });

			const cleaned = cleanupOldSessions(0);
			expect(cleaned).toBe(0);

			const sessions = listSessions();
			expect(sessions).toHaveLength(1);
		});

		it("should delete old completed sessions", async () => {
			const session = createSession({ task: "Old", mode: "developer" });
			updateSession(session.id, { status: "completed" });

			// Wait a bit to ensure time passes
			await new Promise((resolve) => setTimeout(resolve, 100));

			const cleaned = cleanupOldSessions(0.00001); // Very short max age
			expect(cleaned).toBe(1);

			const sessions = listSessions();
			expect(sessions).toHaveLength(0);
		});
	});

	describe("getSessionStats", () => {
		it("should calculate statistics", () => {
			createSession({ task: "Task 1", mode: "developer" });
			const s2 = createSession({ task: "Task 2", mode: "code_review" });
			const s3 = createSession({ task: "Task 3", mode: "developer" });

			updateSession(s2.id, { status: "paused" });
			updateSession(s3.id, { status: "completed", iterations: 10 });

			const stats = getSessionStats();

			expect(stats.total).toBe(3);
			expect(stats.byStatus.active).toBe(1);
			expect(stats.byStatus.paused).toBe(1);
			expect(stats.byStatus.completed).toBe(1);
			expect(stats.byMode.developer).toBe(2);
			expect(stats.byMode.code_review).toBe(1);
		});
	});
});

describe("Session Manager", () => {
	describe("startSession", () => {
		it("should start a new session", async () => {
			const session = await startSession("Test task", "developer");

			expect(session).toBeDefined();
			expect(session.status).toBe("active");
			expect(session.task).toBe("Test task");
			expect(session.mode).toBe("developer");
		});

		it("should add start event", async () => {
			const session = await startSession("Test", "developer");
			expect(session.history).toHaveLength(1);
			expect(session.history[0].type).toBe("start");
		});
	});

	describe("pauseSession", () => {
		it("should pause active session", async () => {
			const session = await startSession("Test", "developer");
			const paused = await pauseSession(session.id, "Test pause");

			expect(paused?.status).toBe("paused");
			expect(paused?.context.pauseReason).toBe("Test pause");
		});

		it("should add pause event", async () => {
			const session = await startSession("Test", "developer");
			const paused = await pauseSession(session.id);

			const loaded = getSession(session.id);
			expect(loaded?.history.some((e) => e.type === "pause")).toBe(true);
		});

		it("should throw error if session not active", async () => {
			const session = await startSession("Test", "developer");
			await pauseSession(session.id);

			await expect(pauseSession(session.id)).rejects.toThrow();
		});
	});

	describe("resumeSession", () => {
		it("should resume paused session", async () => {
			const session = await startSession("Test", "developer");
			await pauseSession(session.id);
			const resumed = await resumeSession(session.id);

			expect(resumed?.status).toBe("active");
		});

		it("should add resume event", async () => {
			const session = await startSession("Test", "developer");
			await pauseSession(session.id);
			await resumeSession(session.id);

			const loaded = getSession(session.id);
			expect(loaded?.history.some((e) => e.type === "resume")).toBe(true);
		});

		it("should remove pause context", async () => {
			const session = await startSession("Test", "developer");
			await pauseSession(session.id, "Test pause");
			const resumed = await resumeSession(session.id);

			expect(resumed?.context.pauseReason).toBeUndefined();
		});
	});

	describe("completeSession", () => {
		it("should complete session with result", async () => {
			const session = await startSession("Test", "developer");
			const completed = await completeSession(session.id, "Success!");

			expect(completed?.status).toBe("completed");
			expect(completed?.result).toBe("Success!");
		});

		it("should add complete event", async () => {
			const session = await startSession("Test", "developer");
			await completeSession(session.id, "Done");

			const loaded = getSession(session.id);
			expect(loaded?.history.some((e) => e.type === "complete")).toBe(true);
		});
	});

	describe("failSession", () => {
		it("should fail session with error", async () => {
			const session = await startSession("Test", "developer");
			const failed = await failSession(session.id, "Error occurred");

			expect(failed?.status).toBe("failed");
			expect(failed?.error).toBe("Error occurred");
		});

		it("should add error event", async () => {
			const session = await startSession("Test", "developer");
			await failSession(session.id, "Error");

			const loaded = getSession(session.id);
			expect(loaded?.history.some((e) => e.type === "error")).toBe(true);
		});
	});

	describe("addEvent", () => {
		it("should add custom event", async () => {
			const session = await startSession("Test", "developer");
			const result = await addEvent(session.id, "iteration", { step: 1 });

			expect(result).toBe(true);

			const loaded = getSession(session.id);
			expect(loaded?.history.some((e) => e.type === "iteration")).toBe(true);
		});
	});

	describe("incrementIteration", () => {
		it("should increment iteration count", async () => {
			const session = await startSession("Test", "developer");

			await incrementIteration(session.id);
			await incrementIteration(session.id);

			const loaded = getSession(session.id);
			expect(loaded?.iterations).toBe(2);
		});

		it("should timeout at max iterations", async () => {
			const session = await startSession("Test", "developer", {
				maxIterations: 3,
			});

			await incrementIteration(session.id);
			await incrementIteration(session.id);
			await incrementIteration(session.id);

			const loaded = getSession(session.id);
			expect(loaded?.status).toBe("timeout");
		});
	});

	describe("recordToolCall", () => {
		it("should record tool execution", async () => {
			const session = await startSession("Test", "developer");
			await recordToolCall(session.id, "bash", { cmd: "ls" }, { output: "files" });

			const loaded = getSession(session.id);
			const toolEvent = loaded?.history.find((e) => e.type === "tool_call");

			expect(toolEvent).toBeDefined();
			expect(toolEvent?.data.tool).toBe("bash");
		});
	});

	describe("recordLearning", () => {
		it("should record learning event", async () => {
			const session = await startSession("Test", "developer");
			await recordLearning(session.id, "Learned something", "/path/to/expertise.md");

			const loaded = getSession(session.id);
			const learningEvent = loaded?.history.find((e) => e.type === "learning");

			expect(learningEvent).toBeDefined();
			expect(learningEvent?.data.insight).toBe("Learned something");
		});
	});

	describe("getSessionContext", () => {
		it("should return accumulated context", async () => {
			const session = await startSession("Test", "developer", {
				context: { key: "value" },
			});

			const context = getSessionContext(session.id);

			expect(context).toBeDefined();
			expect(context?.sessionId).toBe(session.id);
			expect(context?.task).toBe("Test");
			expect(context?.mode).toBe("developer");
			expect((context?.context as any).key).toBe("value");
		});

		it("should include recent history", async () => {
			const session = await startSession("Test", "developer");
			await incrementIteration(session.id);
			await incrementIteration(session.id);

			const context = getSessionContext(session.id);
			expect((context?.recentHistory as any[]).length).toBeGreaterThan(0);
		});
	});

	describe("session query helpers", () => {
		it("should get active sessions", async () => {
			await startSession("Active 1", "developer");
			const s2 = await startSession("Active 2", "developer");
			await pauseSession(s2.id);

			const active = getActiveSessions();
			expect(active).toHaveLength(1);
		});

		it("should get paused sessions", async () => {
			const s1 = await startSession("Task 1", "developer");
			await startSession("Task 2", "developer");
			await pauseSession(s1.id);

			const paused = getPausedSessions();
			expect(paused).toHaveLength(1);
		});

		it("should get completed sessions", async () => {
			const s1 = await startSession("Task 1", "developer");
			await completeSession(s1.id, "Done");

			const completed = getCompletedSessions();
			expect(completed).toHaveLength(1);
		});

		it("should get failed sessions", async () => {
			const s1 = await startSession("Task 1", "developer");
			await failSession(s1.id, "Error");

			const failed = getFailedSessions();
			expect(failed).toHaveLength(1);
		});
	});

	describe("isSessionResumable", () => {
		it("should return true for paused sessions", async () => {
			const session = await startSession("Test", "developer");
			await pauseSession(session.id);

			expect(isSessionResumable(session.id)).toBe(true);
		});

		it("should return true for active sessions", async () => {
			const session = await startSession("Test", "developer");
			expect(isSessionResumable(session.id)).toBe(true);
		});

		it("should return false for completed sessions", async () => {
			const session = await startSession("Test", "developer");
			await completeSession(session.id, "Done");

			expect(isSessionResumable(session.id)).toBe(false);
		});

		it("should return false for non-existent sessions", () => {
			expect(isSessionResumable("nonexistent")).toBe(false);
		});
	});

	describe("getSessionDuration", () => {
		it("should calculate session duration", async () => {
			const session = await startSession("Test", "developer");

			// Wait a bit to ensure time passes
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Update the session to trigger updatedAt change
			await incrementIteration(session.id);

			const duration = getSessionDuration(session.id);
			expect(duration).toBeGreaterThan(0);
		});
	});

	describe("getSessionProgress", () => {
		it("should calculate progress percentage", async () => {
			const session = await startSession("Test", "developer", {
				maxIterations: 10,
			});

			await incrementIteration(session.id);
			await incrementIteration(session.id);
			await incrementIteration(session.id);

			const progress = getSessionProgress(session.id);
			expect(progress).toBe(30);
		});
	});
});
