import { describe, expect, it, vi } from "vitest";
import { HookRunner } from "./runner.js";
import type { HookConfig, HookContext, HookModule, HookStorageContext } from "./types.js";

// Mock storage for testing
function createMockStorage(): HookStorageContext {
	return {
		get: vi.fn().mockResolvedValue(null),
		set: vi.fn().mockResolvedValue(undefined),
		delete: vi.fn().mockResolvedValue(undefined),
		list: vi.fn().mockResolvedValue([]),
	};
}

// Mock context for testing (without storage - it's added per-hook)
function createMockContext(): Omit<HookContext, "storage" | "signal"> {
	return {
		session: {
			id: "test-session",
			messages: [],
			cwd: "/test",
			loadEntries: () => [],
		},
		ui: {
			selector: vi.fn().mockResolvedValue(null),
			confirm: vi.fn().mockResolvedValue(false),
			input: vi.fn().mockResolvedValue(null),
			notify: vi.fn(),
		},
		actions: {
			branch: vi.fn().mockResolvedValue(undefined),
		},
	};
}

// Factory for creating mock storage
const mockStorageFactory = () => createMockStorage();

describe("HookRunner", () => {
	it("should run hooks for subscribed events", async () => {
		const onTurnStart = vi.fn().mockResolvedValue(undefined);
		const hook: HookModule = {
			id: "test-hook",
			onTurnStart,
		};

		const hooks = new Map([["test-hook", hook]]);
		const configs: HookConfig[] = [{ id: "test-hook", path: "", events: ["turn_start"], enabled: true }];

		const runner = new HookRunner(hooks, configs);
		const ctx = createMockContext();

		await runner.emit({ type: "turn_start", timestamp: Date.now() }, ctx, mockStorageFactory);

		expect(onTurnStart).toHaveBeenCalledTimes(1);
		// Check that the event was passed (first arg)
		expect(onTurnStart.mock.calls[0][0]).toMatchObject({ type: "turn_start" });
	});

	it("should not run hooks for unsubscribed events", async () => {
		const onTurnStart = vi.fn().mockResolvedValue(undefined);
		const onTurnEnd = vi.fn().mockResolvedValue(undefined);
		const hook: HookModule = {
			id: "test-hook",
			onTurnStart,
			onTurnEnd,
		};

		const hooks = new Map([["test-hook", hook]]);
		const configs: HookConfig[] = [{ id: "test-hook", path: "", events: ["turn_start"], enabled: true }];

		const runner = new HookRunner(hooks, configs);
		const ctx = createMockContext();

		await runner.emit({ type: "turn_end", message: {} as any, toolResults: [] }, ctx, mockStorageFactory);

		expect(onTurnStart).not.toHaveBeenCalled();
		expect(onTurnEnd).not.toHaveBeenCalled(); // Not subscribed
	});

	it("should catch errors and emit to listeners", async () => {
		const hook: HookModule = {
			id: "failing-hook",
			onTurnStart: vi.fn().mockRejectedValue(new Error("Hook failed!")),
		};

		const hooks = new Map([["failing-hook", hook]]);
		const configs: HookConfig[] = [{ id: "failing-hook", path: "", events: ["turn_start"], enabled: true }];

		const runner = new HookRunner(hooks, configs);
		const errorListener = vi.fn();
		runner.onError(errorListener);

		const ctx = createMockContext();
		const errors = await runner.emit({ type: "turn_start", timestamp: Date.now() }, ctx, mockStorageFactory);

		expect(errors).toHaveLength(1);
		expect(errors[0].hookId).toBe("failing-hook");
		expect(errors[0].error).toBe("Hook failed!");
		expect(errorListener).toHaveBeenCalledWith(errors[0]);
	});

	it("should continue running other hooks after one fails", async () => {
		const hook1: HookModule = {
			id: "failing-hook",
			onTurnStart: vi.fn().mockRejectedValue(new Error("Hook 1 failed")),
		};
		const hook2OnTurnStart = vi.fn().mockResolvedValue(undefined);
		const hook2: HookModule = {
			id: "passing-hook",
			onTurnStart: hook2OnTurnStart,
		};

		const hooks = new Map([
			["failing-hook", hook1],
			["passing-hook", hook2],
		]);
		const configs: HookConfig[] = [
			{ id: "failing-hook", path: "", events: ["turn_start"], enabled: true },
			{ id: "passing-hook", path: "", events: ["turn_start"], enabled: true },
		];

		const runner = new HookRunner(hooks, configs);
		const ctx = createMockContext();

		await runner.emit({ type: "turn_start", timestamp: Date.now() }, ctx, mockStorageFactory);

		// Second hook should still run
		expect(hook2OnTurnStart).toHaveBeenCalled();
	});

	it("should skip disabled hooks", async () => {
		const onTurnStart = vi.fn().mockResolvedValue(undefined);
		const hook: HookModule = {
			id: "disabled-hook",
			onTurnStart,
		};

		const hooks = new Map([["disabled-hook", hook]]);
		const configs: HookConfig[] = [{ id: "disabled-hook", path: "", events: ["turn_start"], enabled: false }];

		const runner = new HookRunner(hooks, configs);
		const ctx = createMockContext();

		await runner.emit({ type: "turn_start", timestamp: Date.now() }, ctx, mockStorageFactory);

		expect(onTurnStart).not.toHaveBeenCalled();
	});

	it("should timeout long-running hooks", async () => {
		const slowHook: HookModule = {
			id: "slow-hook",
			onTurnStart: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 5000))),
		};

		const hooks = new Map([["slow-hook", slowHook]]);
		const configs: HookConfig[] = [
			{ id: "slow-hook", path: "", events: ["turn_start"], enabled: true, timeout: 100 },
		];

		const runner = new HookRunner(hooks, configs);
		const ctx = createMockContext();

		const errors = await runner.emit({ type: "turn_start", timestamp: Date.now() }, ctx, mockStorageFactory);

		expect(errors).toHaveLength(1);
		expect(errors[0].error).toContain("timed out");
	});

	it("should check if handlers exist for event", () => {
		const hook: HookModule = {
			id: "test-hook",
			onTurnStart: vi.fn(),
		};

		const hooks = new Map([["test-hook", hook]]);
		const configs: HookConfig[] = [{ id: "test-hook", path: "", events: ["turn_start"], enabled: true }];

		const runner = new HookRunner(hooks, configs);

		expect(runner.hasHandlers("turn_start")).toBe(true);
		expect(runner.hasHandlers("turn_end")).toBe(false);
	});

	it("should run multiple hooks in sequence", async () => {
		const callOrder: string[] = [];

		const hook1: HookModule = {
			id: "hook-1",
			onTurnStart: vi.fn().mockImplementation(async () => {
				callOrder.push("hook-1");
			}),
		};
		const hook2: HookModule = {
			id: "hook-2",
			onTurnStart: vi.fn().mockImplementation(async () => {
				callOrder.push("hook-2");
			}),
		};

		const hooks = new Map([
			["hook-1", hook1],
			["hook-2", hook2],
		]);
		const configs: HookConfig[] = [
			{ id: "hook-1", path: "", events: ["turn_start"], enabled: true },
			{ id: "hook-2", path: "", events: ["turn_start"], enabled: true },
		];

		const runner = new HookRunner(hooks, configs);
		const ctx = createMockContext();

		await runner.emit({ type: "turn_start", timestamp: Date.now() }, ctx, mockStorageFactory);

		expect(callOrder).toEqual(["hook-1", "hook-2"]);
	});

	it("should remove error listener when unsubscribe called", async () => {
		const hook: HookModule = {
			id: "failing-hook",
			onTurnStart: vi.fn().mockRejectedValue(new Error("Hook failed")),
		};

		const hooks = new Map([["failing-hook", hook]]);
		const configs: HookConfig[] = [{ id: "failing-hook", path: "", events: ["turn_start"], enabled: true }];

		const runner = new HookRunner(hooks, configs);
		const errorListener = vi.fn();
		const unsubscribe = runner.onError(errorListener);

		// Unsubscribe before emitting
		unsubscribe();

		const ctx = createMockContext();
		await runner.emit({ type: "turn_start", timestamp: Date.now() }, ctx, mockStorageFactory);

		expect(errorListener).not.toHaveBeenCalled();
	});

	it("should provide per-hook storage when createStorage is passed", async () => {
		const storageIds: string[] = [];

		const hook1: HookModule = {
			id: "hook-1",
			onTurnStart: vi.fn().mockImplementation(async (_event, ctx) => {
				await ctx.storage.set("key", "value");
			}),
		};
		const hook2: HookModule = {
			id: "hook-2",
			onTurnStart: vi.fn().mockImplementation(async (_event, ctx) => {
				await ctx.storage.set("key", "value");
			}),
		};

		const hooks = new Map([
			["hook-1", hook1],
			["hook-2", hook2],
		]);
		const configs: HookConfig[] = [
			{ id: "hook-1", path: "", events: ["turn_start"], enabled: true },
			{ id: "hook-2", path: "", events: ["turn_start"], enabled: true },
		];

		const runner = new HookRunner(hooks, configs);
		const ctx = createMockContext();

		// Mock storage factory that tracks which hook IDs are passed
		const createStorage = vi.fn().mockImplementation((hookId: string) => {
			storageIds.push(hookId);
			return createMockStorage();
		});

		await runner.emit({ type: "turn_start", timestamp: Date.now() }, ctx, createStorage);

		expect(createStorage).toHaveBeenCalledTimes(2);
		expect(storageIds).toEqual(["hook-1", "hook-2"]);
	});

	it("should provide abort signal to hooks", async () => {
		let receivedSignal: AbortSignal | undefined;

		const hook: HookModule = {
			id: "test-hook",
			onTurnStart: vi.fn().mockImplementation(async (_event, ctx) => {
				receivedSignal = ctx.signal;
			}),
		};

		const hooks = new Map([["test-hook", hook]]);
		const configs: HookConfig[] = [{ id: "test-hook", path: "", events: ["turn_start"], enabled: true }];

		const runner = new HookRunner(hooks, configs);
		const ctx = createMockContext();

		await runner.emit({ type: "turn_start", timestamp: Date.now() }, ctx, mockStorageFactory);

		expect(receivedSignal).toBeDefined();
		expect(receivedSignal?.aborted).toBe(false);
	});
});
