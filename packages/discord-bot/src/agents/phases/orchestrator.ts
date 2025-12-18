/**
 * Two-Phase Orchestrator
 * Coordinates Planning (Phase 1) and Execution (Phase 2)
 */

import { existsSync, readdirSync } from "fs";
import { executeAllFeatures, executeNextFeature, loadTaskSpec } from "./executor.js";
import { getSessionDir, initializeTask } from "./initializer.js";
import type { OrchestratorResult, TaskStatus, TwoPhaseOptions } from "./types.js";

/**
 * Run complete two-phase agent workflow
 * Phase 1: Initialize (plan features)
 * Phase 2: Execute (implement features one by one)
 */
export async function runTwoPhaseAgent(options: TwoPhaseOptions): Promise<OrchestratorResult> {
	const { autoExecute = true, continueOnError = false, maxRetries = 1, ...initOptions } = options;

	const startTime = Date.now();

	// Phase 1: Planning
	const spec = await initializeTask(initOptions);

	console.log(`[Two-Phase] Task initialized: ${spec.id}`);
	console.log(`[Two-Phase] Features planned: ${spec.features.length}`);

	if (!autoExecute) {
		// Return after planning
		return {
			taskId: spec.id,
			success: true,
			spec,
			results: [],
			totalDuration: Date.now() - startTime,
			summary: {
				featuresCompleted: 0,
				featuresFailed: 0,
				totalLearnings: 0,
				expertiseModes: [spec.mode],
			},
		};
	}

	// Phase 2: Execution
	console.log(`[Two-Phase] Starting execution phase...`);

	const results = await executeAllFeatures({
		taskId: spec.id,
		maxRetries,
		enableLearning: initOptions.enableLearning !== false,
		pauseOnError: !continueOnError,
	});

	// Load final spec
	const finalSpec = loadTaskSpec(spec.id);

	// Calculate summary
	const featuresCompleted = results.filter((r) => r.success).length;
	const featuresFailed = results.filter((r) => !r.success).length;
	const totalLearnings = results.filter((r) => r.learned?.learned).length;

	return {
		taskId: spec.id,
		success: finalSpec.status === "completed",
		spec: finalSpec,
		results,
		totalDuration: Date.now() - startTime,
		summary: {
			featuresCompleted,
			featuresFailed,
			totalLearnings,
			expertiseModes: [finalSpec.mode],
		},
	};
}

/**
 * Resume an incomplete task
 * Continues execution from where it left off
 */
export async function resumeTask(taskId: string, options: Partial<TwoPhaseOptions> = {}): Promise<OrchestratorResult> {
	const { continueOnError = false, maxRetries = 1, enableLearning = true } = options;

	const startTime = Date.now();
	const spec = loadTaskSpec(taskId);

	console.log(`[Two-Phase] Resuming task: ${taskId}`);
	console.log(`[Two-Phase] Progress: ${spec.metadata?.completedFeatures}/${spec.metadata?.totalFeatures} features`);

	// Update status
	spec.status = "executing";

	// Execute remaining features
	const results = await executeAllFeatures({
		taskId,
		maxRetries,
		enableLearning,
		pauseOnError: !continueOnError,
	});

	// Load final spec
	const finalSpec = loadTaskSpec(taskId);

	// Calculate summary
	const featuresCompleted = results.filter((r) => r.success).length;
	const featuresFailed = results.filter((r) => !r.success).length;
	const totalLearnings = results.filter((r) => r.learned?.learned).length;

	return {
		taskId,
		success: finalSpec.status === "completed",
		spec: finalSpec,
		results,
		totalDuration: Date.now() - startTime,
		summary: {
			featuresCompleted,
			featuresFailed,
			totalLearnings,
			expertiseModes: [finalSpec.mode],
		},
	};
}

/**
 * Get task status and progress
 */
export function getTaskStatus(taskId: string): TaskStatus {
	const spec = loadTaskSpec(taskId);

	const total = spec.features.length;
	const completed = spec.features.filter((f) => f.status === "completed").length;
	const failed = spec.features.filter((f) => f.status === "failed").length;
	const pending = spec.features.filter((f) => f.status === "pending").length;
	const inProgress = spec.features.filter((f) => f.status === "in_progress").length;

	const percentComplete = total > 0 ? Math.round((completed / total) * 100) : 0;

	// Find next feature
	const nextFeature = spec.features.find((f) => f.status === "pending");

	const canResume = spec.status !== "completed" && (pending > 0 || inProgress > 0);

	return {
		taskId,
		spec,
		progress: {
			total,
			completed,
			failed,
			pending,
			inProgress,
			percentComplete,
		},
		canResume,
		nextFeature,
	};
}

/**
 * List all tasks
 */
export function listTasks(): TaskStatus[] {
	const sessionsDir = getSessionDir("");
	if (!existsSync(sessionsDir)) {
		return [];
	}

	const taskIds = readdirSync(sessionsDir);
	return taskIds
		.filter((id) => existsSync(getSessionDir(id) + "/spec.json"))
		.map((id) => getTaskStatus(id))
		.sort((a, b) => {
			const aTime = new Date(a.spec.updatedAt).getTime();
			const bTime = new Date(b.spec.updatedAt).getTime();
			return bTime - aTime; // Most recent first
		});
}

/**
 * Execute a single step (one feature) of a task
 * Useful for step-by-step execution
 */
export async function executeStep(taskId: string, enableLearning = true): Promise<OrchestratorResult> {
	const startTime = Date.now();
	const result = await executeNextFeature({ taskId, enableLearning });
	const finalSpec = loadTaskSpec(taskId);

	return {
		taskId,
		success: result.success,
		spec: finalSpec,
		results: [result],
		totalDuration: Date.now() - startTime,
		summary: {
			featuresCompleted: result.success ? 1 : 0,
			featuresFailed: result.success ? 0 : 1,
			totalLearnings: result.learned?.learned ? 1 : 0,
			expertiseModes: [finalSpec.mode],
		},
	};
}
