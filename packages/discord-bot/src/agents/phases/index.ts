/**
 * Two-Phase Agent Execution Pattern
 * Based on leonvanzyl/autonomous-coding
 *
 * Usage:
 *
 * // Full workflow (plan + execute all)
 * const result = await runTwoPhaseAgent({
 *   prompt: "Build a REST API with auth",
 *   mode: "coding",
 *   autoExecute: true
 * });
 *
 * // Plan only (no execution)
 * const spec = await initializeTask({
 *   prompt: "Build a REST API",
 *   mode: "coding"
 * });
 *
 * // Execute step by step
 * await executeStep(spec.id); // Execute first feature
 * await executeStep(spec.id); // Execute second feature
 *
 * // Resume incomplete task
 * const result = await resumeTask(taskId);
 *
 * // Check progress
 * const status = getTaskStatus(taskId);
 * console.log(`${status.progress.percentComplete}% complete`);
 */

// Phase 2: Execution
export {
	executeAllFeatures,
	executeFeature,
	executeNextFeature,
	getNextFeature,
	loadTaskSpec,
	updateFeature,
	updateTaskSpec,
} from "./executor.js";

// Phase 1: Planning
export { getSessionDir, getSpecPath, initializeTask, replanTask, saveTaskSpec } from "./initializer.js";
// Orchestration
export {
	executeStep,
	getTaskStatus,
	listTasks,
	resumeTask,
	runTwoPhaseAgent,
} from "./orchestrator.js";
// Types
export type {
	ExecuteOptions,
	Feature,
	InitializeOptions,
	OrchestratorResult,
	PhaseResult,
	TaskSpec,
	TaskStatus,
	TwoPhaseOptions,
} from "./types.js";
