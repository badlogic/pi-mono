/**
 * Unit Tests for Pi Discord Bot MCP Tools
 * Run with: npx vitest run or npm test
 */

import { describe, expect, it, vi } from "vitest";

// Mock environment
process.env.OPENROUTER_API_KEY = "test-key";
process.env.GROQ_API_KEY = "test-groq-key";

// Import tools after setting env
import { getAllMcpTools, withRetry } from "./mcp-tools.js";

describe("MCP Tools", () => {
	describe("getAllMcpTools", () => {
		it("should return an array of tools", () => {
			const tools = getAllMcpTools();
			expect(Array.isArray(tools)).toBe(true);
			expect(tools.length).toBeGreaterThan(0);
		});

		it("should have required properties on each tool", () => {
			const tools = getAllMcpTools();
			for (const tool of tools) {
				expect(tool).toHaveProperty("name");
				expect(tool).toHaveProperty("description");
				expect(tool).toHaveProperty("execute");
				expect(typeof tool.name).toBe("string");
				expect(typeof tool.description).toBe("string");
				expect(typeof tool.execute).toBe("function");
			}
		});

		it("should have unique tool names", () => {
			const tools = getAllMcpTools();
			const names = tools.map((t) => t.name);
			const uniqueNames = new Set(names);
			expect(uniqueNames.size).toBe(names.length);
		});

		it("should have at least 50 tools", () => {
			const tools = getAllMcpTools();
			expect(tools.length).toBeGreaterThanOrEqual(50);
		});
	});

	describe("withRetry", () => {
		it("should succeed on first try", async () => {
			const fn = vi.fn().mockResolvedValue("success");
			const result = await withRetry(fn);
			expect(result).toBe("success");
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it("should retry on failure and succeed", async () => {
			const fn = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValue("success");

			const result = await withRetry(fn, { maxRetries: 3, initialDelay: 10 });
			expect(result).toBe("success");
			expect(fn).toHaveBeenCalledTimes(2);
		});

		it("should throw after max retries", async () => {
			const fn = vi.fn().mockRejectedValue(new Error("timeout"));

			await expect(withRetry(fn, { maxRetries: 2, initialDelay: 10 })).rejects.toThrow("timeout");
			expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
		});

		it("should not retry non-retryable errors", async () => {
			const fn = vi.fn().mockRejectedValue(new Error("invalid input"));

			await expect(withRetry(fn, { maxRetries: 3, initialDelay: 10 })).rejects.toThrow("invalid input");
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it("should retry on rate limit errors", async () => {
			const fn = vi.fn().mockRejectedValueOnce(new Error("429 rate limit")).mockResolvedValue("success");

			const result = await withRetry(fn, { maxRetries: 3, initialDelay: 10 });
			expect(result).toBe("success");
			expect(fn).toHaveBeenCalledTimes(2);
		});
	});

	describe("Tool Categories", () => {
		it("should have web search tools", () => {
			const tools = getAllMcpTools();
			const webTools = tools.filter(
				(t) => t.name.includes("search") || t.name.includes("web") || t.name.includes("scrape"),
			);
			expect(webTools.length).toBeGreaterThan(0);
		});

		it("should have GitHub tools", () => {
			const tools = getAllMcpTools();
			const ghTools = tools.filter((t) => t.name.includes("github"));
			expect(ghTools.length).toBeGreaterThan(0);
		});

		it("should have memory tools", () => {
			const tools = getAllMcpTools();
			const memTools = tools.filter((t) => t.name.includes("memory"));
			expect(memTools.length).toBeGreaterThan(0);
		});

		it("should have skill tools", () => {
			const tools = getAllMcpTools();
			const skillTools = tools.filter((t) => t.name.includes("skill"));
			expect(skillTools.length).toBeGreaterThan(0);
		});

		it("should have voice tools", () => {
			const tools = getAllMcpTools();
			const voiceTools = tools.filter((t) => t.name.includes("voice"));
			expect(voiceTools.length).toBeGreaterThan(0);
		});

		it("should have plugin tools", () => {
			const tools = getAllMcpTools();
			const pluginTools = tools.filter((t) => t.name.includes("plugin"));
			expect(pluginTools.length).toBeGreaterThan(0);
		});
	});
});

describe("Tool Execution", () => {
	// These tests would require mocking file system and APIs
	// Keeping as placeholders for future implementation

	it.todo("should execute web_search tool");
	it.todo("should execute memory_store tool");
	it.todo("should execute skill_list tool");
	it.todo("should execute code_sandbox tool");
	it.todo("should execute docker_sandbox tool");
});
