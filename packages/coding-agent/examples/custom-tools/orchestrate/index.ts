/**
 * Task Orchestration Extension
 *
 * Executes tasks from a collaborative task file (e.g., 0N_TASKS.md) with:
 * - Memory-first pre-hooks (via agent configs)
 * - Quality-gate post-hooks (via agent configs)
 * - Session archiving (episodic-archiver)
 *
 * Usage: orchestrate({ taskFile: "01_TASKS.md" })
 */

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

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
	rawLines: string[];
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
			} else {
				currentSection = "other";
			}
			continue;
		}

		// Parse based on section
		if (currentSection === "context" && trimmed) {
			context += (context ? "\n" : "") + trimmed;
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

	return { title, context, tasks, rawLines: lines };
}

function updateTaskCheckbox(filePath: string, rawLines: string[], taskLineStart: number, completed: boolean): void {
	const lines = [...rawLines];
	const taskLine = lines[taskLineStart];
	if (!taskLine) return;

	// Replace checkbox
	const updatedLine = completed
		? taskLine.replace(/\[\s\]/, "[x]")
		: taskLine.replace(/\[x\]/i, "[ ]");

	lines[taskLineStart] = updatedLine;
	fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
}

interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
}

function loadAgentConfig(agentName: string): AgentConfig | null {
	const userAgentsDir = path.join(os.homedir(), ".pi", "agent", "agents");
	const agentPath = path.join(userAgentsDir, `${agentName}.md`);

	if (!fs.existsSync(agentPath)) {
		return null;
	}

	const content = fs.readFileSync(agentPath, "utf-8");
	const normalized = content.replace(/\r\n/g, "\n");

	if (!normalized.startsWith("---")) {
		return null;
	}

	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) {
		return null;
	}

	const frontmatterBlock = normalized.slice(4, endIndex);
	const body = normalized.slice(endIndex + 4).trim();

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

	const tools = frontmatter.tools
		?.split(",")
		.map((t) => t.trim())
		.filter(Boolean);

	return {
		name: frontmatter.name || agentName,
		description: frontmatter.description || "",
		tools,
		model: frontmatter.model,
		systemPrompt: body,
	};
}

function writePromptFile(agent: string, prompt: string): { dir: string; path: string } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-orchestrate-"));
	const p = path.join(dir, `${agent.replace(/[^\w.-]/g, "_")}.md`);
	fs.writeFileSync(p, prompt, { mode: 0o600 });
	return { dir, path: p };
}

async function runTask(
	task: ParsedTask,
	taskFile: TaskFileContent,
	cwd: string,
	signal?: AbortSignal
): Promise<TaskResult> {
	const startTime = Date.now();
	const agent = loadAgentConfig(task.agent);

	if (!agent) {
		return {
			taskId: task.id,
			title: task.title,
			agent: task.agent,
			status: "failed",
			output: "",
			durationMs: Date.now() - startTime,
			error: `Unknown agent: ${task.agent}. Create ${task.agent}.md in ~/.pi/agent/agents/`,
		};
	}

	// Build the task prompt with context
	const taskPrompt = `
## Context
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

	let output = "";
	let exitCode = 0;

	try {
		exitCode = await new Promise<number>((resolve, reject) => {
			const proc = spawn("pi", args, {
				cwd,
				stdio: ["ignore", "pipe", "pipe"],
			});

			const abortHandler = () => {
				proc.kill("SIGTERM");
				reject(new Error("Task aborted"));
			};
			signal?.addEventListener("abort", abortHandler, { once: true });

			proc.stdout.on("data", (chunk) => {
				// Parse JSONL output for messages
				// pi outputs: message_start, message_update (deltas), message_end (final)
				const lines = chunk.toString().split("\n").filter(Boolean);
				for (const line of lines) {
					try {
						const evt = JSON.parse(line);
						// Capture final message content from message_end events
						if (evt.type === "message_end" && evt.message?.content) {
							for (const part of evt.message.content) {
								if (part.type === "text" && part.text) {
									output += part.text + "\n";
								}
							}
						}
						// Also capture tool results for visibility
						if (evt.type === "tool_result" && evt.result?.content) {
							for (const part of evt.result.content) {
								if (part.type === "text" && part.text) {
									// Only include first 500 chars of tool output
									const text = part.text.slice(0, 500);
									output += `[tool: ${evt.toolName || "unknown"}] ${text}\n`;
								}
							}
						}
					} catch {
						// Not JSON, skip non-JSONL output
					}
				}
			});

			proc.stderr.on("data", (chunk) => {
				output += chunk.toString();
			});

			proc.on("close", (code) => {
				signal?.removeEventListener("abort", abortHandler);
				resolve(code ?? 0);
			});

			proc.on("error", (err) => {
				signal?.removeEventListener("abort", abortHandler);
				reject(err);
			});
		});
	} catch (err) {
		return {
			taskId: task.id,
			title: task.title,
			agent: task.agent,
			status: "failed",
			output,
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

	return {
		taskId: task.id,
		title: task.title,
		agent: task.agent,
		status: exitCode === 0 ? "success" : "failed",
		output: output.trim(),
		durationMs: Date.now() - startTime,
		error: exitCode !== 0 ? `Exit code: ${exitCode}` : undefined,
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

export default function registerOrchestrateExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "orchestrate",
		label: "Orchestrate Tasks",
		description:
			"Execute tasks from a collaborative task file (e.g., 0N_TASKS.md) with memory-first approach, " +
			"quality gates, and session archiving. Use when user says 'run the tasks', 'execute the task file', " +
			"or 'orchestrate'. Each task runs in protected context with pre/post hooks from agent configs.",
		parameters: OrchestrateParams,

		async execute(_toolCallId, params, onUpdate, ctx, signal) {
			const {
				taskFile,
				continueOnError = false,
				archive = true,
			} = params as {
				taskFile: string;
				continueOnError?: boolean;
				archive?: boolean;
			};

			// Resolve task file path
			const absolutePath = path.isAbsolute(taskFile)
				? taskFile
				: path.join(ctx.cwd, taskFile);

			if (!fs.existsSync(absolutePath)) {
				throw new Error(`Task file not found: ${absolutePath}`);
			}

			// Parse task file
			const parsed = parseTaskFile(absolutePath);
			const pendingTasks = parsed.tasks.filter((t) => !t.completed);

			if (pendingTasks.length === 0) {
				return {
					content: [{ type: "text", text: "All tasks are already completed." }],
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
			const details: OrchestrateDetails = {
				taskFile: absolutePath,
				status: "running",
				totalTasks: parsed.tasks.length,
				completedTasks: parsed.tasks.filter((t) => t.completed).length,
				results,
				archived: false,
			};

			// Execute tasks
			for (const task of pendingTasks) {
				if (signal?.aborted) {
					details.status = "cancelled";
					break;
				}

				// Check dependencies
				const unmetDeps = task.dependencies.filter((depId) => {
					const depTask = parsed.tasks.find((t) => t.id === depId);
					const depResult = results.find((r) => r.taskId === depId);
					return depTask && !depTask.completed && (!depResult || depResult.status !== "success");
				});

				if (unmetDeps.length > 0) {
					results.push({
						taskId: task.id,
						title: task.title,
						agent: task.agent,
						status: "skipped",
						output: `Skipped: unmet dependencies (Task ${unmetDeps.join(", ")})`,
						durationMs: 0,
					});
					continue;
				}

				details.currentTask = `Task ${task.id}: ${task.title}`;

				// Update progress
				if (onUpdate) {
					onUpdate({
						content: [
							{
								type: "text",
								text: `Running Task ${task.id}/${parsed.tasks.length}: ${task.title} (${task.agent})`,
							},
						],
						details,
					});
				}

				// Execute task
				const result = await runTask(task, parsed, ctx.cwd, signal);
				results.push(result);

				if (result.status === "success") {
					// Update checkbox in file
					updateTaskCheckbox(absolutePath, parsed.rawLines, task.lineStart, true);
					details.completedTasks++;
				} else if (!continueOnError) {
					details.status = "failed";
					break;
				}
			}

			// Determine final status
			if (details.status !== "cancelled" && details.status !== "failed") {
				const allSuccess = results.every((r) => r.status === "success" || r.status === "skipped");
				details.status = allSuccess ? "completed" : "failed";
			}

			// Archive session if requested
			if (archive && details.status === "completed") {
				const archiveResult = archiveSession(parsed, results, ctx.cwd);
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
				content: [{ type: "text", text: summary.join("\n") }],
				details,
			};
		},

		renderCall(args, theme) {
			const { taskFile } = args as { taskFile?: string };
			const label = taskFile ? `Orchestrate: ${path.basename(taskFile)}` : "Orchestrate Tasks";
			return new Text(theme.fg("toolTitle", theme.bold(label)), 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as OrchestrateDetails | undefined;
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
}
