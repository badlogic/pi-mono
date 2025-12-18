/**
 * Two-Phase Agent Execution Pattern Types
 * Based on leonvanzyl/autonomous-coding pattern
 *
 * Phase 1: Planning (Initializer) - Analyze task, generate feature list
 * Phase 2: Execution (Executor) - Execute features one by one with learning
 */

export interface TaskSpec {
	id: string;
	title: string;
	description: string;
	features: Feature[];
	createdAt: string;
	updatedAt: string;
	status: "planning" | "executing" | "completed" | "failed";
	mode: string; // Expertise mode (general, coding, research, trading)
	metadata?: {
		totalFeatures: number;
		completedFeatures: number;
		failedFeatures: number;
		estimatedDuration?: string;
		actualDuration?: string;
	};
}

export interface Feature {
	id: string;
	name: string;
	description: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	priority: "low" | "medium" | "high" | "critical";
	dependencies?: string[]; // Feature IDs that must complete first
	startedAt?: string;
	completedAt?: string;
	error?: string;
	output?: string; // Output from feature execution
	learnings?: string; // Learnings extracted from this feature
}

export interface PhaseResult {
	success: boolean;
	output: string;
	featuresCompleted: number;
	featuresTotal: number;
	nextFeature?: Feature;
	currentFeature?: Feature;
	error?: string;
	learned?: {
		learned: boolean;
		insight: string;
		expertiseFile: string;
	};
}

export interface InitializeOptions {
	prompt: string;
	mode?: string;
	model?: string;
	maxFeatures?: number;
	enableLearning?: boolean;
}

export interface ExecuteOptions {
	taskId: string;
	maxRetries?: number;
	enableLearning?: boolean;
	pauseOnError?: boolean;
}

export interface TwoPhaseOptions extends InitializeOptions {
	autoExecute?: boolean; // Automatically execute after planning
	continueOnError?: boolean; // Continue to next feature on error
	maxRetries?: number;
}

export interface TaskStatus {
	taskId: string;
	spec: TaskSpec;
	progress: {
		total: number;
		completed: number;
		failed: number;
		pending: number;
		inProgress: number;
		percentComplete: number;
	};
	canResume: boolean;
	nextFeature?: Feature;
}

export interface OrchestratorResult {
	taskId: string;
	success: boolean;
	spec: TaskSpec;
	results: PhaseResult[];
	totalDuration: number;
	summary: {
		featuresCompleted: number;
		featuresFailed: number;
		totalLearnings: number;
		expertiseModes: string[];
	};
}
