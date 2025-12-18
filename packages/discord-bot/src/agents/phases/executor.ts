/**
 * Phase 2: Execution Agent (Executor)
 * Executes features one by one with learning
 */

import { existsSync, readFileSync } from "fs";
import { runLearningAgent } from "../lightweight-agent.js";
import { getSpecPath, saveTaskSpec } from "./initializer.js";
import type { ExecuteOptions, Feature, PhaseResult, TaskSpec } from "./types.js";

/**
 * Load task spec from disk
 */
export function loadTaskSpec(taskId: string): TaskSpec {
	const specPath = getSpecPath(taskId);
	if (!existsSync(specPath)) {
		throw new Error(`Task ${taskId} not found`);
	}

	return JSON.parse(readFileSync(specPath, "utf-8"));
}

/**
 * Update task spec on disk
 */
export function updateTaskSpec(taskId: string, updates: Partial<TaskSpec>): TaskSpec {
	const spec = loadTaskSpec(taskId);
	const updated = {
		...spec,
		...updates,
		updatedAt: new Date().toISOString(),
	};
	saveTaskSpec(updated);
	return updated;
}

/**
 * Update a specific feature in the task spec
 */
export function updateFeature(taskId: string, featureId: string, updates: Partial<Feature>): TaskSpec {
	const spec = loadTaskSpec(taskId);
	const featureIndex = spec.features.findIndex((f) => f.id === featureId);

	if (featureIndex === -1) {
		throw new Error(`Feature ${featureId} not found in task ${taskId}`);
	}

	spec.features[featureIndex] = {
		...spec.features[featureIndex],
		...updates,
	};

	// Update metadata
	spec.metadata = {
		...spec.metadata,
		totalFeatures: spec.features.length,
		completedFeatures: spec.features.filter((f) => f.status === "completed").length,
		failedFeatures: spec.features.filter((f) => f.status === "failed").length,
	};

	saveTaskSpec(spec);
	return spec;
}

/**
 * Get next pending feature to execute
 * Respects dependencies and priorities
 */
export function getNextFeature(spec: TaskSpec): Feature | undefined {
	// Filter pending features
	const pending = spec.features.filter((f) => f.status === "pending");

	if (pending.length === 0) {
		return undefined;
	}

	// Filter by dependencies (only features with no incomplete dependencies)
	const completedIds = new Set(spec.features.filter((f) => f.status === "completed").map((f) => f.id));

	const available = pending.filter((f) => {
		if (!f.dependencies || f.dependencies.length === 0) {
			return true;
		}
		return f.dependencies.every((depId) => completedIds.has(depId));
	});

	if (available.length === 0) {
		// All pending features have incomplete dependencies
		return undefined;
	}

	// Sort by priority (critical > high > medium > low)
	const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
	available.sort((a, b) => {
		const aPriority = priorityOrder[a.priority] ?? 2;
		const bPriority = priorityOrder[b.priority] ?? 2;
		return aPriority - bPriority;
	});

	return available[0];
}

/**
 * Execute a single feature
 */
export async function executeFeature(taskId: string, feature: Feature, enableLearning = true): Promise<PhaseResult> {
	const spec = loadTaskSpec(taskId);
	const _startTime = Date.now(); // Reserved for future duration tracking

	// Mark feature as in progress
	updateFeature(taskId, feature.id, {
		status: "in_progress",
		startedAt: new Date().toISOString(),
	});

	try {
		// Build execution prompt with context
		const contextPrompt = buildFeatureContext(spec, feature);

		// Execute with learning
		const result = await runLearningAgent({
			prompt: contextPrompt,
			mode: spec.mode,
			enableLearning,
			maxTokens: 8000,
			timeout: 120000,
		});

		if (!result.success) {
			// Mark as failed
			updateFeature(taskId, feature.id, {
				status: "failed",
				error: result.error || "Execution failed",
				completedAt: new Date().toISOString(),
			});

			const updatedSpec = loadTaskSpec(taskId);
			return {
				success: false,
				output: result.output,
				error: result.error,
				featuresCompleted: updatedSpec.metadata?.completedFeatures || 0,
				featuresTotal: updatedSpec.metadata?.totalFeatures || 0,
				currentFeature: feature,
			};
		}

		// Mark as completed
		updateFeature(taskId, feature.id, {
			status: "completed",
			output: result.output,
			learnings: result.learned?.insight,
			completedAt: new Date().toISOString(),
		});

		const updatedSpec = loadTaskSpec(taskId);
		const nextFeature = getNextFeature(updatedSpec);

		return {
			success: true,
			output: result.output,
			featuresCompleted: updatedSpec.metadata?.completedFeatures || 0,
			featuresTotal: updatedSpec.metadata?.totalFeatures || 0,
			currentFeature: feature,
			nextFeature,
			learned: result.learned,
		};
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);

		updateFeature(taskId, feature.id, {
			status: "failed",
			error: errMsg,
			completedAt: new Date().toISOString(),
		});

		const updatedSpec = loadTaskSpec(taskId);
		return {
			success: false,
			output: "",
			error: errMsg,
			featuresCompleted: updatedSpec.metadata?.completedFeatures || 0,
			featuresTotal: updatedSpec.metadata?.totalFeatures || 0,
			currentFeature: feature,
		};
	}
}

/**
 * Build execution prompt with full context
 */
function buildFeatureContext(spec: TaskSpec, feature: Feature): string {
	const completedFeatures = spec.features
		.filter((f) => f.status === "completed")
		.map((f) => `- ${f.name}: ✓ Completed`)
		.join("\n");

	const dependencyContext = feature.dependencies
		? spec.features
				.filter((f) => feature.dependencies?.includes(f.id))
				.map((f) => `### ${f.name}\n${f.output || f.description}`)
				.join("\n\n")
		: "";

	return `You are working on a multi-feature project. Execute the following feature:

## Overall Task
${spec.description}

## Current Feature
**${feature.name}**
${feature.description}

Priority: ${feature.priority}

${
	completedFeatures
		? `## Previously Completed Features
${completedFeatures}`
		: ""
}

${
	dependencyContext
		? `## Context from Dependencies
${dependencyContext}`
		: ""
}

---

Execute this feature completely. Provide:
1. Implementation details or code if applicable
2. Verification that the feature works
3. Any important notes or learnings

Be thorough and complete the entire feature in this execution.`;
}

/**
 * Execute the next pending feature in a task
 */
export async function executeNextFeature(options: ExecuteOptions): Promise<PhaseResult> {
	const { taskId, enableLearning = true } = options;

	const spec = loadTaskSpec(taskId);
	const nextFeature = getNextFeature(spec);

	if (!nextFeature) {
		// No more features to execute
		const allCompleted = spec.features.every((f) => f.status === "completed");
		const status = allCompleted ? "completed" : "failed";

		updateTaskSpec(taskId, { status });

		return {
			success: allCompleted,
			output: allCompleted
				? "All features completed successfully"
				: "No more features available (some may have unmet dependencies)",
			featuresCompleted: spec.metadata?.completedFeatures || 0,
			featuresTotal: spec.metadata?.totalFeatures || 0,
		};
	}

	return executeFeature(taskId, nextFeature, enableLearning);
}

/**
 * Execute all remaining features in a task
 */
export async function executeAllFeatures(options: ExecuteOptions): Promise<PhaseResult[]> {
	const { taskId, maxRetries = 1, enableLearning = true, pauseOnError = false } = options;

	const results: PhaseResult[] = [];
	let retries = 0;

	// Update task status
	updateTaskSpec(taskId, { status: "executing" });

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const result = await executeNextFeature({ taskId, enableLearning });
		results.push(result);

		// No more features
		if (!result.nextFeature) {
			break;
		}

		// Handle errors
		if (!result.success) {
			if (pauseOnError) {
				break;
			}

			retries++;
			if (retries >= maxRetries) {
				// Skip to next feature after max retries
				const spec = loadTaskSpec(taskId);
				const failedFeature = spec.features.find((f) => f.status === "in_progress");
				if (failedFeature) {
					updateFeature(taskId, failedFeature.id, {
						status: "failed",
						error: `Max retries (${maxRetries}) exceeded`,
					});
				}
				retries = 0;
			}
		} else {
			retries = 0;
		}
	}

	return results;
}
