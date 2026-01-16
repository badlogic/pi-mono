/**
 * Task Orchestration Extension
 *
 * Executes tasks from a collaborative task file (e.g., 0N_TASKS.md) with:
 * - Questions/Blockers gate: BLOCKS if unresolved questions exist in task file
 * - Memory-first pre-hook: Queries memory/run.sh recall BEFORE each task
 * - Quality-gate post-hook: Runs quality-gate.sh AFTER each task (tests must pass)
 * - Session archiving: Archives via episodic-archiver on completion
 *
 * Workflow:
 * 1. Parse task file, validate no unresolved questions/blockers
 * 2. For each task:
 *    a. PRE-HOOK: Memory recall - inject prior solutions as context
 *    b. Execute task in protected context (pi --no-session)
 *    c. POST-HOOK: Quality gate - run tests, fail if they don't pass
 * 3. Archive session if all tasks completed successfully
 *
 * Usage: orchestrate({ taskFile: "01_TASKS.md" })
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CustomToolFactory, RenderResultOptions } from "@mariozechner/pi-coding-agent";
import type { AgentToolResult } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type, type Static } from "@sinclair/typebox";

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
	durationMs: number;
	error?: string;
}

interface OrchestrateDetails {
	taskFile: string;
	status: "running" | "completed" | "failed" | "cancelled";
	totalTasks: number;
	completedTasks: number;
	currentTask?: string;
	results: TaskResult[];
	archived: boolean;
}

const OrchestrateParams = Type.Object({
	taskFile: Type.String({
		description: "Path to task file (e.g., 01_TASKS.md)",
	}),
	continueOnError: Type.Optional(
		Type.Boolean({
			description: "Continue executing tasks even if one fails",
			default: false,
		})
	),
	archive: Type.Optional(
		Type.Boolean({
			description: "Archive session to episodic memory when complete",
			default: true,
		})
	),
	taskTimeoutMs: Type.Optional(
		Type.Number({
			description: "Timeout per task in milliseconds (default: 30 minutes)",
			default: DEFAULT_TASK_TIMEOUT_MS,
		})
	),
});

function finalizeTask(
	currentTask: Partial<ParsedTask> | null,
	taskLineStart: number,
	lineEnd: number
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
			title = trimmed.slice(2).replace(/^Task List:\s*/i, "").trim();
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

				if (agentMatch) {
					currentTask.agent = agentMatch[1].trim();
				} else if (depsMatch) {
					const depsStr = depsMatch[1].trim();
					if (depsStr.toLowerCase() !== "none") {
						currentTask.dependencies = depsStr
							.split(/[,\s]+/)
							.map((d) => parseInt(d.replace(/\D/g, ""), 10))
							.filter((n) => !isNaN(n));
					}
				} else if (notesMatch) {
					currentTask.notes = notesMatch[1].trim();
				} else if (trimmed && !trimmed.startsWith("-")) {
					currentTask.description = (currentTask.description || "") + (currentTask.description ? "\n" : "") + trimmed;
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
			`Remove them or mark them as "None" when resolved.`
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
				throw new Error(
					`Task ${task.id} depends on Task ${depId}, but Task ${depId} does not exist in the file.`
				);
			}
		}
	}
}

function updateTaskCheckbox(
	filePath: string,
	taskLineStart: number,
	taskId: number,
	completed: boolean
): void {
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
			`Cannot safely update checkbox for Task ${taskId}.`
		);
	}
	const lineTaskId = parseInt(taskPatternMatch[1] || taskPatternMatch[2] || taskPatternMatch[3], 10);
	if (lineTaskId !== taskId) {
		throw new Error(
			`Task file changed during execution; line ${taskLineStart} in ${filePath} is now Task ${lineTaskId}, ` +
			`expected Task ${taskId}. Cannot safely update checkbox.`
		);
	}

	// Replace checkbox (handle [ ], [], [  ], etc.)
	const updatedLine = completed
		? taskLine.replace(/\[\s*\]/, "[x]")
		: taskLine.replace(/\[x\]/i, "[ ]");

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
		return { error: `Agent config ${agentName}.md uses unsupported multiline YAML syntax (| or >). Use single-line values.` };
	}
	if (/^\s*-\s+/m.test(frontmatterBlock)) {
		return { error: `Agent config ${agentName}.md uses unsupported YAML list syntax. Use comma-separated values for tools.` };
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
function runMemoryRecall(
	task: ParsedTask,
	cwd: string
): MemoryRecallResult | null {
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
		const result = spawnSync("bash", ["-c", `echo '${inputJson.replace(/'/g, "'\\''")}' | "${QUALITY_GATE_SCRIPT}"`], {
			cwd,
			encoding: "utf-8",
			timeout: 120000, // 2 minute timeout for tests
		});

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

async function runTask(
	task: ParsedTask,
	taskFile: TaskFileContent,
	cwd: string,
	timeoutMs: number,
	signal?: AbortSignal
): Promise<TaskResult> {
	const startTime = Date.now();
	const agentResult = loadAgentConfig(task.agent);

	if (isAgentConfigError(agentResult)) {
		return {
			taskId: task.id,
			title: task.title,
			agent: task.agent,
			status: "failed",
			output: "",
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
				try {
					const evt = JSON.parse(line);
					// Capture final message content from message_end events
					if (evt.type === "message_end" && evt.message?.content) {
						for (const part of evt.message.content) {
							if (part.type === "text" && part.text) {
								output.append(part.text + "\n");
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
				let idx;
				while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
					const line = stdoutBuf.slice(0, idx);
					stdoutBuf = stdoutBuf.slice(idx + 1);
					processJsonlLine(line);
				}
			});

			proc.stderr.on("data", (chunk) => {
				output.append(chunk.toString());
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
		return {
			taskId: task.id,
			title: task.title,
			agent: task.agent,
			status: "failed",
			output: output.finalize(),
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
		return {
			taskId: task.id,
			title: task.title,
			agent: task.agent,
			status: "failed",
			output: output.finalize(),
			durationMs: Date.now() - startTime,
			error: `Exit code: ${exitCode}`,
		};
	}

	// POST-HOOK: Quality Gate - validate code quality
	const qualityResult = runQualityGate(cwd);
	if (!qualityResult.passed) {
		return {
			taskId: task.id,
			title: task.title,
			agent: task.agent,
			status: "failed",
			output: output.finalize() + "\n\n--- QUALITY GATE FAILED ---\n" + (qualityResult.error || ""),
			durationMs: Date.now() - startTime,
			error: "Quality gate failed - tests or checks did not pass",
		};
	}

	// Both pi subprocess and quality gate passed
	return {
		taskId: task.id,
		title: task.title,
		agent: task.agent,
		status: "success",
		output: output.finalize(),
		durationMs: Date.now() - startTime,
	};
}

function archiveSession(
	taskFile: TaskFileContent,
	results: TaskResult[],
	cwd: string
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
		"or 'orchestrate'. Each task runs in protected context with pre/post hooks from agent configs.",
	parameters: OrchestrateParams,

	async execute(
		_toolCallId: string,
		params: OrchestrateParamsType,
		signal?: AbortSignal,
		onUpdate?: (result: AgentToolResult<OrchestrateDetails>) => void
	) {
		const {
			taskFile,
			continueOnError = false,
			archive = true,
			taskTimeoutMs = DEFAULT_TASK_TIMEOUT_MS,
		} = params;

		// Validate timeout parameter
		if (!Number.isFinite(taskTimeoutMs) || taskTimeoutMs <= 0) {
			throw new Error(`taskTimeoutMs must be a positive number, got ${taskTimeoutMs}`);
		}

		// Resolve task file path
		const absolutePath = path.isAbsolute(taskFile)
			? taskFile
			: path.join(pi.cwd, taskFile);

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

		const results: TaskResult[] = [];
		const completedIds = new Set(parsed.tasks.filter((t) => t.completed).map((t) => t.id));
		const details: OrchestrateDetails = {
			taskFile: absolutePath,
			status: "running",
			totalTasks: parsed.tasks.length,
			completedTasks: completedIds.size,
			results,
			archived: false,
		};

		// Multi-pass execution: retry skipped tasks until no progress
		let remainingTasks = [...pendingTasks];

		while (remainingTasks.length > 0) {
			let madeProgress = false;
			const stillPending: ParsedTask[] = [];

			for (const task of remainingTasks) {
				if (signal?.aborted) {
					details.status = "cancelled";
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

				// Execute task
				const result = await runTask(task, parsed, pi.cwd, taskTimeoutMs, signal);
				results.push(result);
				madeProgress = true;

				if (result.status === "success") {
					// Update checkbox in file
					updateTaskCheckbox(absolutePath, task.lineStart, task.id, true);
					completedIds.add(task.id);
					details.completedTasks++;
				} else if (!continueOnError) {
					details.status = "failed";
					break;
				}
			}

			if (signal?.aborted || details.status === "failed") {
				break;
			}

			remainingTasks = stillPending;

			// Exit if no progress was made this pass (prevents infinite loop)
			if (!madeProgress && remainingTasks.length > 0) {
				break;
			}
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
		if (details.status !== "cancelled" && details.status !== "failed") {
			const allSuccess = results.every((r) => r.status === "success" || r.status === "skipped");
			details.status = allSuccess ? "completed" : "failed";
		}

		// Archive session if requested
		if (archive && details.status === "completed") {
			const archiveResult = archiveSession(parsed, results, pi.cwd);
			details.archived = archiveResult.success;
		}

		// Build summary
		const summary = [
			`Orchestration ${details.status}`,
			`Tasks: ${details.completedTasks}/${details.totalTasks} completed`,
			"",
			"Results:",
			...results.map(
				(r) =>
					`- Task ${r.taskId} (${r.agent}): ${r.status}${r.durationMs ? ` [${formatDuration(r.durationMs)}]` : ""}${r.error ? ` - ${r.error}` : ""}`
			),
		];

		if (details.archived) {
			summary.push("", "Session archived to episodic memory.");
		}

		return {
			content: [{ type: "text" as const, text: summary.join("\n") }],
			details,
		};
	},

	renderCall(args: OrchestrateParamsType, theme: ThemeInterface) {
		const { taskFile } = args;
		const label = taskFile ? `Orchestrate: ${path.basename(taskFile)}` : "Orchestrate Tasks";
		return new Text(theme.fg("toolTitle", theme.bold(label)), 0, 0);
	},

	renderResult(
		result: AgentToolResult<OrchestrateDetails>,
		_options: RenderResultOptions,
		theme: ThemeInterface
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
			return new Text(
				`${theme.fg(statusColor, statusText)}\n${theme.fg("dim", details.currentTask)}`,
				0,
				0
			);
		}

		return new Text(theme.fg(statusColor, statusText), 0, 0);
	},
});

export default factory;
