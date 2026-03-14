/**
 * Subagent Tool - Delegate tasks to specialized agents
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@apholdings/jensen-agent-core";
import type { Message } from "@apholdings/jensen-ai";
import { StringEnum } from "@apholdings/jensen-ai";
import {
	APP_NAME,
	type ExtensionAPI,
	type ExtensionContext,
	getMarkdownTheme,
	type Theme,
	type ToolDefinition,
	type ToolRenderResultOptions,
} from "@apholdings/jensen-code";
import { Container, Markdown, Spacer, Text } from "@apholdings/jensen-tui";
import { type Static, Type } from "@sinclair/typebox";
import {
	type AgentConfig,
	type AgentDiscoveryError,
	type AgentScope,
	discoverAgents,
	findDiscoveryErrorForAgent,
} from "./agents.js";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEM_COUNT = 10;

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

type FailureStage = "lookup" | "discovery" | "launch" | "provider" | "result";

export interface SubagentInvocation {
	command: string;
	args: string[];
	cwd: string;
	displayCommand: string;
}

interface ExtractedFinalOutput {
	text: string;
	reason?: string;
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
	stopReason?: string;
	errorMessage?: string;
	step?: number;
	failureStage?: FailureStage;
	diagnosticMessage?: string;
	invocation?: SubagentInvocation;
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	discoveryErrors: AgentDiscoveryError[];
	results: SingleResult[];
}

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, unknown> };

interface SubagentRunRequest {
	invocation: SubagentInvocation;
	agent: AgentConfig;
	onMessage: (message: Message) => void;
	signal?: AbortSignal;
}

interface SubagentRunResult {
	exitCode: number;
	stderr: string;
	launchError?: string;
}

type SubagentParamsType = Static<typeof SubagentParams>;

function textContent(text: string) {
	return [{ type: "text" as const, text }];
}

export type SubagentRunner = (request: SubagentRunRequest) => Promise<SubagentRunResult>;

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatUsageStats(usage: UsageStats, model?: string): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${formatTokens(usage.input)}`);
	if (usage.output) parts.push(`↓${formatTokens(usage.output)}`);
	if (usage.cacheRead) parts.push(`R${formatTokens(usage.cacheRead)}`);
	if (usage.cacheWrite) parts.push(`W${formatTokens(usage.cacheWrite)}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens > 0) parts.push(`ctx:${formatTokens(usage.contextTokens)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

function formatToolCall(
	toolName: string,
	args: Record<string, unknown>,
	themeFg: (color: any, text: string) => string,
): string {
	const shortenPath = (filePath: string) => {
		const home = os.homedir();
		return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
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
			const argsString = JSON.stringify(args);
			const preview = argsString.length > 50 ? `${argsString.slice(0, 50)}...` : argsString;
			return themeFg("accent", toolName) + themeFg("dim", ` ${preview}`);
		}
	}
}

function trimOutput(value: string): string {
	return value.replace(/\s+$/u, "");
}

export function extractFinalOutput(messages: Message[]): ExtractedFinalOutput {
	let sawAssistantMessage = false;
	let sawAssistantWithoutText = false;
	let sawAssistantWithEmptyText = false;

	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant") continue;
		sawAssistantMessage = true;
		const textParts = message.content
			.filter((part): part is Extract<Message["content"][number], { type: "text" }> => part.type === "text")
			.map((part) => part.text);
		if (textParts.length === 0) {
			sawAssistantWithoutText = true;
			continue;
		}

		const combinedText = trimOutput(textParts.join(""));
		if (combinedText.length > 0) {
			return { text: combinedText };
		}

		sawAssistantWithEmptyText = true;
	}

	if (!sawAssistantMessage) {
		return { text: "", reason: "no assistant message was emitted by the child session" };
	}
	if (sawAssistantWithoutText) {
		return { text: "", reason: "the final assistant message contained no text parts" };
	}
	if (sawAssistantWithEmptyText) {
		return { text: "", reason: "the final assistant message only contained empty text" };
	}
	return { text: "", reason: "the child session ended without a final assistant text response" };
}

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const part of message.content) {
			if (part.type === "text") {
				if (part.text.trim().length > 0) {
					items.push({ type: "text", text: part.text });
				}
			} else if (part.type === "toolCall") {
				items.push({ type: "toolCall", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

function normalizeWorkingDirectory(defaultCwd: string, cwd?: string): string {
	return path.normalize(path.resolve(cwd ?? defaultCwd));
}

function resolveCliCommandPrefix(): { command: string; prefixArgs: string[] } {
	const cliEntry = process.argv[1];
	if (typeof cliEntry === "string" && cliEntry.length > 0) {
		const resolvedCliEntry = path.resolve(cliEntry);
		if (/\.(?:cjs|cts|js|mjs|mts|ts)$/iu.test(resolvedCliEntry)) {
			return { command: process.execPath, prefixArgs: [resolvedCliEntry] };
		}
	}
	return { command: process.execPath, prefixArgs: [] };
}

export function buildSubagentInvocation(
	defaultCwd: string,
	agent: AgentConfig,
	task: string,
	cwd?: string,
): SubagentInvocation {
	const { command, prefixArgs } = resolveCliCommandPrefix();
	const args = [...prefixArgs, "--mode", "json", "-p", "--no-session"];
	if (agent.model) args.push("--model", agent.model);
	if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));
	args.push(`Task: ${task}`);

	return {
		command,
		args,
		cwd: normalizeWorkingDirectory(defaultCwd, cwd),
		displayCommand: [command, ...args].join(" "),
	};
}

function createEmptyUsageStats(): UsageStats {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

function applyAssistantUsage(result: SingleResult, message: Message): void {
	if (message.role !== "assistant") {
		return;
	}
	result.usage.turns++;
	const usage = message.usage;
	if (!usage) {
		return;
	}
	result.usage.input += usage.input || 0;
	result.usage.output += usage.output || 0;
	result.usage.cacheRead += usage.cacheRead || 0;
	result.usage.cacheWrite += usage.cacheWrite || 0;
	result.usage.cost += usage.cost?.total || 0;
	result.usage.contextTokens = usage.totalTokens || 0;
	if (!result.model && message.model) result.model = message.model;
	if (message.stopReason) result.stopReason = message.stopReason;
	if (message.errorMessage) result.errorMessage = message.errorMessage;
}

function writePromptToTempFile(agentName: string, prompt: string): { dir: string; filePath: string } {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `${APP_NAME}-subagent-`));
	const safeName = agentName.replace(/[^\w.-]+/gu, "_");
	const filePath = path.join(tempDir, `prompt-${safeName}.md`);
	fs.writeFileSync(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	return { dir: tempDir, filePath };
}

function parseJsonLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
	let buffer = "";
	stream.on("data", (data) => {
		buffer += data.toString();
		const lines = buffer.split(/\r?\n/u);
		buffer = lines.pop() || "";
		for (const line of lines) onLine(line);
	});
	stream.on("end", () => {
		if (buffer.trim().length > 0) {
			onLine(buffer);
		}
	});
}

function createDefaultSubagentRunner(): SubagentRunner {
	return ({ invocation, onMessage, signal }) =>
		new Promise<SubagentRunResult>((resolve) => {
			const child = spawn(invocation.command, invocation.args, {
				cwd: invocation.cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			let stderr = "";
			let launchError: string | undefined;
			let settled = false;

			const finish = (result: SubagentRunResult) => {
				if (settled) return;
				settled = true;
				resolve(result);
			};

			const killChild = () => {
				child.kill("SIGTERM");
				setTimeout(() => {
					if (!child.killed) child.kill("SIGKILL");
				}, 5000);
			};

			if (signal) {
				if (signal.aborted) {
					killChild();
				} else {
					signal.addEventListener("abort", killChild, { once: true });
				}
			}

			parseJsonLines(child.stdout, (line) => {
				if (!line.trim()) return;
				let event: unknown;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				if (typeof event !== "object" || event === null) return;
				const typedEvent = event as { type?: string; message?: Message };
				if ((typedEvent.type === "message_end" || typedEvent.type === "tool_result_end") && typedEvent.message) {
					onMessage(typedEvent.message);
				}
			});

			child.stderr.on("data", (data) => {
				stderr += data.toString();
			});

			child.on("error", (error) => {
				launchError = error.message;
			});

			child.on("close", (code) => {
				if (signal) {
					signal.removeEventListener("abort", killChild);
				}
				finish({
					exitCode: code ?? 1,
					stderr: trimOutput(stderr),
					launchError,
				});
			});
		});
}

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

function formatDiscoveryError(error: AgentDiscoveryError): string {
	return `Agent discovery failed at ${error.path}: ${error.reason}`;
}

function getUnknownAgentDiagnostic(agentName: string, agents: AgentConfig[]): string {
	const available = agents.map((agent) => `"${agent.name}" (${agent.source})`).join(", ") || "none";
	return `Unknown agent: "${agentName}". Available agents: ${available}.`;
}

function getFailureDiagnostic(result: SingleResult): string {
	if (result.diagnosticMessage) {
		return result.diagnosticMessage;
	}
	if (result.errorMessage) {
		return result.errorMessage;
	}
	if (result.stderr.trim().length > 0) {
		return result.stderr.trim();
	}
	const output = extractFinalOutput(result.messages);
	if (output.text.length > 0) {
		return output.text;
	}
	return output.reason ? `Empty output: ${output.reason}` : "Empty output from child session.";
}

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

async function runSingleAgent(
	defaultCwd: string,
	agents: AgentConfig[],
	discoveryErrors: AgentDiscoveryError[],
	agentName: string,
	task: string,
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
	runSubagent: SubagentRunner,
): Promise<SingleResult> {
	const agent = agents.find((candidate) => candidate.name === agentName);

	if (!agent) {
		const discoveryError = findDiscoveryErrorForAgent(discoveryErrors, agentName);
		return {
			agent: agentName,
			agentSource: discoveryError?.source ?? "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: "",
			usage: createEmptyUsageStats(),
			step,
			failureStage: discoveryError ? "discovery" : "lookup",
			diagnosticMessage: discoveryError
				? formatDiscoveryError(discoveryError)
				: getUnknownAgentDiagnostic(agentName, agents),
		};
	}

	const currentResult: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: createEmptyUsageStats(),
		model: agent.model,
		step,
	};

	const emitUpdate = () => {
		if (!onUpdate) return;
		const output = extractFinalOutput(currentResult.messages);
		onUpdate({
			content: [{ type: "text", text: output.text || "(running...)" }],
			details: makeDetails([currentResult]),
		});
	};

	let tempPromptDir: string | null = null;
	let tempPromptPath: string | null = null;

	try {
		const invocation = buildSubagentInvocation(defaultCwd, agent, task, cwd);
		currentResult.invocation = invocation;

		if (agent.systemPrompt.trim().length > 0) {
			const tempPrompt = writePromptToTempFile(agent.name, agent.systemPrompt);
			tempPromptDir = tempPrompt.dir;
			tempPromptPath = tempPrompt.filePath;
			invocation.args.splice(invocation.args.length - 1, 0, "--append-system-prompt", tempPrompt.filePath);
			invocation.displayCommand = [invocation.command, ...invocation.args].join(" ");
		}

		const runResult = await runSubagent({
			invocation,
			agent,
			signal,
			onMessage: (message) => {
				currentResult.messages.push(message);
				applyAssistantUsage(currentResult, message);
				emitUpdate();
			},
		});

		currentResult.exitCode = runResult.exitCode;
		currentResult.stderr = runResult.stderr;

		if (runResult.launchError) {
			currentResult.failureStage = "launch";
			currentResult.diagnosticMessage = `Failed to launch child process: ${runResult.launchError}. Command: ${invocation.displayCommand}`;
		}

		if (currentResult.stopReason === "error" || currentResult.errorMessage) {
			currentResult.failureStage = "provider";
			if (!currentResult.diagnosticMessage) {
				currentResult.diagnosticMessage = currentResult.errorMessage;
			}
		}

		const output = extractFinalOutput(currentResult.messages);
		if (!currentResult.failureStage && output.text.length === 0) {
			currentResult.failureStage = "result";
			currentResult.diagnosticMessage = `Final assistant output was empty: ${output.reason ?? "unknown reason"}.`;
		}

		return currentResult;
	} finally {
		if (tempPromptPath) {
			try {
				fs.unlinkSync(tempPromptPath);
			} catch {
				/* ignore */
			}
		}
		if (tempPromptDir) {
			try {
				fs.rmdirSync(tempPromptDir);
			} catch {
				/* ignore */
			}
		}
	}
}

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
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
});

function createDetailsFactory(
	mode: "single" | "parallel" | "chain",
	agentScope: AgentScope,
	projectAgentsDir: string | null,
	discoveryErrors: AgentDiscoveryError[],
): (results: SingleResult[]) => SubagentDetails {
	return (results) => ({
		mode,
		agentScope,
		projectAgentsDir,
		discoveryErrors,
		results,
	});
}

function hasToolErrorFlag(result: AgentToolResult<SubagentDetails>): boolean {
	return (result as AgentToolResult<SubagentDetails> & { isError?: boolean }).isError === true;
}

export function createSubagentTool(options?: {
	runSubagent?: SubagentRunner;
}): ToolDefinition<typeof SubagentParams, SubagentDetails> {
	const runSubagent = options?.runSubagent ?? createDefaultSubagentRunner();

	return {
		name: "subagent",
		label: "Subagent",
		description: [
			"Delegate tasks to specialized subagents with isolated context.",
			"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
			'Default agent scope is "user" (from ~/.jensen/agent/agents).',
			'To enable project-local agents in .jensen/agents, set agentScope: "both" (or "project").',
		].join(" "),
		parameters: SubagentParams,

		async execute(
			_toolCallId: string,
			params: SubagentParamsType,
			signal: AbortSignal | undefined,
			onUpdate: OnUpdateCallback | undefined,
			ctx: ExtensionContext,
		) {
			const agentScope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(ctx.cwd, agentScope);
			const agents = discovery.agents;
			const confirmProjectAgents = params.confirmProjectAgents ?? true;

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

			if (modeCount !== 1) {
				const available = agents.map((agent) => `${agent.name} (${agent.source})`).join(", ") || "none";
				return {
					content: textContent(`Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`),
					details: createDetailsFactory("single", agentScope, discovery.projectAgentsDir, discovery.errors)([]),
				};
			}

			if ((agentScope === "project" || agentScope === "both") && confirmProjectAgents && ctx.hasUI) {
				const requestedAgentNames = new Set<string>();
				if (params.chain) for (const step of params.chain) requestedAgentNames.add(step.agent);
				if (params.tasks) for (const task of params.tasks) requestedAgentNames.add(task.agent);
				if (params.agent) requestedAgentNames.add(params.agent);

				const projectAgentsRequested = Array.from(requestedAgentNames)
					.map((name) => agents.find((candidate) => candidate.name === name))
					.filter((candidate): candidate is AgentConfig => candidate?.source === "project");

				if (projectAgentsRequested.length > 0) {
					const names = projectAgentsRequested.map((agent) => agent.name).join(", ");
					const dir = discovery.projectAgentsDir ?? "(unknown)";
					const approved = await ctx.ui.confirm(
						"Run project-local agents?",
						`Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
					);
					if (!approved) {
						return {
							content: textContent("Canceled: project-local agents not approved."),
							details: createDetailsFactory(
								hasChain ? "chain" : hasTasks ? "parallel" : "single",
								agentScope,
								discovery.projectAgentsDir,
								discovery.errors,
							)([]),
						};
					}
				}
			}

			if (params.chain && params.chain.length > 0) {
				const makeDetails = createDetailsFactory("chain", agentScope, discovery.projectAgentsDir, discovery.errors);
				const results: SingleResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const taskWithContext = step.task.replace(/\{previous\}/gu, previousOutput);
					const chainUpdate: OnUpdateCallback | undefined = onUpdate
						? (partial) => {
								const currentResult = partial.details?.results[0];
								if (currentResult) {
									onUpdate({ content: partial.content, details: makeDetails([...results, currentResult]) });
								}
							}
						: undefined;
					const result = await runSingleAgent(
						ctx.cwd,
						agents,
						discovery.errors,
						step.agent,
						taskWithContext,
						step.cwd,
						i + 1,
						signal,
						chainUpdate,
						makeDetails,
						runSubagent,
					);
					results.push(result);

					if (
						result.exitCode !== 0 ||
						result.stopReason === "error" ||
						result.stopReason === "aborted" ||
						result.failureStage
					) {
						return {
							content: textContent(
								`Chain stopped at step ${i + 1} (${step.agent}): ${getFailureDiagnostic(result)}`,
							),
							details: makeDetails(results),
							isError: true,
						};
					}
					previousOutput = extractFinalOutput(result.messages).text;
				}

				return {
					content: textContent(extractFinalOutput(results[results.length - 1].messages).text),
					details: makeDetails(results),
				};
			}

			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > MAX_PARALLEL_TASKS) {
					return {
						content: textContent(
							`Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
						),
						details: createDetailsFactory(
							"parallel",
							agentScope,
							discovery.projectAgentsDir,
							discovery.errors,
						)([]),
					};
				}

				const makeDetails = createDetailsFactory(
					"parallel",
					agentScope,
					discovery.projectAgentsDir,
					discovery.errors,
				);
				const allResults: SingleResult[] = params.tasks.map((task) => ({
					agent: task.agent,
					agentSource: "unknown",
					task: task.task,
					exitCode: -1,
					messages: [],
					stderr: "",
					usage: createEmptyUsageStats(),
				}));

				const emitParallelUpdate = () => {
					if (!onUpdate) return;
					const running = allResults.filter((result) => result.exitCode === -1).length;
					const done = allResults.length - running;
					onUpdate({
						content: textContent(`Parallel: ${done}/${allResults.length} done, ${running} running...`),
						details: makeDetails([...allResults]),
					});
				};

				const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (task, index) => {
					const result = await runSingleAgent(
						ctx.cwd,
						agents,
						discovery.errors,
						task.agent,
						task.task,
						task.cwd,
						undefined,
						signal,
						(partial) => {
							const currentResult = partial.details?.results[0];
							if (currentResult) {
								allResults[index] = currentResult;
								emitParallelUpdate();
							}
						},
						makeDetails,
						runSubagent,
					);
					allResults[index] = result;
					emitParallelUpdate();
					return result;
				});

				const successCount = results.filter((result) => result.exitCode === 0 && !result.failureStage).length;
				const summaries = results.map((result) => {
					const output = extractFinalOutput(result.messages).text;
					const previewSource = output || getFailureDiagnostic(result);
					const preview = previewSource.slice(0, 100) + (previewSource.length > 100 ? "..." : "");
					return `[${result.agent}] ${result.exitCode === 0 && !result.failureStage ? "completed" : "failed"}: ${preview}`;
				});
				return {
					content: textContent(
						`Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}`,
					),
					details: makeDetails(results),
				};
			}

			if (params.agent && params.task) {
				const makeDetails = createDetailsFactory(
					"single",
					agentScope,
					discovery.projectAgentsDir,
					discovery.errors,
				);
				const result = await runSingleAgent(
					ctx.cwd,
					agents,
					discovery.errors,
					params.agent,
					params.task,
					params.cwd,
					undefined,
					signal,
					onUpdate,
					makeDetails,
					runSubagent,
				);
				if (
					result.exitCode !== 0 ||
					result.stopReason === "error" ||
					result.stopReason === "aborted" ||
					result.failureStage
				) {
					return {
						content: textContent(getFailureDiagnostic(result)),
						details: makeDetails([result]),
						isError: true,
					};
				}
				return {
					content: textContent(extractFinalOutput(result.messages).text),
					details: makeDetails([result]),
				};
			}

			const available = agents.map((agent) => `${agent.name} (${agent.source})`).join(", ") || "none";
			return {
				content: textContent(`Invalid parameters. Available agents: ${available}`),
				details: createDetailsFactory("single", agentScope, discovery.projectAgentsDir, discovery.errors)([]),
			};
		},

		renderCall(args: SubagentParamsType, theme: Theme) {
			const scope: AgentScope = args.agentScope ?? "user";
			if (args.chain && args.chain.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `chain (${args.chain.length} steps)`) +
					theme.fg("muted", ` [${scope}]`);
				for (let i = 0; i < Math.min(args.chain.length, 3); i++) {
					const step = args.chain[i];
					const cleanTask = step.task.replace(/\{previous\}/gu, "").trim();
					const preview = cleanTask.length > 40 ? `${cleanTask.slice(0, 40)}...` : cleanTask;
					text += `\n  ${theme.fg("muted", `${i + 1}.`)} ${theme.fg("accent", step.agent)}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.chain.length > 3) text += `\n  ${theme.fg("muted", `... +${args.chain.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}
			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [${scope}]`);
				for (const task of args.tasks.slice(0, 3)) {
					const preview = task.task.length > 40 ? `${task.task.slice(0, 40)}...` : task.task;
					text += `\n  ${theme.fg("accent", task.agent)}${theme.fg("dim", ` ${preview}`)}`;
				}
				if (args.tasks.length > 3) text += `\n  ${theme.fg("muted", `... +${args.tasks.length - 3} more`)}`;
				return new Text(text, 0, 0);
			}

			const agentName = args.agent || "...";
			const preview = args.task ? (args.task.length > 60 ? `${args.task.slice(0, 60)}...` : args.task) : "...";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("subagent "))}${theme.fg("accent", agentName)}${theme.fg("muted", ` [${scope}]`)}\n  ${theme.fg("dim", preview)}`,
				0,
				0,
			);
		},

		renderResult(result: AgentToolResult<SubagentDetails>, { expanded }: ToolRenderResultOptions, theme: Theme) {
			const details = result.details as SubagentDetails | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();
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

			if (details.mode === "single" && details.results.length === 1) {
				const single = details.results[0];
				const isError = hasToolErrorFlag(result) || single.exitCode !== 0 || !!single.failureStage;
				const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
				const displayItems = getDisplayItems(single.messages);
				const finalOutput = extractFinalOutput(single.messages).text;

				if (expanded) {
					const container = new Container();
					let header = `${icon} ${theme.fg("toolTitle", theme.bold(single.agent))}${theme.fg("muted", ` (${single.agentSource})`)}`;
					if (single.failureStage) header += ` ${theme.fg("error", `[${single.failureStage}]`)}`;
					container.addChild(new Text(header, 0, 0));
					if (single.diagnosticMessage) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("error", single.diagnosticMessage), 0, 0));
					}
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Task ───"), 0, 0));
					container.addChild(new Text(theme.fg("dim", single.task), 0, 0));
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("muted", "─── Output ───"), 0, 0));
					if (displayItems.length === 0 && !finalOutput) {
						container.addChild(new Text(theme.fg("muted", "(no assistant output)"), 0, 0));
					} else {
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
							container.addChild(new Markdown(finalOutput, 0, 0, mdTheme));
						}
					}
					const usageText = formatUsageStats(single.usage, single.model);
					if (usageText) {
						container.addChild(new Spacer(1));
						container.addChild(new Text(theme.fg("dim", usageText), 0, 0));
					}
					return container;
				}

				let text = `${icon} ${theme.fg("toolTitle", theme.bold(single.agent))}${theme.fg("muted", ` (${single.agentSource})`)}`;
				if (single.failureStage) text += ` ${theme.fg("error", `[${single.failureStage}]`)}`;
				if (single.diagnosticMessage) {
					text += `\n${theme.fg("error", single.diagnosticMessage)}`;
				} else if (displayItems.length === 0) {
					text += `\n${theme.fg("muted", "(no assistant output)")}`;
				} else {
					text += `\n${renderDisplayItems(displayItems, COLLAPSED_ITEM_COUNT)}`;
				}
				const usageText = formatUsageStats(single.usage, single.model);
				if (usageText) text += `\n${theme.fg("dim", usageText)}`;
				return new Text(text, 0, 0);
			}

			const aggregateUsage = (results: SingleResult[]) => {
				const total = createEmptyUsageStats();
				for (const single of results) {
					total.input += single.usage.input;
					total.output += single.usage.output;
					total.cacheRead += single.usage.cacheRead;
					total.cacheWrite += single.usage.cacheWrite;
					total.cost += single.usage.cost;
					total.turns += single.usage.turns;
				}
				return total;
			};

			if (details.mode === "chain") {
				const successCount = details.results.filter(
					(single) => single.exitCode === 0 && !single.failureStage,
				).length;
				const icon = successCount === details.results.length ? theme.fg("success", "✓") : theme.fg("error", "✗");
				let text = `${icon} ${theme.fg("toolTitle", theme.bold("chain "))}${theme.fg("accent", `${successCount}/${details.results.length} steps`)}`;
				for (const single of details.results) {
					const stepIcon =
						single.exitCode === 0 && !single.failureStage ? theme.fg("success", "✓") : theme.fg("error", "✗");
					text += `\n\n${theme.fg("muted", `─── Step ${single.step}: `)}${theme.fg("accent", single.agent)} ${stepIcon}`;
					if (single.diagnosticMessage) {
						text += `\n${theme.fg("error", single.diagnosticMessage)}`;
						continue;
					}
					const displayItems = getDisplayItems(single.messages);
					text += `\n${displayItems.length > 0 ? renderDisplayItems(displayItems, 5) : theme.fg("muted", "(no assistant output)")}`;
				}
				const usageText = formatUsageStats(aggregateUsage(details.results));
				if (usageText) text += `\n\n${theme.fg("dim", `Total: ${usageText}`)}`;
				if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
				return new Text(text, 0, 0);
			}

			const running = details.results.filter((single) => single.exitCode === -1).length;
			const successCount = details.results.filter((single) => single.exitCode === 0 && !single.failureStage).length;
			const failCount = details.results.filter((single) => single.exitCode > 0 || single.failureStage).length;
			const isRunning = running > 0;
			const icon = isRunning
				? theme.fg("warning", "⏳")
				: failCount > 0
					? theme.fg("warning", "◐")
					: theme.fg("success", "✓");
			const status = isRunning
				? `${successCount + failCount}/${details.results.length} done, ${running} running`
				: `${successCount}/${details.results.length} tasks`;
			let text = `${icon} ${theme.fg("toolTitle", theme.bold("parallel "))}${theme.fg("accent", status)}`;
			for (const single of details.results) {
				const stepIcon =
					single.exitCode === -1
						? theme.fg("warning", "⏳")
						: single.exitCode === 0 && !single.failureStage
							? theme.fg("success", "✓")
							: theme.fg("error", "✗");
				text += `\n\n${theme.fg("muted", "─── ")}${theme.fg("accent", single.agent)} ${stepIcon}`;
				if (single.diagnosticMessage) {
					text += `\n${theme.fg("error", single.diagnosticMessage)}`;
					continue;
				}
				const displayItems = getDisplayItems(single.messages);
				text += `\n${displayItems.length > 0 ? renderDisplayItems(displayItems, 5) : theme.fg("muted", isRunning ? "(running...)" : "(no assistant output)")}`;
			}
			if (!isRunning) {
				const usageText = formatUsageStats(aggregateUsage(details.results));
				if (usageText) text += `\n\n${theme.fg("dim", `Total: ${usageText}`)}`;
			}
			if (!expanded) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
			return new Text(text, 0, 0);
		},
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerTool(createSubagentTool());
}
