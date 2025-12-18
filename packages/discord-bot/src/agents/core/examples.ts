/**
 * PAI Core Examples - Integration with Act-Learn-Reuse
 *
 * Demonstrates how to use PAI principles with the existing
 * discord-bot agent architecture.
 */

import { actLearnReuse } from "../expertise-manager.js";
import { runAgent } from "../lightweight-agent.js";
import { History, HistoryManager } from "./history.js";
import { BuiltInHooks, Hooks, setupAgentHooks } from "./hooks.js";
import { CLEAR_THINKING, DETERMINISM } from "./principles.js";
import { SkillBuilder, type SkillOutput, SkillRegistry } from "./skill.js";

/**
 * Example 1: Create a skill with hooks and history
 */
export async function example1_SkillWithHooksAndHistory() {
	console.log("\n=== Example 1: Skill with Hooks and History ===\n");

	// Initialize infrastructure
	const history = new HistoryManager("/tmp/pai-example", { maxEntries: 100 });
	const skills = new SkillRegistry("/tmp/pai-example/skills");

	// Setup hooks
	setupAgentHooks();

	// Add history hook
	Hooks.afterExecute(
		async (context, data) => {
			const result = data as SkillOutput;

			history.add(
				result.success
					? History.success(context.component, "Skill execution completed", JSON.stringify(result.data), {
							duration: result.metadata?.duration,
							confidence: result.metadata?.confidence,
						})
					: History.error(context.component, "Skill execution failed", result.error || "Unknown error"),
			);

			return { success: true };
		},
		{ name: "history-recorder" },
	);

	// Create a code review skill
	const codeReviewSkill = new SkillBuilder()
		.name("code_reviewer")
		.version("1.0.0")
		.description("Review code for bugs and improvements")
		.modes("fast", "thorough")
		.tags("code", "review", "quality")
		.validator((input) => {
			const errors: string[] = [];
			if (!input.code || typeof input.code !== "string") {
				errors.push("Missing or invalid 'code' field");
			}
			return { valid: errors.length === 0, errors };
		})
		.executor(async (input, context) => {
			const code = input.code as string;
			const mode = context?.mode || "fast";

			// Use lightweight agent with structured prompt (Principle 1)
			const structuredPrompt = CLEAR_THINKING.structuredPrompt({
				task: "Review the following code for bugs, security issues, and improvements",
				context: `Code to review:\n\`\`\`\n${code}\n\`\`\``,
				constraints: [
					"Focus on critical issues first",
					"Provide specific line numbers",
					"Suggest concrete improvements",
				],
				outputFormat: "Markdown with ## Issues and ## Improvements sections",
			});

			// Use deterministic config (Principle 2)
			const taskType = DETERMINISM.classifyTask(structuredPrompt);
			const config = taskType === "deterministic" ? DETERMINISM.deterministicConfig : DETERMINISM.creativeConfig;

			const result = await runAgent({
				prompt: structuredPrompt,
				model: "glm-4.6",
				maxTokens: 4000,
				// Apply determinism principle
				...config,
			});

			return {
				success: result.success,
				data: result.output,
				error: result.error,
				metadata: {
					duration: result.duration,
					tokensUsed: result.tokens?.total,
					confidence: result.success ? 0.9 : 0.3,
				},
			};
		})
		.build();

	// Register skill
	skills.register(codeReviewSkill);

	// Execute skill
	const result = await skills.execute(
		"code_reviewer",
		{
			code: `function getUserById(id) {
  return users.find(u => u.id == id); // Bug: should use ===
}`,
		},
		{
			mode: "thorough",
			userId: "example-user",
		},
	);

	console.log("Skill result:", result);
	console.log("\nHistory stats:", history.getStats());
	console.log("Recent history:", history.recent(3));

	return { skills, history };
}

/**
 * Example 2: Act-Learn-Reuse with PAI principles
 */
export async function example2_ActLearnReuseWithPAI() {
	console.log("\n=== Example 2: Act-Learn-Reuse with PAI ===\n");

	const history = new HistoryManager("/tmp/pai-example", { maxEntries: 100 });

	// Task: Analyze trading data
	const task = "Analyze BTC price action and identify key support/resistance levels";

	// Use Act-Learn-Reuse cycle with history tracking
	const { success, output, learned } = await actLearnReuse("trading", task, async (enhancedTask) => {
		// Log task start
		history.add(
			History.task("trading-agent", task, enhancedTask, {
				tags: ["trading", "analysis"],
			}),
		);

		// Execute with structured prompt (Principle 1)
		const structuredPrompt = CLEAR_THINKING.structuredPrompt({
			task: enhancedTask,
			context: "You are analyzing Bitcoin price action",
			constraints: ["Use technical analysis", "Provide specific price levels", "Include timeframes"],
			outputFormat: "Markdown with ## Analysis, ## Support Levels, ## Resistance Levels",
		});

		const result = await runAgent({
			prompt: structuredPrompt,
			model: "glm-4.6",
			maxTokens: 4000,
		});

		// Record learning
		if (result.success && learned?.learned) {
			history.add(
				History.learning("trading-agent", learned.insight, learned.expertiseFile, {
					tags: ["trading", "learning"],
				}),
			);
		}

		return {
			success: result.success,
			output: result.output,
			result,
		};
	});

	console.log("Success:", success);
	console.log("Output:", output.substring(0, 200));
	console.log("Learned:", learned);

	// Build context from history for next task
	const relevantHistory = history.buildContext({
		component: "trading-agent",
		tags: ["trading"],
		limit: 5,
	});

	console.log("\nRelevant history context:", relevantHistory.substring(0, 200));

	return { success, output, learned, history };
}

/**
 * Example 3: Multi-agent pipeline with hooks
 */
export async function example3_MultiAgentPipeline() {
	console.log("\n=== Example 3: Multi-Agent Pipeline ===\n");

	const skills = new SkillRegistry("/tmp/pai-example/skills");
	const history = new HistoryManager("/tmp/pai-example", { maxEntries: 100 });

	// Setup timing hooks
	Hooks.beforeExecute(BuiltInHooks.timer(), { priority: "high", name: "timer-start" });
	Hooks.afterExecute(BuiltInHooks.timer(), { priority: "low", name: "timer-end" });

	// Setup rate limiting
	Hooks.beforeExecute(BuiltInHooks.rateLimiter(60), { priority: "highest", name: "rate-limiter" });

	// Create research skill
	const researchSkill = new SkillBuilder()
		.name("researcher")
		.version("1.0.0")
		.description("Research a topic and provide summary")
		.modes("fast", "deep")
		.executor(async (input) => {
			const topic = input.topic as string;

			const result = await runAgent({
				prompt: `Research the following topic: ${topic}`,
				model: "glm-4.6",
				maxTokens: 8000,
			});

			return {
				success: result.success,
				data: result.output,
				error: result.error,
			};
		})
		.build();

	// Create summarizer skill
	const summarizerSkill = new SkillBuilder()
		.name("summarizer")
		.version("1.0.0")
		.description("Summarize text")
		.executor(async (input) => {
			const text = input.text as string;

			const result = await runAgent({
				prompt: `Summarize the following text:\n\n${text}`,
				model: "glm-4.6",
				maxTokens: 2000,
			});

			return {
				success: result.success,
				data: result.output,
			};
		})
		.build();

	skills.register(researchSkill);
	skills.register(summarizerSkill);

	// Pipeline: Research → Summarize
	const topic = "WebGPU shader optimization techniques";

	console.log("Step 1: Research");
	const researchResult = await skills.execute("researcher", { topic }, { mode: "deep" });

	if (!researchResult.success) {
		console.error("Research failed:", researchResult.error);
		return;
	}

	console.log("Step 2: Summarize");
	const summaryResult = await skills.execute("summarizer", { text: researchResult.data }, { mode: "fast" });

	console.log("\nFinal summary:", summaryResult.data);

	// Export history
	const report = history.exportMarkdown();
	console.log("\n=== History Report ===");
	console.log(report.substring(0, 500));

	return { research: researchResult, summary: summaryResult };
}

/**
 * Example 4: Observable skill with error recovery
 */
export async function example4_ObservableSkillWithRecovery() {
	console.log("\n=== Example 4: Observable Skill with Error Recovery ===\n");

	const skills = new SkillRegistry("/tmp/pai-example/skills");

	// Create skill with fallback
	const unstableSkill = new SkillBuilder()
		.name("unstable_processor")
		.version("1.0.0")
		.description("A skill that might fail")
		.executor(async (_input) => {
			const shouldFail = Math.random() < 0.5;

			if (shouldFail) {
				throw new Error("Random failure for demonstration");
			}

			return {
				success: true,
				data: "Processed successfully",
			};
		})
		.build();

	skills.register(unstableSkill);

	// Add error recovery hook
	Hooks.onError(
		BuiltInHooks.errorRecovery(async (_context, error) => {
			console.log(`[Recovery] Attempting fallback for error: ${error}`);

			// Fallback strategy
			return {
				success: true,
				data: "Fallback result - used simpler approach",
				metadata: {
					fallbackUsed: true,
				},
			};
		}),
		{ name: "error-recovery" },
	);

	// Try execution multiple times
	let attempts = 0;
	let result: SkillOutput | null = null;

	while (attempts < 3 && (!result || !result.success)) {
		attempts++;
		console.log(`\nAttempt ${attempts}:`);

		result = await skills.execute("unstable_processor", { input: "test" });

		console.log("Result:", result);
	}

	return result;
}

/**
 * Run all examples
 */
export async function runAllExamples() {
	console.log("╔═══════════════════════════════════════════════════════╗");
	console.log("║   PAI Core Examples - Discord Bot Integration        ║");
	console.log("╚═══════════════════════════════════════════════════════╝");

	try {
		await example1_SkillWithHooksAndHistory();
		await example2_ActLearnReuseWithPAI();
		await example3_MultiAgentPipeline();
		await example4_ObservableSkillWithRecovery();

		console.log("\n✅ All examples completed successfully!");
	} catch (error) {
		console.error("\n❌ Example failed:", error);
	}
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
	runAllExamples();
}
