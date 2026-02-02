/**
 * Task Orchestration Extension
 *
 * A comprehensive task execution tool with two modes:
 *
 * ## Task File Mode (default)
 * Executes tasks from a collaborative task file (e.g., 0N_TASKS.md):
 * - Questions/Blockers gate: BLOCKS if unresolved questions exist
 * - Memory-first pre-hook: Queries memory for prior solutions
 * - Quality-gate post-hook: Runs tests after each task
 * - Retry-until-pass mode: Iteratively fix until gate passes
 * - Self-review: Agent reviews work before marking complete
 * - CLARIFY handling: Exit code 42 stops for human intervention
 * - Session archiving: Archives to episodic memory on completion
 * - Pause/Resume: State persistence to .orchestrate/<session>.state.json
 *
 * Usage: orchestrate({ taskFile: "01_TASKS.md" })
 *
 * ## Direct Mode
 * Run a single gate without a task file (equivalent to tasks_loop):
 * - No task file needed
 * - Retry until gate passes or max retries exhausted
 * - Optional self-review before completion
 *
 * Usage: orchestrate({ gate: "gates/gate_s05.py", maxRetries: 5 })
 *
 * ## Pause/Resume
 * - List paused sessions: orchestrate({ resume: "list" })
 * - Resume a session: orchestrate({ resume: "<session-id>" })
 * - State saved on abort, cleaned up on completion
 *
 * ## Task File Workflow
 * 1. Parse task file, validate no unresolved questions/blockers
 * 2. For each task:
 *    a. PRE-HOOK: Memory recall - inject prior solutions as context
 *    b. Execute task in protected context (pi --no-session)
 *    c. POST-HOOK: Quality gate - run tests, fail if they don't pass
 *    d. If retry-until-pass: retry with agent fixes until gate passes
 *    e. If self-review enabled: agent reviews before marking complete
 *    f. Save state checkpoint after each completed task
 * 3. Archive session if all tasks completed successfully
 * 4. Clean up state file on completion
 *
 * ## Full Output Logging
 * All task outputs saved to /tmp/pi-orchestrate-{uuid}/ for debugging.
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type {
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
	ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { type Static, Type } from "@sinclair/typebox";

// Constants
const DEFAULT_TASK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_OUTPUT_BYTES = 100 * 1024; // 100KB tail buffer
const SIGKILL_GRACE_MS = 5000; // Grace period before SIGKILL
const DEFAULT_MODEL = "claude-sonnet-4-5-20250929"; // Anthropic's recommended balanced model
const DEFAULT_ESCALATE_AFTER = 2; // Number of attempts before escalating
const DEFAULT_MAX_ESCALATIONS = 2; // Maximum escalation attempts

// Hook script paths
const ORCHESTRATE_HOME = process.env.ORCHESTRATE_HOME || path.join(os.homedir(), ".pi", "skills", "orchestrate");
const AGENT_HOME = process.env.PI_HOME
	? path.join(process.env.PI_HOME, "agent")
	: path.join(os.homedir(), ".pi", "agent");

const MEMORY_RECALL_SCRIPT = path.join(AGENT_HOME, "skills", "memory", "run.sh");
const QUALITY_GATE_SCRIPT = path.join(ORCHESTRATE_HOME, "quality-gate.sh");
const PREFLIGHT_SCRIPT = path.join(ORCHESTRATE_HOME, "preflight.sh");

interface ParsedTask {
	id: number;
	title: string;
	description: string;
	agent: string;
	dependencies: number[];
	notes: string;
	completed: boolean;
	lineStart: number;
	lineEnd: number;
	// Retry-until-pass mode (from tasks_loop)
	mode?: "execute" | "retry-until-pass";
	gate?: string; // Path to gate script for retry-until-pass mode
	maxRetries?: number; // Max retry attempts (default: 3)
	selfReview?: boolean; // Run self-review before marking complete (default: false)
	// Parallel execution (inspired by Ralphy)
	parallel?: number; // Parallel group number (0 = sequential, same number = run together)
	// Per-task model selection with escalation (from research doc)
	model?: string; // Base model to use for initial attempts (default: claude-sonnet-4-5-20250929)
	escalateModel?: string; // Model to escalate to after EscalateAfter attempts
	escalateAfter?: number; // Number of attempts before escalating (default: 2)
	maxEscalations?: number; // Maximum escalation attempts (default: 2)
	// Provider-based routing (Phase 2)
	provider?: string; // Provider to use (anthropic, openai, google, github)
	fallbackProvider?: string; // Fallback provider if primary fails
	fallbackModel?: string; // Fallback model if primary fails
	// Phase 4: Cost budgets and optimization
	maxCostUSD?: number; // Task-level budget cap (fail if exceeded)
	costStrategy?: "cheapest-first" | "balanced" | "quality-first"; // Cost optimization strategy
}

interface TaskFileContent {
	title: string;
	context: string;
	tasks: ParsedTask[];
	questionsBlockers: string[]; // Unresolved questions/blockers - must be empty to proceed
	rawLines: string[];
	// Code review configuration (post-orchestration)
	reviewAfterCompletion?: boolean; // Run code review after all tasks complete
	reviewProvider?: string; // Provider for code review (github, anthropic, openai, google)
	reviewModel?: string; // Model for code review
	// Phase 4: Session-level budgets
	maxSessionCostUSD?: number; // Session-level budget cap (halt if exceeded)
	costAlertThreshold?: number; // Warn at this cost (default: 75% of max)
	budgetProfile?: "dev" | "staging" | "production" | "enterprise"; // Budget preset
}

interface MemoryRecallResult {
	found: boolean;
	items?: Array<{
		problem: string;
		solution: string;
		confidence?: number;
	}>;
}

interface TaskResult {
	taskId: number;
	title: string;
	agent: string;
	status: "success" | "failed" | "skipped";
	output: string;
	outputFile?: string; // Full output written to disk (not truncated)
	durationMs: number;
	error?: string;
	// Phase 2: Cost tracking
	provider?: string; // Provider used
	model?: string; // Model used
	usedFallback?: boolean; // Whether fallback was used
	// Phase 4: Token usage and actual cost
	tokenUsage?: TokenUsage; // Actual token usage from API
	cost?: number; // Actual cost in USD
}

interface ProviderCostInfo {
	provider: string;
	model: string;
	inputCost: number; // Cost per million input tokens
	outputCost: number; // Cost per million output tokens
}

// Phase 2: Model cost tiers (updated 2026)
const MODEL_COSTS: Record<string, ProviderCostInfo> = {
	// Anthropic Claude models
	"claude-haiku-4-5-20251001": { provider: "anthropic", model: "claude-haiku-4-5", inputCost: 1, outputCost: 5 },
	"claude-sonnet-4-5-20250929": { provider: "anthropic", model: "claude-sonnet-4-5", inputCost: 3, outputCost: 15 },
	"claude-opus-4-5-20251101": { provider: "anthropic", model: "claude-opus-4-5", inputCost: 5, outputCost: 25 },
	"claude-opus-4-1-20250805": { provider: "anthropic", model: "claude-opus-4-1", inputCost: 5, outputCost: 25 },
	// Google Gemini models
	"gemini-2.0-flash": { provider: "google", model: "gemini-2.0-flash", inputCost: 0.075, outputCost: 0.3 },
	"gemini-1.5-pro": { provider: "google", model: "gemini-1.5-pro", inputCost: 1.25, outputCost: 5 },
	// OpenAI models
	"gpt-5": { provider: "openai", model: "gpt-5", inputCost: 2.5, outputCost: 10 },
	"gpt-5.2-codex": { provider: "openai", model: "gpt-5.2-codex", inputCost: 5, outputCost: 15 },
	o3: { provider: "openai", model: "o3", inputCost: 10, outputCost: 30 },
	// GitHub Copilot (FREE with subscription)
	"github/claude-sonnet-4.5": { provider: "github", model: "claude-sonnet-4.5", inputCost: 0, outputCost: 0 },
	"github/gpt-5": { provider: "github", model: "gpt-5", inputCost: 0, outputCost: 0 },
};

// Phase 3: Provider performance metrics
interface ProviderMetrics {
	provider: string;
	totalAttempts: number;
	successes: number;
	failures: number;
	rateLimits: number;
	downtimes: number;
	avgLatencyMs: number;
	lastUsed: Date;
	successRate: number; // Calculated
}

interface MetricsStore {
	providers: Record<string, ProviderMetrics>;
	lastUpdated: Date;
}

// Phase 4: Token usage tracking (actual usage, not estimates)
interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

// Phase 4: Cost tracking per task
interface TaskCostInfo {
	taskId: number;
	provider: string;
	model: string;
	tokenUsage: TokenUsage;
	estimatedCost: number; // USD
	actualCost?: number; // USD (if available from API)
}

// Phase 4: Session budget tracking
interface SessionBudget {
	maxCostUSD: number;
	alertThreshold: number; // USD
	currentCost: number; // USD
	tasksCompleted: number;
	taskCosts: TaskCostInfo[];
	exceeded: boolean;
	alertFired: boolean;
}

// Phase 4: Budget presets
interface BudgetPreset {
	name: string;
	maxSessionCostUSD: number;
	costAlertThreshold: number;
	defaultProvider: string;
	defaultModel: string;
	fallbackProvider?: string;
	costStrategy: "cheapest-first" | "balanced" | "quality-first";
}

// Phase 4: Budget preset configurations
const BUDGET_PRESETS: Record<string, BudgetPreset> = {
	dev: {
		name: "Development (Unlimited)",
		maxSessionCostUSD: Infinity,
		costAlertThreshold: Infinity,
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-5-20250929",
		costStrategy: "balanced",
	},
	staging: {
		name: "Staging (Moderate)",
		maxSessionCostUSD: 5.0,
		costAlertThreshold: 3.75, // 75%
		defaultProvider: "anthropic",
		defaultModel: "claude-haiku-4-5-20251001",
		fallbackProvider: "google",
		costStrategy: "balanced",
	},
	production: {
		name: "Production (Cost-Optimized)",
		maxSessionCostUSD: 2.0,
		costAlertThreshold: 1.5, // 75%
		defaultProvider: "github",
		defaultModel: "claude-sonnet-4-5-20250929",
		fallbackProvider: "google",
		costStrategy: "cheapest-first",
	},
	enterprise: {
		name: "Enterprise (Quality-First)",
		maxSessionCostUSD: 20.0,
		costAlertThreshold: 15.0, // 75%
		defaultProvider: "anthropic",
		defaultModel: "claude-opus-4-5-20251101",
		fallbackProvider: "openai",
		costStrategy: "quality-first",
	},
};

// Metrics file path
const METRICS_FILE = path.join(ORCHESTRATE_HOME, ".metrics.json");

/**
 * Phase 3: Load provider metrics from disk
 */
function loadMetrics(): MetricsStore {
	try {
		if (fs.existsSync(METRICS_FILE)) {
			const data = fs.readFileSync(METRICS_FILE, "utf-8");
			const parsed = JSON.parse(data);
			// Convert date strings back to Date objects
			parsed.lastUpdated = new Date(parsed.lastUpdated);
			for (const provider in parsed.providers) {
				parsed.providers[provider].lastUsed = new Date(parsed.providers[provider].lastUsed);
			}
			return parsed;
		}
	} catch (err) {
		// If file is corrupted, start fresh
		console.warn(`⚠️  Metrics file corrupted or unreadable: ${err instanceof Error ? err.message : String(err)}`);
		console.warn("   Starting with fresh metrics.");
	}
	return { providers: {}, lastUpdated: new Date() };
}

/**
 * Phase 3: Save provider metrics to disk
 */
function saveMetrics(metrics: MetricsStore): void {
	try {
		fs.writeFileSync(METRICS_FILE, JSON.stringify(metrics, null, 2));
	} catch (err) {
		// Non-critical - metrics are optional
		console.warn(`⚠️  Failed to save metrics: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * Phase 3: Update provider metrics after execution
 */
function updateProviderMetrics(
	provider: string,
	success: boolean,
	latencyMs: number,
	errorType?: "rate_limit" | "downtime",
): void {
	const metrics = loadMetrics();

	if (!metrics.providers[provider]) {
		metrics.providers[provider] = {
			provider,
			totalAttempts: 0,
			successes: 0,
			failures: 0,
			rateLimits: 0,
			downtimes: 0,
			avgLatencyMs: 0,
			lastUsed: new Date(),
			successRate: 0,
		};
	}

	const providerMetrics = metrics.providers[provider];
	providerMetrics.totalAttempts++;
	providerMetrics.lastUsed = new Date();

	if (success) {
		providerMetrics.successes++;
	} else {
		providerMetrics.failures++;
		if (errorType === "rate_limit") {
			providerMetrics.rateLimits++;
		} else if (errorType === "downtime") {
			providerMetrics.downtimes++;
		}
	}

	// Update average latency (exponential moving average)
	if (providerMetrics.avgLatencyMs === 0) {
		providerMetrics.avgLatencyMs = latencyMs;
	} else {
		providerMetrics.avgLatencyMs = providerMetrics.avgLatencyMs * 0.7 + latencyMs * 0.3;
	}

	// Calculate success rate
	providerMetrics.successRate = providerMetrics.successes / providerMetrics.totalAttempts;

	metrics.lastUpdated = new Date();
	saveMetrics(metrics);
}

/**
 * Phase 3: Smart fallback selection - choose best fallback based on metrics and cost
 */
function selectSmartFallback(
	primaryProvider: string,
	excludeProviders: string[] = [],
): { provider: string; model: string } | null {
	const metrics = loadMetrics();
	const availableProviders = ["anthropic", "google", "openai", "github"].filter(
		(p) => p !== primaryProvider && !excludeProviders.includes(p),
	);

	if (availableProviders.length === 0) {
		return null;
	}

	// Score providers by: success rate (60%), cost (30%), latency (10%)
	const scored = availableProviders.map((provider) => {
		const providerMetrics = metrics.providers[provider] || {
			successRate: 0.95, // Assume 95% for new providers
			avgLatencyMs: 3000,
			rateLimits: 0,
		};

		// Find cheapest model for this provider
		const providerModels = Object.entries(MODEL_COSTS)
			.filter(([_model, info]) => info.provider === provider)
			.sort((a, b) => a[1].inputCost - b[1].inputCost);

		if (providerModels.length === 0) {
			return { provider, score: 0, model: "" };
		}

		const [cheapestModel, costInfo] = providerModels[0];

		// Calculate score
		const successScore = providerMetrics.successRate * 60;
		const costScore = (1 - Math.min(costInfo.inputCost / 10, 1)) * 30; // Normalize cost to 0-1
		const latencyScore = (1 - Math.min(providerMetrics.avgLatencyMs / 10000, 1)) * 10;

		// Penalty for recent rate limits
		const rateLimitPenalty = providerMetrics.rateLimits > 0 ? 20 : 0;

		const totalScore = successScore + costScore + latencyScore - rateLimitPenalty;

		return {
			provider,
			model: cheapestModel,
			score: totalScore,
			successRate: providerMetrics.successRate,
			cost: costInfo.inputCost,
		};
	});

	// Sort by score descending
	scored.sort((a, b) => b.score - a.score);

	// Return best provider
	if (scored.length > 0 && scored[0].score > 0) {
		return { provider: scored[0].provider, model: scored[0].model };
	}

	return null;
}

/**
 * Phase 3: Provider health check - verify provider is responding before use
 */
async function checkProviderHealth(provider: string, timeoutMs: number = 5000): Promise<boolean> {
	// Simple health check: try to spawn the command with --help
	return new Promise((resolve) => {
		const dispatch = getCommandForProvider(provider, undefined, "general-purpose");
		const proc = spawn(dispatch.command, ["--help"], {
			stdio: ["ignore", "ignore", "ignore"],
			timeout: timeoutMs,
		});

		const timer = setTimeout(() => {
			try {
				proc.kill();
			} catch {}
			resolve(false);
		}, timeoutMs);

		proc.on("exit", (code) => {
			clearTimeout(timer);
			resolve(code === 0 || code === null); // null = timeout but responded
		});

		proc.on("error", () => {
			clearTimeout(timer);
			resolve(false);
		});
	});
}

interface OrchestrateDetails {
	taskFile: string;
	status: "running" | "completed" | "failed" | "cancelled" | "paused";
	totalTasks: number;
	completedTasks: number;
	currentTask?: string;
	results: TaskResult[];
	archived: boolean;
	outputDir?: string; // Directory containing full task outputs
	sessionId?: string; // For pause/resume
	// Phase 2: Cost tracking
	costByProvider?: Record<string, { count: number; estimatedCost: number }>; // Provider usage stats
	fallbacksUsed?: number; // Number of times fallback was triggered
}

/**
 * State persistence for pause/resume functionality.
 * Stored in .orchestrate/<session-id>.state.json
 */
interface OrchestrationState {
	sessionId: string;
	version: 1; // Schema version for future migrations
	taskFile: string; // Absolute path
	startedAt: string; // ISO timestamp
	pausedAt?: string; // ISO timestamp if paused
	status: "running" | "paused" | "completed" | "failed";

	// Config
	continueOnError: boolean;
	archive: boolean;
	taskTimeoutMs: number;

	// Progress
	completedTaskIds: number[];
	currentTaskId?: number;
	results: TaskResult[];

	// Direct mode (if applicable)
	directMode?: {
		gate: string;
		maxRetries: number;
		selfReview: boolean;
		agentName: string;
		prompt?: string;
		currentAttempt: number;
	};

	outputDir: string;
}

// State directory name (relative to cwd)
const STATE_DIR = ".orchestrate";

/**
 * Get the state directory path for the given cwd.
 */
function getStateDir(cwd: string): string {
	return path.join(cwd, STATE_DIR);
}

/**
 * Get the state file path for a session.
 */
function getStateFilePath(cwd: string, sessionId: string): string {
	return path.join(getStateDir(cwd), `${sessionId}.state.json`);
}

/**
 * Save orchestration state to disk.
 */
function saveState(cwd: string, state: OrchestrationState): void {
	const stateDir = getStateDir(cwd);
	if (!fs.existsSync(stateDir)) {
		fs.mkdirSync(stateDir, { recursive: true });
	}
	const statePath = getStateFilePath(cwd, state.sessionId);
	fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Load orchestration state from disk.
 */
function loadState(cwd: string, sessionId: string): OrchestrationState | null {
	const statePath = getStateFilePath(cwd, sessionId);
	if (!fs.existsSync(statePath)) {
		return null;
	}
	try {
		const content = fs.readFileSync(statePath, "utf-8");
		return JSON.parse(content) as OrchestrationState;
	} catch {
		return null;
	}
}

/**
 * Find paused sessions for a given task file.
 */
function findPausedSessions(cwd: string, taskFile: string): OrchestrationState[] {
	const stateDir = getStateDir(cwd);
	if (!fs.existsSync(stateDir)) {
		return [];
	}

	const paused: OrchestrationState[] = [];
	const absoluteTaskFile = path.isAbsolute(taskFile) ? taskFile : path.join(cwd, taskFile);

	try {
		const files = fs.readdirSync(stateDir);
		for (const file of files) {
			if (!file.endsWith(".state.json")) continue;
			const statePath = path.join(stateDir, file);
			try {
				const content = fs.readFileSync(statePath, "utf-8");
				const state = JSON.parse(content) as OrchestrationState;
				if (state.status === "paused" && state.taskFile === absoluteTaskFile) {
					paused.push(state);
				}
			} catch {
				// Ignore invalid state files
			}
		}
	} catch {
		// Ignore directory read errors
	}

	// Sort by pausedAt descending (most recent first)
	return paused.sort((a, b) => {
		const aTime = a.pausedAt ? new Date(a.pausedAt).getTime() : 0;
		const bTime = b.pausedAt ? new Date(b.pausedAt).getTime() : 0;
		return bTime - aTime;
	});
}

/**
 * Delete a state file.
 */
function deleteState(cwd: string, sessionId: string): void {
	const statePath = getStateFilePath(cwd, sessionId);
	try {
		fs.unlinkSync(statePath);
	} catch {
		// Ignore if file doesn't exist
	}
}

const OrchestrateParams = Type.Object({
	// Task file mode (default)
	taskFile: Type.Optional(
		Type.String({
			description: "Path to task file (e.g., 01_TASKS.md). Required unless using direct mode with 'gate' parameter.",
		}),
	),
	continueOnError: Type.Optional(
		Type.Boolean({
			description: "Continue executing tasks even if one fails",
			default: false,
		}),
	),
	archive: Type.Optional(
		Type.Boolean({
			description: "Archive session to episodic memory when complete",
			default: true,
		}),
	),
	taskTimeoutMs: Type.Optional(
		Type.Number({
			description: "Timeout per task in milliseconds (default: 30 minutes)",
			default: DEFAULT_TASK_TIMEOUT_MS,
		}),
	),
	// Direct mode parameters (alternative to taskFile)
	gate: Type.Optional(
		Type.String({
			description:
				"Direct mode: Path to gate script to run until it passes. Use instead of taskFile for simple single-gate workflows.",
		}),
	),
	maxRetries: Type.Optional(
		Type.Number({
			description: "Direct mode: Maximum retry attempts (default: 3)",
			default: 3,
		}),
	),
	selfReview: Type.Optional(
		Type.Boolean({
			description: "Direct mode: Run self-review before marking complete (default: false)",
			default: false,
		}),
	),
	agent: Type.Optional(
		Type.String({
			description: "Direct mode: Agent config to use (default: general-purpose)",
			default: "general-purpose",
		}),
	),
	prompt: Type.Optional(
		Type.String({
			description: "Direct mode: Task description/prompt for the agent",
		}),
	),
	// Resume/pause parameters
	resume: Type.Optional(
		Type.String({
			description:
				"Resume a paused orchestration session by its session ID. Use 'list' to see available paused sessions.",
		}),
	),
});

function finalizeTask(
	currentTask: Partial<ParsedTask> | null,
	taskLineStart: number,
	lineEnd: number,
): ParsedTask | null {
	if (!currentTask || !currentTask.title) return null;
	return {
		id: currentTask.id!,
		title: currentTask.title,
		description: currentTask.description || "",
		agent: currentTask.agent || "general-purpose",
		dependencies: currentTask.dependencies || [],
		notes: currentTask.notes || "",
		completed: currentTask.completed || false,
		lineStart: taskLineStart,
		lineEnd,
	};
}

function parseTaskFile(filePath: string): TaskFileContent {
	const content = fs.readFileSync(filePath, "utf-8");
	const lines = content.split("\n");

	let title = "";
	let context = "";
	const tasks: ParsedTask[] = [];
	const questionsBlockers: string[] = [];

	let currentSection = "";
	let taskId = 0;
	let currentTask: Partial<ParsedTask> | null = null;
	let taskLineStart = 0;

	// Review configuration metadata (parsed from top-level fields)
	let reviewAfterCompletion: boolean | undefined;
	let reviewProvider: string | undefined;
	let reviewModel: string | undefined;
	// Phase 4: Session-level budget metadata
	let maxSessionCostUSD: number | undefined;
	let costAlertThreshold: number | undefined;
	let budgetProfile: "dev" | "staging" | "production" | "enterprise" | undefined;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();

		// Detect title
		if (trimmed.startsWith("# ")) {
			title = trimmed
				.slice(2)
				.replace(/^Task List:\s*/i, "")
				.trim();
			continue;
		}

		// Parse top-level metadata (review configuration + Phase 4 budgets)
		// Format: review_after_completion: true
		const reviewAfterMatch = trimmed.match(/^review_after_completion:\s*(true|false|yes|no)/i);
		const reviewProviderMatch = trimmed.match(/^review_provider:\s*(.+)/i);
		const reviewModelMatch = trimmed.match(/^review_model:\s*(.+)/i);
		// Phase 4: Budget field parsing
		const maxSessionCostMatch = trimmed.match(/^max_session_cost_usd:\s*([\d.]+)/i);
		const costAlertMatch = trimmed.match(/^cost_alert_threshold:\s*([\d.]+)/i);
		const budgetProfileMatch = trimmed.match(/^budget_profile:\s*(dev|staging|production|enterprise)/i);

		if (reviewAfterMatch) {
			const value = reviewAfterMatch[1].toLowerCase();
			reviewAfterCompletion = value === "true" || value === "yes";
			continue;
		} else if (reviewProviderMatch) {
			reviewProvider = reviewProviderMatch[1].trim();
			continue;
		} else if (reviewModelMatch) {
			reviewModel = reviewModelMatch[1].trim();
			continue;
		} else if (maxSessionCostMatch) {
			maxSessionCostUSD = parseFloat(maxSessionCostMatch[1]);
			continue;
		} else if (costAlertMatch) {
			costAlertThreshold = parseFloat(costAlertMatch[1]);
			continue;
		} else if (budgetProfileMatch) {
			budgetProfile = budgetProfileMatch[1] as "dev" | "staging" | "production" | "enterprise";
			continue;
		}

		// Detect sections
		if (trimmed.startsWith("## ")) {
			const finalized = finalizeTask(currentTask, taskLineStart, i - 1);
			if (finalized) tasks.push(finalized);
			currentTask = null;

			const section = trimmed.slice(3).toLowerCase();
			if (section.includes("context")) {
				currentSection = "context";
			} else if (section.includes("task")) {
				currentSection = "tasks";
			} else if (section.includes("question") || section.includes("blocker")) {
				currentSection = "questions";
			} else {
				currentSection = "other";
			}
			continue;
		}

		// Parse based on section
		if (currentSection === "context" && trimmed) {
			context += (context ? "\n" : "") + trimmed;
		} else if (currentSection === "questions") {
			// Capture questions/blockers - lines starting with - or * that aren't "none"
			const itemMatch = trimmed.match(/^[-*]\s*(.+)/);
			if (itemMatch) {
				const item = itemMatch[1].trim();
				// Ignore placeholder entries like "None", "N/A", "Nothing", etc.
				if (!/^(none|n\/a|nothing|no\s+questions?|no\s+blockers?)\.?$/i.test(item)) {
					questionsBlockers.push(item);
				}
			}
		} else if (currentSection === "tasks") {
			// Task line formats supported:
			// - [ ] **Task N**: Description (bold format)
			// - [ ] Task N: Description (plain format)
			// - [ ] N. Description (numbered format)
			const boldMatch = trimmed.match(/^-\s*\[([ x])\]\s*\*\*Task\s*(\d+)\*\*:\s*(.+)/i);
			const plainMatch = trimmed.match(/^-\s*\[([ x])\]\s*Task\s*(\d+):\s*(.+)/i);
			const numberedMatch = trimmed.match(/^-\s*\[([ x])\]\s*(\d+)\.\s*(.+)/i);

			const taskMatch = boldMatch || plainMatch || numberedMatch;
			if (taskMatch) {
				const finalized = finalizeTask(currentTask, taskLineStart, i - 1);
				if (finalized) tasks.push(finalized);

				taskId = parseInt(taskMatch[2], 10);
				taskLineStart = i;
				currentTask = {
					id: taskId,
					title: taskMatch[3].trim(),
					completed: taskMatch[1] === "x",
					description: "",
					agent: "general-purpose",
					dependencies: [],
					notes: "",
				};
			} else if (currentTask) {
				// Parse task metadata
				const agentMatch = trimmed.match(/^-\s*Agent:\s*(.+)/i);
				const depsMatch = trimmed.match(/^-\s*Dependencies:\s*(.+)/i);
				const notesMatch = trimmed.match(/^-\s*Notes:\s*(.+)/i);
				const modeMatch = trimmed.match(/^-\s*Mode:\s*(.+)/i);
				const gateMatch = trimmed.match(/^-\s*Gate:\s*(.+)/i);
				const maxRetriesMatch = trimmed.match(/^-\s*MaxRetries:\s*(\d+)/i);
				const selfReviewMatch = trimmed.match(/^-\s*SelfReview:\s*(true|false|yes|no)/i);
				const parallelMatch = trimmed.match(/^-\s*Parallel:\s*(\d+)/i);
				// Model selection fields
				const modelMatch = trimmed.match(/^-\s*Model:\s*(.+)/i);
				const escalateModelMatch = trimmed.match(/^-\s*EscalateModel:\s*(.+)/i);
				const escalateAfterMatch = trimmed.match(/^-\s*EscalateAfter:\s*(\d+)/i);
				const maxEscalationsMatch = trimmed.match(/^-\s*MaxEscalations:\s*(\d+)/i);
				// Provider fields (Phase 2)
				const providerMatch = trimmed.match(/^-\s*Provider:\s*(.+)/i);
				const fallbackProviderMatch = trimmed.match(/^-\s*FallbackProvider:\s*(.+)/i);
				const fallbackModelMatch = trimmed.match(/^-\s*FallbackModel:\s*(.+)/i);
				// Phase 4: Budget fields
				const maxCostMatch = trimmed.match(/^-\s*MaxCostUSD:\s*([\d.]+)/i);
				const costStrategyMatch = trimmed.match(/^-\s*CostStrategy:\s*(cheapest-first|balanced|quality-first)/i);

				// Definition of Done parsing (Test detection)
				// Format: - Test: tests/foo.py
				// Or inside a DoD block (handled via looking for "Test:" prefix in lines belonging to task)
				// Simple approach: look for "Test:" or "Test File:" line pattern
				const testMatch = trimmed.match(/^\s*-\s*Test(?:\s*File)?:\s*(.+)/i);

				if (agentMatch) {
					currentTask.agent = agentMatch[1].trim();
				} else if (depsMatch) {
					const depsStr = depsMatch[1].trim();
					if (depsStr.toLowerCase() !== "none") {
						currentTask.dependencies = depsStr
							.split(/[,\s]+/)
							.map((d) => parseInt(d.replace(/\D/g, ""), 10))
							.filter((n) => !Number.isNaN(n));
					}
				} else if (notesMatch) {
					currentTask.notes = notesMatch[1].trim();
				} else if (modeMatch) {
					const mode = modeMatch[1].trim().toLowerCase();
					if (mode === "retry-until-pass" || mode === "execute") {
						currentTask.mode = mode;
					}
				} else if (gateMatch) {
					currentTask.gate = gateMatch[1].trim();
					// Explicit gate implies retry-until-pass unless stated otherwise
					if (!currentTask.mode) currentTask.mode = "retry-until-pass";
				} else if (testMatch) {
					// "Definition of Done" Test field detected -> Auto-promote to Gate
					const testPath = testMatch[1].trim();
					if (testPath.toLowerCase() !== "missing" && !testPath.toLowerCase().startsWith("n/a")) {
						currentTask.gate = testPath;
						currentTask.mode = "retry-until-pass";
					}
				} else if (maxRetriesMatch) {
					currentTask.maxRetries = parseInt(maxRetriesMatch[1], 10);
				} else if (selfReviewMatch) {
					const value = selfReviewMatch[1].toLowerCase();
					currentTask.selfReview = value === "true" || value === "yes";
				} else if (parallelMatch) {
					currentTask.parallel = parseInt(parallelMatch[1], 10);
				} else if (modelMatch) {
					currentTask.model = modelMatch[1].trim();
				} else if (escalateModelMatch) {
					currentTask.escalateModel = escalateModelMatch[1].trim();
				} else if (escalateAfterMatch) {
					currentTask.escalateAfter = parseInt(escalateAfterMatch[1], 10);
				} else if (maxEscalationsMatch) {
					currentTask.maxEscalations = parseInt(maxEscalationsMatch[1], 10);
				} else if (providerMatch) {
					currentTask.provider = providerMatch[1].trim();
				} else if (fallbackProviderMatch) {
					currentTask.fallbackProvider = fallbackProviderMatch[1].trim();
				} else if (fallbackModelMatch) {
					currentTask.fallbackModel = fallbackModelMatch[1].trim();
				} else if (maxCostMatch) {
					currentTask.maxCostUSD = parseFloat(maxCostMatch[1]);
				} else if (costStrategyMatch) {
					currentTask.costStrategy = costStrategyMatch[1] as "cheapest-first" | "balanced" | "quality-first";
				} else if (trimmed && !trimmed.startsWith("-")) {
					currentTask.description =
						(currentTask.description || "") + (currentTask.description ? "\n" : "") + trimmed;
				}
			}
		}
	}

	// Save last task
	const finalized = finalizeTask(currentTask, taskLineStart, lines.length - 1);
	if (finalized) tasks.push(finalized);

	return {
		title,
		context,
		tasks,
		questionsBlockers,
		rawLines: lines,
		reviewAfterCompletion,
		reviewProvider,
		reviewModel,
		maxSessionCostUSD,
		costAlertThreshold,
		budgetProfile,
	};
}

function validateTaskFile(parsed: TaskFileContent): void {
	// CRITICAL: Block execution if there are unresolved questions/blockers
	// This prevents starting work before clarifying requirements
	if (parsed.questionsBlockers.length > 0) {
		const questions = parsed.questionsBlockers.map((q, i) => `  ${i + 1}. ${q}`).join("\n");
		throw new Error(
			`Cannot start orchestration: ${parsed.questionsBlockers.length} unresolved question(s)/blocker(s):\n\n` +
				`${questions}\n\n` +
				`Resolve these questions in the task file before running orchestration. ` +
				`Remove them or mark them as "None" when resolved.`,
		);
	}

	// Check for duplicate task IDs
	const seenIds = new Set<number>();
	for (const task of parsed.tasks) {
		if (seenIds.has(task.id)) {
			throw new Error(`Duplicate task ID found: Task ${task.id}. Each task must have a unique ID.`);
		}
		seenIds.add(task.id);
	}

	// Check for missing dependency references
	const allIds = new Set(parsed.tasks.map((t) => t.id));
	for (const task of parsed.tasks) {
		for (const depId of task.dependencies) {
			if (!allIds.has(depId)) {
				throw new Error(`Task ${task.id} depends on Task ${depId}, but Task ${depId} does not exist in the file.`);
			}
		}
	}
}

function updateTaskCheckbox(filePath: string, taskLineStart: number, taskId: number, completed: boolean): void {
	// Re-read file to avoid stale data issues
	const lines = fs.readFileSync(filePath, "utf-8").split("\n");
	const taskLine = lines[taskLineStart];
	if (!taskLine) {
		throw new Error(`Cannot update checkbox: line ${taskLineStart} not found in ${filePath}`);
	}

	// Verify the line still looks like the expected task (guards against file mutation during execution)
	// Check for task patterns: "- [ ] **Task N**:", "- [ ] Task N:", "- [ ] N."
	const taskPatternMatch = taskLine.match(/^-\s*\[[ x]\]\s*(?:\*\*Task\s*(\d+)\*\*|Task\s*(\d+)|(\d+)\.)/i);
	if (!taskPatternMatch) {
		throw new Error(
			`Task file changed during execution; line ${taskLineStart} in ${filePath} no longer matches task format. ` +
				`Cannot safely update checkbox for Task ${taskId}.`,
		);
	}
	const lineTaskId = parseInt(taskPatternMatch[1] || taskPatternMatch[2] || taskPatternMatch[3], 10);
	if (lineTaskId !== taskId) {
		throw new Error(
			`Task file changed during execution; line ${taskLineStart} in ${filePath} is now Task ${lineTaskId}, ` +
				`expected Task ${taskId}. Cannot safely update checkbox.`,
		);
	}

	// Replace checkbox (handle [ ], [], [  ], etc.)
	const updatedLine = completed ? taskLine.replace(/\[\s*\]/, "[x]") : taskLine.replace(/\[x\]/i, "[ ]");

	lines[taskLineStart] = updatedLine;
	fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
}

interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	provider?: string;
	model?: string;
	systemPrompt: string;
}

interface AgentConfigError {
	error: string;
}

function loadAgentConfig(agentName: string): AgentConfig | AgentConfigError {
	const userAgentsDir = path.join(os.homedir(), ".pi", "agent", "agents");
	const agentPath = path.join(userAgentsDir, `${agentName}.md`);

	if (!fs.existsSync(agentPath)) {
		return { error: `Agent config not found: ${agentPath}. Create ${agentName}.md in ~/.pi/agent/agents/` };
	}

	const content = fs.readFileSync(agentPath, "utf-8");
	const normalized = content.replace(/\r\n/g, "\n");

	if (!normalized.startsWith("---")) {
		return { error: `Agent config ${agentName}.md missing opening "---" frontmatter delimiter` };
	}

	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) {
		return { error: `Agent config ${agentName}.md missing closing "---" frontmatter delimiter` };
	}

	const frontmatterBlock = normalized.slice(4, endIndex);
	const body = normalized.slice(endIndex + 4).trim();

	// Check for unsupported YAML features
	if (frontmatterBlock.includes(": |") || frontmatterBlock.includes(": >")) {
		return {
			error: `Agent config ${agentName}.md uses unsupported multiline YAML syntax (| or >). Use single-line values.`,
		};
	}
	if (/^\s*-\s+/m.test(frontmatterBlock)) {
		return {
			error: `Agent config ${agentName}.md uses unsupported YAML list syntax. Use comma-separated values for tools.`,
		};
	}

	const frontmatter: Record<string, string> = {};
	for (const line of frontmatterBlock.split("\n")) {
		const match = line.match(/^([\w-]+):\s*(.*)$/);
		if (match) {
			let value = match[2].trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			frontmatter[match[1]] = value;
		}
	}

	// Fallback: use agentName if name field is missing (backwards compatibility)
	const name = frontmatter.name || agentName;

	if (!body.trim()) {
		return { error: `Agent config ${agentName}.md has empty system prompt (body after frontmatter)` };
	}

	const tools = frontmatter.tools
		?.split(",")
		.map((t) => t.trim())
		.filter(Boolean);

	return {
		name,
		description: frontmatter.description || "",
		tools,
		provider: frontmatter.provider,
		model: frontmatter.model,
		systemPrompt: body,
	};
}

function isAgentConfigError(result: AgentConfig | AgentConfigError): result is AgentConfigError {
	return "error" in result;
}

function writePromptFile(agent: string, prompt: string): { dir: string; path: string } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-orchestrate-"));
	const p = path.join(dir, `${agent.replace(/[^\w.-]/g, "_")}.md`);
	fs.writeFileSync(p, prompt, { mode: 0o600 });
	return { dir, path: p };
}

/** Helper for inline output truncation during execution - keeps tail without repeated headers */
class OutputAccumulator {
	private buffer = "";
	private readonly maxBytes: number;
	private totalTruncatedBytes = 0;

	constructor(maxBytes: number) {
		this.maxBytes = maxBytes;
	}

	append(text: string): void {
		this.buffer += text;
		// Truncate inline when buffer exceeds 2x max to avoid unbounded growth
		const currentBytes = Buffer.byteLength(this.buffer, "utf-8");
		if (currentBytes > this.maxBytes * 2) {
			// Keep only the tail, track total truncated
			const buf = Buffer.from(this.buffer, "utf-8");
			const bytesToTruncate = buf.length - this.maxBytes;
			this.totalTruncatedBytes += bytesToTruncate;
			this.buffer = buf.subarray(bytesToTruncate).toString("utf-8");
		}
	}

	get value(): string {
		return this.buffer;
	}

	/** Get final output with single truncation header if needed */
	finalize(): string {
		if (this.totalTruncatedBytes > 0) {
			return `...[truncated ${this.totalTruncatedBytes} bytes]...\n${this.buffer}`;
		}
		// Apply final truncation if buffer is still over limit
		const currentBytes = Buffer.byteLength(this.buffer, "utf-8");
		if (currentBytes > this.maxBytes) {
			const buf = Buffer.from(this.buffer, "utf-8");
			const bytesToTruncate = buf.length - this.maxBytes;
			const truncated = buf.subarray(bytesToTruncate).toString("utf-8");
			return `...[truncated ${bytesToTruncate} bytes]...\n${truncated}`;
		}
		return this.buffer;
	}
}

/**
 * Kill process with SIGTERM, escalate to SIGKILL after grace period.
 * Does NOT wait for close - returns immediately after initiating termination.
 * The close listener is purely for cleanup (clearing the SIGKILL timer).
 */
function killWithEscalation(proc: ChildProcess): void {
	try {
		proc.kill("SIGTERM");
	} catch {
		// Process may already be dead
	}
	const killTimer = setTimeout(() => {
		try {
			proc.kill("SIGKILL");
		} catch {
			// Process may already be dead
		}
	}, SIGKILL_GRACE_MS);

	// Clear the SIGKILL timer when process closes (best-effort cleanup)
	proc.once("close", () => {
		clearTimeout(killTimer);
	});
}

/**
 * POST-HOOK: Quality Gate
 * Validate code quality after task completion.
 * Returns true if quality gate passes, false otherwise with error details.
 */
function runQualityGate(cwd: string): { passed: boolean; error?: string } {
	if (!fs.existsSync(QUALITY_GATE_SCRIPT)) {
		// No quality gate script = pass by default
		return { passed: true };
	}

	try {
		const inputJson = JSON.stringify({ cwd });
		const result = spawnSync(
			"bash",
			["-c", `echo '${inputJson.replace(/'/g, "'\\''")}' | "${QUALITY_GATE_SCRIPT}"`],
			{
				cwd,
				encoding: "utf-8",
				timeout: 120000, // 2 minute timeout for tests
			},
		);

		if (result.status === 0) {
			return { passed: true };
		}

		// Quality gate failed - extract error details
		const errorOutput = result.stderr || result.stdout || "Quality gate failed with no output";
		return { passed: false, error: errorOutput.slice(0, 2000) }; // Truncate error output
	} catch (err) {
		return { passed: false, error: `Quality gate script error: ${err instanceof Error ? err.message : String(err)}` };
	}
}

// Exit codes for gate scripts (from tasks_loop)
const CLARIFY_CODE = 42;

interface GateResult {
	passed: boolean;
	exitCode: number;
	output: string;
	needsClarification?: boolean;
}

/**
 * Run a custom gate script for retry-until-pass mode.
 * Returns full output for feeding back to agent on failure.
 */
function runGate(gatePath: string, cwd: string): GateResult {
	const absoluteGate = path.isAbsolute(gatePath) ? gatePath : path.join(cwd, gatePath);

	if (!fs.existsSync(absoluteGate)) {
		return {
			passed: false,
			exitCode: 1,
			output: `Gate script not found: ${absoluteGate}`,
		};
	}

	try {
		const result = spawnSync("bash", [absoluteGate], {
			cwd,
			encoding: "utf-8",
			timeout: 300000, // 5 minute timeout for gate scripts
		});

		const output = (result.stdout || "") + (result.stderr || "");
		const exitCode = result.status ?? 1;

		if (exitCode === 0) {
			return { passed: true, exitCode: 0, output };
		}

		if (exitCode === CLARIFY_CODE) {
			return {
				passed: false,
				exitCode: CLARIFY_CODE,
				output,
				needsClarification: true,
			};
		}

		return { passed: false, exitCode, output };
	} catch (err) {
		return {
			passed: false,
			exitCode: 1,
			output: `Gate script error: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

/**
 * Choose model for current attempt based on escalation policy.
 * Implements deterministic routing from research doc:
 * - attempt <= EscalateAfter → use base Model
 * - else → use EscalateModel (up to MaxEscalations times)
 * - if escalations exhausted → fall back to base Model
 */
function chooseModel(attempt: number, task: ParsedTask, escalationsUsed: number, agentModel?: string): string {
	const baseModel = task.model || agentModel || DEFAULT_MODEL;
	const escalateAfter = task.escalateAfter ?? DEFAULT_ESCALATE_AFTER;
	const maxEscalations = task.maxEscalations ?? DEFAULT_MAX_ESCALATIONS;

	// Early attempts: use base model
	if (attempt <= escalateAfter) {
		return baseModel;
	}

	// Escalation phase: use escalate model if available and budget allows
	if (task.escalateModel && escalationsUsed < maxEscalations) {
		return task.escalateModel;
	}

	// Escalation budget exhausted or no escalate model: fall back to base
	return baseModel;
}

/**
 * PRE-HOOK: Memory Recall
 * Query memory for prior solutions before each task.
 * Returns strictly prior solutions to inject as context into the task prompt.
 */
function runMemoryRecall(task: ParsedTask, cwd: string): MemoryRecallResult | null {
	if (!fs.existsSync(MEMORY_RECALL_SCRIPT)) {
		return null;
	}

	// Build query from task context
	const query = `${task.title}. ${task.description}`.trim();
	if (!query) {
		return null;
	}

	try {
		const result = spawnSync(MEMORY_RECALL_SCRIPT, ["recall", "--q", query, "--json"], {
			cwd,
			encoding: "utf-8",
			timeout: 30000,
		});

		if (result.status !== 0 || !result.stdout) {
			return null;
		}

		const data = JSON.parse(result.stdout) as MemoryRecallResult;
		return data;
	} catch {
		// Memory recall failure shouldn't block task execution
		return null;
	}
}

/// ============================================================================
// AGENT EXECUTION ABSTRACTION
// ============================================================================

interface AgentExecutionResult {
	output: string;
	toolCallCount: number;
	// Phase 4: Token usage tracking
	tokenUsage?: TokenUsage; // Actual usage from API (if available)
	estimatedCost?: number; // Estimated cost in USD
}

/**
 * Determines the command and args to use based on provider and model
 * Phase 2: Provider-based routing for multi-provider support
 */
function getCommandForProvider(
	provider: string | undefined,
	model: string | undefined,
	agentName: string,
): { command: string; args: string[]; usePromptFlag: boolean } {
	// Determine effective provider
	// Priority: explicit provider > inferred from agent name > default (anthropic)
	let effectiveProvider = provider || "anthropic";

	// Infer provider from agent name if not explicitly set
	if (!provider) {
		const lowerAgent = agentName.toLowerCase();
		if (lowerAgent.includes("codex")) {
			effectiveProvider = "openai";
		} else if (lowerAgent.includes("review")) {
			effectiveProvider = "github";
		}
	}

	// Route based on provider
	switch (effectiveProvider) {
		case "anthropic":
		case "google":
			// Use pi CLI for Anthropic and Google
			return {
				command: "pi",
				args: ["--mode", "json", "-p", "--no-session", "--provider", effectiveProvider],
				usePromptFlag: false, // Prompt added at end
			};

		case "openai":
			// Check if model requires codex CLI
			if (model?.includes("codex") || model?.includes("o3") || model?.includes("gpt-5.2")) {
				return {
					command: "codex",
					args: ["exec", "--json"],
					usePromptFlag: true, // Uses -p flag
				};
			} else {
				// Use pi CLI for standard OpenAI models
				return {
					command: "pi",
					args: ["--mode", "json", "-p", "--no-session", "--provider", "openai"],
					usePromptFlag: false,
				};
			}

		case "github":
			// Use copilot CLI for GitHub provider (FREE)
			return {
				command: "copilot",
				args: [],
				usePromptFlag: false,
			};

		default:
			// Fallback to pi with anthropic
			return {
				command: "pi",
				args: ["--mode", "json", "-p", "--no-session", "--provider", "anthropic"],
				usePromptFlag: false,
			};
	}
}

/**
 * Checks if an error is a rate limit error
 */
function isRateLimitError(error: unknown): boolean {
	const errorMsg = String(error).toLowerCase();
	return (
		errorMsg.includes("rate limit") ||
		errorMsg.includes("429") ||
		errorMsg.includes("too many requests") ||
		errorMsg.includes("quota exceeded")
	);
}

/**
 * Checks if an error is a provider downtime error
 */
function isProviderDownError(error: unknown): boolean {
	const errorMsg = String(error).toLowerCase();
	return (
		errorMsg.includes("503") ||
		errorMsg.includes("service unavailable") ||
		errorMsg.includes("connection refused") ||
		errorMsg.includes("econnrefused") ||
		errorMsg.includes("timeout")
	);
}

/**
 * Executes agent with fallback support for rate limits and downtime
 * Phase 2: Fallback logic
 * Phase 3: Metrics tracking, smart fallback, health checks
 */
async function executeAgentWithFallback(
	agentConfig: AgentConfig,
	prompt: string,
	cwd: string,
	writeToFile: (line: string) => void,
	timeoutMs: number,
	signal?: AbortSignal,
	modelOverride?: string,
	providerOverride?: string,
	fallbackProvider?: string,
	fallbackModel?: string,
): Promise<AgentExecutionResult & { usedFallback?: boolean; provider?: string }> {
	const primaryProvider = providerOverride || agentConfig.provider || "anthropic";
	const primaryModel = modelOverride || agentConfig.model;

	// Phase 3: Determine fallback (explicit or smart)
	let effectiveFallbackProvider = fallbackProvider;
	let effectiveFallbackModel = fallbackModel;

	if (!effectiveFallbackProvider && !effectiveFallbackModel) {
		// No explicit fallback - use smart selection
		const smartFallback = selectSmartFallback(primaryProvider);
		if (smartFallback) {
			effectiveFallbackProvider = smartFallback.provider;
			effectiveFallbackModel = smartFallback.model;
			writeToFile(
				`[system] 💡 Smart fallback selected: ${effectiveFallbackProvider}/${effectiveFallbackModel} (optimized for cost/reliability)\n`,
			);
		}
	}

	// Try primary provider first
	const primaryStartTime = Date.now();
	try {
		writeToFile(`[system] Attempting with provider: ${primaryProvider}, model: ${primaryModel || "default"}\n`);
		const result = await executeAgent(
			agentConfig,
			prompt,
			cwd,
			writeToFile,
			timeoutMs,
			signal,
			modelOverride,
			providerOverride,
		);

		// Phase 3: Track metrics for success
		const latency = Date.now() - primaryStartTime;
		updateProviderMetrics(primaryProvider, true, latency);

		return { ...result, usedFallback: false, provider: primaryProvider };
	} catch (primaryError) {
		// Determine error type
		const isRateLimit = isRateLimitError(primaryError);
		const isDowntime = isProviderDownError(primaryError);
		const errorType = isRateLimit ? "rate_limit" : isDowntime ? "downtime" : undefined;

		// Phase 3: Track metrics for failure
		const latency = Date.now() - primaryStartTime;
		updateProviderMetrics(primaryProvider, false, latency, errorType as "rate_limit" | "downtime" | undefined);

		// Check if we should try fallback
		const shouldFallback = (effectiveFallbackProvider || effectiveFallbackModel) && (isRateLimit || isDowntime);

		if (!shouldFallback) {
			// No fallback available or error is not rate limit/downtime
			throw primaryError;
		}

		// Log fallback attempt
		const errorTypeLabel = isRateLimit ? "RATE_LIMIT" : "PROVIDER_DOWN";
		writeToFile(
			`[system] ⚠️  Primary provider failed (${errorTypeLabel}): ${primaryError}\n` +
				`[system] 🔄 Attempting fallback - provider: ${effectiveFallbackProvider || "same"}, model: ${effectiveFallbackModel || "same"}\n`,
		);

		// Phase 3: Health check before trying fallback
		if (effectiveFallbackProvider && effectiveFallbackProvider !== primaryProvider) {
			writeToFile(`[system] 🏥 Health check: ${effectiveFallbackProvider}...\n`);
			const healthy = await checkProviderHealth(effectiveFallbackProvider);
			if (!healthy) {
				writeToFile(`[system] ⚠️  Fallback provider ${effectiveFallbackProvider} health check failed, skipping\n`);
				throw primaryError;
			}
			writeToFile(`[system] ✅ Health check passed\n`);
		}

		// Try fallback
		const fallbackStartTime = Date.now();
		try {
			const result = await executeAgent(
				agentConfig,
				prompt,
				cwd,
				writeToFile,
				timeoutMs,
				signal,
				effectiveFallbackModel || modelOverride,
				effectiveFallbackProvider || providerOverride,
			);

			// Phase 3: Track metrics for fallback success
			const fallbackLatency = Date.now() - fallbackStartTime;
			updateProviderMetrics(effectiveFallbackProvider || primaryProvider, true, fallbackLatency);

			writeToFile(`[system] ✅ Fallback succeeded\n`);
			return { ...result, usedFallback: true, provider: effectiveFallbackProvider };
		} catch (fallbackError) {
			// Phase 3: Track metrics for fallback failure
			const fallbackLatency = Date.now() - fallbackStartTime;
			const fallbackErrorType = isRateLimitError(fallbackError)
				? "rate_limit"
				: isProviderDownError(fallbackError)
					? "downtime"
					: undefined;
			updateProviderMetrics(
				effectiveFallbackProvider || primaryProvider,
				false,
				fallbackLatency,
				fallbackErrorType as "rate_limit" | "downtime" | undefined,
			);

			// Both primary and fallback failed
			writeToFile(`[system] ❌ Fallback also failed: ${fallbackError}\n`);
			throw new Error(`Primary provider failed: ${primaryError}\nFallback provider also failed: ${fallbackError}`);
		}
	}
}

/**
 * Executes a single agent task using the configured provider (pi or codex)
 */
async function executeAgent(
	agentConfig: AgentConfig,
	prompt: string,
	cwd: string,
	writeToFile: (line: string) => void,
	timeoutMs: number,
	signal?: AbortSignal,
	modelOverride?: string,
	providerOverride?: string,
): Promise<AgentExecutionResult> {
	return new Promise<AgentExecutionResult>((resolve, reject) => {
		let settled = false;
		let toolCallCount = 0; // Tracking tool calls if possible
		const output = new OutputAccumulator(MAX_OUTPUT_BYTES); // Use OutputAccumulator here
		// Phase 4: Token usage tracking
		let tokenUsage: TokenUsage | undefined;

		// Determine effective provider and model
		const effectiveProvider = providerOverride || agentConfig.provider;
		const effectiveModel = modelOverride || agentConfig.model;

		// Phase 2: Provider-based dispatch
		const dispatch = getCommandForProvider(effectiveProvider, effectiveModel, agentConfig.name);
		const command = dispatch.command;
		// Check for codex in command/provider (handles variants like "openai-codex", "/usr/bin/codex")
		const isCodex = command.toLowerCase().includes("codex") || effectiveProvider?.toLowerCase().includes("codex");
		const args: string[] = [...dispatch.args];
		let tmpDir: string | null = null; // For system prompt file

		// Add model if specified
		if (effectiveModel) {
			args.push("--model", effectiveModel);
		}

		// Add tools if using pi CLI
		if (command === "pi" && agentConfig.tools?.length) {
			const builtinTools: string[] = [];
			for (const tool of agentConfig.tools) {
				if (!tool.includes("/") && !tool.endsWith(".ts") && !tool.endsWith(".js")) {
					builtinTools.push(tool);
				}
			}
			if (builtinTools.length > 0) {
				args.push("--tools", builtinTools.join(","));
			}
		}

		// Add system prompt if using pi CLI
		if (command === "pi" && agentConfig.systemPrompt?.trim()) {
			const tmp = writePromptFile(agentConfig.name, agentConfig.systemPrompt);
			tmpDir = tmp.dir;
			args.push("--append-system-prompt", tmp.path);
		}

		// Add prompt (different format for different CLIs)
		if (dispatch.usePromptFlag) {
			args.push("-p", prompt);
		} else {
			args.push(prompt);
		}

		writeToFile(`[system] Spawning agent: ${command} ${args.join(" ")}\n`);

		const proc = spawn(command, args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let timeoutId: NodeJS.Timeout | null = null;

		// Cleanup helper - call before settling
		const cleanup = () => {
			if (timeoutId) clearTimeout(timeoutId);
			signal?.removeEventListener("abort", abortHandler);
			if (tmpDir) {
				try {
					fs.rmSync(tmpDir, { recursive: true });
				} catch {}
			}
		};

		// Abort handler with guard against multiple settlements
		const abortHandler = () => {
			if (!settled) {
				settled = true;
				cleanup();
				killWithEscalation(proc); // Best-effort cleanup, don't wait
				reject(new Error("Task aborted")); // Settle immediately
			}
		};
		signal?.addEventListener("abort", abortHandler, { once: true });

		// Timeout handler with SIGKILL escalation
		timeoutId = setTimeout(() => {
			if (!settled) {
				settled = true;
				cleanup();
				killWithEscalation(proc); // Best-effort cleanup, don't wait
				reject(new Error(`Task timed out after ${Math.round(timeoutMs / 1000)}s`)); // Settle immediately
			}
		}, timeoutMs);

		// JSONL line buffer for proper chunk handling
		let stdoutBuf = "";

		const processJsonlLine = (line: string) => {
			if (!line.trim()) return;
			// Write raw JSONL to file (complete, no truncation)
			writeToFile(`${line}\n`);
			try {
				const evt = JSON.parse(line);

				// Handle Pi-style events
				if (evt.type === "message_end" && evt.message?.content) {
					for (const part of evt.message.content) {
						if (part.type === "text" && part.text) {
							output.append(`${part.text}\n`);
						}
					}
					// Phase 4: Capture token usage from Claude API
					if (evt.message?.usage) {
						tokenUsage = {
							inputTokens: evt.message.usage.input_tokens || 0,
							outputTokens: evt.message.usage.output_tokens || 0,
							totalTokens: (evt.message.usage.input_tokens || 0) + (evt.message.usage.output_tokens || 0),
						};
					}
				}
				// Also capture tool results for visibility
				if (evt.type === "tool_result" && evt.result?.content) {
					toolCallCount++;
					for (const part of evt.result.content) {
						if (part.type === "text" && part.text) {
							const text = part.text.slice(0, 500);
							output.append(`[tool: ${evt.toolName || "unknown"}] ${text}\n`);
						}
					}
				}

				// Handle Codex-style events (if they differ, adapt here)
				// Codex tool output is evolving. Assuming similar structure or just text.
				// If codex outputs non-standard JSON, we might need adjustments.
				// For now, relying on JSON compatibility or fallback.
				if (isCodex && evt.response) {
					output.append(`${evt.response}\n`);
				}
			} catch {
				// Not valid JSON, might be raw text
				if (isCodex) {
					output.append(`${line}\n`);
				}
			}
		};

		proc.stdout.on("data", (chunk) => {
			stdoutBuf += chunk.toString("utf-8");
			for (let idx = stdoutBuf.indexOf("\n"); idx !== -1; idx = stdoutBuf.indexOf("\n")) {
				const line = stdoutBuf.slice(0, idx);
				stdoutBuf = stdoutBuf.slice(idx + 1);
				processJsonlLine(line);
			}
		});

		proc.stderr.on("data", (chunk) => {
			const text = chunk.toString();
			writeToFile(`[stderr] ${text}`);
			// output.append(text); // Don't pollute main output with stderr unless essential
		});

		proc.on("close", (code) => {
			if (settled) return;
			settled = true;
			cleanup();

			// Process any remaining buffer content
			if (stdoutBuf.trim()) {
				processJsonlLine(stdoutBuf);
			}

			if (code === 0) {
				// Phase 4: Calculate estimated cost if token usage available
				let estimatedCost: number | undefined;
				if (tokenUsage && effectiveModel) {
					const costInfo = MODEL_COSTS[effectiveModel];
					if (costInfo) {
						estimatedCost =
							(tokenUsage.inputTokens / 1_000_000) * costInfo.inputCost +
							(tokenUsage.outputTokens / 1_000_000) * costInfo.outputCost;
					}
				}

				resolve({ output: output.finalize(), toolCallCount, tokenUsage, estimatedCost });
			} else {
				reject(new Error(`Agent exited with code ${code}`));
			}
		});

		proc.on("error", (err) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(err);
		});
	});
}

/**
 * Check if task-monitor is running.
 * Task-monitor is MANDATORY for all orchestrations to provide visibility into long-running processes.
 * Uses pgrep to detect task-monitor process (tui or api mode).
 *
 * @throws {Error} If task-monitor is not detected
 *
 * Environment Variables:
 * - ORCHESTRATE_SKIP_MONITOR_CHECK=1: Skip check for development/testing (macOS/Linux only)
 *
 * Platform Support: macOS and Linux (requires pgrep)
 */
function checkTaskMonitor(): void {
	// Allow override for development/testing
	if (process.env.ORCHESTRATE_SKIP_MONITOR_CHECK === "1") {
		console.warn("⚠️  Task-monitor check skipped (ORCHESTRATE_SKIP_MONITOR_CHECK=1)");
		return;
	}

	try {
		// Check if task-monitor process is running
		// More specific pattern to reduce false positives: looks for Python running monitor.py script
		const result = spawnSync("pgrep", ["-f", "python.*task-monitor/monitor\\.py.*(tui|api)"], {
			encoding: "utf-8",
			timeout: 10000, // Increased from 5s to 10s for slower systems
		});

		const stdout = result.stdout.trim();

		// Validate result
		if (result.status !== 0 || !stdout) {
			throw new Error(
				`❌ BLOCKED: Task-monitor is not running.

Orchestrations run 5-30+ minutes and REQUIRE monitoring for:
- Real-time progress tracking
- Error detection and alerts
- Budget usage and cost tracking
- Early failure detection (saves hours of wasted compute)

Start task-monitor BEFORE running orchestrate:

  .pi/skills/task-monitor/run.sh tui &

Then re-run orchestrate.

Rule: NEVER run /orchestrate without task-monitor watchdog.`,
			);
		}

		// Validate pgrep output is actually a PID (numeric)
		if (!/^\d+(\n\d+)*$/.test(stdout)) {
			console.warn(`⚠️  Unexpected pgrep output: ${stdout}`);
			throw new Error("Task-monitor check returned unexpected output");
		}
	} catch (err) {
		if (err instanceof Error && err.message.includes("BLOCKED")) {
			throw err;
		}
		// If pgrep command fails (not found), issue a warning but don't block
		// This allows orchestrate to run in environments where pgrep isn't available
		console.warn(
			"⚠️  Warning: Could not verify task-monitor status (pgrep not available). " +
				"Ensure task-monitor is running manually: .pi/skills/task-monitor/run.sh tui &",
		);
	}
}

/**
 * Run pre-flight checks (sanity scripts, definition of done).
 * Throws error if checks fail.
 */
function runPreflight(taskFile: string, cwd: string): void {
	if (!fs.existsSync(PREFLIGHT_SCRIPT)) {
		// If preflight script is missing, we cannot enforce checks.
		// Warn or ignore based on strictness. For now, ignore to allow operation without it.
		return;
	}

	try {
		const result = spawnSync(PREFLIGHT_SCRIPT, [taskFile], {
			cwd,
			encoding: "utf-8",
			timeout: 60000, // 1 minute
		});

		if (result.status !== 0) {
			const output = (result.stdout || "") + (result.stderr || "");
			throw new Error(`Pre-flight check failed. Fix issues before running:\n\n${output}`);
		}
	} catch (err) {
		throw new Error(`Pre-flight script error: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * Run agent to fix issues based on gate failure.
 * This is the core of retry-until-pass mode from tasks_loop.
 */
async function runAgentFix(
	task: ParsedTask,
	taskFile: TaskFileContent,
	gateOutput: string,
	attempt: number,
	maxRetries: number,
	agent: AgentConfig,
	cwd: string,
	outputDir: string,
	modelOverride?: string,
): Promise<{ fixed: boolean; output: string }> {
	// Build fix prompt with failure context
	const tailLines = 160;
	const failureTail = gateOutput.split("\n").slice(-tailLines).join("\n");

	const fixPrompt = `
You are a repo-scoped coding agent.

Goal: make the gate script pass.

Rules:
- DO NOT edit gate scripts unless explicitly instructed
- Make minimal, localized changes to fix the issue
- The runner will re-run the gate after you finish

## Attempt ${attempt}/${maxRetries}

## Task Context
${taskFile.context}

## Task ${task.id}: ${task.title}
${task.description}

## Gate Failure Output (last ${tailLines} lines):
${failureTail}

## Instructions
Analyze the failure and make the minimal fix needed. Do NOT introduce unrelated changes.
`.trim();

	// Write fix prompt to output file
	const fixLogPath = path.join(outputDir, `task-${task.id}-fix-attempt-${attempt}.log`);
	let fixFd: number | null = null;
	try {
		fixFd = fs.openSync(fixLogPath, "w");
		fs.writeSync(fixFd, `=== FIX ATTEMPT ${attempt} ===\n\n${fixPrompt}\n\n=== AGENT OUTPUT ===\n`);
	} catch {
		// Ignore file errors
	}

	// Helper to write to file (full output, no truncation)
	const writeToFile = (text: string) => {
		if (fixFd !== null) {
			try {
				fs.writeSync(fixFd, text);
			} catch {
				// Ignore write errors
			}
		}
	};

	try {
		// Phase 2: Use fallback-aware execution
		const agentExecutionResult = await executeAgentWithFallback(
			agent,
			fixPrompt,
			cwd,
			writeToFile,
			300000, // 5 minute timeout
			undefined,
			modelOverride,
			task.provider,
			task.fallbackProvider,
			task.fallbackModel,
		);

		if (agentExecutionResult.usedFallback) {
			writeToFile(
				`\n[system] 🔄 Fix attempt completed using fallback provider: ${agentExecutionResult.provider || "unknown"}\n`,
			);
		}

		return { fixed: true, output: agentExecutionResult.output };
	} catch (err) {
		return { fixed: false, output: `Agent fix error: ${err instanceof Error ? err.message : String(err)}` };
	} finally {
		if (fixFd !== null) {
			try {
				fs.closeSync(fixFd);
			} catch {}
		}
	}
}

const MAX_SELF_REVIEW_CYCLES = 3;

/**
 * Self-review: agent reviews its own work before marking complete.
 * From tasks_loop - helps catch issues before declaring success.
 */
async function runSelfReview(
	task: ParsedTask,
	agent: AgentConfig,
	cwd: string,
	outputDir: string,
): Promise<{ passed: boolean; output: string }> {
	const output = new OutputAccumulator(MAX_OUTPUT_BYTES);

	// Get recent git changes for context
	let gitDiff = "";
	try {
		const diffResult = spawnSync("git", ["diff", "--stat"], {
			cwd,
			encoding: "utf-8",
			timeout: 10000,
		});
		gitDiff = diffResult.stdout || "No git diff available";
	} catch {
		gitDiff = "Could not get git diff";
	}

	for (let cycle = 1; cycle <= MAX_SELF_REVIEW_CYCLES; cycle++) {
		const reviewPrompt = `
You just made changes to complete Task ${task.id}: ${task.title}

Before marking complete, review with fresh eyes:

1. Did you make the minimal change needed?
2. Are there any obvious issues or regressions?
3. Does the fix address the root cause?

Recent changes:
${gitDiff}

If no issues found, respond with EXACTLY: "No issues found."
If issues found, fix them now.
`.trim();

		// Write review to file
		const reviewLogPath = path.join(outputDir, `task-${task.id}-self-review-${cycle}.log`);
		let reviewFd: number | null = null;
		try {
			reviewFd = fs.openSync(reviewLogPath, "w");
			fs.writeSync(reviewFd, `=== SELF-REVIEW CYCLE ${cycle} ===\n\n${reviewPrompt}\n\n=== AGENT OUTPUT ===\n`);
		} catch {
			// Ignore file errors
		}

		// Helper to write to file (full output, no truncation)
		const writeToFile = (text: string) => {
			if (reviewFd !== null) {
				try {
					fs.writeSync(reviewFd, text);
				} catch {
					// Ignore write errors
				}
			}
		};

		let reviewOutput = "";

		try {
			const agentExecutionResult = await executeAgent(agent, reviewPrompt, cwd, writeToFile, 300000); // 5 minute timeout
			reviewOutput = agentExecutionResult.output;
			output.append(reviewOutput);
		} catch (err) {
			output.append(`\nAgent self-review error: ${err instanceof Error ? err.message : String(err)}\n`);
			// If agent crashes during self-review, it's a failure for this cycle, but we might continue.
			// For now, let's just append the error and proceed to check for "No issues found."
		} finally {
			if (reviewFd !== null) {
				try {
					fs.closeSync(reviewFd);
				} catch {}
			}
		}

		// Check if review passed (no issues found)
		if (/no issues found/i.test(reviewOutput)) {
			return { passed: true, output: output.finalize() };
		}

		// Issues found - agent is fixing, will retry on next cycle
		output.append(`\n[Self-review cycle ${cycle}: issues found, agent fixing...]\n`);
	}

	// Max cycles reached
	output.append(`\n[Self-review: max cycles (${MAX_SELF_REVIEW_CYCLES}) reached, proceeding anyway]\n`);
	return { passed: true, output: output.finalize() };
}

async function runTask(
	task: ParsedTask,
	taskFile: TaskFileContent,
	cwd: string,
	timeoutMs: number,
	outputDir: string,
	signal?: AbortSignal,
): Promise<TaskResult> {
	const startTime = Date.now();

	// Create output file for complete (non-truncated) output
	const outputFile = path.join(outputDir, `task-${task.id}.log`);
	let outputFd: number | null = null;
	try {
		outputFd = fs.openSync(outputFile, "w");
	} catch {
		// If we can't create the output file, continue without it
	}

	// Helper to write to file (full output, no truncation)
	const writeToFile = (text: string) => {
		if (outputFd !== null) {
			try {
				fs.writeSync(outputFd, text);
			} catch {
				// Ignore write errors
			}
		}
	};

	// Helper to close the output file
	const closeOutputFile = () => {
		if (outputFd !== null) {
			try {
				fs.closeSync(outputFd);
			} catch {
				// Ignore close errors
			}
			outputFd = null;
		}
	};

	const agentResult = loadAgentConfig(task.agent);

	if (isAgentConfigError(agentResult)) {
		writeToFile(`ERROR: ${agentResult.error}\n`);
		closeOutputFile();
		return {
			taskId: task.id,
			title: task.title,
			agent: task.agent,
			status: "failed",
			output: "",
			outputFile,
			durationMs: Date.now() - startTime,
			error: agentResult.error,
		};
	}

	const agent = agentResult;

	// PRE-HOOK: Memory Recall - query for prior solutions
	const memoryResult = runMemoryRecall(task, cwd);
	let memoryContext = "";
	if (memoryResult?.found && memoryResult.items?.length) {
		const recalledItems = memoryResult.items
			.map((item, i) => `${i + 1}. **Problem**: ${item.problem}\n   **Solution**: ${item.solution}`)
			.join("\n\n");
		memoryContext = `
## Memory Recall (Prior Solutions Found)

The following relevant solutions were found in memory. Review and adapt as needed:

${recalledItems}

---
`;
	}

	// Build the task prompt with context and memory
	const taskPrompt = `
${memoryContext}## Context
${taskFile.context}

## Task ${task.id}: ${task.title}
${task.description}

${task.notes ? `Notes: ${task.notes}` : ""}
## Instructions
1. Implement the task.
2. **CRITICAL**: Run the verification script to self-check your work:
   \`${QUALITY_GATE_SCRIPT}\`
3. If it fails, fix the code and run it again.
4. Only when it passes, summarize what was accomplished.
`.trim();

	let agentExecutionResult: AgentExecutionResult & { usedFallback?: boolean; provider?: string };
	try {
		// Phase 2: Use fallback-aware execution
		agentExecutionResult = await executeAgentWithFallback(
			agent,
			taskPrompt,
			cwd,
			writeToFile,
			timeoutMs,
			signal,
			undefined, // modelOverride (handled by chooseModel in retry loop)
			task.provider, // providerOverride from task
			task.fallbackProvider,
			task.fallbackModel,
		);

		// Log if fallback was used
		if (agentExecutionResult.usedFallback) {
			writeToFile(
				`\n[system] 🔄 Task completed using fallback provider: ${agentExecutionResult.provider || "unknown"}\n`,
			);
		}
	} catch (err) {
		writeToFile(`\nERROR: ${err instanceof Error ? err.message : String(err)}\n`);
		closeOutputFile();
		return {
			taskId: task.id,
			title: task.title,
			agent: task.agent,
			status: "failed",
			output: "",
			outputFile,
			durationMs: Date.now() - startTime,
			error: err instanceof Error ? err.message : String(err),
		};
	}

	// If agent subprocess failed (executeAgent throws on non-zero exit), it's caught above.
	// If it resolved, it means the agent process itself exited with 0.

	// POST-HOOK: Quality Gate - validate code quality
	const qualityResult = runQualityGate(cwd);
	if (!qualityResult.passed) {
		writeToFile(`\n--- QUALITY GATE FAILED ---\n${qualityResult.error || ""}\n`);
		closeOutputFile();
		return {
			taskId: task.id,
			title: task.title,
			agent: task.agent,
			status: "failed",
			output: `${agentExecutionResult.output}\n\n--- QUALITY GATE FAILED ---\n${qualityResult.error || ""}`,
			outputFile,
			durationMs: Date.now() - startTime,
			error: "Quality gate failed - tests or checks did not pass",
		};
	}

	// Both agent execution and quality gate passed
	closeOutputFile();
	return {
		taskId: task.id,
		title: task.title,
		agent: task.agent,
		status: "success",
		output: agentExecutionResult.output,
		outputFile,
		durationMs: Date.now() - startTime,
		// Phase 2: Cost tracking
		provider: agentExecutionResult.provider || task.provider,
		model: task.model,
		usedFallback: agentExecutionResult.usedFallback,
		// Phase 4: Token usage and cost
		tokenUsage: agentExecutionResult.tokenUsage,
		cost: agentExecutionResult.estimatedCost,
	};
}

const DEFAULT_MAX_RETRIES = 3;

/**
 * Run task with retry-until-pass mode (from tasks_loop).
 * If task has mode "retry-until-pass" and a gate, will retry with agent fixes until gate passes.
 */
async function runTaskWithRetry(
	task: ParsedTask,
	taskFile: TaskFileContent,
	cwd: string,
	timeoutMs: number,
	outputDir: string,
	signal?: AbortSignal,
): Promise<TaskResult> {
	const startTime = Date.now();

	// If not retry-until-pass mode or no gate, use normal execution
	if (task.mode !== "retry-until-pass" || !task.gate) {
		const result = await runTask(task, taskFile, cwd, timeoutMs, outputDir, signal);

		// Run self-review if enabled and task succeeded
		if (task.selfReview && result.status === "success") {
			const agentResult = loadAgentConfig(task.agent);
			if (!isAgentConfigError(agentResult)) {
				const reviewResult = await runSelfReview(task, agentResult, cwd, outputDir);
				result.output += `\n\n=== SELF-REVIEW ===\n${reviewResult.output}`;
			}
		}

		return result;
	}

	const maxRetries = task.maxRetries ?? DEFAULT_MAX_RETRIES;
	const agentResult = loadAgentConfig(task.agent);

	if (isAgentConfigError(agentResult)) {
		return {
			taskId: task.id,
			title: task.title,
			agent: task.agent,
			status: "failed",
			output: "",
			outputFile: path.join(outputDir, `task-${task.id}.log`),
			durationMs: Date.now() - startTime,
			error: agentResult.error,
		};
	}

	const agent = agentResult;
	const allOutput: string[] = [];
	let escalationsUsed = 0; // Track how many times we've escalated models

	// First, run the initial task to set up the work
	const initialResult = await runTask(task, taskFile, cwd, timeoutMs, outputDir, signal);
	allOutput.push(`=== INITIAL EXECUTION ===\n${initialResult.output}`);

	// Now enter the retry loop
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		if (signal?.aborted) {
			return {
				taskId: task.id,
				title: task.title,
				agent: task.agent,
				status: "failed",
				output: allOutput.join("\n\n"),
				outputFile: initialResult.outputFile,
				durationMs: Date.now() - startTime,
				error: "Task aborted",
			};
		}

		// Run the gate
		const gateResult = runGate(task.gate, cwd);
		allOutput.push(`=== GATE ATTEMPT ${attempt} ===\nExit code: ${gateResult.exitCode}\n${gateResult.output}`);

		if (gateResult.passed) {
			// Gate passed! Run self-review if enabled
			if (task.selfReview) {
				const reviewResult = await runSelfReview(task, agent, cwd, outputDir);
				allOutput.push(`=== SELF-REVIEW ===\n${reviewResult.output}`);
			}

			// Task is complete
			return {
				taskId: task.id,
				title: task.title,
				agent: task.agent,
				status: "success",
				output: allOutput.join("\n\n"),
				outputFile: initialResult.outputFile,
				durationMs: Date.now() - startTime,
			};
		}

		if (gateResult.needsClarification) {
			// CLARIFY exit code - stop and return for human intervention
			return {
				taskId: task.id,
				title: task.title,
				agent: task.agent,
				status: "failed",
				output: allOutput.join("\n\n"),
				outputFile: initialResult.outputFile,
				durationMs: Date.now() - startTime,
				error: `Gate returned CLARIFY (exit ${CLARIFY_CODE}) - human intervention required`,
			};
		}

		// Gate failed - run agent fix (except on last attempt)
		if (attempt < maxRetries) {
			// Choose model for this attempt
			const chosenModel = chooseModel(attempt, task, escalationsUsed, agent.model);

			// Track if we're using an escalated model
			if (task.escalateModel && chosenModel === task.escalateModel) {
				escalationsUsed++;
			}

			const fixResult = await runAgentFix(
				task,
				taskFile,
				gateResult.output,
				attempt,
				maxRetries,
				agent,
				cwd,
				outputDir,
				chosenModel,
			);
			allOutput.push(`=== FIX ATTEMPT ${attempt} (model: ${chosenModel}) ===\n${fixResult.output}`);
		}
	}

	// Exhausted all retries
	return {
		taskId: task.id,
		title: task.title,
		agent: task.agent,
		status: "failed",
		output: allOutput.join("\n\n"),
		outputFile: initialResult.outputFile,
		durationMs: Date.now() - startTime,
		error: `Exhausted ${maxRetries} retries - gate still failing`,
	};
}

/**
 * Runs post-orchestration code review using the review-code skill
 */
function runPostOrchestrationReview(
	taskFile: TaskFileContent,
	cwd: string,
): { success: boolean; output?: string; error?: string } {
	const reviewerPath = path.join(os.homedir(), ".pi", "skills", "review-code", "run.sh");

	if (!fs.existsSync(reviewerPath)) {
		return { success: false, error: "review-code skill not found" };
	}

	// Get git diff of all changes
	const diffResult = spawnSync("git", ["diff", "HEAD"], {
		cwd,
		encoding: "utf-8",
		maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large diffs
	});

	if (diffResult.status !== 0 || !diffResult.stdout.trim()) {
		return { success: false, error: "No changes to review (git diff returned nothing)" };
	}

	// Build review-code command
	// Format: review-code review-full --provider <provider> --model <model>
	const args = ["review-full"];

	if (taskFile.reviewProvider) {
		args.push("--provider", taskFile.reviewProvider);
	}

	if (taskFile.reviewModel) {
		args.push("--model", taskFile.reviewModel);
	}

	try {
		const result = spawnSync("bash", [reviewerPath, ...args], {
			cwd,
			encoding: "utf-8",
			timeout: 5 * 60 * 1000, // 5 minutes
			stdio: ["pipe", "pipe", "pipe"],
		});

		if (result.status !== 0) {
			return {
				success: false,
				output: result.stdout || result.stderr,
				error: `review-code exited with status ${result.status}`,
			};
		}

		return {
			success: true,
			output: result.stdout,
		};
	} catch (error) {
		return {
			success: false,
			error: `Failed to run review-code: ${error}`,
		};
	}
}

function archiveSession(
	taskFile: TaskFileContent,
	results: TaskResult[],
	cwd: string,
): { success: boolean; error?: string } {
	const archiverPath = path.join(os.homedir(), ".pi", "agent", "skills", "episodic-archiver", "run.sh");

	if (!fs.existsSync(archiverPath)) {
		return { success: false, error: "Episodic archiver not found" };
	}

	// Create transcript JSON
	const transcript = {
		title: taskFile.title,
		context: taskFile.context,
		completedAt: new Date().toISOString(),
		tasks: results.map((r) => ({
			id: r.taskId,
			title: r.title,
			agent: r.agent,
			status: r.status,
			durationMs: r.durationMs,
			output: r.output.slice(0, 2000), // Truncate for storage
			error: r.error,
		})),
		totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
		successCount: results.filter((r) => r.status === "success").length,
		failCount: results.filter((r) => r.status === "failed").length,
	};

	const transcriptPath = path.join(os.tmpdir(), `orchestrate-${randomUUID()}.json`);
	fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2));

	try {
		const result = spawnSync("bash", [archiverPath, "archive", transcriptPath], {
			cwd,
			encoding: "utf-8",
			timeout: 30000,
		});

		// Cleanup
		try {
			fs.unlinkSync(transcriptPath);
		} catch {}

		if (result.status !== 0) {
			return { success: false, error: result.stderr || "Archive failed" };
		}

		return { success: true };
	} catch (err) {
		return { success: false, error: err instanceof Error ? err.message : String(err) };
	}
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

/**
 * Direct mode execution: Run a single gate without a task file.
 * Equivalent to tasks_loop but integrated into orchestrate.
 */
async function executeDirectMode(
	gate: string,
	maxRetries: number,
	selfReview: boolean,
	agentName: string,
	prompt: string | undefined,
	taskTimeoutMs: number,
	archive: boolean,
	cwd: string,
	signal?: AbortSignal,
	onUpdate?: (result: AgentToolResult<OrchestrateDetails>) => void,
): Promise<AgentToolResult<OrchestrateDetails>> {
	// Create output directory
	const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-orchestrate-direct-"));

	// Resolve gate path
	const absoluteGate = path.isAbsolute(gate) ? gate : path.join(cwd, gate);

	// Create a synthetic task for the gate
	const syntheticTask: ParsedTask = {
		id: 1,
		title: prompt || `Make ${path.basename(gate)} pass`,
		description: prompt || `Run the gate script until it passes: ${gate}`,
		agent: agentName,
		dependencies: [],
		notes: "",
		completed: false,
		lineStart: 0,
		lineEnd: 0,
		mode: "retry-until-pass",
		gate: absoluteGate,
		maxRetries,
		selfReview,
	};

	// Create synthetic task file content
	const syntheticTaskFile: TaskFileContent = {
		title: `Direct Gate: ${path.basename(gate)}`,
		context: `Running gate in direct mode: ${gate}`,
		tasks: [syntheticTask],
		questionsBlockers: [],
		rawLines: [],
	};

	const details: OrchestrateDetails = {
		taskFile: `[direct mode: ${gate}]`,
		status: "running",
		totalTasks: 1,
		completedTasks: 0,
		currentTask: syntheticTask.title,
		results: [],
		archived: false,
		outputDir,
	};

	// Update progress
	if (onUpdate) {
		onUpdate({
			content: [{ type: "text" as const, text: `Running gate: ${gate}` }],
			details,
		});
	}

	// Execute the task with retry-until-pass
	const result = await runTaskWithRetry(syntheticTask, syntheticTaskFile, cwd, taskTimeoutMs, outputDir, signal);

	details.results.push(result);

	if (result.status === "success") {
		details.completedTasks = 1;
		details.status = "completed";
	} else {
		details.status = "failed";
	}

	// Archive if requested and successful
	if (archive && details.status === "completed") {
		const archiveResult = archiveSession(syntheticTaskFile, [result], cwd);
		details.archived = archiveResult.success;
	}

	// Build summary
	const summary = [
		`Direct mode ${details.status}`,
		`Gate: ${gate}`,
		"",
		`Result: ${result.status}${result.durationMs ? ` [${formatDuration(result.durationMs)}]` : ""}`,
	];

	if (result.error) {
		summary.push(`Error: ${result.error}`);
	}

	if (details.archived) {
		summary.push("", "Session archived to episodic memory.");
	}

	summary.push("", `Full output: ${outputDir}`);

	return {
		content: [{ type: "text" as const, text: summary.join("\n") }],
		details,
	};
}

/**
 * Task file mode execution with state persistence for pause/resume.
 * Extracted to allow both fresh starts and resuming paused sessions.
 */
async function executeTaskFileMode(
	parsed: TaskFileContent,
	absolutePath: string,
	initialPendingTasks: ParsedTask[],
	initialCompletedIds: Set<number>,
	initialResults: TaskResult[],
	outputDir: string,
	existingState: OrchestrationState | null,
	cwd: string,
	continueOnError: boolean,
	archive: boolean,
	taskTimeoutMs: number,
	signal?: AbortSignal,
	onUpdate?: (result: AgentToolResult<OrchestrateDetails>) => void,
): Promise<AgentToolResult<OrchestrateDetails>> {
	// Create or use existing session ID
	const sessionId = existingState?.sessionId ?? randomUUID().slice(0, 8);

	// Initialize or restore state
	const completedIds = new Set(initialCompletedIds);
	const results = [...initialResults];

	// Create initial state if starting fresh
	const state: OrchestrationState = existingState ?? {
		sessionId,
		version: 1,
		taskFile: absolutePath,
		startedAt: new Date().toISOString(),
		status: "running",
		continueOnError,
		archive,
		taskTimeoutMs,
		completedTaskIds: Array.from(completedIds),
		results: [],
		outputDir,
	};

	// Save initial state
	state.status = "running";
	saveState(cwd, state);

	const details: OrchestrateDetails = {
		taskFile: absolutePath,
		status: "running",
		totalTasks: parsed.tasks.length,
		completedTasks: completedIds.size,
		results,
		archived: false,
		outputDir,
		sessionId,
	};

	// Phase 4: Initialize session budget
	let sessionBudget: SessionBudget | null = null;
	if (parsed.maxSessionCostUSD !== undefined || parsed.budgetProfile) {
		// Apply budget preset if specified
		let maxCost = parsed.maxSessionCostUSD ?? Infinity;
		let alertThreshold = parsed.costAlertThreshold;

		if (parsed.budgetProfile) {
			const preset = BUDGET_PRESETS[parsed.budgetProfile];
			if (preset) {
				maxCost = parsed.maxSessionCostUSD ?? preset.maxSessionCostUSD;
				alertThreshold = parsed.costAlertThreshold ?? preset.costAlertThreshold;
			}
		}

		// Default alert threshold to 75% of max budget
		if (alertThreshold === undefined && maxCost !== Infinity) {
			alertThreshold = maxCost * 0.75;
		}

		sessionBudget = {
			maxCostUSD: maxCost,
			alertThreshold: alertThreshold ?? Infinity,
			currentCost: 0,
			tasksCompleted: 0,
			taskCosts: [],
			exceeded: false,
			alertFired: false,
		};
	}

	// Multi-pass execution: retry skipped tasks until no progress
	let remainingTasks = [...initialPendingTasks];
	let wasPaused = false;

	while (remainingTasks.length > 0) {
		let madeProgress = false;
		const stillPending: ParsedTask[] = [];

		for (const task of remainingTasks) {
			// Check for abort/pause
			if (signal?.aborted) {
				// Save paused state
				state.status = "paused";
				state.pausedAt = new Date().toISOString();
				state.completedTaskIds = Array.from(completedIds);
				state.results = results;
				state.currentTaskId = task.id;
				saveState(cwd, state);

				details.status = "paused";
				details.sessionId = sessionId;
				wasPaused = true;
				break;
			}

			// Check dependencies - must be in completedIds
			const unmetDeps = task.dependencies.filter((depId) => !completedIds.has(depId));

			if (unmetDeps.length > 0) {
				// Defer to next pass
				stillPending.push(task);
				continue;
			}

			details.currentTask = `Task ${task.id}/${parsed.tasks.length}: ${task.title}`;
			state.currentTaskId = task.id;
			saveState(cwd, state);

			// Phase 4: Budget enforcement - check before executing
			if (sessionBudget?.exceeded) {
				// Budget already exceeded - halt orchestration
				results.push({
					taskId: task.id,
					title: task.title,
					agent: task.agent,
					status: "skipped",
					output: `Skipped - session budget of $${sessionBudget.maxCostUSD.toFixed(2)} exceeded (current: $${sessionBudget.currentCost.toFixed(2)})`,
					durationMs: 0,
					error: "Session budget exceeded",
				});
				stillPending.push(...remainingTasks.slice(remainingTasks.indexOf(task) + 1));
				break;
			}

			// Update progress
			if (onUpdate) {
				onUpdate({
					content: [
						{
							type: "text" as const,
							text: `Running Task ${task.id}/${parsed.tasks.length}: ${task.title} (${task.agent})`,
						},
					],
					details,
				});
			}

			// Execute task (uses retry-until-pass if configured)
			const result = await runTaskWithRetry(task, parsed, cwd, taskTimeoutMs, outputDir, signal);
			results.push(result);
			madeProgress = true;

			if (result.status === "success") {
				// Update checkbox in file
				updateTaskCheckbox(absolutePath, task.lineStart, task.id, true);
				completedIds.add(task.id);
				details.completedTasks++;

				// Phase 4: Update session budget
				if (sessionBudget && result.cost !== undefined) {
					sessionBudget.currentCost += result.cost;
					sessionBudget.tasksCompleted++;
					sessionBudget.taskCosts.push({
						taskId: task.id,
						provider: result.provider || "unknown",
						model: result.model || "unknown",
						tokenUsage: result.tokenUsage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
						estimatedCost: result.cost,
					});

					// Check alert threshold
					if (!sessionBudget.alertFired && sessionBudget.currentCost >= sessionBudget.alertThreshold) {
						sessionBudget.alertFired = true;
						if (onUpdate) {
							const alertPct = ((sessionBudget.currentCost / sessionBudget.maxCostUSD) * 100).toFixed(1);
							onUpdate({
								content: [
									{
										type: "text" as const,
										text: `⚠️  Cost alert: ${alertPct}% of budget used ($${sessionBudget.currentCost.toFixed(2)}/$${sessionBudget.maxCostUSD.toFixed(2)})`,
									},
								],
								details,
							});
						}
					}

					// Check budget exceeded
					if (sessionBudget.currentCost > sessionBudget.maxCostUSD) {
						sessionBudget.exceeded = true;
						if (onUpdate) {
							onUpdate({
								content: [
									{
										type: "text" as const,
										text: `❌ Budget exceeded: $${sessionBudget.currentCost.toFixed(2)}/$${sessionBudget.maxCostUSD.toFixed(2)} - Halting orchestration`,
									},
								],
								details,
							});
						}
					}

					// Task-level budget check
					if (task.maxCostUSD !== undefined && result.cost > task.maxCostUSD) {
						// Note: Task already completed, but log the budget violation
						if (onUpdate) {
							onUpdate({
								content: [
									{
										type: "text" as const,
										text: `⚠️  Task ${task.id} exceeded its budget: $${result.cost.toFixed(2)}/$${task.maxCostUSD.toFixed(2)}`,
									},
								],
								details,
							});
						}
					}
				}

				// Save progress after each successful task
				state.completedTaskIds = Array.from(completedIds);
				state.results = results;
				saveState(cwd, state);
			} else if (!continueOnError) {
				details.status = "failed";
				state.status = "failed";
				saveState(cwd, state);
				break;
			}
		}

		if (wasPaused || details.status === "failed") {
			break;
		}

		remainingTasks = stillPending;

		// Exit if no progress was made this pass (prevents infinite loop)
		if (!madeProgress && remainingTasks.length > 0) {
			break;
		}
	}

	// Handle paused state - return early with pause info
	if (wasPaused) {
		return {
			content: [
				{
					type: "text" as const,
					text: `Orchestration paused.\n\nSession ID: ${sessionId}\nCompleted: ${completedIds.size}/${parsed.tasks.length} tasks\n\nTo resume: orchestrate({ resume: "${sessionId}" })\nTo list paused sessions: orchestrate({ resume: "list" })`,
				},
			],
			details,
		};
	}

	// Mark any remaining tasks as skipped with unmet deps
	for (const task of remainingTasks) {
		const unmetDeps = task.dependencies.filter((depId) => !completedIds.has(depId));
		results.push({
			taskId: task.id,
			title: task.title,
			agent: task.agent,
			status: "skipped",
			output: `Skipped: unmet dependencies (Task ${unmetDeps.join(", ")})`,
			durationMs: 0,
		});
	}

	// Determine final status
	if (details.status !== "paused" && details.status !== "failed") {
		const allSuccess = results.every((r) => r.status === "success" || r.status === "skipped");
		details.status = allSuccess ? "completed" : "failed";
	}

	// Update final state
	state.status = details.status === "completed" ? "completed" : "failed";
	state.completedTaskIds = Array.from(completedIds);
	state.results = results;

	// Archive session if requested and completed
	if (archive && details.status === "completed") {
		const archiveResult = archiveSession(parsed, results, cwd);
		details.archived = archiveResult.success;
	}

	// Run post-orchestration code review if configured
	let reviewOutput: string | undefined;
	if (parsed.reviewAfterCompletion && details.status === "completed") {
		const reviewResult = runPostOrchestrationReview(parsed, cwd);
		if (reviewResult.success) {
			reviewOutput = reviewResult.output;
		} else {
			// Log review failure but don't fail the orchestration
			reviewOutput = `Code review failed: ${reviewResult.error}`;
		}
	}

	// Clean up state file on completion (success or failure)
	if (details.status === "completed" || details.status === "failed") {
		deleteState(cwd, sessionId);
	}

	// Build summary
	const summary = [
		`Orchestration ${details.status}`,
		`Tasks: ${details.completedTasks}/${details.totalTasks} completed`,
		"",
		"Results:",
		...results.map(
			(r) =>
				`- Task ${r.taskId} (${r.agent}): ${r.status}${r.durationMs ? ` [${formatDuration(r.durationMs)}]` : ""}${r.error ? ` - ${r.error}` : ""}`,
		),
	];

	if (details.archived) {
		summary.push("", "Session archived to episodic memory.");
	}

	// Phase 2: Cost tracking summary
	const costByProvider: Record<string, { count: number; models: Set<string>; fallbacks: number }> = {};
	let totalFallbacks = 0;

	for (const result of results) {
		if (result.provider && result.status !== "skipped") {
			if (!costByProvider[result.provider]) {
				costByProvider[result.provider] = { count: 0, models: new Set(), fallbacks: 0 };
			}
			costByProvider[result.provider].count++;
			if (result.model) {
				costByProvider[result.provider].models.add(result.model);
			}
			if (result.usedFallback) {
				costByProvider[result.provider].fallbacks++;
				totalFallbacks++;
			}
		}
	}

	if (Object.keys(costByProvider).length > 0) {
		summary.push("", "=== PROVIDER USAGE ===");
		let estimatedTotalCost = 0;
		let hasFreeProvider = false;

		for (const [provider, stats] of Object.entries(costByProvider)) {
			const modelsList = Array.from(stats.models).join(", ");
			const fallbackNote =
				stats.fallbacks > 0 ? ` (${stats.fallbacks} fallback${stats.fallbacks > 1 ? "s" : ""})` : "";

			// Phase 3: Cost estimation
			let providerCost = 0;
			const models = Array.from(stats.models);
			for (const model of models) {
				const costInfo = MODEL_COSTS[model];
				if (costInfo) {
					if (costInfo.inputCost === 0) {
						hasFreeProvider = true;
					} else {
						// Rough estimate: assume 1000 input tokens per task
						providerCost += (costInfo.inputCost / 1000) * stats.count * 1;
					}
				}
			}
			estimatedTotalCost += providerCost;

			const costNote = providerCost > 0 ? ` (~$${providerCost.toFixed(2)})` : provider === "github" ? " (FREE)" : "";
			summary.push(`${provider}: ${stats.count} task${stats.count > 1 ? "s" : ""}${fallbackNote}${costNote}`);
			if (modelsList) {
				summary.push(`  Models: ${modelsList}`);
			}
		}

		// Phase 4: Use actual cost from token tracking if available
		let actualTotalCost = 0;
		let hasActualCost = false;
		for (const result of results) {
			if (result.cost !== undefined && result.status !== "skipped") {
				actualTotalCost += result.cost;
				hasActualCost = true;
			}
		}

		// Display cost information
		if (hasActualCost || estimatedTotalCost > 0 || hasFreeProvider) {
			summary.push("");
			if (hasActualCost) {
				summary.push(`💰 Actual cost: $${actualTotalCost.toFixed(2)}`);
			} else if (estimatedTotalCost > 0) {
				summary.push(`💰 Estimated cost: ~$${estimatedTotalCost.toFixed(2)}`);
			}
			if (hasFreeProvider) {
				summary.push(`✨ FREE provider usage detected (GitHub Copilot)`);
			}
		}

		// Phase 4: Budget summary
		if (sessionBudget) {
			summary.push("");
			summary.push("=== BUDGET SUMMARY ===");
			const budgetUsagePct = ((sessionBudget.currentCost / sessionBudget.maxCostUSD) * 100).toFixed(1);
			summary.push(
				`Budget: $${sessionBudget.currentCost.toFixed(2)}/$${sessionBudget.maxCostUSD.toFixed(2)} (${budgetUsagePct}%)`,
			);
			if (sessionBudget.alertFired) {
				summary.push(`⚠️  Budget alert threshold reached`);
			}
			if (sessionBudget.exceeded) {
				summary.push(`❌ Budget exceeded - orchestration halted`);
			}
			if (sessionBudget.taskCosts.length > 0) {
				summary.push("");
				summary.push("Per-task costs:");
				for (const taskCost of sessionBudget.taskCosts) {
					summary.push(
						`  Task ${taskCost.taskId}: $${taskCost.estimatedCost.toFixed(3)} (${taskCost.provider}/${taskCost.model})`,
					);
				}
			}
		}

		if (totalFallbacks > 0) {
			summary.push(
				"",
				`🔄 Fallback providers used ${totalFallbacks} time${totalFallbacks > 1 ? "s" : ""} (rate limit/downtime protection)`,
			);
		}

		// Phase 3: Provider metrics summary
		const metrics = loadMetrics();
		const usedProviders = Object.keys(costByProvider);
		if (usedProviders.length > 0 && Object.keys(metrics.providers).length > 0) {
			summary.push("", "=== PROVIDER METRICS (Historical) ===");
			for (const provider of usedProviders) {
				const providerMetrics = metrics.providers[provider];
				if (providerMetrics) {
					const successRate = (providerMetrics.successRate * 100).toFixed(1);
					const avgLatency = (providerMetrics.avgLatencyMs / 1000).toFixed(1);
					summary.push(`${provider}: ${successRate}% success rate, ${avgLatency}s avg latency`);
					if (providerMetrics.rateLimits > 0) {
						summary.push(
							`  ⚠️  ${providerMetrics.rateLimits} rate limit${providerMetrics.rateLimits > 1 ? "s" : ""} in history`,
						);
					}
				}
			}
		}
	}

	// Include code review output if it was run
	if (reviewOutput) {
		summary.push("", "=== CODE REVIEW ===", reviewOutput);
	}

	// Include output directory for debugging
	summary.push("", `Full task outputs: ${outputDir}`);

	return {
		content: [{ type: "text" as const, text: summary.join("\n") }],
		details,
	};
}

// Minimal theme interface for the methods we use (avoids internal dependency)
interface ThemeInterface {
	fg(color: string, text: string): string;
	bold(text: string): string;
}

type OrchestrateParamsType = Static<typeof OrchestrateParams>;

const factory: ExtensionFactory = (pi: ExtensionAPI) => {
	const cwd: string = process.cwd();

	pi.registerTool<typeof OrchestrateParams, OrchestrateDetails>({
		name: "orchestrate",
		label: "Orchestrate Tasks",
		description:
			"Execute tasks from a collaborative task file (e.g., 0N_TASKS.md) with memory-first approach, " +
			"quality gates, and session archiving. Use when user says 'run the tasks', 'execute the task file', " +
			"or 'orchestrate'. Each task runs in protected context with pre/post hooks from agent configs. " +
			"Direct mode: Use 'gate' parameter instead of 'taskFile' for simple single-gate retry workflows.",
		parameters: OrchestrateParams,

		async execute(
			_toolCallId: string,
			params: OrchestrateParamsType,
			onUpdate: AgentToolUpdateCallback<OrchestrateDetails> | undefined,
			_ctx: ExtensionContext,
			signal?: AbortSignal,
		): Promise<AgentToolResult<OrchestrateDetails>> {
			const {
				taskFile,
				continueOnError = false,
				archive = true,
				taskTimeoutMs = DEFAULT_TASK_TIMEOUT_MS,
				// Direct mode parameters
				gate,
				maxRetries = 3,
				selfReview = false,
				agent: agentName = "general-purpose",
				prompt,
				// Resume parameter
				resume,
			} = params;

			// Validate timeout parameter
			if (!Number.isFinite(taskTimeoutMs) || taskTimeoutMs <= 0) {
				throw new Error(`taskTimeoutMs must be a positive number, got ${taskTimeoutMs}`);
			}

			// ============================================================
			// LIST PAUSED SESSIONS
			// ============================================================
			if (resume === "list") {
				const stateDir = getStateDir(cwd);
				if (!fs.existsSync(stateDir)) {
					return {
						content: [{ type: "text" as const, text: "No paused orchestration sessions found." }],
						details: {
							taskFile: "",
							status: "completed",
							totalTasks: 0,
							completedTasks: 0,
							results: [],
							archived: false,
						} as OrchestrateDetails,
					};
				}

				const pausedSessions: OrchestrationState[] = [];
				try {
					const files = fs.readdirSync(stateDir);
					for (const file of files) {
						if (!file.endsWith(".state.json")) continue;
						try {
							const content = fs.readFileSync(path.join(stateDir, file), "utf-8");
							const state = JSON.parse(content) as OrchestrationState;
							if (state.status === "paused") {
								pausedSessions.push(state);
							}
						} catch {
							// Ignore invalid files
						}
					}
				} catch {
					// Ignore errors
				}

				if (pausedSessions.length === 0) {
					return {
						content: [{ type: "text" as const, text: "No paused orchestration sessions found." }],
						details: {
							taskFile: "",
							status: "completed",
							totalTasks: 0,
							completedTasks: 0,
							results: [],
							archived: false,
						} as OrchestrateDetails,
					};
				}

				// Sort by pausedAt descending
				pausedSessions.sort((a, b) => {
					const aTime = a.pausedAt ? new Date(a.pausedAt).getTime() : 0;
					const bTime = b.pausedAt ? new Date(b.pausedAt).getTime() : 0;
					return bTime - aTime;
				});

				const sessionList = pausedSessions
					.map((s) => {
						const pausedAt = s.pausedAt ? new Date(s.pausedAt).toLocaleString() : "unknown";
						const taskFileName = path.basename(s.taskFile);
						const progress = `${s.completedTaskIds.length}/${s.completedTaskIds.length + s.results.filter((r) => r.status !== "success").length} tasks`;
						return `- **${s.sessionId}**\n  File: ${taskFileName}\n  Paused: ${pausedAt}\n  Progress: ${progress}`;
					})
					.join("\n\n");

				return {
					content: [
						{
							type: "text" as const,
							text: `## Paused Orchestration Sessions\n\n${sessionList}\n\nTo resume, use: orchestrate({ resume: "<session-id>" })`,
						},
					],
					details: {
						taskFile: "",
						status: "completed",
						totalTasks: pausedSessions.length,
						completedTasks: 0,
						results: [],
						archived: false,
					} as OrchestrateDetails,
				};
			}

			// ============================================================
			// RESUME A PAUSED SESSION
			// ============================================================
			if (resume) {
				const savedState = loadState(cwd, resume);
				if (!savedState) {
					throw new Error(
						`No paused session found with ID: ${resume}. Use resume: "list" to see available sessions.`,
					);
				}
				if (savedState.status !== "paused") {
					throw new Error(`Session ${resume} is not paused (status: ${savedState.status})`);
				}

				// Restore state and continue execution
				const absolutePath = savedState.taskFile;
				if (!fs.existsSync(absolutePath)) {
					throw new Error(`Task file no longer exists: ${absolutePath}`);
				}

				// Re-parse task file to get current state
				const parsed = parseTaskFile(absolutePath);
				validateTaskFile(parsed);

				// Restore completed IDs from saved state
				const completedIds = new Set(savedState.completedTaskIds);
				const results = [...savedState.results];
				const outputDir = savedState.outputDir;

				// Update state to running
				savedState.status = "running";
				savedState.pausedAt = undefined;
				saveState(cwd, savedState);

				// Get remaining pending tasks
				const pendingTasks = parsed.tasks.filter((t) => !t.completed && !completedIds.has(t.id));

				const details: OrchestrateDetails = {
					taskFile: absolutePath,
					status: "running",
					totalTasks: parsed.tasks.length,
					completedTasks: completedIds.size,
					results,
					archived: false,
					outputDir,
					sessionId: savedState.sessionId,
				};

				if (pendingTasks.length === 0) {
					details.status = "completed";
					deleteState(cwd, savedState.sessionId);
					return {
						content: [{ type: "text" as const, text: "Resumed session - all tasks are already completed." }],
						details,
					};
				}

				// Continue with task execution (shared logic below)
				return executeTaskFileMode(
					parsed,
					absolutePath,
					pendingTasks,
					completedIds,
					results,
					outputDir,
					savedState,
					cwd,
					savedState.continueOnError,
					savedState.archive,
					savedState.taskTimeoutMs,
					signal,
					onUpdate,
				);
			}

			// ============================================================
			// DIRECT MODE: Run a single gate without a task file
			// ============================================================
			if (gate) {
				return executeDirectMode(
					gate,
					maxRetries,
					selfReview,
					agentName,
					prompt,
					taskTimeoutMs,
					archive,
					cwd,
					signal,
					onUpdate,
				);
			}

			// ============================================================
			// TASK FILE MODE: Parse and execute tasks from file
			// ============================================================
			if (!taskFile) {
				throw new Error("Either 'taskFile' or 'gate' parameter is required");
			}

			// Resolve task file path
			const absolutePath = path.isAbsolute(taskFile) ? taskFile : path.join(cwd, taskFile);

			if (!fs.existsSync(absolutePath)) {
				throw new Error(`Task file not found: ${absolutePath}`);
			}

			// Parse and validate task file
			const parsed = parseTaskFile(absolutePath);
			validateTaskFile(parsed);

			// Check that task-monitor is running (MANDATORY for all orchestrations)
			checkTaskMonitor();

			// Run pre-flight check (enforces Definition of Done & Sanity Scripts)
			runPreflight(absolutePath, cwd);

			const pendingTasks = parsed.tasks.filter((t) => !t.completed);

			if (pendingTasks.length === 0) {
				return {
					content: [{ type: "text" as const, text: "All tasks are already completed." }],
					details: {
						taskFile: absolutePath,
						status: "completed",
						totalTasks: parsed.tasks.length,
						completedTasks: parsed.tasks.length,
						results: [],
						archived: false,
					} as OrchestrateDetails,
				};
			}

			// Check for existing paused session for this task file
			const pausedSessions = findPausedSessions(cwd, absolutePath);
			if (pausedSessions.length > 0) {
				const mostRecent = pausedSessions[0];
				// Notify user about existing paused session
				return {
					content: [
						{
							type: "text" as const,
							text: `Found paused session for this task file.\n\nSession ID: ${mostRecent.sessionId}\nPaused: ${mostRecent.pausedAt ? new Date(mostRecent.pausedAt).toLocaleString() : "unknown"}\nProgress: ${mostRecent.completedTaskIds.length} tasks completed\n\nTo resume: orchestrate({ resume: "${mostRecent.sessionId}" })\nTo start fresh: delete .orchestrate/${mostRecent.sessionId}.state.json first`,
						},
					],
					details: {
						taskFile: absolutePath,
						status: "paused",
						totalTasks: parsed.tasks.length,
						completedTasks: mostRecent.completedTaskIds.length,
						results: [],
						archived: false,
						sessionId: mostRecent.sessionId,
					} as OrchestrateDetails,
				};
			}

			// Create output directory for complete task outputs
			const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-orchestrate-"));

			// Initialize state for fresh start
			const completedIds = new Set(parsed.tasks.filter((t) => t.completed).map((t) => t.id));

			return executeTaskFileMode(
				parsed,
				absolutePath,
				pendingTasks,
				completedIds,
				[], // No prior results
				outputDir,
				null, // No existing state
				cwd,
				continueOnError,
				archive,
				taskTimeoutMs,
				signal,
				onUpdate,
			);
		},

		renderCall(args: OrchestrateParamsType, theme: ThemeInterface) {
			const { taskFile, gate } = args;
			let label: string;
			if (gate) {
				label = `Orchestrate (direct): ${path.basename(gate)}`;
			} else if (taskFile) {
				label = `Orchestrate: ${path.basename(taskFile)}`;
			} else {
				label = "Orchestrate Tasks";
			}
			return new Text(theme.fg("toolTitle", theme.bold(label)), 0, 0);
		},

		renderResult(
			result: AgentToolResult<OrchestrateDetails>,
			_options: ToolRenderResultOptions,
			theme: ThemeInterface,
		) {
			const details = result.details;
			if (!details) return new Text("Orchestrate", 0, 0);

			const statusColor =
				details.status === "completed"
					? "success"
					: details.status === "running"
						? "info"
						: details.status === "cancelled"
							? "warning"
							: "error";

			const statusText = `${details.status.toUpperCase()} (${details.completedTasks}/${details.totalTasks} tasks)`;

			if (details.currentTask && details.status === "running") {
				return new Text(`${theme.fg(statusColor, statusText)}\n${theme.fg("dim", details.currentTask)}`, 0, 0);
			}

			return new Text(theme.fg(statusColor, statusText), 0, 0);
		},
	});
};

export default factory;
