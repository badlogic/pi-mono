/**
 * Integration Tests for Act-Learn-Reuse Cycle
 * TAC Lesson 13: Tests the complete learning loop
 */

import { existsSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeWithAutoExpert, getExpert } from "./agent-experts.js";
import { actLearnReuse, extractLearnings, loadExpertise } from "./expertise-manager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXPERTISE_DIR = join(__dirname, "expertise");

// Test expertise file for isolation
const TEST_MODE = "test_integration";
const TEST_EXPERTISE_PATH = join(EXPERTISE_DIR, `${TEST_MODE}.md`);

describe("Act-Learn-Reuse Integration", () => {
	beforeEach(() => {
		// Create test expertise file
		const template = `# Test Integration Expert

## Mental Model
Test expert for integration testing.

*Last updated: Never*
*Total sessions: 0*

## Patterns Learned
<!-- Test patterns -->

## Common Pitfalls
<!-- Test pitfalls -->

## Session Insights
<!-- Recent learning sessions are stored here -->
`;
		writeFileSync(TEST_EXPERTISE_PATH, template);
	});

	afterEach(() => {
		// Clean up test file - restore to template
		if (existsSync(TEST_EXPERTISE_PATH)) {
			const template = `# Test Integration Expert

## Mental Model
Test expert for integration testing.

*Last updated: Never*
*Total sessions: 0*

## Patterns Learned
<!-- Test patterns -->

## Common Pitfalls
<!-- Test pitfalls -->

## Session Insights
<!-- Recent learning sessions are stored here -->
`;
			writeFileSync(TEST_EXPERTISE_PATH, template);
		}
	});

	describe("Complete Cycle", () => {
		it("should execute ACT phase with expertise injection", async () => {
			const task = "Test task for integration";
			let receivedPrompt = "";

			const executor = async (enhancedTask: string) => {
				receivedPrompt = enhancedTask;
				return {
					success: true,
					output: "Task completed successfully",
				};
			};

			await actLearnReuse(TEST_MODE, task, executor);

			// Verify expertise was injected into prompt
			expect(receivedPrompt).toContain(task);
			expect(receivedPrompt).toContain("---"); // Self-improve separator
		});

		it("should execute LEARN phase and extract insights", async () => {
			const task = "Analyze this code";
			const learningOutput = `Analysis complete.

## What I Learned
- Always check for null values before accessing properties
- Use TypeScript strict mode for better type safety
- Prefer const over let for immutable bindings

Task completed.`;

			const executor = async (_enhancedTask: string) => ({
				success: true,
				output: learningOutput,
			});

			const result = await actLearnReuse(TEST_MODE, task, executor);

			expect(result.success).toBe(true);
			expect(result.learned.learned).toBe(true);
			expect(result.learned.insight).toContain("null values");
		});

		it("should execute REUSE phase by persisting learnings", async () => {
			// First execution with learnings
			const learningOutput = `Done.

## Learnings
- Important pattern: Always validate inputs
- Key insight: Use early returns for cleaner code`;

			const executor = async (_enhancedTask: string) => ({
				success: true,
				output: learningOutput,
			});

			await actLearnReuse(TEST_MODE, "First task", executor);

			// Verify learnings were persisted
			const expertise = loadExpertise(TEST_MODE);
			expect(expertise).toContain("validate inputs");
		});

		it("should accumulate learnings across multiple executions", async () => {
			// First execution
			const executor1 = async (_enhancedTask: string) => ({
				success: true,
				output: `## What I Learned
- First learning: Use dependency injection`,
			});
			await actLearnReuse(TEST_MODE, "Task 1", executor1);

			// Second execution
			const executor2 = async (_enhancedTask: string) => ({
				success: true,
				output: `## What I Learned
- Second learning: Prefer composition over inheritance`,
			});
			await actLearnReuse(TEST_MODE, "Task 2", executor2);

			// Both learnings should be in expertise
			const expertise = loadExpertise(TEST_MODE);
			expect(expertise).toContain("dependency injection");
			expect(expertise).toContain("composition over inheritance");
		});
	});

	describe("Expert Selection", () => {
		it("should auto-select correct expert based on task", async () => {
			// Mock executor
			const executor = async (_enhancedTask: string) => {
				return { success: true, output: "Done" };
			};

			// Test security task
			const securityResult = await executeWithAutoExpert("Review authentication for XSS vulnerabilities", executor);
			expect(securityResult.expert).toBe("security");

			// Test database task
			const dbResult = await executeWithAutoExpert("Optimize SQL query performance", executor);
			expect(dbResult.expert).toBe("database");

			// Test performance task
			const perfResult = await executeWithAutoExpert("Profile memory usage and optimize caching", executor);
			expect(perfResult.expert).toBe("performance");
		});
	});

	describe("Learning Extraction", () => {
		it("should extract learnings from various marker formats", () => {
			const outputs = [
				{ text: "## What I Learned\n- Insight 1", expected: "Insight 1" },
				{ text: "## Learnings\n- Key point", expected: "Key point" },
				{ text: "## Key Takeaways\n- Important lesson", expected: "Important lesson" },
				{ text: "## Insights\n- Discovery", expected: "Discovery" },
			];

			for (const { text, expected } of outputs) {
				const learnings = extractLearnings(text);
				expect(learnings).toContain(expected);
			}
		});

		it("should prefer learning markers over generic sections", () => {
			// Output with learning section should extract from there
			const outputWithLearning = `## Summary
Some summary text

## What I Learned
- The actual learning point

## Next Steps
Things to do next`;

			const learnings = extractLearnings(outputWithLearning);
			expect(learnings).toContain("actual learning point");
			expect(learnings).not.toContain("Next Steps");
		});
	});

	describe("Expert Methods", () => {
		it("should create prompts with expertise and self-improve instructions", () => {
			const expert = getExpert("security");
			const prompt = expert.createPrompt("Check this authentication code");

			expect(prompt).toContain("Check this authentication code");
			expect(prompt).toContain("---");
			// Should include self-improve prompt
			expect(prompt.length).toBeGreaterThan(100);
		});

		it("should learn from execution output", () => {
			const expert = getExpert(TEST_MODE);
			const output = `## What I Learned
- Test learning for expert method`;

			const result = expert.learn(output, "Test task", true);

			expect(result.learned).toBe(true);
			expect(result.insight).toContain("Test learning");
		});
	});

	describe("Error Handling", () => {
		it("should handle failed executions gracefully", async () => {
			const executor = async (_enhancedTask: string) => ({
				success: false,
				output: "Execution failed",
			});

			const result = await actLearnReuse(TEST_MODE, "Failing task", executor);

			expect(result.success).toBe(false);
			// Should still attempt to learn from failure
			expect(result.learned).toBeDefined();
		});

		it("should handle empty output gracefully", async () => {
			const executor = async (_enhancedTask: string) => ({
				success: true,
				output: "",
			});

			const result = await actLearnReuse(TEST_MODE, "Empty output task", executor);

			expect(result.success).toBe(true);
			expect(result.learned.learned).toBe(false);
		});
	});

	describe("Bounded Learning", () => {
		it("should prevent unbounded expertise growth", async () => {
			// Generate many learning sessions
			for (let i = 0; i < 10; i++) {
				const executor = async (_enhancedTask: string) => ({
					success: true,
					output: `## What I Learned
- Learning session ${i}: Insight ${i}`,
				});
				await actLearnReuse(TEST_MODE, `Task ${i}`, executor);
			}

			// Expertise file should not grow indefinitely
			const expertise = loadExpertise(TEST_MODE);
			// Max 5 session insights (bounded)
			const sessionMatches = expertise.match(/Learning session \d+/g) || [];
			expect(sessionMatches.length).toBeLessThanOrEqual(5);
		});
	});
});
