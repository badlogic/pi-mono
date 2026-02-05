import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTickLoop, formatTickPrompt } from "../src/tick-loop.js";
import type { WorldState } from "../src/types.js";

describe("Tick Loop", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("createTickLoop", () => {
		it("should return { start, stop, isRunning, tickCount }", () => {
			const loop = createTickLoop({
				intervalMs: 100,
				onTick: async () => {},
			});

			expect(loop).toHaveProperty("start");
			expect(loop).toHaveProperty("stop");
			expect(loop).toHaveProperty("isRunning");
			expect(loop).toHaveProperty("tickCount");
			expect(typeof loop.start).toBe("function");
			expect(typeof loop.stop).toBe("function");
			expect(typeof loop.isRunning).toBe("boolean");
			expect(typeof loop.tickCount).toBe("number");
		});

		it("should not be running initially", () => {
			const loop = createTickLoop({
				intervalMs: 100,
				onTick: async () => {},
			});

			expect(loop.isRunning).toBe(false);
			expect(loop.tickCount).toBe(0);
		});

		it("should call onTick immediately on start (first tick)", async () => {
			const onTick = vi.fn().mockResolvedValue(undefined);
			const loop = createTickLoop({
				intervalMs: 100,
				onTick,
			});

			loop.start();
			// The first tick is called immediately but is async, so we need to flush microtasks
			await vi.advanceTimersByTimeAsync(0);

			expect(onTick).toHaveBeenCalledTimes(1);
			expect(loop.isRunning).toBe(true);

			loop.stop();
		});

		it("should call onTick again at interval", async () => {
			const onTick = vi.fn().mockResolvedValue(undefined);
			const loop = createTickLoop({
				intervalMs: 100,
				onTick,
			});

			loop.start();
			// Flush the immediate first tick
			await vi.advanceTimersByTimeAsync(0);
			expect(onTick).toHaveBeenCalledTimes(1);

			// Advance to the first interval tick
			await vi.advanceTimersByTimeAsync(100);
			expect(onTick).toHaveBeenCalledTimes(2);

			// Advance to the second interval tick
			await vi.advanceTimersByTimeAsync(100);
			expect(onTick).toHaveBeenCalledTimes(3);

			loop.stop();
		});

		it("should stop the loop and set isRunning to false", async () => {
			const onTick = vi.fn().mockResolvedValue(undefined);
			const loop = createTickLoop({
				intervalMs: 100,
				onTick,
			});

			loop.start();
			await vi.advanceTimersByTimeAsync(0);
			expect(loop.isRunning).toBe(true);

			loop.stop();
			expect(loop.isRunning).toBe(false);

			// Advance time - onTick should NOT be called again
			const callCountAtStop = onTick.mock.calls.length;
			await vi.advanceTimersByTimeAsync(500);
			expect(onTick).toHaveBeenCalledTimes(callCountAtStop);
		});

		it("should skip tick if previous onTick is still running (mutex)", async () => {
			let resolveSlowTick: (() => void) | null = null;
			let tickCallCount = 0;

			const onTick = vi.fn().mockImplementation(() => {
				tickCallCount++;
				if (tickCallCount === 1) {
					// First tick takes a long time (longer than the interval)
					return new Promise<void>((resolve) => {
						resolveSlowTick = resolve;
					});
				}
				return Promise.resolve();
			});

			const loop = createTickLoop({
				intervalMs: 50,
				onTick,
			});

			loop.start();
			// Start the first (slow) tick
			await vi.advanceTimersByTimeAsync(0);
			expect(onTick).toHaveBeenCalledTimes(1);

			// Advance past the interval - tick should be skipped because previous is still running
			await vi.advanceTimersByTimeAsync(50);
			// onTick was called again by setInterval, but the mutex should skip it
			// The mock is called but the internal mutex prevents actual execution
			// Actually, the mock IS called but the mutex in tick() returns early before calling onTick
			// So onTick should still only show 1 call since the mutex skips before calling onTick
			// Wait - the mutex is INSIDE tick(), and onTick is called inside tick() after the mutex check.
			// So if ticking is true, tick() returns early, and onTick is NOT called again.
			// But setInterval fires tick(), not onTick directly. So onTick call count stays at 1.
			expect(onTick).toHaveBeenCalledTimes(1);

			// Resolve the slow tick
			resolveSlowTick!();
			await vi.advanceTimersByTimeAsync(0);

			// Now the next interval should succeed
			await vi.advanceTimersByTimeAsync(50);
			expect(onTick).toHaveBeenCalledTimes(2);

			loop.stop();
		});

		it("should continue the loop and call onError if onTick throws", async () => {
			const error = new Error("tick failed");
			let callCount = 0;
			const onTick = vi.fn().mockImplementation(async () => {
				callCount++;
				if (callCount === 1) {
					throw error;
				}
			});
			const onError = vi.fn();

			const loop = createTickLoop({
				intervalMs: 100,
				onTick,
				onError,
			});

			loop.start();
			// First tick throws
			await vi.advanceTimersByTimeAsync(0);
			expect(onError).toHaveBeenCalledTimes(1);
			expect(onError).toHaveBeenCalledWith(error);

			// Loop should continue - next tick should succeed
			await vi.advanceTimersByTimeAsync(100);
			expect(onTick).toHaveBeenCalledTimes(2);
			expect(onError).toHaveBeenCalledTimes(1); // no new errors

			expect(loop.isRunning).toBe(true);
			loop.stop();
		});

		it("should increment tickCount with each completed tick", async () => {
			const onTick = vi.fn().mockResolvedValue(undefined);
			const loop = createTickLoop({
				intervalMs: 100,
				onTick,
			});

			expect(loop.tickCount).toBe(0);

			loop.start();
			await vi.advanceTimersByTimeAsync(0);
			expect(loop.tickCount).toBe(1);

			await vi.advanceTimersByTimeAsync(100);
			expect(loop.tickCount).toBe(2);

			await vi.advanceTimersByTimeAsync(100);
			expect(loop.tickCount).toBe(3);

			loop.stop();
		});

		it("should not increment tickCount when onTick throws", async () => {
			const onTick = vi.fn().mockRejectedValue(new Error("boom"));
			const onError = vi.fn();

			const loop = createTickLoop({
				intervalMs: 100,
				onTick,
				onError,
			});

			loop.start();
			await vi.advanceTimersByTimeAsync(0);
			expect(loop.tickCount).toBe(0); // failed tick should not increment

			loop.stop();
		});

		it("should not start twice if already running", async () => {
			const onTick = vi.fn().mockResolvedValue(undefined);
			const loop = createTickLoop({
				intervalMs: 100,
				onTick,
			});

			loop.start();
			loop.start(); // second start should be a no-op
			await vi.advanceTimersByTimeAsync(0);

			// Should only have been called once (not twice from double start)
			expect(onTick).toHaveBeenCalledTimes(1);

			loop.stop();
		});
	});

	describe("formatTickPrompt", () => {
		it("should return a string containing tick number", () => {
			const state: WorldState = {
				tick: 42,
				timestamp: Date.now(),
				entities: [{ id: "unit-1" }, { id: "unit-2" }],
			};

			const result = formatTickPrompt(state);
			expect(typeof result).toBe("string");
			expect(result).toContain("42");
			expect(result).toContain("Tick");
		});

		it("should include entity count", () => {
			const state: WorldState = {
				tick: 5,
				timestamp: Date.now(),
				entities: [{ id: "a" }, { id: "b" }, { id: "c" }],
			};

			const result = formatTickPrompt(state);
			expect(result).toContain("3");
		});

		it("should include resource information when present", () => {
			const state: WorldState = {
				tick: 1,
				timestamp: Date.now(),
				entities: [],
				resources: new Map([
					["gold", 500],
					["wood", 200],
				]),
			};

			const result = formatTickPrompt(state);
			expect(result).toContain("gold");
			expect(result).toContain("500");
			expect(result).toContain("wood");
			expect(result).toContain("200");
		});

		it("should handle missing resources gracefully", () => {
			const state: WorldState = {
				tick: 1,
				timestamp: Date.now(),
				entities: [],
			};

			const result = formatTickPrompt(state);
			expect(result).toContain("None tracked");
		});

		it("should include instructions for the agent", () => {
			const state: WorldState = {
				tick: 1,
				timestamp: Date.now(),
				entities: [],
			};

			const result = formatTickPrompt(state);
			expect(result).toContain("observe_game");
			expect(result).toContain("execute_action");
			expect(result).toContain("reasoning");
		});
	});
});
