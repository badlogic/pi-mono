/**
 * Unit Tests for Agent Hooks System
 * Run with: npx vitest run hooks.test.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentHookManager, createHookRegistration, enableDebugLogging, isDebugLoggingEnabled } from "./hook-manager.js";
import type { ToolResultEvent, TurnStartEvent } from "./types.js";

// ============================================================================
// Debug Logging Tests
// ============================================================================

describe("Debug Logging", () => {
	afterEach(() => {
		enableDebugLogging(false);
	});

	it("should be disabled by default", () => {
		expect(isDebugLoggingEnabled()).toBe(false);
	});

	it("should enable debug logging", () => {
		enableDebugLogging(true);
		expect(isDebugLoggingEnabled()).toBe(true);
	});

	it("should disable debug logging", () => {
		enableDebugLogging(true);
		enableDebugLogging(false);
		expect(isDebugLoggingEnabled()).toBe(false);
	});
});

// ============================================================================
// HookMetrics Tests
// ============================================================================

describe("HookMetrics", () => {
	let manager: AgentHookManager;

	beforeEach(() => {
		manager = new AgentHookManager("/tmp/test-hooks");
	});

	it("should have initial metrics with zero counts", () => {
		const metrics = manager.getMetrics();

		expect(metrics.totalEvents).toBe(0);
		expect(metrics.eventsByType).toEqual({});
		expect(metrics.executionTimes.total).toBe(0);
		expect(metrics.errors.total).toBe(0);
		expect(metrics.session.turnCount).toBe(0);
		expect(metrics.toolCalls.total).toBe(0);
		expect(metrics.toolCalls.blocked).toBe(0);
		expect(metrics.toolCalls.modified).toBe(0);
	});

	it("should have session start time set", () => {
		const metrics = manager.getMetrics();
		const now = Date.now();

		expect(metrics.session.startTime).toBeLessThanOrEqual(now);
		expect(metrics.session.startTime).toBeGreaterThan(now - 1000);
	});

	it("should reset metrics with new session ID", () => {
		// Emit some events first
		manager.emit({ type: "turn_start", turnIndex: 1, timestamp: Date.now() });

		// Reset
		manager.resetMetrics("new-session-123");

		const metrics = manager.getMetrics();
		expect(metrics.totalEvents).toBe(0);
		expect(metrics.session.sessionId).toBe("new-session-123");
	});

	it("should return a copy of metrics (immutable)", () => {
		const metrics1 = manager.getMetrics();
		const metrics2 = manager.getMetrics();

		expect(metrics1).not.toBe(metrics2);
		expect(metrics1).toEqual(metrics2);
	});
});

// ============================================================================
// AgentHookManager Tests
// ============================================================================

describe("AgentHookManager", () => {
	let manager: AgentHookManager;

	beforeEach(() => {
		manager = new AgentHookManager("/tmp/test-hooks");
	});

	describe("Hook Registration", () => {
		it("should register a hook", () => {
			// Use type assertion to avoid overload issues in tests
			const hook = createHookRegistration("test-hook", (api: any) => {
				api.on("session", () => {});
			});

			manager.register(hook);
			const hooks = manager.list();

			expect(hooks).toHaveLength(1);
			expect(hooks[0].id).toBe("test-hook");
			expect(hooks[0].enabled).toBe(true);
		});

		it("should unregister a hook", () => {
			const hook = createHookRegistration("test-hook", () => {});
			manager.register(hook);

			const removed = manager.unregister("test-hook");

			expect(removed).toBe(true);
			expect(manager.list()).toHaveLength(0);
		});

		it("should return false when unregistering non-existent hook", () => {
			const removed = manager.unregister("non-existent");
			expect(removed).toBe(false);
		});

		it("should enable/disable hooks", () => {
			const hook = createHookRegistration("test-hook", () => {});
			manager.register(hook);

			manager.setEnabled("test-hook", false);
			expect(manager.list()[0].enabled).toBe(false);

			manager.setEnabled("test-hook", true);
			expect(manager.list()[0].enabled).toBe(true);
		});

		it("should replace hook with same id", () => {
			const hook1 = createHookRegistration("test-hook", () => {}, { name: "First" });
			const hook2 = createHookRegistration("test-hook", () => {}, { name: "Second" });

			manager.register(hook1);
			manager.register(hook2);

			const hooks = manager.list();
			expect(hooks).toHaveLength(1);
			expect(hooks[0].name).toBe("Second");
		});
	});

	describe("Event Emission", () => {
		it("should track events in metrics", async () => {
			await manager.emit({ type: "turn_start", turnIndex: 1, timestamp: Date.now() });

			const metrics = manager.getMetrics();
			expect(metrics.totalEvents).toBe(1);
			expect(metrics.eventsByType.turn_start).toBe(1);
		});

		it("should increment turn count on turn_start", async () => {
			await manager.emit({ type: "turn_start", turnIndex: 1, timestamp: Date.now() });
			await manager.emit({ type: "turn_start", turnIndex: 2, timestamp: Date.now() });

			const metrics = manager.getMetrics();
			expect(metrics.session.turnCount).toBe(2);
		});

		it("should track session ID from session event", async () => {
			await manager.emit({ type: "session", reason: "start", sessionId: "test-session-abc" });

			const metrics = manager.getMetrics();
			expect(metrics.session.sessionId).toBe("test-session-abc");
		});

		it("should track tool_call events", async () => {
			await manager.emit({
				type: "tool_call",
				toolName: "bash",
				toolCallId: "call-123",
				input: { command: "echo hello" },
			});

			const metrics = manager.getMetrics();
			expect(metrics.toolCalls.total).toBe(1);
		});

		it("should call registered handlers", async () => {
			const handler = vi.fn();

			manager.register(
				createHookRegistration("test-hook", (api: any) => {
					api.on("turn_start", handler);
				}),
			);

			const event: TurnStartEvent = { type: "turn_start", turnIndex: 1, timestamp: Date.now() };
			await manager.emit(event);

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith(event, expect.any(Object));
		});

		it("should not call handlers for disabled hooks", async () => {
			const handler = vi.fn();

			manager.register(
				createHookRegistration("test-hook", (api: any) => {
					api.on("turn_start", handler);
				}),
			);
			manager.setEnabled("test-hook", false);

			await manager.emit({ type: "turn_start", turnIndex: 1, timestamp: Date.now() });

			expect(handler).not.toHaveBeenCalled();
		});

		it("should track errors in metrics", async () => {
			manager.register(
				createHookRegistration("error-hook", (api: any) => {
					api.on("turn_start", () => {
						throw new Error("Test error");
					});
				}),
			);

			await manager.emit({ type: "turn_start", turnIndex: 1, timestamp: Date.now() });

			const metrics = manager.getMetrics();
			expect(metrics.errors.total).toBe(1);
			expect(metrics.errors.byHook["error-hook"]).toBe(1);
		});
	});

	describe("Tool Call Blocking", () => {
		it("should allow tool calls by default", async () => {
			const result = await manager.emit({
				type: "tool_call",
				toolName: "bash",
				toolCallId: "call-123",
				input: { command: "echo hello" },
			});

			expect(result).toBeUndefined();
		});

		it("should block tool calls when hook returns block", async () => {
			manager.register(
				createHookRegistration("blocking-hook", (api: any) => {
					api.on("tool_call", () => ({ block: true, reason: "Dangerous command" }));
				}),
			);

			const result = await manager.emit({
				type: "tool_call",
				toolName: "bash",
				toolCallId: "call-123",
				input: { command: "rm -rf /" },
			});

			// Type assertion for test
			const blockResult = result as { block: boolean; reason: string } | undefined;
			expect(blockResult?.block).toBe(true);
			expect(blockResult?.reason).toBe("Dangerous command");

			const metrics = manager.getMetrics();
			expect(metrics.toolCalls.blocked).toBe(1);
		});
	});

	describe("Tool Result Modification", () => {
		it("should allow modification of tool results", async () => {
			manager.register(
				createHookRegistration("modifying-hook", (api: any) => {
					api.on("tool_result", (event: ToolResultEvent) => ({
						result: event.result + "\n[Modified by hook]",
						isError: event.isError,
					}));
				}),
			);

			const event: ToolResultEvent = {
				type: "tool_result",
				toolName: "bash",
				toolCallId: "call-123",
				input: { command: "echo hello" },
				result: "hello",
				isError: false,
			};

			const result = await manager.emit(event);

			// Type assertion for test
			const modResult = result as { result: string; isError: boolean } | undefined;
			expect(modResult?.result).toContain("[Modified by hook]");
		});
	});

	describe("Send Queue", () => {
		it("should queue messages without callback", () => {
			const testManager = new AgentHookManager("/tmp/test");

			testManager.register(
				createHookRegistration("send-hook", (api: any) => {
					api.send("Test message");
				}),
			);

			const queued = testManager.getQueuedMessages();
			expect(queued).toHaveLength(1);
			expect(queued[0].text).toBe("Test message");
		});

		it("should call callback when set", () => {
			const callback = vi.fn();
			const testManager = new AgentHookManager("/tmp/test", callback);

			testManager.register(
				createHookRegistration("send-hook", (api: any) => {
					api.send("Test message");
				}),
			);

			expect(callback).toHaveBeenCalledWith("Test message", undefined);
		});

		it("should process queued messages when callback is set later", () => {
			const testManager = new AgentHookManager("/tmp/test");

			testManager.register(
				createHookRegistration("send-hook", (api: any) => {
					api.send("Queued message");
				}),
			);

			const callback = vi.fn();
			testManager.setSendCallback(callback);

			expect(callback).toHaveBeenCalledWith("Queued message", undefined);
			expect(testManager.getQueuedMessages()).toHaveLength(0);
		});
	});
});

// ============================================================================
// createHookRegistration Tests
// ============================================================================

describe("createHookRegistration", () => {
	it("should create hook with defaults", () => {
		const hook = createHookRegistration("test", () => {});

		expect(hook.id).toBe("test");
		expect(hook.name).toBe("test");
		expect(hook.enabled).toBe(true);
		expect(hook.description).toBeUndefined();
	});

	it("should create hook with custom options", () => {
		const hook = createHookRegistration("test", () => {}, {
			name: "Custom Name",
			description: "Custom description",
			enabled: false,
		});

		expect(hook.id).toBe("test");
		expect(hook.name).toBe("Custom Name");
		expect(hook.description).toBe("Custom description");
		expect(hook.enabled).toBe(false);
	});
});

// ============================================================================
// Execution Time Tracking Tests
// ============================================================================

describe("Execution Time Tracking", () => {
	it("should track total execution time", async () => {
		const testManager = new AgentHookManager("/tmp/test");

		testManager.register(
			createHookRegistration("slow-hook", (api: any) => {
				api.on("turn_start", async () => {
					await new Promise((resolve) => setTimeout(resolve, 10));
				});
			}),
		);

		await testManager.emit({ type: "turn_start", turnIndex: 1, timestamp: Date.now() });

		const metrics = testManager.getMetrics();
		expect(metrics.executionTimes.total).toBeGreaterThanOrEqual(10);
		expect(metrics.executionTimes.byHook["slow-hook"]).toBeGreaterThanOrEqual(10);
		expect(metrics.executionTimes.byEvent.turn_start).toBeGreaterThanOrEqual(10);
	});
});
