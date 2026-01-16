/**
 * Task Orchestration Extension
 *
 * A comprehensive task execution tool with two modes:
 *
 * ## Task File Mode (default)
 * Executes tasks from a collaborative task file (e.g., 01_TASKS.md):
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
import type { AgentToolResult } from "@mariozechner/pi-ai";
import type { CustomToolFactory, RenderResultOptions } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { type Static, Type } from "@sinclair/typebox";

// Constants
const DEFAULT_TASK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_OUTPUT_BYTES = 100 * 1024; // 100KB tail buffer
const SIGKILL_GRACE_MS = 5000; // Grace period before SIGKILL

// Hook script paths
const MEMORY_RECALL_SCRIPT = path.join(os.homedir(), ".pi", "agent", "skills", "memory", "run.sh");
const QUALITY_GATE_SCRIPT = "/home/graham/workspace/experiments/memory/.claude/hooks/quality-gate.sh";

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
}

interface TaskFileContent {
	title: string;
	context: string;
	tasks: ParsedTask[];
	questionsBlockers: string[]; // Unresolved questions/blockers - must be empty to proceed
	rawLines: string[];
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
				} else if (maxRetriesMatch) {
					currentTask.maxRetries = parseInt(maxRetriesMatch[1], 10);
				} else if (selfReviewMatch) {
					const value = selfReviewMatch[1].toLowerCase();
					currentTask.selfReview = value === "true" || value === "yes";
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

	return { title, context, tasks, questionsBlockers, rawLines: lines };
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
 * PRE-HOOK: Memory Recall
 * Query memory for prior solutions before each task.
 * Returns recalled items to inject as context into the task prompt.
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

	const output = new OutputAccumulator(MAX_OUTPUT_BYTES);

	// Build pi arguments
	const args = ["--mode", "json", "-p", "--no-session"];

	if (agent.provider) {
		args.push("--provider", agent.provider);
	}

	if (agent.model) {
		args.push("--model", agent.model);
	}

	if (agent.tools?.length) {
		const builtinTools: string[] = [];
		for (const tool of agent.tools) {
			if (!tool.includes("/") && !tool.endsWith(".ts") && !tool.endsWith(".js")) {
				builtinTools.push(tool);
			}
		}
		if (builtinTools.length > 0) {
			args.push("--tools", builtinTools.join(","));
		}
	}

	// Add system prompt
	let tmpDir: string | null = null;
	if (agent.systemPrompt?.trim()) {
		const tmp = writePromptFile(agent.name, agent.systemPrompt);
		tmpDir = tmp.dir;
		args.push("--append-system-prompt", tmp.path);
	}

	args.push(fixPrompt);

	try {
		await new Promise<number>((resolve, reject) => {
			const proc = spawn("pi", args, {
				cwd,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let stdoutBuf = "";

			proc.stdout.on("data", (chunk) => {
				const text = chunk.toString("utf-8");
				if (fixFd !== null) {
					try {
						fs.writeSync(fixFd, text);
					} catch {}
				}
				stdoutBuf += text;
				for (let idx = stdoutBuf.indexOf("\n"); idx !== -1; idx = stdoutBuf.indexOf("\n")) {
					const line = stdoutBuf.slice(0, idx);
					stdoutBuf = stdoutBuf.slice(idx + 1);
					if (line.trim()) {
						try {
							const evt = JSON.parse(line);
							if (evt.type === "message_end" && evt.message?.content) {
								for (const part of evt.message.content) {
									if (part.type === "text" && part.text) {
										output.append(`${part.text}\n`);
									}
								}
							}
						} catch {}
					}
				}
			});

			proc.stderr.on("data", (chunk) => {
				const text = chunk.toString();
				if (fixFd !== null) {
					try {
						fs.writeSync(fixFd, `[stderr] ${text}`);
					} catch {}
				}
				output.append(text);
			});

			proc.on("close", (code) => resolve(code ?? 0));
			proc.on("error", reject);
		});

		return { fixed: true, output: output.finalize() };
	} catch (err) {
		return { fixed: false, output: `Agent fix error: ${err instanceof Error ? err.message : String(err)}` };
	} finally {
		if (fixFd !== null) {
			try {
				fs.closeSync(fixFd);
			} catch {}
		}
		if (tmpDir) {
			try {
				fs.rmSync(tmpDir, { recursive: true });
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

		// Build pi arguments
		const args = ["--mode", "json", "-p", "--no-session"];

		if (agent.provider) {
			args.push("--provider", agent.provider);
		}

		if (agent.model) {
			args.push("--model", agent.model);
		}

		if (agent.tools?.length) {
			const builtinTools: string[] = [];
			for (const tool of agent.tools) {
				if (!tool.includes("/") && !tool.endsWith(".ts") && !tool.endsWith(".js")) {
					builtinTools.push(tool);
				}
			}
			if (builtinTools.length > 0) {
				args.push("--tools", builtinTools.join(","));
			}
		}

		let tmpDir: string | null = null;
		if (agent.systemPrompt?.trim()) {
			const tmp = writePromptFile(agent.name, agent.systemPrompt);
			tmpDir = tmp.dir;
			args.push("--append-system-prompt", tmp.path);
		}

		args.push(reviewPrompt);

		let reviewOutput = "";

		try {
			await new Promise<number>((resolve, reject) => {
				const proc = spawn("pi", args, {
					cwd,
					stdio: ["ignore", "pipe", "pipe"],
				});

				let stdoutBuf = "";

				proc.stdout.on("data", (chunk) => {
					const text = chunk.toString("utf-8");
					if (reviewFd !== null) {
						try {
							fs.writeSync(reviewFd, text);
						} catch {}
					}
					stdoutBuf += text;
					for (let idx = stdoutBuf.indexOf("\n"); idx !== -1; idx = stdoutBuf.indexOf("\n")) {
						const line = stdoutBuf.slice(0, idx);
						stdoutBuf = stdoutBuf.slice(idx + 1);
						if (line.trim()) {
							try {
								const evt = JSON.parse(line);
								if (evt.type === "message_end" && evt.message?.content) {
									for (const part of evt.message.content) {
										if (part.type === "text" && part.text) {
											reviewOutput += `${part.text}\n`;
											output.append(`${part.text}\n`);
										}
									}
								}
							} catch {}
						}
					}
				});

				proc.stderr.on("data", (chunk) => {
					const text = chunk.toString();
					if (reviewFd !== null) {
						try {
							fs.writeSync(reviewFd, `[stderr] ${text}`);
						} catch {}
					}
					output.append(text);
				});

				proc.on("close", (code) => resolve(code ?? 0));
				proc.on("error", reject);
			});
		} finally {
			if (reviewFd !== null) {
				try {
					fs.closeSync(reviewFd);
				} catch {}
			}
			if (tmpDir) {
				try {
					fs.rmSync(tmpDir, { recursive: true });
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
Complete this task following the quality gate checklist in your system prompt.
When done, summarize what was accomplished.
`.trim();

	// Build pi arguments
	const args = ["--mode", "json", "-p", "--no-session"];

	if (agent.provider) {
		args.push("--provider", agent.provider);
	}

	if (agent.model) {
		args.push("--model", agent.model);
	}

	if (agent.tools?.length) {
		const builtinTools: string[] = [];
		for (const tool of agent.tools) {
			if (!tool.includes("/") && !tool.endsWith(".ts") && !tool.endsWith(".js")) {
				builtinTools.push(tool);
			}
		}
		if (builtinTools.length > 0) {
			args.push("--tools", builtinTools.join(","));
		}
	}

	// Add system prompt with memory recall and quality gate
	let tmpDir: string | null = null;
	if (agent.systemPrompt?.trim()) {
		const tmp = writePromptFile(agent.name, agent.systemPrompt);
		tmpDir = tmp.dir;
		args.push("--append-system-prompt", tmp.path);
	}

	args.push(taskPrompt);

	const output = new OutputAccumulator(MAX_OUTPUT_BYTES);
	let exitCode = 0;
	let settled = false;

	try {
		exitCode = await new Promise<number>((resolve, reject) => {
			const proc = spawn("pi", args, {
				cwd,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let timeoutId: NodeJS.Timeout | null = null;

			// Cleanup helper - call before settling
			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				signal?.removeEventListener("abort", abortHandler);
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
				writeToFile(line + "\n");
				try {
					const evt = JSON.parse(line);
					// Capture final message content from message_end events
					if (evt.type === "message_end" && evt.message?.content) {
						for (const part of evt.message.content) {
							if (part.type === "text" && part.text) {
								output.append(`${part.text}\n`);
							}
						}
					}
					// Also capture tool results for visibility
					if (evt.type === "tool_result" && evt.result?.content) {
						for (const part of evt.result.content) {
							if (part.type === "text" && part.text) {
								const text = part.text.slice(0, 500);
								output.append(`[tool: ${evt.toolName || "unknown"}] ${text}\n`);
							}
						}
					}
				} catch {
					// Not valid JSON, skip
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
				output.append(text);
			});

			proc.on("close", (code) => {
				if (!settled) {
					settled = true;
					cleanup();
					// Process any remaining buffer content
					if (stdoutBuf.trim()) {
						processJsonlLine(stdoutBuf);
					}
					resolve(code ?? 0);
				}
			});

			proc.on("error", (err) => {
				if (!settled) {
					settled = true;
					cleanup();
					reject(err);
				}
			});
		});
	} catch (err) {
		writeToFile(`\nERROR: ${err instanceof Error ? err.message : String(err)}\n`);
		closeOutputFile();
		return {
			taskId: task.id,
			title: task.title,
			agent: task.agent,
			status: "failed",
			output: output.finalize(),
			outputFile,
			durationMs: Date.now() - startTime,
			error: err instanceof Error ? err.message : String(err),
		};
	} finally {
		// Cleanup temp prompt file
		if (tmpDir) {
			try {
				fs.rmSync(tmpDir, { recursive: true });
			} catch {}
		}
	}

	// If pi subprocess failed, return failure immediately
	if (exitCode !== 0) {
		writeToFile(`\nExit code: ${exitCode}\n`);
		closeOutputFile();
		return {
			taskId: task.id,
			title: task.title,
			agent: task.agent,
			status: "failed",
			output: output.finalize(),
			outputFile,
			durationMs: Date.now() - startTime,
			error: `Exit code: ${exitCode}`,
		};
	}

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
			output: output.finalize() + "\n\n--- QUALITY GATE FAILED ---\n" + (qualityResult.error || ""),
			outputFile,
			durationMs: Date.now() - startTime,
			error: "Quality gate failed - tests or checks did not pass",
		};
	}

	// Both pi subprocess and quality gate passed
	closeOutputFile();
	return {
		taskId: task.id,
		title: task.title,
		agent: task.agent,
		status: "success",
		output: output.finalize(),
		outputFile,
		durationMs: Date.now() - startTime,
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
			const fixResult = await runAgentFix(
				task,
				taskFile,
				gateResult.output,
				attempt,
				maxRetries,
				agent,
				cwd,
				outputDir,
			);
			allOutput.push(`=== FIX ATTEMPT ${attempt} ===\n${fixResult.output}`);
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

			details.currentTask = `Task ${task.id}: ${task.title}`;
			state.currentTaskId = task.id;
			saveState(cwd, state);

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

const factory: CustomToolFactory = (pi) => ({
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
		signal?: AbortSignal,
		onUpdate?: (result: AgentToolResult<OrchestrateDetails>) => void,
	) {
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
			const stateDir = getStateDir(pi.cwd);
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
			const savedState = loadState(pi.cwd, resume);
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
			saveState(pi.cwd, savedState);

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
				deleteState(pi.cwd, savedState.sessionId);
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
				pi.cwd,
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
				pi.cwd,
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
		const absolutePath = path.isAbsolute(taskFile) ? taskFile : path.join(pi.cwd, taskFile);

		if (!fs.existsSync(absolutePath)) {
			throw new Error(`Task file not found: ${absolutePath}`);
		}

		// Parse and validate task file
		const parsed = parseTaskFile(absolutePath);
		validateTaskFile(parsed);

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
		const pausedSessions = findPausedSessions(pi.cwd, absolutePath);
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
			pi.cwd,
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

	renderResult(result: AgentToolResult<OrchestrateDetails>, _options: RenderResultOptions, theme: ThemeInterface) {
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

export default factory;
