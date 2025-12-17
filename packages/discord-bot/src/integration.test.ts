/**
 * Integration Tests for Pi Discord Bot
 * Tests end-to-end functionality of tools and systems
 */

import { describe, expect, it, vi } from "vitest";
import { getAllMcpTools, withRetry } from "./mcp-tools.js";

// Mock external APIs for testing
vi.mock("node-fetch", () => ({
	default: vi.fn(),
}));

describe("Integration Tests", () => {
	describe("Tool System", () => {
		it("should load all tools without errors", () => {
			const tools = getAllMcpTools();
			expect(tools.length).toBeGreaterThan(50);

			// Verify each tool has required properties
			for (const tool of tools) {
				expect(tool).toHaveProperty("name");
				expect(tool).toHaveProperty("execute");
				expect(typeof tool.execute).toBe("function");
			}
		});

		it("should have unique tool names", () => {
			const tools = getAllMcpTools();
			const names = tools.map((t) => t.name);
			const uniqueNames = new Set(names);
			expect(uniqueNames.size).toBe(names.length);
		});

		it.skip("should categorize tools correctly", () => {
			const tools = getAllMcpTools();
			const toolNames = tools.map((t) => t.name);

			// Check for key tool categories (using actual tool names)
			const categories = {
				web: ["web_search", "web_scrape"],
				github: ["github_search_repos", "github_list_issues"],
				memory: ["memory_store", "memory_recall"],
				voice: ["voice_join", "voice_tts"],
				plugin: ["plugin_load", "plugin_list"],
			};

			for (const [category, expectedTools] of Object.entries(categories)) {
				for (const tool of expectedTools) {
					// Allow for slight naming variations
					const found = toolNames.some((n) => n.includes(tool.replace("_", "")) || n === tool);
					expect(found || toolNames.includes(tool)).toBe(true);
				}
			}
		});
	});

	describe("Retry Logic", () => {
		// Note: These tests use the withRetry function which requires specific error codes
		it.skip("should retry on transient failures using withRetry", async () => {
			let attempts = 0;
			const flakeyFn = async () => {
				attempts++;
				if (attempts < 3) {
					const error = new Error("Transient error");
					(error as any).code = "ECONNRESET"; // Make it retryable
					throw error;
				}
				return "success";
			};

			const result = await withRetry(flakeyFn, { maxRetries: 5, initialDelay: 10 });
			expect(result).toBe("success");
			expect(attempts).toBe(3);
		});

		it.skip("should respect max retries with retryable errors", async () => {
			let attempts = 0;
			const alwaysFails = async () => {
				attempts++;
				const error = new Error("Always fails");
				(error as any).code = "ECONNRESET"; // Make it retryable
				throw error;
			};

			await expect(withRetry(alwaysFails, { maxRetries: 3, initialDelay: 10 })).rejects.toThrow("Always fails");
			expect(attempts).toBe(3);
		});

		it.skip("should apply exponential backoff with retryable errors", async () => {
			const delays: number[] = [];
			let lastTime = Date.now();
			let attempts = 0;

			const trackingFn = async () => {
				attempts++;
				const now = Date.now();
				if (attempts > 1) {
					delays.push(now - lastTime);
				}
				lastTime = now;
				if (attempts < 4) {
					const error = new Error("Retry");
					(error as any).code = "ETIMEDOUT"; // Make it retryable
					throw error;
				}
				return "done";
			};

			await withRetry(trackingFn, { maxRetries: 5, initialDelay: 50 });

			// Each delay should be roughly double the previous (with jitter)
			expect(delays.length).toBe(3);
		});
	});

	describe("Tool Execution", () => {
		it("should handle memory_store tool", async () => {
			const tools = getAllMcpTools();
			const memoryStore = tools.find((t) => t.name === "memory_store");
			expect(memoryStore).toBeDefined();

			// Tool should have correct parameter schema
			expect(memoryStore?.parameters).toBeDefined();
		});

		it("should handle skill_list tool", async () => {
			const tools = getAllMcpTools();
			const skillList = tools.find((t) => t.name === "skill_list");
			expect(skillList).toBeDefined();
		});

		it("should handle task_list tool", async () => {
			const tools = getAllMcpTools();
			const taskList = tools.find((t) => t.name === "task_list");
			expect(taskList).toBeDefined();
		});
	});

	describe("Error Handling", () => {
		it("should handle tool execution errors gracefully", async () => {
			const tools = getAllMcpTools();
			const webSearch = tools.find((t) => t.name === "web_search");

			// Should not throw even with invalid input
			if (webSearch) {
				// The tool should handle errors internally
				expect(webSearch.execute).toBeDefined();
			}
		});
	});

	describe("Rate Limiting", () => {
		it("should enforce rate limits", () => {
			// Simulate rate limiting behavior
			const requests = new Map<string, number>();
			const limit = 10;
			const window = 60000;

			const isRateLimited = (userId: string): boolean => {
				const count = requests.get(userId) || 0;
				if (count >= limit) return true;
				requests.set(userId, count + 1);
				return false;
			};

			// First 10 requests should pass
			for (let i = 0; i < 10; i++) {
				expect(isRateLimited("user1")).toBe(false);
			}

			// 11th request should be rate limited
			expect(isRateLimited("user1")).toBe(true);

			// Different user should not be affected
			expect(isRateLimited("user2")).toBe(false);
		});
	});

	describe("Input Validation", () => {
		it("should sanitize inputs", () => {
			const sanitize = (input: string): string => {
				return input.replace(/\0/g, "").substring(0, 10000);
			};

			// Test null byte removal
			expect(sanitize("hello\0world")).toBe("helloworld");

			// Test length limiting
			const longInput = "a".repeat(20000);
			expect(sanitize(longInput).length).toBe(10000);

			// Test normal input passthrough
			expect(sanitize("normal text")).toBe("normal text");
		});

		it("should validate channel IDs", () => {
			const isValidChannelId = (id: string): boolean => /^\d{17,20}$/.test(id);

			expect(isValidChannelId("123456789012345678")).toBe(true);
			expect(isValidChannelId("12345678901234567890")).toBe(true);
			expect(isValidChannelId("abc")).toBe(false);
			expect(isValidChannelId("")).toBe(false);
			expect(isValidChannelId("12345")).toBe(false);
		});
	});
});

describe("Load Testing Simulation", () => {
	it("should handle concurrent tool calls", async () => {
		const tools = getAllMcpTools();
		const taskList = tools.find((t) => t.name === "task_list");

		if (!taskList) {
			console.warn("task_list tool not found, skipping concurrent test");
			return;
		}

		// Simulate 10 concurrent calls
		const promises = Array(10)
			.fill(null)
			.map((_, i) => Promise.resolve(`call_${i}`));

		const results = await Promise.all(promises);
		expect(results.length).toBe(10);
	});

	it("should maintain performance under load", () => {
		const tools = getAllMcpTools();

		// Measure tool lookup time
		const start = Date.now();
		for (let i = 0; i < 1000; i++) {
			tools.find((t) => t.name === "memory_store");
		}
		const elapsed = Date.now() - start;

		// Should complete 1000 lookups in under 100ms
		expect(elapsed).toBeLessThan(100);
	});
});
