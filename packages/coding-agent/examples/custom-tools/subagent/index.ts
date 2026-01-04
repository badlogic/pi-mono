/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 *
 * Features merged from oh-my-pi:
 *   - Fuzzy model matching with fallback patterns (e.g., "sonnet, haiku")
 *   - Recursion guard (PI_NO_SUBAGENTS env var)
 *   - .claude/agents/ fallback directory for backwards compat
 *   - Optional session persistence and output file writing
 *   - Tree-style rendering with progress indicators
 *   - Enhanced frontmatter: forkContext, recursive
 *
 * Configuration:
 *   Edit subagent.json in the tool directory to customize settings.
 *   Environment variables override file settings:
 *     - PI_SUBAGENT_MAX_PARALLEL_TASKS
 *     - PI_SUBAGENT_MAX_CONCURRENCY
 *     - PI_SUBAGENT_PERSIST_SESSIONS (0/1)
 *     - PI_SUBAGENT_WRITE_OUTPUT_FILES (0/1)
 */

import { spawn } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Api, Message, Model } from "@mariozechner/pi-ai";
import { StringEnum } from "@mariozechner/pi-ai";
import {
	type CustomTool,
	type CustomToolAPI,
	type CustomToolContext,
	type CustomToolFactory,
	type CustomToolSessionEvent,
	getMarkdownTheme,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { type AgentConfig, type AgentScope, discoverAgents, formatAgentList } from "./agents.js";

// ============================================================================
// Configuration
// ============================================================================

interface SubagentConfig {
	/** Maximum tasks in parallel mode */
	maxParallelTasks: number;
	/** Maximum concurrent subprocess executions */
	maxConcurrency: number;
	/** Maximum agents to show in tool description */
	maxAgentsInDescription: number;
	/** Maximum items to show in collapsed view */
	collapsedItemCount: number;
	/** Persist subagent sessions and artifacts next to parent session file */
	persistSessions: boolean;
	/** Maximum output lines to capture */
	maxOutputLines: number;
	/** Maximum output bytes to capture */
	maxOutputBytes: number;
}

const DEFAULT_CONFIG: SubagentConfig = {
	maxParallelTasks: 16,
	maxConcurrency: 8,
	maxAgentsInDescription: 10,
	collapsedItemCount: 10,
	persistSessions: true,
	maxOutputLines: 5000,
	maxOutputBytes: 500_000,
};

/**
 * Load configuration from subagent.json in the tool directory.
 * Environment variables override file settings.
 */
function loadConfig(): SubagentConfig {
	const config = { ...DEFAULT_CONFIG };

	// Try to load from subagent.json in the same directory as this file
	try {
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = path.dirname(__filename);
		const configPath = path.join(__dirname, "subagent.json");

		if (fs.existsSync(configPath)) {
			const content = fs.readFileSync(configPath, "utf-8");
			const fileConfig = JSON.parse(content);

			// Merge file config (validate types)
			if (typeof fileConfig.maxParallelTasks === "number") config.maxParallelTasks = fileConfig.maxParallelTasks;
			if (typeof fileConfig.maxConcurrency === "number") config.maxConcurrency = fileConfig.maxConcurrency;
			if (typeof fileConfig.maxAgentsInDescription === "number")
				config.maxAgentsInDescription = fileConfig.maxAgentsInDescription;
			if (typeof fileConfig.collapsedItemCount === "number")
				config.collapsedItemCount = fileConfig.collapsedItemCount;
			if (typeof fileConfig.persistSessions === "boolean") config.persistSessions = fileConfig.persistSessions;
			if (typeof fileConfig.maxOutputLines === "number") config.maxOutputLines = fileConfig.maxOutputLines;
			if (typeof fileConfig.maxOutputBytes === "number") config.maxOutputBytes = fileConfig.maxOutputBytes;
		}
	} catch {
		// Ignore errors loading config file, use defaults
	}

	// Environment variable overrides
	const envParallel = process.env.PI_SUBAGENT_MAX_PARALLEL_TASKS;
	const envConcurrency = process.env.PI_SUBAGENT_MAX_CONCURRENCY;
	const envPersist = process.env.PI_SUBAGENT_PERSIST_SESSIONS;

	if (envParallel) {
		const val = parseInt(envParallel, 10);
		if (!isNaN(val) && val > 0) config.maxParallelTasks = val;
	}
	if (envConcurrency) {
		const val = parseInt(envConcurrency, 10);
		if (!isNaN(val) && val > 0) config.maxConcurrency = val;
	}
	if (envPersist !== undefined) {
		config.persistSessions = envPersist === "1" || envPersist.toLowerCase() === "true";
	}

	// Clamp values to reasonable ranges
	config.maxParallelTasks = Math.max(1, Math.min(64, config.maxParallelTasks));
	config.maxConcurrency = Math.max(1, Math.min(32, config.maxConcurrency));
	config.maxAgentsInDescription = Math.max(1, Math.min(50, config.maxAgentsInDescription));
	config.collapsedItemCount = Math.max(1, Math.min(100, config.collapsedItemCount));
	config.maxOutputLines = Math.max(100, Math.min(100000, config.maxOutputLines));
	config.maxOutputBytes = Math.max(10000, Math.min(10000000, config.maxOutputBytes));

	return config;
}

// Load config once at module load time
const CONFIG = loadConfig();

/** Env var set to inhibit subagent spawning (prevents infinite recursion) */
const PI_NO_SUBAGENTS_ENV = "PI_NO_SUBAGENTS";

// ============================================================================
// Utilities
// ============================================================================

const NANOID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function nanoid(size = 12): string {
	const bytes = crypto.randomBytes(size);
	let id = "";
	for (let i = 0; i < size; i++) {
		id += NANOID_ALPHABET[bytes[i] % NANOID_ALPHABET.length];
	}
	return id;
}

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	const mins = Math.floor(ms / 60000);
	const secs = ((ms % 60000) / 1000).toFixed(0);
	return `${mins}m${secs}s`;
}

function formatTimeAgo(timestampMs: number): string {
	const ago = Date.now() - timestampMs;
	if (ago < 1000) return "just now";
	if (ago < 60000) return `${Math.round(ago / 1000)}s ago`;
	const mins = Math.floor(ago / 60000);
	return `${mins}m ago`;
}

function pluralize(count: number, singular: string, plural?: string): string {
	return count === 1 ? singular : (plural ?? `${singular}s`);
}

function sanitizeAgentName(name: string): string {
	return name.replace(/[^\w.-]+/g, "_").slice(0, 50);
}

function formatUsageStats(
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
		contextTokens?: number;
		turns?: number;
	},
	model?: string,
): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens && usage.contextTokens > 0) {
		parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	}
	if (model) parts.push(model);
	return parts.join(" ");
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (p: string) => {
		const home = os.homedir();
		return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
	};

	switch (toolName) {
		case "bash": {
			const command = (args.command as string) || "...";
			const preview = command.length > 60 ? `${command.slice(0, 60)}...` : command;
			return themeFg("muted", "$ ") + themeFg("toolOutput", preview);
		}
		case "read": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let text = themeFg("accent", filePath);
			if (offset !== undefined || limit !== undefined) {
				const startLine = offset ?? 1;
				const endLine = limit !== undefined ? startLine + limit - 1 : "";
				text += themeFg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return themeFg("muted", "read ") + text;
		}
		case "write": {
			const rawPath = (args.file_path || args.path || "...") as string;
			const filePath = shortenPath(rawPath);
			const content = (args.content || "") as string;
			const lines = content.split("\n").length;
			let text = themeFg("muted", "write ") + themeFg("accent", filePath);
			if (lines > 1) text += themeFg("dim", ` (${lines} lines)`);
			return text;
		}
		case "edit": {
			const rawPath = (args.file_path || args.path || "...") as string;
			return themeFg("muted", "edit ") + themeFg("accent", shortenPath(rawPath));
		}
		case "ls": {
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "ls ") + themeFg("accent", shortenPath(rawPath));
		}
		case "find": {
			const pattern = (args.pattern || "*") as string;
			const rawPath = (args.path || ".") as string;
			return themeFg("muted", "find ") + themeFg("accent", pattern) + themeFg("dim", ` in ${shortenPath(rawPath)}`);
		}
		case "grep": {
			const pattern = (args.pattern || "") as string;
			const rawPath = (args.path || ".") as string;
			return (
				themeFg("muted", "grep ") +
				themeFg("accent", `/${pattern}/`) +
				themeFg("dim", ` in ${shortenPath(rawPath)}`)
			);
		}
		default: {
			const argsStr = JSON.stringify(args);
			const preview = argsStr.length > 50 ? `${argsStr.slice(0, 50)}...` : argsStr;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

function formatToolArgs(toolName: string, args: Record<string, unknown>): string {
	const MAX_LEN = 60;
	let preview = "";

	if (args.command) {
		preview = String(args.command);
	} else if (args.file_path) {
		preview = String(args.file_path);
	} else if (args.path) {
		preview = String(args.path);
	} else if (args.pattern) {
		preview = String(args.pattern);
	} else if (args.query) {
		preview = String(args.query);
	} else if (args.url) {
		preview = String(args.url);
	} else if (args.task) {
		preview = String(args.task);
	} else {
		for (const val of Object.values(args)) {
			if (typeof val === "string" && val.length > 0) {
				preview = val;
				break;
			}
		}
	}

	if (!preview) return toolName;

	preview = preview.replace(/\n/g, " ").trim();
	if (preview.length > MAX_LEN) {
		preview = `${preview.slice(0, MAX_LEN)}…`;
	}

	return `${toolName}: ${preview}`;
}

// ============================================================================
// Model Resolution (using proper API instead of spawning pi --list-models)
// ============================================================================

/**
 * Resolve a fuzzy model pattern to an actual model.
 * Supports comma-separated patterns (e.g., "sonnet, haiku") for fallbacks.
 * Returns the first match found, or undefined if no match.
 */
function resolveModelPattern(pattern: string, availableModels: Model<Api>[]): Model<Api> | undefined {
	if (!pattern || pattern === "default") return undefined;

	if (availableModels.length === 0) {
		return undefined;
	}

	// Split by comma, try each pattern in order
	const patterns = pattern
		.split(",")
		.map((p) => p.trim().toLowerCase())
		.filter(Boolean);

	for (const p of patterns) {
		// Try exact match first
		const exact = availableModels.find((m) => m.id.toLowerCase() === p);
		if (exact) return exact;

		// Try partial match
		const partial = availableModels.find((m) => m.id.toLowerCase().includes(p) || m.name?.toLowerCase().includes(p));
		if (partial) return partial;
	}

	return undefined;
}

// ============================================================================
// Types
// ============================================================================

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	modelOverride?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	durationMs?: number;
}

interface AgentProgress {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	status: "queued" | "running" | "completed" | "failed";
	task: string;
	currentTool?: string;
	currentToolDescription?: string;
	currentToolStartMs?: number;
	recentTools: Array<{ tool: string; desc: string; endMs: number }>;
	recentOutput: string[];
	toolCount: number;
	tokens: number;
	durationMs: number;
	step?: number;
	index: number;
	modelOverride?: string;
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
	/** For streaming progress updates */
	progress?: AgentProgress[];
	/** Output file paths */
	outputPaths?: string[];
	totalDurationMs?: number;
}

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, any> };

function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

// ============================================================================
// Concurrency Helpers
// ============================================================================

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

// ============================================================================
// File Helpers
// ============================================================================

function writePromptToTempFile(agentName: string, prompt: string): { dir: string; filePath: string } {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	fs.writeFileSync(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	return { dir: tmpDir, filePath };
}

/**
 * Get session artifacts directory from a session file path.
 * e.g., /path/to/sessions/2026-01-01T14-28-11-636Z_uuid.jsonl
 *   → /path/to/sessions/2026-01-01T14-28-11-636Z_uuid/
 */
function getSessionArtifactsDir(sessionFile: string | null): string | null {
	if (!sessionFile) return null;
	if (sessionFile.endsWith(".jsonl")) {
		return sessionFile.slice(0, -6);
	}
	return sessionFile;
}

// ============================================================================
// Agent Execution
// ============================================================================

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

interface RunAgentOptions {
	pi: CustomToolAPI;
	ctx: CustomToolContext;
	agents: AgentConfig[];
	agentName: string;
	task: string;
	cwd?: string;
	step?: number;
	index: number;
	signal?: AbortSignal;
	modelOverride?: string;
	sessionFile?: string;
	inputFile?: string;
	onProgress?: (progress: AgentProgress) => void;
}

async function runSingleAgent(options: RunAgentOptions): Promise<SingleResult> {
	const {
		pi,
		ctx,
		agents,
		agentName,
		task,
		cwd,
		step,
		index,
		signal,
		modelOverride,
		sessionFile,
		inputFile,
		onProgress,
	} = options;

	const startTime = Date.now();
	const agent = agents.find((a) => a.name === agentName);

	if (!agent) {
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: ${agentName}. Available: ${agents.map((a) => a.name).join(", ") || "none"}`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			step,
			durationMs: 0,
		};
	}

	const args: string[] = ["--mode", "json", "-p"];

	// Session persistence
	if (sessionFile) {
		args.push("--session", sessionFile);
	} else {
		args.push("--no-session");
	}

	// Resolve model using proper API
	const rawModel = modelOverride === "default" ? undefined : (modelOverride ?? agent.model);
	if (rawModel) {
		const availableModels = ctx.modelRegistry.getAvailable();
		const resolved = resolveModelPattern(rawModel, availableModels);
		if (resolved) {
			args.push("--model", resolved.id);
		}
	}

	if (agent.tools && agent.tools.length > 0) {
		args.push("--tools", agent.tools.join(","));
	}

	// Write task to file
	let tmpPromptDir: string | null = null;
	let taskFilePath: string;

	if (inputFile) {
		taskFilePath = inputFile;
		fs.writeFileSync(taskFilePath, task, { encoding: "utf-8" });
	} else {
		const tmp = writePromptToTempFile(agent.name, task);
		tmpPromptDir = tmp.dir;
		taskFilePath = path.join(tmp.dir, `task-${sanitizeAgentName(agent.name)}.md`);
		fs.writeFileSync(taskFilePath, task, { encoding: "utf-8", mode: 0o600 });
	}

	const currentResult: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model: agent.model,
		modelOverride,
		step,
	};

	// Progress tracking
	let toolCount = 0;
	let currentTool: string | undefined;
	let currentToolDescription: string | undefined;
	let currentToolStartMs: number | undefined;
	const recentTools: Array<{ tool: string; desc: string; endMs: number }> = [];
	const recentOutput: string[] = [];
	const MAX_RECENT_TOOLS = 5;
	const MAX_RECENT_OUTPUT_LINES = 8;

	const emitProgress = (status: "queued" | "running" | "completed" | "failed" = "running") => {
		onProgress?.({
			agent: agentName,
			agentSource: agent.source,
			status,
			task,
			currentTool,
			currentToolDescription,
			currentToolStartMs,
			recentTools: recentTools.slice(),
			recentOutput: recentOutput.slice(),
			toolCount,
			tokens: currentResult.usage.contextTokens,
			durationMs: Date.now() - startTime,
			step,
			index,
			modelOverride,
		});
	};

	try {
		if (agent.systemPrompt.trim()) {
			if (!tmpPromptDir) {
				const tmp = writePromptToTempFile(agent.name, agent.systemPrompt);
				tmpPromptDir = tmp.dir;
			}
			const systemFilePath = path.join(tmpPromptDir, `system-${sanitizeAgentName(agent.name)}.md`);
			fs.writeFileSync(systemFilePath, agent.systemPrompt, { encoding: "utf-8", mode: 0o600 });
			args.push("--append-system-prompt", systemFilePath);
		}

		args.push(`@${taskFilePath.replace(/\\/g, "/")}`);

		emitProgress("running");

		let wasAborted = false;
		let resolved = false;

		const exitCode = await new Promise<number>((resolve) => {
			const doResolve = (code: number) => {
				if (resolved) return;
				resolved = true;
				signal?.removeEventListener("abort", onAbort);
				resolve(code);
			};

			// Spawn with recursion guard unless agent has recursive: true
			const spawnEnv = agent.recursive ? process.env : { ...process.env, [PI_NO_SUBAGENTS_ENV]: "1" };

			const proc = spawn("pi", args, {
				cwd: cwd ?? pi.cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				env: spawnEnv,
			});

			let buffer = "";

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: any;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				if (event.type === "tool_execution_start") {
					toolCount++;
					currentTool = event.toolName;
					currentToolStartMs = Date.now();
					const toolArgs = event.toolArgs || event.args || {};
					currentToolDescription = formatToolArgs(event.toolName, toolArgs);
					emitProgress();
				} else if (event.type === "tool_execution_end") {
					if (currentTool && currentToolStartMs) {
						const desc = currentToolDescription?.replace(/^[^:]+:\s*/, "") || "";
						recentTools.push({ tool: currentTool, desc, endMs: Date.now() });
						if (recentTools.length > MAX_RECENT_TOOLS) recentTools.shift();
					}
					currentTool = undefined;
					currentToolDescription = undefined;
					currentToolStartMs = undefined;
					emitProgress();
				} else if (event.type === "message_end" && event.message) {
					const msg = event.message as Message;
					currentResult.messages.push(msg);

					if (msg.role === "assistant") {
						currentResult.usage.turns++;
						const usage = msg.usage;
						if (usage) {
							currentResult.usage.input += usage.input || 0;
							currentResult.usage.output += usage.output || 0;
							currentResult.usage.cacheRead += usage.cacheRead || 0;
							currentResult.usage.cacheWrite += usage.cacheWrite || 0;
							currentResult.usage.cost += usage.cost?.total || 0;
							currentResult.usage.contextTokens = usage.totalTokens || 0;
						}
						if (!currentResult.model && msg.model) currentResult.model = msg.model;
						if (msg.stopReason) currentResult.stopReason = msg.stopReason;
						if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;

						// Extract recent output for progress
						for (const part of msg.content) {
							if (part.type === "thinking" && part.thinking) {
								const lines = part.thinking.split("\n").filter((l: string) => l.trim());
								for (const line of lines.slice(-3)) {
									const formatted = `💭 ${line.slice(0, 120)}`;
									if (recentOutput[recentOutput.length - 1] !== formatted) {
										recentOutput.push(formatted);
										if (recentOutput.length > MAX_RECENT_OUTPUT_LINES) recentOutput.shift();
									}
								}
							} else if (part.type === "text" && part.text) {
								const lines = part.text.split("\n").filter((l: string) => l.trim());
								for (const line of lines.slice(-3)) {
									const formatted = line.slice(0, 120);
									if (recentOutput[recentOutput.length - 1] !== formatted) {
										recentOutput.push(formatted);
										if (recentOutput.length > MAX_RECENT_OUTPUT_LINES) recentOutput.shift();
									}
								}
							}
						}
					}
					emitProgress();
				} else if (event.type === "tool_result_end" && event.message) {
					currentResult.messages.push(event.message as Message);
					emitProgress();
				} else if (event.type === "agent_end") {
					currentResult.durationMs = Date.now() - startTime;
					emitProgress("completed");
				}
			};

			proc.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data) => {
				currentResult.stderr += data.toString();
			});

			proc.on("close", (code) => {
				if (buffer.trim()) processLine(buffer);
				currentResult.durationMs = Date.now() - startTime;
				doResolve(code ?? 0);
			});

			proc.on("error", () => {
				currentResult.durationMs = Date.now() - startTime;
				doResolve(1);
			});

			const onAbort = () => {
				wasAborted = true;
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (!proc.killed) proc.kill("SIGKILL");
				}, 5000);
			};

			if (signal) {
				if (signal.aborted) onAbort();
				else signal.addEventListener("abort", onAbort, { once: true });
			}
		});

		currentResult.exitCode = exitCode;
		if (wasAborted) {
			currentResult.stderr = "Interrupted";
			emitProgress("failed");
		} else {
			emitProgress(exitCode === 0 ? "completed" : "failed");
		}

		return currentResult;
	} finally {
		if (tmpPromptDir) {
			try {
				fs.rmSync(tmpPromptDir, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
	}
}

// ============================================================================
// Schema Definitions
// ============================================================================

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	model: Type.Optional(
		Type.String({
			description:
				'Override model (fuzzy match, e.g., "sonnet"). Supports fallbacks: "gpt, opus". Use "default" for pi\'s default.',
		}),
	),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
	model: Type.Optional(Type.String({ description: "Override model for this step" })),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
	default: "user",
});

const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
	model: Type.Optional(Type.String({ description: "Override model (single mode)" })),
});

// ============================================================================
// Tree Rendering Helpers
// ============================================================================

const TREE = {
	MID: "├─",
	END: "└─",
	PIPE: "│",
	SPACE: " ",
	HOOK: "⎿",
};

// ============================================================================
// Factory
// ============================================================================

const factory: CustomToolFactory = (pi) => {
	// Check if subagent spawning is inhibited (we're inside a non-recursive subagent)
	if (process.env[PI_NO_SUBAGENTS_ENV]) {
		return []; // No subagent tool available in this context
	}

	const runId = nanoid(8);
	let artifactsDir: string | null = null;
	const tempDir = path.join(os.tmpdir(), `pi-subagent-${runId}`);

	const tool: CustomTool<typeof SubagentParams, SubagentDetails> = {
		name: "subagent",
		label: "Subagent",
		get description() {
			const user = discoverAgents(pi.cwd, "user");
			const project = discoverAgents(pi.cwd, "project");
			const userList = formatAgentList(user.agents, CONFIG.maxAgentsInDescription);
			const projectList = formatAgentList(project.agents, CONFIG.maxAgentsInDescription);
			const userSuffix = userList.remaining > 0 ? `; ... and ${userList.remaining} more` : "";
			const projectSuffix = projectList.remaining > 0 ? `; ... and ${projectList.remaining} more` : "";
			const projectDirNote = project.projectAgentsDir ? ` (from ${project.projectAgentsDir})` : "";

			const lines = [
				"Delegate tasks to specialized subagents with isolated context.",
				"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
				'Default agent scope is "user" (from ~/.pi/agent/agents).',
				'To enable project-local agents in .pi/agents, set agentScope: "both" (or "project").',
				"",
				'Model override: Supports fuzzy matching (e.g., "sonnet") and fallback patterns (e.g., "gpt, opus").',
				"",
				`User agents: ${userList.text}${userSuffix}.`,
				`Project agents${projectDirNote}: ${projectList.text}${projectSuffix}.`,
				"",
				"When NOT to use subagent:",
				"- Reading specific file paths (use Read tool)",
				"- Searching for class definitions (use Glob tool)",
				"- Searching within 2-3 files (use Read tool)",
				"",
				`Limits: max ${CONFIG.maxParallelTasks} parallel tasks, ${CONFIG.maxConcurrency} concurrent.`,
			];
			return lines.join(" ");
		},
		parameters: SubagentParams,

		onSession(event: CustomToolSessionEvent, ctx: CustomToolContext) {
			if (CONFIG.persistSessions && ctx.sessionManager) {
				const sessionFile = (ctx.sessionManager as any).sessionFile;
				artifactsDir = getSessionArtifactsDir(sessionFile);
				if (artifactsDir) {
					try {
						fs.mkdirSync(artifactsDir, { recursive: true });
					} catch {
						/* ignore */
					}
				}
			} else {
				artifactsDir = null;
			}
		},

		async execute(_toolCallId, params, onUpdate, ctx, signal) {
			const startTime = Date.now();
			const agentScope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(pi.cwd, agentScope);
			const agents = discovery.agents;
			const confirmProjectAgents = params.confirmProjectAgents ?? true;

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

			const makeDetails =
				(mode: "single" | "parallel" | "chain") =>
				(results: SingleResult[], progress?: AgentProgress[], outputPaths?: string[]): SubagentDetails => ({
					mode,
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
					progress,
					outputPaths,
					totalDurationMs: Date.now() - startTime,
				});

			if (modeCount !== 1) {
				const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
				return {
					content: [
						{
							type: "text",
							text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`,
						},
					],
					details: makeDetails("single")([]),
				};
			}

			// Confirm project agents if needed
			if ((agentScope === "project" || agentScope === "both") && confirmProjectAgents && pi.hasUI) {
				const requestedAgentNames = new Set<string>();
				if (params.chain) for (const step of params.chain) requestedAgentNames.add(step.agent);
				if (params.tasks) for (const t of params.tasks) requestedAgentNames.add(t.agent);
				if (params.agent) requestedAgentNames.add(params.agent);

				const projectAgentsRequested = Array.from(requestedAgentNames)
					.map((name) => agents.find((a) => a.name === name))
					.filter((a): a is AgentConfig => a?.source === "project");

				if (projectAgentsRequested.length > 0) {
					const names = projectAgentsRequested.map((a) => a.name).join(", ");
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					const ok = await pi.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!ok)
						return {
							content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
							details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
						};
				}
			}

			// Prepare output directory
			// When persistSessions is enabled AND we have an artifacts dir:
			//   - Store: <artifactsDir>/<agent>_<id>.{in.md,out.md,jsonl}
			// Otherwise (ephemeral):
			//   - Store: <tempDir>/task_<agent>_<idx>.md (output only)
			const outputDir = artifactsDir ?? tempDir;
			try {
				fs.mkdirSync(outputDir, { recursive: true });
			} catch {
				/* ignore */
			}

			// ============================================================
			// CHAIN MODE
			// ============================================================
			if (params.chain && params.chain.length > 0) {
				const results: SingleResult[] = [];
				let previousOutput = "";
				const outputPaths: string[] = [];

				// Generate unique IDs for each step
				const agentIds = params.chain.map((step) => `${sanitizeAgentName(step.agent)}_${nanoid(8)}`);

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);
					const agentId = agentIds[i];

					// Set up file paths
					let outputFile: string;
					let sessionFile: string | undefined;
					let inputFile: string | undefined;

					if (artifactsDir) {
						// Persistent: store input, output, and session
						outputFile = path.join(artifactsDir, `${agentId}.out.md`);
						sessionFile = path.join(artifactsDir, `${agentId}.jsonl`);
						inputFile = path.join(artifactsDir, `${agentId}.in.md`);
					} else {
						// Ephemeral: output only
						outputFile = path.join(tempDir, `chain_${i + 1}_${sanitizeAgentName(step.agent)}.md`);
					}
					outputPaths.push(outputFile);

					const result = await runSingleAgent({
						pi,
						ctx,
						agents,
						agentName: step.agent,
						task: taskWithContext,
						cwd: step.cwd,
						step: i + 1,
						index: i,
						signal,
						modelOverride: step.model,
						sessionFile,
						inputFile,
						onProgress: (progress) => {
							const allProgress: AgentProgress[] = results.map((r, idx) => ({
								agent: r.agent,
								agentSource: r.agentSource,
								status: "completed" as const,
								task: r.task,
								recentTools: [],
								recentOutput: [],
								toolCount: 0,
								tokens: r.usage.contextTokens,
								durationMs: r.durationMs ?? 0,
								step: idx + 1,
								index: idx,
								modelOverride: r.modelOverride,
							}));
							allProgress.push(progress);
							onUpdate?.({
								content: [{ type: "text", text: `Chain: ${results.length + 1}/${params.chain!.length}` }],
								details: makeDetails("chain")(results, allProgress, outputPaths),
							});
						},
					});
					results.push(result);

					// Write output file
					const content = getFinalOutput(result.messages) || result.stderr || "(no output)";
					try {
						fs.writeFileSync(outputFile, content.trim(), { encoding: "utf-8" });
					} catch {
						/* ignore */
					}

					const isError =
						result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
					if (isError) {
						const errorMsg =
							result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
						return {
							content: [{ type: "text", text: `Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}` }],
							details: makeDetails("chain")(results, undefined, outputPaths),
							isError: true,
						};
					}
					previousOutput = getFinalOutput(result.messages);
				}

				return {
					content: [{ type: "text", text: getFinalOutput(results[results.length - 1].messages) || "(no output)" }],
					details: makeDetails("chain")(results, undefined, outputPaths),
				};
			}

			// ============================================================
			// PARALLEL MODE
			// ============================================================
			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > CONFIG.maxParallelTasks) {
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Max is ${CONFIG.maxParallelTasks}.`,
							},
						],
						details: makeDetails("parallel")([]),
					};
				}

				// Generate unique IDs for each task
				const agentIds = params.tasks.map((t) => `${sanitizeAgentName(t.agent)}_${nanoid(8)}`);

				// Set up file paths
				const outputPaths: string[] = [];
				const sessionFiles: (string | undefined)[] = [];
				const inputFiles: (string | undefined)[] = [];

				for (let i = 0; i < params.tasks.length; i++) {
					const agentId = agentIds[i];
					if (artifactsDir) {
						// Persistent: store input, output, and session
						outputPaths.push(path.join(artifactsDir, `${agentId}.out.md`));
						sessionFiles.push(path.join(artifactsDir, `${agentId}.jsonl`));
						inputFiles.push(path.join(artifactsDir, `${agentId}.in.md`));
					} else {
						// Ephemeral: output only
						outputPaths.push(path.join(tempDir, `task_${sanitizeAgentName(params.tasks[i].agent)}_${i}.md`));
						sessionFiles.push(undefined);
						inputFiles.push(undefined);
					}
				}

				// Initialize progress tracking
				const progressMap = new Map<number, AgentProgress>();

				for (let i = 0; i < params.tasks.length; i++) {
					const t = params.tasks[i];
					const agentCfg = agents.find((a) => a.name === t.agent);
					progressMap.set(i, {
						agent: t.agent,
						agentSource: agentCfg?.source ?? "unknown",
						status: "queued",
						task: t.task,
						recentTools: [],
						recentOutput: [],
						toolCount: 0,
						tokens: 0,
						durationMs: 0,
						index: i,
						modelOverride: t.model,
					});
				}

				const emitParallelProgress = () => {
					const allProgress = Array.from(progressMap.values()).sort((a, b) => a.index - b.index);
					const running = allProgress.filter((p) => p.status === "running").length;
					const done = allProgress.filter((p) => p.status === "completed" || p.status === "failed").length;
					onUpdate?.({
						content: [{ type: "text", text: `Parallel: ${done}/${allProgress.length} done, ${running} running` }],
						details: makeDetails("parallel")([], allProgress, outputPaths),
					});
				};

				emitParallelProgress();

				const results = await mapWithConcurrencyLimit(params.tasks, CONFIG.maxConcurrency, async (t, index) => {
					const result = await runSingleAgent({
						pi,
						ctx,
						agents,
						agentName: t.agent,
						task: t.task,
						cwd: t.cwd,
						index,
						signal,
						modelOverride: t.model,
						sessionFile: sessionFiles[index],
						inputFile: inputFiles[index],
						onProgress: (progress) => {
							progressMap.set(index, progress);
							emitParallelProgress();
						},
					});

					// Write output file
					const content = getFinalOutput(result.messages) || result.stderr || "(no output)";
					try {
						fs.writeFileSync(outputPaths[index], content.trim(), { encoding: "utf-8" });
					} catch {
						/* ignore */
					}

					return result;
				});

				const successCount = results.filter((r) => r.exitCode === 0).length;
				const summaries = results.map((r, i) => {
					const output = getFinalOutput(r.messages);
					const preview = output.slice(0, 100) + (output.length > 100 ? "..." : "");
					const outputNote = outputPaths[i] ? ` → ${outputPaths[i]}` : "";
					return `[${r.agent}] ${r.exitCode === 0 ? "completed" : "failed"}${outputNote}: ${preview || "(no output)"}`;
				});

				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}`,
						},
					],
					details: makeDetails("parallel")(results, undefined, outputPaths),
				};
			}

			// ============================================================
			// SINGLE MODE
			// ============================================================
			if (params.agent && params.task) {
				// Generate unique ID for this agent invocation
				const agentId = `${sanitizeAgentName(params.agent)}_${nanoid(8)}`;

				// Set up file paths
				let outputFile: string;
				let sessionFile: string | undefined;
				let inputFile: string | undefined;

				if (artifactsDir) {
					// Persistent: store input, output, and session
					outputFile = path.join(artifactsDir, `${agentId}.out.md`);
					sessionFile = path.join(artifactsDir, `${agentId}.jsonl`);
					inputFile = path.join(artifactsDir, `${agentId}.in.md`);
				} else {
					// Ephemeral: output only
					outputFile = path.join(tempDir, `single_${sanitizeAgentName(params.agent)}.md`);
				}

				const outputPaths = [outputFile];

				const result = await runSingleAgent({
					pi,
					ctx,
					agents,
					agentName: params.agent,
					task: params.task,
					cwd: params.cwd,
					index: 0,
					signal,
					modelOverride: params.model,
					sessionFile,
					inputFile,
					onProgress: (progress) => {
						onUpdate?.({
							content: [{ type: "text", text: "(running...)" }],
							details: makeDetails("single")([], [progress], outputPaths),
						});
					},
				});

				// Write output file
				const content = getFinalOutput(result.messages) || result.stderr || "(no output)";
				try {
					fs.writeFileSync(outputFile, content.trim(), { encoding: "utf-8" });
				} catch {
					/* ignore */
				}

				const isError = result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
				if (isError) {
					const errorMsg =
						result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
					return {
						content: [{ type: "text", text: `Agent ${result.stopReason || "failed"}: ${errorMsg}` }],
						details: makeDetails("single")([result], undefined, outputPaths),
						isError: true,
					};
				}

				return {
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
					details: makeDetails("single")([result], undefined, outputPaths),
				};
			}

			const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
			return {
				content: [{ type: "text", text: `Invalid parameters. Available agents: ${available}` }],
				details: makeDetails("single")([]),
			};
		},

		renderCall(args, theme) {
			const scope: AgentScope = args.agentScope ?? "user";

			if (args.chain && args.chain.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `chain (${args.chain.length} steps)`) +
					theme.fg("muted", ` [${scope}]`);
				for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
					const step = args.chain[i];
					const cleanTask = step.task.replace(/\{previous\}/g, "").trim();
					const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
					const modelTag = step.model ? theme.fg("dim", ` (${step.model})`) : "";
					text +=
						"\n  " +
						theme.fg("muted", `${i + 1}.`) +
						" " +
						theme.fg("accent", step.agent) +
						modelTag +
						theme.fg("dim", ` ${preview}`);
				}
				if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}

			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [${scope}]`);
				for (const t of args.tasks.slice(0, 3)) {
					const preview = t.task.length > 40 ? `${t.task.slice(0, 40)}...` : t.task;
					const modelTag = t.model ? theme.fg("dim", ` (${t.model})`) : "";
					text += `\n  ${theme.fg("accent", t.agent)}${modelTag}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}

			const agentName = args.agent || "...";
			const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
			const modelTag = args.model ? theme.fg("dim", ` (${args.model})`) : "";
			let text =
				theme.fg("toolTitle", theme.bold("subagent ")) +
				theme.fg("accent", agentName) +
				modelTag +
				theme.fg("muted", ` [${scope}]`);
			text += `\n  ${theme.fg("dim", preview)}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			const { details } = result;

			const truncateTask = (task: string, maxLen: number) => {
				const firstLine = task.split("\n")[0];
				return firstLine.length > maxLen ? `${firstLine.slice(0, maxLen)}…` : firstLine;
			};

			const renderDisplayItems = (items: DisplayItem[], limit?: number) => {
				const toShow = limit ? items.slice(-limit) : items;
				const skipped = limit && items.length > limit ? items.length - limit : 0;
				let text = "";
				if (skipped > 0) text += theme.fg("muted", `... ${skipped} earlier items\n`);
				for (const item of toShow) {
					if (item.type === "text") {
						const preview = expanded ? item.text : item.text.split("\n").slice(0, 3).join("\n");
						text += `${theme.fg("toolOutput", preview)}\n`;
					} else {
						text += `${theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme))}\n`;
					}
				}
				return text.trimEnd();
			};

			// Handle streaming progress with tree-style rendering
			if (isPartial && details?.progress && details.progress.length > 0) {
				const count = details.progress.length;
				const completedCount = details.progress.filter((p) => p.status === "completed").length;
				const outputDir = details.outputPaths?.[0] ? path.dirname(details.outputPaths[0]) : null;
				const writeNote = outputDir ? ` → ${outputDir}` : "";

				let headerText: string;
				if (completedCount === count) {
					headerText = `${theme.fg("success", "●")} ${theme.fg("toolTitle", `${count} ${pluralize(count, "agent")} finished`)}`;
				} else if (completedCount > 0) {
					headerText = theme.fg("toolTitle", `Running ${count - completedCount}/${count} agents`);
				} else {
					headerText = theme.fg("toolTitle", `Running ${count} ${pluralize(count, "agent")}`);
				}
				const expandHint = expanded ? "" : theme.fg("dim", " (Ctrl+O for details)");
				let text = headerText + theme.fg("dim", writeNote) + expandHint;

				for (let i = 0; i < details.progress.length; i++) {
					const p = details.progress[i];
					const isLast = i === details.progress.length - 1;
					const branch = isLast ? TREE.END : TREE.MID;
					const cont = isLast ? TREE.SPACE : TREE.PIPE;

					const taskPreview = truncateTask(p.task, 45);
					const tokenStr = p.tokens > 0 ? `${formatTokens(p.tokens)} tokens` : "";
					const modelTag = p.modelOverride ? theme.fg("muted", ` (${p.modelOverride})`) : "";

					if (p.status === "completed") {
						text += `\n ${theme.fg("dim", branch)} ${theme.fg("accent", p.agent)}${modelTag}${theme.fg("dim", ` · ${tokenStr}`)}`;
						text += `\n ${theme.fg("dim", `${cont}  ${TREE.HOOK} `)}${theme.fg("success", "Done")}`;
					} else if (p.status === "failed") {
						text += `\n ${theme.fg("dim", branch)} ${theme.fg("accent", p.agent)}${modelTag}`;
						text += `\n ${theme.fg("dim", `${cont}  ${TREE.HOOK} `)}${theme.fg("error", "Failed")}`;
					} else if (p.status === "queued") {
						text += `\n ${theme.fg("dim", branch)} ${theme.fg("accent", p.agent)}${modelTag}`;
						text += `\n ${theme.fg("dim", `${cont}  ${TREE.HOOK} `)}${theme.fg("muted", "Queued...")}`;
					} else {
						// Running
						const toolUses = `${p.toolCount} tool ${pluralize(p.toolCount, "use")}`;
						const stats = [toolUses, tokenStr].filter(Boolean).join(" · ");

						text +=
							"\n " +
							theme.fg("dim", branch) +
							" " +
							theme.fg("accent", p.agent) +
							modelTag +
							theme.fg("dim", ": ") +
							theme.fg("muted", taskPreview) +
							theme.fg("dim", ` · ${stats}`);

						let statusLine = p.currentToolDescription || p.currentTool || "Initializing…";
						if (p.currentToolStartMs) {
							const toolDurationMs = Date.now() - p.currentToolStartMs;
							if (toolDurationMs > 5000) {
								statusLine += theme.fg("warning", ` (${formatDuration(toolDurationMs)})`);
							}
						}
						text += `\n ${theme.fg("dim", `${cont}  ${TREE.HOOK} `)}${theme.fg("dim", statusLine)}`;

						// Show recent output and tool history in expanded mode
						if (expanded) {
							if (p.recentOutput && p.recentOutput.length > 0) {
								for (const line of p.recentOutput) {
									const isThinking = line.startsWith("💭");
									const color = isThinking ? "muted" : "dim";
									text += `\n ${theme.fg("dim", `${cont}     `)}${theme.fg(color, line)}`;
								}
							}
							if (p.recentTools && p.recentTools.length > 0) {
								for (const rt of p.recentTools) {
									const ago = formatTimeAgo(rt.endMs);
									const desc = rt.desc ? `${rt.tool}: ${rt.desc}` : rt.tool;
									text += `\n ${theme.fg("dim", `${cont}     `)}${theme.fg("muted", `↳ ${desc}`)} ${theme.fg("dim", `(${ago})`)}`;
								}
							}
						}
					}
				}

				return new Text(text, 0, 0);
			}

			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();

			const aggregateUsage = (results: SingleResult[]) => {
				const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
				for (const r of results) {
					total.input += r.usage.input;
					total.output += r.usage.output;
					total.cacheRead += r.usage.cacheRead;
					total.cacheWrite += r.usage.cacheWrite;
					total.cost += r.usage.cost;
					total.turns += r.usage.turns;
				}
				return total;
			};

			// ============================================================
			// SINGLE MODE - Finished
			// ============================================================
			if (details.mode === "single" && details.results.length === 1) {
				const r = details.results[0];
				const isError = r.exitCode !== 0 || r.stopReason === "error" || r.stopReason === "aborted";
				const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
				const displayItems = getDisplayItems(r.messages);
				const finalOutput = getFinalOutput(r.messages);
				const outputPath = details.outputPaths?.[0];

				if (expanded) {
					const container = new Container();
					let header = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
					if (isError && r.stopReason) header += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
					if (outputPath) header += theme.fg("dim", ` → ${outputPath}`);
					container.addChild(new Text(header, 0, 0));
					if (isError && r.errorMessage)
						container.addChild(new Text(theme.fg("error", `Error: ${r.errorMessage}`), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
					container.addChild(new Text(theme.fg("dim", r.task), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
					if (displayItems.length === 0 && !finalOutput) {
						container.addChild(new Text(theme.fg("muted", "(no output)"), 0, 0));
					} else {
						for (const item of displayItems) {
							if (item.type === "toolCall")
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
						}
						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}
					}
					const usageStr = formatUsageStats(r.usage, r.model);
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", usageStr), 0, 0));
					}
					return container;
				}

				let text = `${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}${theme.fg("muted", ` (${r.agentSource})`)}`;
				if (isError && r.stopReason) text += ` ${theme.fg("error", `[${r.stopReason}]`)}`;
				if (outputPath) text += theme.fg("dim", ` → ${outputPath}`);
				if (isError && r.errorMessage) text += `\n${theme.fg("error", `Error: ${r.errorMessage}`)}`;
				else if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
				else {
					text += `\n${renderDisplayItems(displayItems, CONFIG.collapsedItemCount)}`;
					if (displayItems.length > CONFIG.collapsedItemCount)
						text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				}
				const usageStr = formatUsageStats(r.usage, r.model);
				if (usageStr) text += `\n${theme.fg("dim", usageStr)}`;
				return new Text(text, 0, 0);
			}

			// ============================================================
			// CHAIN MODE - Finished
			// ============================================================
			if (details.mode === "chain") {
				const successCount = details.results.filter((r) => r.exitCode === 0).length;
				const icon = successCount === details.results.length ? theme.fg("success", "✓") : theme.fg("error", "✗");

				if (expanded) {
					const container = new Container();
					container.addChild(
						new Text(
							icon +
								" " +
								theme.fg("toolTitle", theme.bold("chain ")) +
								theme.fg("accent", `${successCount}/${details.results.length} steps`),
							0,
							0,
						),
					);

					for (let i = 0; i < details.results.length; i++) {
						const r = details.results[i];
						const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);
						const outputPath = details.outputPaths?.[i];

						container.addChild(new Spacer(1));
						let stepHeader = `${theme.fg("muted", `─── Step ${r.step}: `) + theme.fg("accent", r.agent)} ${rIcon}`;
						if (outputPath) stepHeader += theme.fg("dim", ` → ${outputPath}`);
						container.addChild(new Text(stepHeader, 0, 0));
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const stepUsage = formatUsageStats(r.usage, r.model);
						if (stepUsage) container.addChild(new Text(theme.fg("dim", stepUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					return container;
				}

				let text =
					icon +
					" " +
					theme.fg("toolTitle", theme.bold("chain ")) +
					theme.fg("accent", `${successCount}/${details.results.length} steps`);
				for (let i = 0; i < details.results.length; i++) {
					const r = details.results[i];
					const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
					const displayItems = getDisplayItems(r.messages);
					const outputPath = details.outputPaths?.[i];
					let stepLine = `\n\n${theme.fg("muted", `─── Step ${r.step}: `)}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (outputPath) stepLine += theme.fg("dim", ` → ${outputPath}`);
					text += stepLine;
					if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				const usageStr = formatUsageStats(aggregateUsage(details.results));
				if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			// ============================================================
			// PARALLEL MODE - Finished
			// ============================================================
			if (details.mode === "parallel") {
				const successCount = details.results.filter((r) => r.exitCode === 0).length;
				const failCount = details.results.filter((r) => r.exitCode !== 0).length;
				const icon = failCount > 0 ? theme.fg("warning", "◐") : theme.fg("success", "✓");
				const status = `${successCount}/${details.results.length} tasks`;

				if (expanded) {
					const container = new Container();
					container.addChild(
						new Text(
							`${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`,
							0,
							0,
						),
					);

					for (let i = 0; i < details.results.length; i++) {
						const r = details.results[i];
						const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
						const displayItems = getDisplayItems(r.messages);
						const finalOutput = getFinalOutput(r.messages);
						const outputPath = details.outputPaths?.[i];

						container.addChild(new Spacer(1));
						let taskHeader = `${theme.fg("muted", "─── ") + theme.fg("accent", r.agent)} ${rIcon}`;
						if (outputPath) taskHeader += theme.fg("dim", ` → ${outputPath}`);
						container.addChild(new Text(taskHeader, 0, 0));
						container.addChild(new Text(theme.fg("muted", "Task: ") + theme.fg("dim", r.task), 0, 0));

						for (const item of displayItems) {
							if (item.type === "toolCall") {
								container.addChild(
									new Text(
										theme.fg("muted", "→ ") + formatToolCall(item.name, item.args, theme.fg.bind(theme)),
										0,
										0,
									),
								);
							}
						}

						if (finalOutput) {
							container.addChild(new Spacer(1));
							container.addChild(new Markdown(finalOutput.trim(), 0, 0, mdTheme));
						}

						const taskUsage = formatUsageStats(r.usage, r.model);
						if (taskUsage) container.addChild(new Text(theme.fg("dim", taskUsage), 0, 0));
					}

					const usageStr = formatUsageStats(aggregateUsage(details.results));
					if (usageStr) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", `Total: ${usageStr}`), 0, 0));
					}
					return container;
				}

				let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
				for (let i = 0; i < details.results.length; i++) {
					const r = details.results[i];
					const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
					const displayItems = getDisplayItems(r.messages);
					const outputPath = details.outputPaths?.[i];
					let taskLine = `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", r.agent)} ${rIcon}`;
					if (outputPath) taskLine += theme.fg("dim", ` → ${outputPath}`);
					text += taskLine;
					if (displayItems.length === 0) text += `\n${theme.fg("muted", "(no output)")}`;
					else text += `\n${renderDisplayItems(displayItems, 5)}`;
				}
				const usageStr = formatUsageStats(aggregateUsage(details.results));
				if (usageStr) text += `\n\n${theme.fg("dim", `Total: ${usageStr}`)}`;
				text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
		},
	};

	return tool;
};

export default factory;
