/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Discovers agent definitions from:
 *   - ~/.pi/agent/agents/*.md (user-level)
 *   - .pi/agents/*.md (project-level, opt-in via agentScope)
 *
 * Agent files use markdown with YAML frontmatter:
 *
 *   ---
 *   name: scout
 *   description: Fast codebase recon
 *   tools: read, grep, find, ls, bash
 *   model: claude-haiku-4-5
 *   ---
 *
 *   You are a scout. Quickly investigate and return findings.
 *
 * The tool spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window. Project agents can be enabled explicitly,
 * and will override user agents with the same name when agentScope="both".
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Chain mode runs steps sequentially. Use {previous} in task to reference
 * the previous step's output.
 *
 * Limitations:
 *   - No timeout/cancellation (pi.exec limitation)
 *   - Output is truncated for UI/context size (pi.exec still buffers full output today)
 *   - Agents reloaded on each invocation (edit agents mid-session)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import type { CustomAgentTool, CustomToolFactory, ToolAPI } from "@mariozechner/pi-coding-agent";

const MAX_OUTPUT_LINES = 500;
const MAX_OUTPUT_BYTES = 50_000;
const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const MAX_AGENTS_IN_DESCRIPTION = 10;

type AgentScope = "user" | "project" | "both";

interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

interface SingleResult {
	agent: string;
	agentSource: "user" | "project" | "unknown";
	task: string;
	exitCode: number;
	stdout: string;
	stderr: string;
	truncated: boolean;
	step?: number;
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	agentScope: AgentScope;
	projectAgentsDir: string | null;
	results: SingleResult[];
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
	const frontmatter: Record<string, string> = {};
	const normalized = content.replace(/\r\n/g, "\n");

	if (!normalized.startsWith("---")) {
		return { frontmatter, body: normalized };
	}

	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) {
		return { frontmatter, body: normalized };
	}

	const frontmatterBlock = normalized.slice(4, endIndex);
	const body = normalized.slice(endIndex + 4).trim();

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

	return { frontmatter, body };
}

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter(content);

		if (!frontmatter.name || !frontmatter.description) {
			continue;
		}

		const tools = frontmatter.tools
			?.split(",")
			.map((t) => t.trim())
			.filter(Boolean);

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: tools && tools.length > 0 ? tools : undefined,
			model: frontmatter.model,
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, ".pi", "agents");
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

function discoverAgents(cwd: string, scope: AgentScope): { agents: AgentConfig[]; projectAgentsDir: string | null } {
	const userDir = path.join(os.homedir(), ".pi", "agent", "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
	const projectAgents =
		scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

	const agentMap = new Map<string, AgentConfig>();

	if (scope === "both") {
		// Explicit opt-in: project agents override user agents with the same name.
		for (const agent of userAgents) agentMap.set(agent.name, agent);
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	} else if (scope === "user") {
		for (const agent of userAgents) agentMap.set(agent.name, agent);
	} else {
		for (const agent of projectAgents) agentMap.set(agent.name, agent);
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

function truncateOutput(output: string): { text: string; truncated: boolean } {
	let truncated = false;
	let byteBudget = MAX_OUTPUT_BYTES;
	let lineBudget = MAX_OUTPUT_LINES;

	// Note: This truncation is for UI/context size. The underlying pi.exec() currently buffers
	// full stdout/stderr in memory before we see it here.

	let i = 0;
	let lastNewlineIndex = -1;
	while (i < output.length && byteBudget > 0) {
		const ch = output.charCodeAt(i);

		// Approximate bytes by UTF-16 code units; MAX_OUTPUT_BYTES is a practical guardrail, not exact bytes.
		byteBudget--;

		if (ch === 10 /* \n */) {
			lineBudget--;
			lastNewlineIndex = i;
			if (lineBudget <= 0) {
				truncated = true;
				break;
			}
		}

		i++;
	}

	if (i < output.length) {
		truncated = true;
	}

	// Prefer cutting at a newline boundary if we hit the line cap, to keep previews readable.
	if (truncated && lineBudget <= 0 && lastNewlineIndex >= 0) {
		output = output.slice(0, lastNewlineIndex);
	} else {
		output = output.slice(0, i);
	}

	return { text: output, truncated };
}

function previewFirstLines(text: string, maxLines: number): string {
	if (maxLines <= 0) return "";
	let linesRemaining = maxLines;
	let i = 0;
	while (i < text.length) {
		const nextNewline = text.indexOf("\n", i);
		if (nextNewline === -1) return text;
		linesRemaining--;
		if (linesRemaining <= 0) return text.slice(0, nextNewline);
		i = nextNewline + 1;
	}
	return text;
}

function firstLine(text: string): string {
	const idx = text.indexOf("\n");
	return idx === -1 ? text : text.slice(0, idx);
}

function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>
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

function writePromptToTempFile(agentName: string, prompt: string): { dir: string; filePath: string } {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
	const safeName = agentName.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	fs.writeFileSync(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	return { dir: tmpDir, filePath };
}

async function runSingleAgent(
	pi: ToolAPI,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	step?: number
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);

	if (!agent) {
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			stdout: "",
			stderr: `Unknown agent: ${agentName}`,
			truncated: false,
			step,
		};
	}

	const args: string[] = ["-p", "--no-session"];

	if (agent.model) {
		args.push("--model", agent.model);
	}

	if (agent.tools && agent.tools.length > 0) {
		args.push("--tools", agent.tools.join(","));
	}

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;
	try {
		if (agent.systemPrompt.trim()) {
			// IMPORTANT: Never pass raw prompt text to --append-system-prompt.
			// pi treats this flag as "path or literal", and will read the file contents if the string
			// happens to match an existing path. Writing to a temp file prevents unintended file exfiltration.
			const tmp = writePromptToTempFile(agent.name, agent.systemPrompt);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		// Prefixing prevents accidental CLI flag parsing if the task starts with '-'.
		args.push(`Task: ${task}`);

		const result = await pi.exec("pi", args);

		const stdoutResult = truncateOutput(result.stdout);
		const stderrResult = truncateOutput(result.stderr);

		return {
			agent: agentName,
			agentSource: agent.source,
			task,
			exitCode: result.code,
			stdout: stdoutResult.text,
			stderr: stderrResult.text,
			truncated: stdoutResult.truncated || stderrResult.truncated,
			step,
		};
	} finally {
		if (tmpPromptPath) {
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				// ignore
			}
		}
		if (tmpPromptDir) {
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
				// ignore
			}
		}
	}
}

const TaskItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task to delegate to the agent" }),
});

const ChainItem = Type.Object({
	agent: Type.String({ description: "Name of the agent to invoke" }),
	task: Type.String({ description: "Task with optional {previous} placeholder for prior output" }),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description:
		'Which agent directories are eligible. Default: "user". Use "both" to enable project-local agents from .pi/agents.',
	default: "user",
});

const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution. Use {previous} in task to reference prior output" })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({
			description:
				"Interactive-only safety prompt when running project-local agents (.pi/agents). Ignored in headless modes. Default: true.",
			default: true,
		}),
	),
});

const factory: CustomToolFactory = (pi) => {
	const tool: CustomAgentTool<typeof SubagentParams, SubagentDetails> = {
		name: "subagent",
		label: "Subagent",
		get description() {
			const user = discoverAgents(pi.cwd, "user");
			const project = discoverAgents(pi.cwd, "project");

			const userList = formatAgentList(user.agents, MAX_AGENTS_IN_DESCRIPTION);
			const projectList = formatAgentList(project.agents, MAX_AGENTS_IN_DESCRIPTION);

			const userSuffix = userList.remaining > 0 ? `; ... and ${userList.remaining} more` : "";
			const projectSuffix = projectList.remaining > 0 ? `; ... and ${projectList.remaining} more` : "";

			const projectDirNote = project.projectAgentsDir ? ` (from ${project.projectAgentsDir})` : "";

			return [
				"Delegate tasks to specialized subagents with isolated context.",
				"Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
				'Default agent scope is "user" (from ~/.pi/agent/agents).',
				'To enable project-local agents in .pi/agents, set agentScope: "both" (or "project").',
				`User agents: ${userList.text}${userSuffix}.`,
				`Project agents${projectDirNote}: ${projectList.text}${projectSuffix}.`,
			].join(" ");
		},
		parameters: SubagentParams,

		async execute(_toolCallId, params) {
			const agentScope: AgentScope = params.agentScope ?? "user";
			const discovery = discoverAgents(pi.cwd, agentScope);
			const agents = discovery.agents;
			const confirmProjectAgents = params.confirmProjectAgents ?? true;

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

			if (modeCount !== 1) {
				const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
				return {
					content: [
						{
							type: "text",
							text:
								"Invalid parameters. Provide exactly one mode:\n" +
								"- { agent, task } for single\n" +
								"- { tasks: [...] } for parallel\n" +
								"- { chain: [...] } for sequential\n\n" +
								`agentScope: ${agentScope}\n` +
								`Available agents: ${available}`,
						},
					],
					details: { mode: "single", agentScope, projectAgentsDir: discovery.projectAgentsDir, results: [] },
				};
			}

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
					const dir = discovery.projectAgentsDir ?? "(unknown .pi/agents)";
					const ok = await pi.ui.confirm(
						"Run project-local agents?",
						`About to run project agent(s): ${names}\n\nSource directory:\n${dir}\n\nProject agents are repo-controlled prompts. Only continue for repositories you trust.\n\nContinue?`,
					);
					if (!ok) {
						return {
							content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
							details: { mode: hasChain ? "chain" : hasTasks ? "parallel" : "single", agentScope, projectAgentsDir: discovery.projectAgentsDir, results: [] },
						};
					}
				}
			}

			if (params.chain && params.chain.length > 0) {
				const results: SingleResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);

					const result = await runSingleAgent(pi, agents, step.agent, taskWithContext, i + 1);
					results.push(result);

					if (result.exitCode !== 0) {
						const output = result.stdout.trim() || result.stderr.trim() || "(no output)";
						const preview = previewFirstLines(output, 15);
						const summaries = results.map((r) => {
							const status = r.exitCode === 0 ? "completed" : `failed (exit ${r.exitCode})`;
							return `Step ${r.step}: [${r.agent}] ${status}`;
						});
						return {
							content: [
								{
									type: "text",
									text:
										`Chain stopped at step ${i + 1} (${step.agent} failed)\n\n` +
										`${summaries.join("\n")}\n\n` +
										`Failed step output (preview):\n${preview}`,
								},
							],
							details: { mode: "chain", agentScope, projectAgentsDir: discovery.projectAgentsDir, results },
						};
					}

					previousOutput = result.stdout.trim() || result.stderr.trim();
				}

				const finalResult = results[results.length - 1];
				const output = finalResult.stdout.trim() || finalResult.stderr.trim() || "(no output)";
				const summaries = results.map((r) => `Step ${r.step}: [${r.agent}] completed`);

				return {
					content: [{ type: "text", text: `Chain completed (${results.length} steps)\n\n${summaries.join("\n")}\n\nFinal output:\n${output}` }],
					details: { mode: "chain", agentScope, projectAgentsDir: discovery.projectAgentsDir, results },
				};
			}

			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > MAX_PARALLEL_TASKS) {
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}. Split into multiple calls or use chain mode.`,
							},
						],
						details: { mode: "parallel", agentScope, projectAgentsDir: discovery.projectAgentsDir, results: [] },
					};
				}

				const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, (t) =>
					runSingleAgent(pi, agents, t.agent, t.task)
				);

				const successCount = results.filter((r) => r.exitCode === 0).length;
				const summaries = results.map((r) => {
					const status = r.exitCode === 0 ? "completed" : `failed (exit ${r.exitCode})`;
					const output = r.stdout.trim() || r.stderr.trim() || "(no output)";
					const preview = previewFirstLines(output, 5);
					return `[${r.agent}] ${status}\n${preview}`;
				});

				return {
					content: [{ type: "text", text: `Parallel execution: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}` }],
					details: { mode: "parallel", agentScope, projectAgentsDir: discovery.projectAgentsDir, results },
				};
			}

			if (params.agent && params.task) {
				const result = await runSingleAgent(pi, agents, params.agent, params.task);

				const success = result.exitCode === 0;
				const output = result.stdout.trim() || result.stderr.trim() || "(no output)";
				const truncatedNote = result.truncated ? " [output truncated]" : "";

				return {
					content: [{ type: "text", text: success ? output + truncatedNote : `Agent failed (exit ${result.exitCode}): ${output}${truncatedNote}` }],
					details: { mode: "single", agentScope, projectAgentsDir: discovery.projectAgentsDir, results: [result] },
				};
			}

			const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
			return {
				content: [{ type: "text", text: `Invalid parameters. Use: {agent, task} for single, {tasks: [...]} for parallel, or {chain: [...]} for sequential. Available agents: ${available}` }],
				details: { mode: "single", agentScope, projectAgentsDir: discovery.projectAgentsDir, results: [] },
			};
		},

		renderCall(args, theme) {
			const agents = discoverAgents(pi.cwd, "both").agents;
			const scope: AgentScope = args.agentScope ?? "user";

			if (args.chain && args.chain.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `chain (${args.chain.length} steps)`) +
					theme.fg("muted", ` [scope: ${scope}]`);
				for (let i = 0; i < Math.min(args.chain.length, 5); i++) {
					const step = args.chain[i];
					const agent = agents.find((a) => a.name === step.agent);
					const sourceTag = agent ? theme.fg("muted", ` (${agent.source})`) : "";
					const taskPreview = step.task.length > 35 ? step.task.slice(0, 35) + "..." : step.task;
					text += "\n" + theme.fg("dim", `  ${i + 1}. ${step.agent}${sourceTag}: ${taskPreview}`);
				}
				if (args.chain.length > 5) {
					text += "\n" + theme.fg("muted", `  ... and ${args.chain.length - 5} more steps`);
				}
				return new Text(text, 0, 0);
			}

			if (args.tasks && args.tasks.length > 0) {
				let text =
					theme.fg("toolTitle", theme.bold("subagent ")) +
					theme.fg("accent", `parallel (${args.tasks.length} tasks)`) +
					theme.fg("muted", ` [scope: ${scope}]`);
				for (const t of args.tasks.slice(0, 5)) {
					const agent = agents.find((a) => a.name === t.agent);
					const sourceTag = agent ? theme.fg("muted", ` (${agent.source})`) : "";
					const taskPreview = t.task.length > 40 ? t.task.slice(0, 40) + "..." : t.task;
					text += "\n" + theme.fg("dim", `  ${t.agent}${sourceTag}: ${taskPreview}`);
				}
				if (args.tasks.length > 5) {
					text += "\n" + theme.fg("muted", `  ... and ${args.tasks.length - 5} more`);
				}
				return new Text(text, 0, 0);
			}

			if (args.agent && args.task) {
				const agent = agents.find((a) => a.name === args.agent);
				const sourceTag = agent ? theme.fg("muted", ` (${agent.source})`) : "";
				const agentLabel = agent ? theme.fg("accent", args.agent) + sourceTag : theme.fg("error", args.agent);

				let text = theme.fg("toolTitle", theme.bold("subagent ")) + agentLabel + theme.fg("muted", ` [scope: ${scope}]`);
				const taskPreview = args.task.length > 60 ? args.task.slice(0, 60) + "..." : args.task;
				text += "\n" + theme.fg("dim", `  ${taskPreview}`);
				return new Text(text, 0, 0);
			}

			return new Text(theme.fg("error", "subagent: invalid parameters"), 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const { details } = result;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			if (details.mode === "chain") {
				const successCount = details.results.filter((r) => r.exitCode === 0).length;
				const totalCount = details.results.length;
				const allSuccess = successCount === totalCount;
				const icon = allSuccess ? theme.fg("success", "✓") : theme.fg("error", "✗");

				let text =
					icon +
					" " +
					theme.fg("accent", `chain ${successCount}/${totalCount}`) +
					theme.fg("muted", " steps completed") +
					theme.fg("muted", ` (scope: ${details.agentScope})`);

				if (expanded) {
					for (const r of details.results) {
						const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
						const truncTag = r.truncated ? theme.fg("warning", " [truncated]") : "";
						const sourceTag = theme.fg("muted", ` (${r.agentSource})`);
						text += "\n\n" + theme.fg("muted", `Step ${r.step}: `) + rIcon + " " + theme.fg("accent", r.agent) + sourceTag + truncTag;
						const output = r.stdout.trim() || r.stderr.trim();
						if (output) {
							text += "\n" + theme.fg("dim", output);
						}
					}
				} else {
					for (const r of details.results) {
						const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
						const output = r.stdout.trim() || r.stderr.trim();
						const preview = (firstLine(output) || "(no output)").slice(0, 50);
						text +=
							"\n" +
							theme.fg("muted", `${r.step}. `) +
							rIcon +
							" " +
							theme.fg("accent", r.agent) +
							theme.fg("muted", ` (${r.agentSource})`) +
							": " +
							theme.fg("dim", preview);
					}
					if (details.results.some((r) => (r.stdout + r.stderr).includes("\n"))) {
						text += "\n" + theme.fg("muted", "  (Ctrl+O to expand)");
					}
				}

				return new Text(text, 0, 0);
			}

			if (details.mode === "parallel") {
				const successCount = details.results.filter((r) => r.exitCode === 0).length;
				const totalCount = details.results.length;
				const allSuccess = successCount === totalCount;
				const icon = allSuccess ? theme.fg("success", "✓") : theme.fg("warning", "◐");

				let text =
					icon +
					" " +
					theme.fg("accent", `${successCount}/${totalCount}`) +
					theme.fg("muted", " tasks completed") +
					theme.fg("muted", ` (scope: ${details.agentScope})`);

				if (expanded) {
					for (const r of details.results) {
						const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
						const truncTag = r.truncated ? theme.fg("warning", " [truncated]") : "";
						text += "\n\n" + rIcon + " " + theme.fg("accent", r.agent) + theme.fg("muted", ` (${r.agentSource})`) + truncTag;
						const output = r.stdout.trim() || r.stderr.trim();
						if (output) {
							text += "\n" + theme.fg("dim", output);
						}
					}
				} else {
					for (const r of details.results.slice(0, 3)) {
						const rIcon = r.exitCode === 0 ? theme.fg("success", "✓") : theme.fg("error", "✗");
						const output = r.stdout.trim() || r.stderr.trim();
						const preview = (firstLine(output) || "(no output)").slice(0, 60);
						text += "\n" + rIcon + " " + theme.fg("accent", r.agent) + ": " + theme.fg("dim", preview);
					}
					if (details.results.length > 3) {
						text += "\n" + theme.fg("muted", `  ... ${details.results.length - 3} more (Ctrl+O to expand)`);
					}
				}

				return new Text(text, 0, 0);
			}

			const r = details.results[0];
			const success = r.exitCode === 0;
			const icon = success ? theme.fg("success", "✓") : theme.fg("error", "✗");
			const status = success ? "completed" : `failed (exit ${r.exitCode})`;
			const sourceTag = theme.fg("muted", ` (${r.agentSource})`);
			const truncatedTag = r.truncated ? theme.fg("warning", " [truncated]") : "";

			let text = icon + " " + theme.fg("accent", r.agent) + sourceTag + " " + theme.fg("muted", status) + truncatedTag;

			const output = r.stdout.trim() || r.stderr.trim();
			if (output) {
				if (expanded) {
					text += "\n" + theme.fg("dim", output);
				} else {
					const preview = previewFirstLines(output, 3);
					const hasMore = preview.length < output.length;
					text += "\n" + theme.fg("dim", preview);
					if (hasMore) {
						text += "\n" + theme.fg("muted", "  ... (Ctrl+O to expand)");
					}
				}
			}

			return new Text(text, 0, 0);
		},
	};

	return tool;
};

export default factory;
