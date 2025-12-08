import { describe, expect, it, vi } from "vitest";
import type { LoadedHook } from "./loader.js";
import { HookRunner } from "./runner.js";
import type { HookUIContext, TurnStartEvent } from "./types.js";

// Mock UI context for testing
function createMockUIContext(): HookUIContext {
	return {
		select: vi.fn().mockResolvedValue(null),
		confirm: vi.fn().mockResolvedValue(false),
		input: vi.fn().mockResolvedValue(null),
		notify: vi.fn(),
	};
}

// Handler type matching loader.ts
type HandlerFn = (...args: unknown[]) => Promise<unknown>;

// Create a mock loaded hook
function createMockHook(path: string, handlers: Record<string, HandlerFn[]>): LoadedHook {
	return {
		path,
		resolvedPath: `/resolved${path}`,
		handlers: new Map(Object.entries(handlers)),
	};
}

describe("HookRunner", () => {
	it("should run hooks for subscribed events", async () => {
		const onTurnStart = vi.fn().mockResolvedValue(undefined);
		const hook = createMockHook("/test-hook.ts", { turn_start: [onTurnStart] });

		const runner = new HookRunner([hook], createMockUIContext(), "/test");

		const event: TurnStartEvent = { type: "turn_start", turnIndex: 0, timestamp: Date.now() };
		await runner.emit(event);

		expect(onTurnStart).toHaveBeenCalledTimes(1);
		expect(onTurnStart.mock.calls[0][0]).toMatchObject({ type: "turn_start" });
	});

	it("should not run hooks for unsubscribed events", async () => {
		const onTurnStart = vi.fn().mockResolvedValue(undefined);
		const hook = createMockHook("/test-hook.ts", { turn_start: [onTurnStart] });

		const runner = new HookRunner([hook], createMockUIContext(), "/test");

		await runner.emit({ type: "turn_end", turnIndex: 0, message: {} as any, toolResults: [] });

		expect(onTurnStart).not.toHaveBeenCalled();
	});

	it("should catch errors and emit to listeners", async () => {
		const failingHandler = vi.fn().mockRejectedValue(new Error("Hook failed!"));
		const hook = createMockHook("/failing-hook.ts", { turn_start: [failingHandler] });

		const runner = new HookRunner([hook], createMockUIContext(), "/test");
		const errorListener = vi.fn();
		runner.onError(errorListener);

		const event: TurnStartEvent = { type: "turn_start", turnIndex: 0, timestamp: Date.now() };
		await runner.emit(event);

		expect(errorListener).toHaveBeenCalledWith({
			hookPath: "/failing-hook.ts",
			event: "turn_start",
			error: "Hook failed!",
		});
	});

	it("should continue running other hooks after one fails", async () => {
		const failingHandler = vi.fn().mockRejectedValue(new Error("Hook 1 failed"));
		const passingHandler = vi.fn().mockResolvedValue(undefined);

		const hook1 = createMockHook("/failing.ts", { turn_start: [failingHandler] });
		const hook2 = createMockHook("/passing.ts", { turn_start: [passingHandler] });

		const runner = new HookRunner([hook1, hook2], createMockUIContext(), "/test");

		const event: TurnStartEvent = { type: "turn_start", turnIndex: 0, timestamp: Date.now() };
		await runner.emit(event);

		expect(passingHandler).toHaveBeenCalled();
	});

	it("should timeout long-running hooks", async () => {
		const slowHandler = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 5000)));
		const hook = createMockHook("/slow-hook.ts", { turn_start: [slowHandler] });

		const runner = new HookRunner([hook], createMockUIContext(), "/test", 100);
		const errorListener = vi.fn();
		runner.onError(errorListener);

		const event: TurnStartEvent = { type: "turn_start", turnIndex: 0, timestamp: Date.now() };
		await runner.emit(event);

		expect(errorListener).toHaveBeenCalled();
		expect(errorListener.mock.calls[0][0].error).toContain("timed out");
	});

	it("should check if handlers exist for event", () => {
		const hook = createMockHook("/test.ts", { turn_start: [vi.fn()] });
		const runner = new HookRunner([hook], createMockUIContext(), "/test");

		expect(runner.hasHandlers("turn_start")).toBe(true);
		expect(runner.hasHandlers("turn_end")).toBe(false);
	});

	it("should run multiple hooks in sequence", async () => {
		const callOrder: string[] = [];

		const handler1 = vi.fn().mockImplementation(async () => {
			callOrder.push("hook-1");
		});
		const handler2 = vi.fn().mockImplementation(async () => {
			callOrder.push("hook-2");
		});

		const hook1 = createMockHook("/hook-1.ts", { turn_start: [handler1] });
		const hook2 = createMockHook("/hook-2.ts", { turn_start: [handler2] });

		const runner = new HookRunner([hook1, hook2], createMockUIContext(), "/test");

		const event: TurnStartEvent = { type: "turn_start", turnIndex: 0, timestamp: Date.now() };
		await runner.emit(event);

		expect(callOrder).toEqual(["hook-1", "hook-2"]);
	});

	it("should remove error listener when unsubscribe called", async () => {
		const failingHandler = vi.fn().mockRejectedValue(new Error("Hook failed"));
		const hook = createMockHook("/failing.ts", { turn_start: [failingHandler] });

		const runner = new HookRunner([hook], createMockUIContext(), "/test");
		const errorListener = vi.fn();
		const unsubscribe = runner.onError(errorListener);

		unsubscribe();

		const event: TurnStartEvent = { type: "turn_start", turnIndex: 0, timestamp: Date.now() };
		await runner.emit(event);

		expect(errorListener).not.toHaveBeenCalled();
	});

	it("should return result from branch event handler", async () => {
		const branchHandler = vi.fn().mockResolvedValue({ skipConversationRestore: true });
		const hook = createMockHook("/checkpoint.ts", { branch: [branchHandler] });

		const runner = new HookRunner([hook], createMockUIContext(), "/test");

		const result = await runner.emit({
			type: "branch",
			targetTurnIndex: 5,
			entries: [],
		});

		expect(result).toEqual({ skipConversationRestore: true });
	});

	it("should pass context with exec and ui to handlers", async () => {
		let receivedCtx: any;
		const handler = vi.fn().mockImplementation(async (_event, ctx) => {
			receivedCtx = ctx;
		});
		const hook = createMockHook("/test.ts", { turn_start: [handler] });

		const uiContext = createMockUIContext();
		const runner = new HookRunner([hook], uiContext, "/test/cwd");

		const event: TurnStartEvent = { type: "turn_start", turnIndex: 0, timestamp: Date.now() };
		await runner.emit(event);

		expect(receivedCtx).toBeDefined();
		expect(receivedCtx.cwd).toBe("/test/cwd");
		expect(receivedCtx.ui).toBe(uiContext);
		expect(typeof receivedCtx.exec).toBe("function");
	});
});
