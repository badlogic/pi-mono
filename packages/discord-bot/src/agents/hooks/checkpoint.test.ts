/**
 * Unit Tests for Checkpoint Hook Tagging
 * Run with: npx vitest run checkpoint.test.ts
 */

import { describe, expect, it, vi } from "vitest";

// We can't easily test actual git operations, so we test the utility functions
// that don't require git, and test the structure of exports

describe("Checkpoint Hook Exports", () => {
	it("should export all required functions", async () => {
		const checkpointModule = await import("./checkpoint-hook.js");

		// Core checkpoint functions
		expect(typeof checkpointModule.createCheckpoint).toBe("function");
		expect(typeof checkpointModule.restoreCheckpoint).toBe("function");
		expect(typeof checkpointModule.loadCheckpointFromRef).toBe("function");
		expect(typeof checkpointModule.listCheckpointRefs).toBe("function");
		expect(typeof checkpointModule.loadAllCheckpoints).toBe("function");
		expect(typeof checkpointModule.cleanupOldCheckpoints).toBe("function");

		// Tagging functions
		expect(typeof checkpointModule.tagCheckpoint).toBe("function");
		expect(typeof checkpointModule.listTags).toBe("function");
		expect(typeof checkpointModule.getCheckpointByTag).toBe("function");
		expect(typeof checkpointModule.deleteTag).toBe("function");

		// Hook factory
		expect(typeof checkpointModule.createCheckpointHook).toBe("function");
		expect(typeof checkpointModule.checkpointHook).toBe("function");

		// Utils object
		expect(checkpointModule.CheckpointUtils).toBeDefined();
		expect(typeof checkpointModule.CheckpointUtils.createCheckpoint).toBe("function");
		expect(typeof checkpointModule.CheckpointUtils.tagCheckpoint).toBe("function");
		expect(typeof checkpointModule.CheckpointUtils.listTags).toBe("function");
	});

	it("should export CheckpointUtils with all tagging functions", async () => {
		const { CheckpointUtils } = await import("./checkpoint-hook.js");

		const expectedFunctions = [
			"createCheckpoint",
			"restoreCheckpoint",
			"loadCheckpointFromRef",
			"listCheckpointRefs",
			"loadAllCheckpoints",
			"cleanupOldCheckpoints",
			"isGitRepo",
			"getRepoRoot",
			"tagCheckpoint",
			"listTags",
			"getCheckpointByTag",
			"deleteTag",
		];

		for (const fn of expectedFunctions) {
			expect(CheckpointUtils).toHaveProperty(fn);
			expect(typeof CheckpointUtils[fn as keyof typeof CheckpointUtils]).toBe("function");
		}
	});
});

describe("Checkpoint Hook Factory", () => {
	it("should create checkpoint hook with default config", async () => {
		const { createCheckpointHook } = await import("./checkpoint-hook.js");

		const hook = createCheckpointHook();
		expect(typeof hook).toBe("function");
	});

	it("should create checkpoint hook with custom config", async () => {
		const { createCheckpointHook } = await import("./checkpoint-hook.js");

		const hook = createCheckpointHook({
			enabled: false,
			autoCreate: false,
			maxCheckpoints: 50,
			refBase: "refs/custom-checkpoints",
		});

		expect(typeof hook).toBe("function");
	});

	it("should return a function that accepts AgentHookAPI", async () => {
		const { createCheckpointHook } = await import("./checkpoint-hook.js");

		const hook = createCheckpointHook();

		// Mock API
		const mockApi = {
			on: vi.fn(),
			send: vi.fn(),
		};

		// Should not throw
		expect(() => hook(mockApi as any)).not.toThrow();

		// Should register handlers for session, turn_start, and branch
		expect(mockApi.on).toHaveBeenCalledWith("session", expect.any(Function));
		expect(mockApi.on).toHaveBeenCalledWith("turn_start", expect.any(Function));
		expect(mockApi.on).toHaveBeenCalledWith("branch", expect.any(Function));
	});
});

describe("Index Exports", () => {
	it("should export checkpoint tagging types and functions from index", async () => {
		const indexModule = await import("./index.js");

		// Type export (CheckpointTag) - can't test type directly, but can test related functions
		expect(typeof indexModule.tagCheckpoint).toBe("function");
		expect(typeof indexModule.listTags).toBe("function");
		expect(typeof indexModule.getCheckpointByTag).toBe("function");
		expect(typeof indexModule.deleteTag).toBe("function");

		// Utils object should have tagging
		expect(typeof indexModule.CheckpointUtils.tagCheckpoint).toBe("function");
	});

	it("should export metrics and debug logging from index", async () => {
		const indexModule = await import("./index.js");

		expect(typeof indexModule.enableDebugLogging).toBe("function");
		expect(typeof indexModule.isDebugLoggingEnabled).toBe("function");
		expect(typeof indexModule.AgentHookManager).toBe("function");
	});

	it("should export hook presets", async () => {
		const indexModule = await import("./index.js");

		expect(indexModule.ALL_HOOKS).toBeDefined();
		expect(indexModule.CODING_HOOKS).toBeDefined();
		expect(indexModule.MINIMAL_HOOKS).toBeDefined();
		expect(indexModule.SECURITY_HOOKS).toBeDefined();

		expect(Array.isArray(indexModule.CODING_HOOKS)).toBe(true);
		expect(Array.isArray(indexModule.MINIMAL_HOOKS)).toBe(true);
		expect(Array.isArray(indexModule.SECURITY_HOOKS)).toBe(true);
	});
});

describe("Discord Integration Exports", () => {
	it("should export all discord integration functions", async () => {
		const { createDiscordHookIntegration, wrapToolWithHooks, generateSessionId, getChannelHookIntegration } =
			await import("./index.js");

		expect(typeof createDiscordHookIntegration).toBe("function");
		expect(typeof wrapToolWithHooks).toBe("function");
		expect(typeof generateSessionId).toBe("function");
		expect(typeof getChannelHookIntegration).toBe("function");
	});

	it("should generate valid session IDs", async () => {
		const { generateSessionId } = await import("./index.js");

		const sessionId = generateSessionId("channel-123");

		expect(sessionId).toContain("discord-");
		expect(sessionId).toContain("channel-123");
		expect(sessionId).toMatch(/discord-channel-123-\d+/);
	});
});

describe("Expert Hook Exports", () => {
	it("should export expert hook functions", async () => {
		const { expertHook, createExpertHook, detectDomain, getDomainRiskLevel, ExpertUtils } = await import(
			"./index.js"
		);

		expect(typeof expertHook).toBe("function");
		expect(typeof createExpertHook).toBe("function");
		expect(typeof detectDomain).toBe("function");
		expect(typeof getDomainRiskLevel).toBe("function");
		expect(ExpertUtils).toBeDefined();
	});

	it("should detect domains from task content", async () => {
		const { detectDomain } = await import("./index.js");

		// Security domain
		expect(detectDomain("Fix SQL injection vulnerability")).toBe("security");
		expect(detectDomain("Add authentication to API")).toBe("security");

		// Database domain
		expect(detectDomain("Create database migration")).toBe("database");
		expect(detectDomain("Optimize PostgreSQL query")).toBe("database");

		// General fallback
		expect(detectDomain("Add new button to UI")).toBe("general");
	});

	it("should return risk levels for domains", async () => {
		const { getDomainRiskLevel } = await import("./index.js");

		expect(getDomainRiskLevel("security")).toBe("critical");
		expect(getDomainRiskLevel("database")).toBe("critical");
		expect(getDomainRiskLevel("trading")).toBe("critical");
		expect(getDomainRiskLevel("billing")).toBe("critical");
		expect(getDomainRiskLevel("api_integration")).toBe("high");
		expect(getDomainRiskLevel("performance")).toBe("high");
		expect(getDomainRiskLevel("user_experience")).toBe("medium");
		expect(getDomainRiskLevel("general")).toBe("low");
	});
});

describe("LSP Hook Exports", () => {
	it("should export LSP hook functions", async () => {
		const { lspHook, createLSPHook, LSPUtils } = await import("./index.js");

		expect(typeof lspHook).toBe("function");
		expect(typeof createLSPHook).toBe("function");
		expect(LSPUtils).toBeDefined();
	});

	it("should have LSP server configurations", async () => {
		const { LSPUtils } = await import("./index.js");

		expect(LSPUtils.LSP_SERVERS).toBeDefined();
		expect(LSPUtils.LANGUAGE_IDS).toBeDefined();

		// LSP_SERVERS is an array of server configs
		expect(Array.isArray(LSPUtils.LSP_SERVERS)).toBe(true);
		expect(LSPUtils.LSP_SERVERS.length).toBeGreaterThan(0);

		// Should have common language IDs (keyed by file extension)
		expect(LSPUtils.LANGUAGE_IDS[".ts"]).toBe("typescript");
		expect(LSPUtils.LANGUAGE_IDS[".py"]).toBe("python");
	});
});
