import { execSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearConfigValueCache, resolveConfigValue } from "../src/core/resolve-config-value.js";

// Mock child_process.execSync
vi.mock("child_process", () => ({
	execSync: vi.fn(),
}));

describe("resolveConfigValue TTL Caching", () => {
	beforeEach(() => {
		clearConfigValueCache();
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-06T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("should cache command results indefinitely if no TTL is provided", () => {
		const mockExec = execSync as any;
		mockExec.mockReturnValue("token1");

		// First call
		const res1 = resolveConfigValue("!get-token");
		expect(res1).toBe("token1");
		expect(mockExec).toHaveBeenCalledTimes(1);

		// Fast forward time by a lot
		vi.advanceTimersByTime(1000 * 60 * 60 * 24); // 1 day

		// Second call
		const res2 = resolveConfigValue("!get-token");
		expect(res2).toBe("token1");
		expect(mockExec).toHaveBeenCalledTimes(1); // Still cached
	});

	it("should re-execute command if TTL has expired", () => {
		const mockExec = execSync as any;
		mockExec.mockReturnValueOnce("token1").mockReturnValueOnce("token2");

		const ttlMs = 1000; // 1 second

		// First call
		const res1 = resolveConfigValue("!get-token", ttlMs);
		expect(res1).toBe("token1");
		expect(mockExec).toHaveBeenCalledTimes(1);

		// Advance time by 500ms (less than TTL)
		vi.advanceTimersByTime(500);
		const res2 = resolveConfigValue("!get-token", ttlMs);
		expect(res2).toBe("token1");
		expect(mockExec).toHaveBeenCalledTimes(1); // Cached

		// Advance time by another 600ms (total 1100ms, more than TTL)
		vi.advanceTimersByTime(600);
		const res3 = resolveConfigValue("!get-token", ttlMs);
		expect(res3).toBe("token2");
		expect(mockExec).toHaveBeenCalledTimes(2); // Re-executed
	});

	it("should use individual TTLs for different commands", () => {
		const mockExec = execSync as any;
		mockExec.mockReturnValue("val");

		resolveConfigValue("!cmd1", 1000);
		resolveConfigValue("!cmd2", 5000);

		vi.advanceTimersByTime(2000);

		resolveConfigValue("!cmd1", 1000);
		resolveConfigValue("!cmd2", 5000);

		expect(mockExec).toHaveBeenCalledTimes(3); // cmd1 (twice), cmd2 (once)
	});

	it("should clear cache when clearConfigValueCache is called", () => {
		const mockExec = execSync as any;
		mockExec.mockReturnValue("val");

		resolveConfigValue("!cmd1");
		clearConfigValueCache();
		resolveConfigValue("!cmd1");

		expect(mockExec).toHaveBeenCalledTimes(2);
	});
});
