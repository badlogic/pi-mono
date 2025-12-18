/**
 * Two-Phase Agent Test Examples
 * Run with: npx tsx src/agents/phases/test-example.ts
 */

import { executeStep, getTaskStatus, listTasks, resumeTask, runTwoPhaseAgent } from "./orchestrator.js";

async function example1_FullWorkflow() {
	console.log("\n=== Example 1: Full Workflow (Plan + Execute) ===\n");

	const result = await runTwoPhaseAgent({
		prompt: `Create a simple Node.js REST API with:
- Express server setup
- User CRUD endpoints (GET, POST, PUT, DELETE)
- SQLite database integration
- Input validation middleware
- Error handling`,
		mode: "coding",
		autoExecute: true,
		continueOnError: true,
		maxRetries: 2,
		maxFeatures: 6,
		enableLearning: true,
	});

	console.log(`Task ID: ${result.taskId}`);
	console.log(`Status: ${result.spec.status}`);
	console.log(`Duration: ${(result.totalDuration / 1000).toFixed(2)}s`);
	console.log(`\nSummary:`);
	console.log(`  Features completed: ${result.summary.featuresCompleted}/${result.spec.features.length}`);
	console.log(`  Features failed: ${result.summary.featuresFailed}`);
	console.log(`  Total learnings: ${result.summary.totalLearnings}`);

	console.log(`\nFeatures:`);
	result.spec.features.forEach((f, i) => {
		const status = f.status === "completed" ? "✓" : f.status === "failed" ? "✗" : "○";
		console.log(`  ${status} ${i + 1}. ${f.name} (${f.priority})`);
	});

	return result.taskId;
}

async function example2_PlanThenExecute() {
	console.log("\n=== Example 2: Plan First, Review, Then Execute ===\n");

	// Phase 1: Planning only
	const planResult = await runTwoPhaseAgent({
		prompt: `Build a crypto trading bot with:
- Hyperliquid API integration
- WebSocket price feeds
- Risk management system
- Trade execution engine
- Performance tracking`,
		mode: "trading",
		autoExecute: false, // Plan only
		maxFeatures: 8,
	});

	console.log(`Task ID: ${planResult.taskId}`);
	console.log(`\nPlanned Features (${planResult.spec.features.length}):`);
	planResult.spec.features.forEach((f, i) => {
		console.log(`  ${i + 1}. ${f.name} (${f.priority})`);
		console.log(`     ${f.description.substring(0, 80)}...`);
		if (f.dependencies?.length) {
			console.log(`     Dependencies: ${f.dependencies.length}`);
		}
	});

	// Phase 2: Execute with user approval simulation
	console.log(`\n--- Ready to execute? Simulating user approval ---\n`);

	const execResult = await resumeTask(planResult.taskId, {
		continueOnError: true,
		maxRetries: 2,
		enableLearning: true,
	});

	console.log(`Execution Status: ${execResult.spec.status}`);
	console.log(`Completed: ${execResult.summary.featuresCompleted}/${execResult.spec.features.length}`);

	return planResult.taskId;
}

async function example3_StepByStep() {
	console.log("\n=== Example 3: Step-by-Step Execution ===\n");

	// Initialize task
	const planResult = await runTwoPhaseAgent({
		prompt: "Research the top 5 DeFi protocols by TVL and compare their yields",
		mode: "research",
		autoExecute: false,
		maxFeatures: 5,
	});

	console.log(`Task: ${planResult.taskId}`);
	console.log(`Features: ${planResult.spec.features.length}\n`);

	// Execute one step at a time
	for (let i = 0; i < 3; i++) {
		// Execute max 3 steps for demo
		const status = getTaskStatus(planResult.taskId);

		if (!status.canResume) {
			console.log("Task complete!");
			break;
		}

		console.log(`--- Step ${i + 1} ---`);
		console.log(`Executing: ${status.nextFeature?.name}`);

		const result = await executeStep(planResult.taskId);

		console.log(`Result: ${result.success ? "SUCCESS ✓" : "FAILED ✗"}`);
		console.log(`Progress: ${result.spec.metadata?.completedFeatures}/${result.spec.metadata?.totalFeatures}`);
		const lastResult = result.results[result.results.length - 1];
		console.log(`Output: ${(lastResult?.output || "").substring(0, 150)}...\n`);

		if (lastResult?.learned?.learned) {
			console.log(`Learning: ${lastResult.learned.insight.substring(0, 100)}...\n`);
		}
	}

	return planResult.taskId;
}

async function example4_ResumeTask(taskId?: string) {
	console.log("\n=== Example 4: Resume Incomplete Task ===\n");

	if (!taskId) {
		console.log("No task ID provided, creating a new incomplete task...");

		const result = await runTwoPhaseAgent({
			prompt: "Create a comprehensive testing suite with unit, integration, and e2e tests",
			mode: "coding",
			autoExecute: false,
			maxFeatures: 6,
		});

		taskId = result.taskId;

		// Execute only first 2 features
		await executeStep(taskId);
		await executeStep(taskId);
	}

	// Check status before resume
	const statusBefore = getTaskStatus(taskId);
	console.log(`Task: ${taskId}`);
	console.log(`Status: ${statusBefore.spec.status}`);
	console.log(`Progress: ${statusBefore.progress.percentComplete}%`);
	console.log(`Can resume: ${statusBefore.canResume}`);

	if (!statusBefore.canResume) {
		console.log("Task already completed or cannot be resumed");
		return taskId;
	}

	console.log(`\n--- Resuming execution ---\n`);

	// Resume from where it left off
	const result = await resumeTask(taskId, {
		continueOnError: true,
		maxRetries: 1,
	});

	console.log(`Final Status: ${result.spec.status}`);
	console.log(`Features completed: ${result.summary.featuresCompleted}`);
	console.log(`Features failed: ${result.summary.featuresFailed}`);

	return taskId;
}

async function example5_ListTasks() {
	console.log("\n=== Example 5: List All Tasks ===\n");

	const tasks = listTasks();

	if (tasks.length === 0) {
		console.log("No tasks found. Create one first!");
		return;
	}

	console.log(`Total tasks: ${tasks.length}\n`);

	tasks.slice(0, 5).forEach((task, i) => {
		console.log(`${i + 1}. ${task.taskId}`);
		console.log(`   Title: ${task.spec.title.substring(0, 60)}...`);
		console.log(`   Status: ${task.spec.status}`);
		console.log(`   Progress: ${task.progress.percentComplete}%`);
		console.log(`   Updated: ${task.spec.updatedAt}`);
		if (task.canResume) {
			console.log(`   ⚠️ Can be resumed (next: ${task.nextFeature?.name})`);
		}
		console.log();
	});
}

async function main() {
	console.log("Two-Phase Agent Test Examples");
	console.log("==============================");

	try {
		// Run examples in sequence
		const taskId1 = await example1_FullWorkflow();
		await new Promise((resolve) => setTimeout(resolve, 1000));

		const taskId2 = await example2_PlanThenExecute();
		await new Promise((resolve) => setTimeout(resolve, 1000));

		const taskId3 = await example3_StepByStep();
		await new Promise((resolve) => setTimeout(resolve, 1000));

		const taskId4 = await example4_ResumeTask();
		await new Promise((resolve) => setTimeout(resolve, 1000));

		await example5_ListTasks();

		console.log("\n=== All examples completed! ===\n");
		console.log("Task IDs created:");
		console.log(`  1. ${taskId1}`);
		console.log(`  2. ${taskId2}`);
		console.log(`  3. ${taskId3}`);
		console.log(`  4. ${taskId4}`);
	} catch (error) {
		console.error("Error running examples:", error);
		process.exit(1);
	}
}

// Uncomment to run:
// main();

export {
	example1_FullWorkflow,
	example2_PlanThenExecute,
	example3_StepByStep,
	example4_ResumeTask,
	example5_ListTasks,
};
