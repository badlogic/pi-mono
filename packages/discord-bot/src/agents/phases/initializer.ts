/**
 * Phase 1: Planning Agent (Initializer)
 * Analyzes task and generates feature breakdown
 */

import { randomUUID } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { runLearningAgent } from "../lightweight-agent.js";
import type { Feature, InitializeOptions, TaskSpec } from "./types.js";

const SESSIONS_DIR = join(process.cwd(), "src", "agents", "sessions");

/**
 * Ensure sessions directory exists
 */
function ensureSessionsDir(): void {
	if (!existsSync(SESSIONS_DIR)) {
		mkdirSync(SESSIONS_DIR, { recursive: true });
	}
}

/**
 * Get session directory path for a task
 */
export function getSessionDir(taskId: string): string {
	return join(SESSIONS_DIR, taskId);
}

/**
 * Get spec file path for a task
 */
export function getSpecPath(taskId: string): string {
	return join(getSessionDir(taskId), "spec.json");
}

/**
 * Save task spec to disk
 */
export function saveTaskSpec(spec: TaskSpec): void {
	const sessionDir = getSessionDir(spec.id);
	if (!existsSync(sessionDir)) {
		mkdirSync(sessionDir, { recursive: true });
	}

	const specPath = getSpecPath(spec.id);
	writeFileSync(specPath, JSON.stringify(spec, null, 2));
}

/**
 * Parse features from agent output
 * Looks for markdown lists, numbered lists, or structured sections
 */
function parseFeaturesFromOutput(output: string, taskDescription: string): Feature[] {
	const features: Feature[] = [];
	const lines = output.split("\n");

	// Try different parsing strategies
	const strategies = [parseNumberedList, parseMarkdownList, parseFeatureHeaders, parseChecklistItems];

	for (const strategy of strategies) {
		const parsed = strategy(lines);
		if (parsed.length > 0) {
			return parsed
				.filter((f): f is Required<Partial<Feature>> => !!f.name && !!f.description)
				.map((f) => ({
					id: randomUUID(),
					name: f.name,
					description: f.description,
					status: (f.status as Feature["status"]) || "pending",
					priority: (f.priority as Feature["priority"]) || "medium",
					dependencies: f.dependencies,
					startedAt: f.startedAt,
					completedAt: f.completedAt,
					error: f.error,
					output: f.output,
					learnings: f.learnings,
				}));
		}
	}

	// Fallback: Create single feature from entire task
	return [
		{
			id: randomUUID(),
			name: "Complete Task",
			description: taskDescription,
			status: "pending",
			priority: "high",
		},
	];
}

/**
 * Parse numbered list (1. Feature name\nDescription)
 */
function parseNumberedList(lines: string[]): Partial<Feature>[] {
	const features: Partial<Feature>[] = [];
	let current: Partial<Feature> | null = null;

	for (const line of lines) {
		const match = line.match(/^\d+\.\s+(.+)/);
		if (match) {
			if (current) features.push(current);
			current = {
				name: match[1].trim(),
				description: "",
				status: "pending",
				priority: "medium",
			};
		} else if (current && line.trim()) {
			current.description += (current.description ? "\n" : "") + line.trim();
		}
	}

	if (current) features.push(current);
	return features.filter((f) => f.name && f.name.length > 0);
}

/**
 * Parse markdown bullet list (- Feature name or * Feature name)
 */
function parseMarkdownList(lines: string[]): Partial<Feature>[] {
	const features: Partial<Feature>[] = [];

	for (const line of lines) {
		const match = line.match(/^[*-]\s+(.+)/);
		if (match) {
			const text = match[1].trim();
			// Skip generic bullets
			if (text.length > 10) {
				features.push({
					name: text.substring(0, 100),
					description: text,
					status: "pending",
					priority: "medium",
				});
			}
		}
	}

	return features;
}

/**
 * Parse feature headers (### Feature Name)
 */
function parseFeatureHeaders(lines: string[]): Partial<Feature>[] {
	const features: Partial<Feature>[] = [];
	let current: Partial<Feature> | null = null;

	for (const line of lines) {
		if (line.startsWith("###")) {
			if (current) features.push(current);
			current = {
				name: line.replace(/^#+\s*/, "").trim(),
				description: "",
				status: "pending",
				priority: "medium",
			};
		} else if (current && line.trim() && !line.startsWith("#")) {
			current.description += (current.description ? "\n" : "") + line.trim();
		}
	}

	if (current) features.push(current);
	return features.filter((f) => f.name && f.name.length > 0);
}

/**
 * Parse checklist items (- [ ] Feature name)
 */
function parseChecklistItems(lines: string[]): Partial<Feature>[] {
	const features: Partial<Feature>[] = [];

	for (const line of lines) {
		const match = line.match(/^[*-]\s+\[\s*\]\s+(.+)/);
		if (match) {
			const text = match[1].trim();
			if (text.length > 10) {
				features.push({
					name: text.substring(0, 100),
					description: text,
					status: "pending",
					priority: "medium",
				});
			}
		}
	}

	return features;
}

/**
 * Assign priorities based on keywords and position
 */
function assignPriorities(features: Feature[]): Feature[] {
	return features.map((feature, idx) => {
		const text = (feature.name + " " + feature.description).toLowerCase();

		// Critical keywords
		if (text.includes("critical") || text.includes("urgent") || text.includes("security") || text.includes("bug")) {
			return { ...feature, priority: "critical" };
		}

		// High priority keywords
		if (
			text.includes("important") ||
			text.includes("core") ||
			text.includes("foundation") ||
			text.includes("setup") ||
			idx === 0
		) {
			return { ...feature, priority: "high" };
		}

		// Low priority keywords
		if (
			text.includes("optional") ||
			text.includes("nice to have") ||
			text.includes("enhancement") ||
			idx >= features.length - 2
		) {
			return { ...feature, priority: "low" };
		}

		return { ...feature, priority: "medium" };
	});
}

/**
 * Initialize a new task with feature breakdown
 * Phase 1: Planning
 */
export async function initializeTask(options: InitializeOptions): Promise<TaskSpec> {
	const { prompt, mode = "general", model, maxFeatures = 10, enableLearning = true } = options;

	ensureSessionsDir();

	// Create planning prompt
	const planningPrompt = `You are an expert project planner. Analyze the following task and break it down into concrete, actionable features.

TASK:
${prompt}

REQUIREMENTS:
1. Create a feature list with clear, specific items (max ${maxFeatures} features)
2. Each feature should be independently executable
3. Order features by logical dependencies (prerequisites first)
4. Use this format for each feature:

### Feature Name
Description of what needs to be done and why.
Dependencies: [Feature IDs if any]
Priority: [critical/high/medium/low]

EXAMPLE:
### Setup Database Schema
Create tables for users, sessions, and settings with proper indexes.
Dependencies: None
Priority: high

### Implement Authentication
Add login/logout endpoints with JWT tokens.
Dependencies: Setup Database Schema
Priority: high

### Add User Dashboard
Create dashboard UI with user profile and settings.
Dependencies: Implement Authentication
Priority: medium

Now break down the task above into features:`;

	// Run planning agent with learning
	const result = await runLearningAgent({
		prompt: planningPrompt,
		mode,
		model,
		enableLearning,
		maxTokens: 8000,
		timeout: 60000,
	});

	if (!result.success) {
		throw new Error(`Planning failed: ${result.error}`);
	}

	// Parse features from output
	let features = parseFeaturesFromOutput(result.output, prompt);

	// Limit features
	if (features.length > maxFeatures) {
		features = features.slice(0, maxFeatures);
	}

	// Assign priorities
	features = assignPriorities(features);

	// Create task spec
	const taskId = randomUUID();
	const spec: TaskSpec = {
		id: taskId,
		title: prompt.substring(0, 100),
		description: prompt,
		features,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		status: "planning",
		mode,
		metadata: {
			totalFeatures: features.length,
			completedFeatures: 0,
			failedFeatures: 0,
		},
	};

	// Save spec
	saveTaskSpec(spec);

	return spec;
}

/**
 * Re-plan a task (regenerate feature breakdown)
 */
export async function replanTask(taskId: string, options: Partial<InitializeOptions> = {}): Promise<TaskSpec> {
	const specPath = getSpecPath(taskId);
	if (!existsSync(specPath)) {
		throw new Error(`Task ${taskId} not found`);
	}

	const { readFileSync } = await import("fs");
	const currentSpec: TaskSpec = JSON.parse(readFileSync(specPath, "utf-8"));

	// Re-initialize with same prompt
	const newSpec = await initializeTask({
		prompt: currentSpec.description,
		mode: currentSpec.mode,
		...options,
	});

	// Preserve original task ID and creation time
	newSpec.id = taskId;
	newSpec.createdAt = currentSpec.createdAt;

	saveTaskSpec(newSpec);
	return newSpec;
}
