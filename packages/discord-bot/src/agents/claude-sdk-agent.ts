/**
 * Claude Agent SDK Integration
 *
 * Two-Agent Pattern from leonvanzyl/autonomous-coding:
 * - Initializer Agent (Session 1): Analyzes task, creates feature list, sets up structure
 * - Coding Agent (Sessions 2+): Implements features one by one, marks completion
 *
 * Integrated with Agent Experts (Act-Learn-Reuse) from TAC Lesson 13
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { detectExpertDomain, getExpert } from "./agent-experts.js";
import type { LearningResult } from "./expertise-manager.js";

// Paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..", "..");
const SESSIONS_DIR = join(packageRoot, "src", "agents", "sessions");

// ============================================================================
// TYPES
// ============================================================================

export interface FeatureSpec {
	id: string;
	name: string;
	description: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	testCriteria?: string[];
	dependencies?: string[];
	output?: string;
	error?: string;
}

export interface TaskSpec {
	id: string;
	title: string;
	description: string;
	features: FeatureSpec[];
	status: "initializing" | "executing" | "completed" | "failed" | "paused";
	createdAt: string;
	updatedAt: string;
	domain: string;
	metadata?: {
		totalFeatures: number;
		completedFeatures: number;
		failedFeatures: number;
		estimatedDuration?: string;
	};
}

export interface ClaudeAgentOptions {
	prompt: string;
	workingDir?: string;
	model?: string;
	maxIterations?: number;
	enableLearning?: boolean;
	domain?: string; // Expert domain (auto-detected if not provided)
}

export interface ClaudeAgentResult {
	success: boolean;
	taskId: string;
	spec: TaskSpec;
	output: string;
	error?: string;
	learned?: LearningResult;
	duration: number;
}

// ============================================================================
// INITIALIZER AGENT PROMPT (Session 1)
// ============================================================================

const INITIALIZER_PROMPT = `You are the Initializer Agent. Your job is to analyze a task and create a structured feature list.

## Your Task
{{TASK}}

## Instructions

1. **Analyze the Task**: Break down the requirements into concrete, testable features
2. **Create Feature List**: Generate a JSON array of features with:
   - Unique ID (feature_001, feature_002, etc.)
   - Clear name
   - Detailed description
   - Test criteria (how to verify completion)
   - Dependencies (other feature IDs that must complete first)
3. **Prioritize**: Order features by dependency and importance
4. **Estimate**: Rough complexity estimate

## Output Format

Return a JSON object with this structure:

\`\`\`json
{
  "title": "Task Title",
  "description": "Brief task description",
  "features": [
    {
      "id": "feature_001",
      "name": "Feature Name",
      "description": "What this feature does",
      "testCriteria": ["Criterion 1", "Criterion 2"],
      "dependencies": []
    }
  ],
  "estimatedDuration": "2-4 hours"
}
\`\`\`

## Guidelines

- Create 5-20 features depending on task complexity
- Each feature should be independently testable
- Order by dependencies (no circular dependencies)
- Be specific and actionable

{{EXPERTISE}}`;

// ============================================================================
// CODING AGENT PROMPT (Sessions 2+)
// ============================================================================

const CODING_AGENT_PROMPT = `You are the Coding Agent. Your job is to implement the next pending feature.

## Current Task
{{TASK_TITLE}}

{{TASK_DESCRIPTION}}

## Feature to Implement
**ID**: {{FEATURE_ID}}
**Name**: {{FEATURE_NAME}}
**Description**: {{FEATURE_DESCRIPTION}}

## Test Criteria
{{TEST_CRITERIA}}

## Completed Dependencies
{{COMPLETED_DEPS}}

## Instructions

1. **Implement the Feature**: Write clean, tested code
2. **Verify Test Criteria**: Ensure all criteria are met
3. **Document**: Add necessary comments and documentation
4. **Report Status**: Indicate success or failure with details

## Output Format

After implementation, report:

\`\`\`json
{
  "status": "completed" | "failed",
  "output": "Description of what was done",
  "error": "Error message if failed (optional)",
  "learnings": "Key insights from this implementation"
}
\`\`\`

{{EXPERTISE}}

---
{{SELF_IMPROVE}}`;

// ============================================================================
// TASK MANAGEMENT
// ============================================================================

/**
 * Generate unique task ID
 */
function generateTaskId(): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).substring(2, 6);
	return `task_${timestamp}_${random}`;
}

/**
 * Get task spec path
 */
function getTaskPath(taskId: string): string {
	return join(SESSIONS_DIR, taskId, "spec.json");
}

/**
 * Save task spec
 */
function saveTaskSpec(taskId: string, spec: TaskSpec): void {
	const taskDir = join(SESSIONS_DIR, taskId);
	if (!existsSync(taskDir)) {
		mkdirSync(taskDir, { recursive: true });
	}

	spec.updatedAt = new Date().toISOString();
	writeFileSync(getTaskPath(taskId), JSON.stringify(spec, null, 2));
}

/**
 * Load task spec
 */
export function loadTaskSpec(taskId: string): TaskSpec | null {
	const path = getTaskPath(taskId);
	if (!existsSync(path)) {
		return null;
	}

	try {
		const content = readFileSync(path, "utf-8");
		return JSON.parse(content);
	} catch {
		return null;
	}
}

/**
 * Get next pending feature
 */
function getNextFeature(spec: TaskSpec): FeatureSpec | null {
	for (const feature of spec.features) {
		if (feature.status !== "pending") continue;

		// Check dependencies
		const depsCompleted =
			!feature.dependencies?.length ||
			feature.dependencies.every((depId) => {
				const dep = spec.features.find((f) => f.id === depId);
				return dep?.status === "completed";
			});

		if (depsCompleted) {
			return feature;
		}
	}
	return null;
}

/**
 * Update feature status
 */
function updateFeature(spec: TaskSpec, featureId: string, updates: Partial<FeatureSpec>): void {
	const feature = spec.features.find((f) => f.id === featureId);
	if (feature) {
		Object.assign(feature, updates);
	}

	// Update metadata
	if (spec.metadata) {
		spec.metadata.completedFeatures = spec.features.filter((f) => f.status === "completed").length;
		spec.metadata.failedFeatures = spec.features.filter((f) => f.status === "failed").length;
	}
}

// ============================================================================
// CLAUDE SDK EXECUTION
// ============================================================================

/**
 * Check if Claude SDK is available
 */
export function isClaudeSDKAvailable(): boolean {
	return !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN);
}

/**
 * Execute Claude SDK via subprocess
 * Uses the claude CLI or Python SDK
 */
async function executeClaudeSDK(
	prompt: string,
	_workingDir?: string,
	_model = "claude-sonnet-4-5-20250929",
): Promise<{ success: boolean; output: string; error?: string }> {
	// For now, use our lightweight agent as the backend
	// In production, this would spawn the actual Claude SDK
	const { runAgent } = await import("./lightweight-agent.js");

	try {
		const result = await runAgent({
			prompt,
			model: "sonnet", // Use Claude Sonnet via our agent
			maxTokens: 8000,
			timeout: 120000,
		});

		return {
			success: result.success,
			output: result.output,
			error: result.error,
		};
	} catch (error) {
		return {
			success: false,
			output: "",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

// ============================================================================
// INITIALIZER AGENT
// ============================================================================

/**
 * Run initializer agent to create feature list
 */
export async function initializeTask(options: ClaudeAgentOptions): Promise<ClaudeAgentResult> {
	const startTime = Date.now();
	const taskId = generateTaskId();
	const domain = options.domain || detectExpertDomain(options.prompt);
	const expert = getExpert(domain);

	// Build initializer prompt
	const prompt = INITIALIZER_PROMPT.replace("{{TASK}}", options.prompt).replace(
		"{{EXPERTISE}}",
		expert.loadExpertise() || "",
	);

	// Execute
	const { success, output, error } = await executeClaudeSDK(prompt, options.workingDir, options.model);

	if (!success) {
		return {
			success: false,
			taskId,
			spec: createEmptySpec(taskId, options.prompt, domain),
			output,
			error,
			duration: Date.now() - startTime,
		};
	}

	// Parse feature list from output
	const spec = parseInitializerOutput(taskId, options.prompt, output, domain);

	// Save spec
	saveTaskSpec(taskId, spec);

	// Learn from initialization
	let learned: LearningResult | undefined;
	if (options.enableLearning !== false) {
		learned = expert.learn(output, `Initialize task: ${options.prompt.substring(0, 100)}`, success);
	}

	return {
		success: true,
		taskId,
		spec,
		output,
		learned,
		duration: Date.now() - startTime,
	};
}

/**
 * Parse initializer agent output into TaskSpec
 */
function parseInitializerOutput(taskId: string, originalPrompt: string, output: string, domain: string): TaskSpec {
	// Try to extract JSON
	const jsonMatch = output.match(/```json\s*\n([\s\S]*?)\n```/);

	if (jsonMatch) {
		try {
			const parsed = JSON.parse(jsonMatch[1]);
			return {
				id: taskId,
				title: parsed.title || "Untitled Task",
				description: parsed.description || originalPrompt,
				features: (parsed.features || []).map((f: FeatureSpec, i: number) => ({
					id: f.id || `feature_${String(i + 1).padStart(3, "0")}`,
					name: f.name || `Feature ${i + 1}`,
					description: f.description || "",
					status: "pending" as const,
					testCriteria: f.testCriteria || [],
					dependencies: f.dependencies || [],
				})),
				status: "executing",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				domain,
				metadata: {
					totalFeatures: parsed.features?.length || 0,
					completedFeatures: 0,
					failedFeatures: 0,
					estimatedDuration: parsed.estimatedDuration,
				},
			};
		} catch {
			// Fall through to empty spec
		}
	}

	return createEmptySpec(taskId, originalPrompt, domain);
}

/**
 * Create empty spec for failed initialization
 */
function createEmptySpec(taskId: string, prompt: string, domain: string): TaskSpec {
	return {
		id: taskId,
		title: "Task Initialization Failed",
		description: prompt,
		features: [],
		status: "failed",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		domain,
		metadata: {
			totalFeatures: 0,
			completedFeatures: 0,
			failedFeatures: 0,
		},
	};
}

// ============================================================================
// CODING AGENT
// ============================================================================

/**
 * Execute next feature in task
 */
export async function executeNextFeature(
	taskId: string,
	options: Partial<ClaudeAgentOptions> = {},
): Promise<ClaudeAgentResult> {
	const startTime = Date.now();
	const spec = loadTaskSpec(taskId);

	if (!spec) {
		return {
			success: false,
			taskId,
			spec: createEmptySpec(taskId, "", "general"),
			output: "",
			error: `Task not found: ${taskId}`,
			duration: Date.now() - startTime,
		};
	}

	const feature = getNextFeature(spec);

	if (!feature) {
		// No more features to execute
		spec.status = "completed";
		saveTaskSpec(taskId, spec);

		return {
			success: true,
			taskId,
			spec,
			output: "All features completed",
			duration: Date.now() - startTime,
		};
	}

	// Mark feature as in progress
	updateFeature(spec, feature.id, { status: "in_progress" });
	saveTaskSpec(taskId, spec);

	// Build coding agent prompt
	const expert = getExpert(spec.domain);
	const completedDeps =
		feature.dependencies
			?.map((depId) => {
				const dep = spec.features.find((f) => f.id === depId);
				return dep ? `- ${dep.name}: ${dep.output?.substring(0, 100) || "completed"}` : null;
			})
			.filter(Boolean)
			.join("\n") || "None";

	const prompt = CODING_AGENT_PROMPT.replace("{{TASK_TITLE}}", spec.title)
		.replace("{{TASK_DESCRIPTION}}", spec.description)
		.replace("{{FEATURE_ID}}", feature.id)
		.replace("{{FEATURE_NAME}}", feature.name)
		.replace("{{FEATURE_DESCRIPTION}}", feature.description)
		.replace("{{TEST_CRITERIA}}", feature.testCriteria?.join("\n- ") || "No specific criteria")
		.replace("{{COMPLETED_DEPS}}", completedDeps)
		.replace("{{EXPERTISE}}", expert.loadExpertise() || "")
		.replace("{{SELF_IMPROVE}}", expert.selfImprovePrompt);

	// Execute
	const { success, output, error } = await executeClaudeSDK(prompt, options.workingDir, options.model);

	// Parse result
	const resultMatch = output.match(/```json\s*\n([\s\S]*?)\n```/);
	let featureStatus: "completed" | "failed" = success ? "completed" : "failed";
	let featureOutput = output;
	let learnings = "";

	if (resultMatch) {
		try {
			const parsed = JSON.parse(resultMatch[1]);
			featureStatus = parsed.status === "completed" ? "completed" : "failed";
			featureOutput = parsed.output || output;
			learnings = parsed.learnings || "";
			if (parsed.error) {
				updateFeature(spec, feature.id, { error: parsed.error });
			}
		} catch {
			// Keep defaults
		}
	}

	// Update feature
	updateFeature(spec, feature.id, {
		status: featureStatus,
		output: featureOutput,
	});
	saveTaskSpec(taskId, spec);

	// Learn from execution
	let learned: LearningResult | undefined;
	if (options.enableLearning !== false && learnings) {
		learned = expert.learn(learnings || output, `Implement ${feature.name}`, featureStatus === "completed");
	}

	return {
		success: featureStatus === "completed",
		taskId,
		spec,
		output: featureOutput,
		error,
		learned,
		duration: Date.now() - startTime,
	};
}

// ============================================================================
// FULL WORKFLOW
// ============================================================================

/**
 * Run complete two-agent workflow
 * Initialize then execute all features
 */
export async function runTwoAgentWorkflow(options: ClaudeAgentOptions): Promise<ClaudeAgentResult> {
	const startTime = Date.now();

	// Phase 1: Initialize
	const initResult = await initializeTask(options);

	if (!initResult.success || initResult.spec.features.length === 0) {
		return initResult;
	}

	// Phase 2: Execute all features
	const maxIterations = options.maxIterations || 100;
	let iterations = 0;
	let lastResult = initResult;

	while (iterations < maxIterations) {
		const nextFeature = getNextFeature(lastResult.spec);
		if (!nextFeature) break;

		lastResult = await executeNextFeature(initResult.taskId, options);
		iterations++;

		if (!lastResult.success && lastResult.error) {
			// Stop on critical error
			break;
		}
	}

	return {
		...lastResult,
		duration: Date.now() - startTime,
	};
}

/**
 * Resume an existing task
 */
export async function resumeTask(
	taskId: string,
	options: Partial<ClaudeAgentOptions> = {},
): Promise<ClaudeAgentResult> {
	const startTime = Date.now();
	const spec = loadTaskSpec(taskId);

	if (!spec) {
		return {
			success: false,
			taskId,
			spec: createEmptySpec(taskId, "", "general"),
			output: "",
			error: `Task not found: ${taskId}`,
			duration: Date.now() - startTime,
		};
	}

	// Execute remaining features
	const maxIterations = options.maxIterations || 100;
	let iterations = 0;
	let lastResult: ClaudeAgentResult = {
		success: true,
		taskId,
		spec,
		output: "Resuming task",
		duration: 0,
	};

	while (iterations < maxIterations) {
		const nextFeature = getNextFeature(spec);
		if (!nextFeature) break;

		lastResult = await executeNextFeature(taskId, options);
		iterations++;

		if (!lastResult.success && lastResult.error) {
			break;
		}
	}

	return {
		...lastResult,
		duration: Date.now() - startTime,
	};
}

/**
 * Get task status
 */
export function getTaskStatus(taskId: string): {
	exists: boolean;
	spec?: TaskSpec;
	progress?: {
		total: number;
		completed: number;
		failed: number;
		pending: number;
		percentComplete: number;
	};
	nextFeature?: FeatureSpec;
} {
	const spec = loadTaskSpec(taskId);

	if (!spec) {
		return { exists: false };
	}

	const completed = spec.features.filter((f) => f.status === "completed").length;
	const failed = spec.features.filter((f) => f.status === "failed").length;
	const pending = spec.features.filter((f) => f.status === "pending").length;
	const total = spec.features.length;

	return {
		exists: true,
		spec,
		progress: {
			total,
			completed,
			failed,
			pending,
			percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0,
		},
		nextFeature: getNextFeature(spec) || undefined,
	};
}
