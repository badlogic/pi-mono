/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... @pi:previous ..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";

import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Message } from "@mariozechner/pi-ai";
import { StringEnum } from "@mariozechner/pi-ai";
import type { CustomAgentTool, CustomToolFactory, ToolAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { type AgentConfig, type AgentScope, discoverAgents, formatAgentList } from "./agents.js";
import { getFinalOutput, renderCall, renderResult } from "./render.js";
import type { OnUpdateCallback, SingleResult, SubagentAsyncResult, SubagentDetails } from "./types.js";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const MAX_AGENTS_IN_DESCRIPTION = 10;
const RESULTS_DIR = path.join(os.tmpdir(), "pi-subagent-results");

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
	cwd: string | undefined,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);

	if (!agent) {
		return {
			agent: agentName,
			agentSource: "unknown",
			task,
			exitCode: 1,
			messages: [],
			stderr: `Unknown agent: ${agentName}`,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			step,
		};
	}

	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	if (agent.model) args.push("--model", agent.model);
	if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	const currentResult: SingleResult = {
		agent: agentName,
		agentSource: agent.source,
		task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
		model: agent.model,
		step,
	};

	const emitUpdate = () => {
		if (onUpdate) {
			onUpdate({
				content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
				details: makeDetails([currentResult]),
			});
		}
	};

	try {
		if (agent.systemPrompt.trim()) {
			const tmp = writePromptToTempFile(agent.name, agent.systemPrompt);
			tmpPromptDir = tmp.dir;
			tmpPromptPath = tmp.filePath;
			args.push("--append-system-prompt", tmpPromptPath);
		}

		args.push(`Task: ${task}`);
		let wasAborted = false;

		const exitCode = await new Promise<number>((resolve) => {
			const proc = spawn("pi", args, { cwd: cwd ?? pi.cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
			let buffer = "";

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: unknown;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				const evt = event as { type?: string; message?: Message };
				if (evt.type === "message_end" && evt.message) {
					const msg = evt.message;
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
					}
					emitUpdate();
				}

				if (evt.type === "tool_result_end" && evt.message) {
					currentResult.messages.push(evt.message);
					emitUpdate();
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
				resolve(code ?? 0);
			});

			proc.on("error", () => {
				resolve(1);
			});

			if (signal) {
				const killProc = () => {
					wasAborted = true;
					proc.kill("SIGTERM");
					setTimeout(() => {
						if (!proc.killed) proc.kill("SIGKILL");
					}, 5000);
				};
				if (signal.aborted) killProc();
				else signal.addEventListener("abort", killProc, { once: true });
			}
		});

		currentResult.exitCode = exitCode;
		if (wasAborted) throw new Error("Subagent was aborted");
		return currentResult;
	} finally {
		if (tmpPromptPath)
			try {
				fs.unlinkSync(tmpPromptPath);
			} catch {
				/* ignore */
			}
		if (tmpPromptDir)
			try {
				fs.rmdirSync(tmpPromptDir);
			} catch {
				/* ignore */
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
	task: Type.String({ description: "Task with optional @pi:previous placeholder for prior output" }),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process" })),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
	description: 'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
	default: "user",
});

const SubagentParams = Type.Object({
	agent: Type.Optional(Type.String({ description: "Name of the agent to invoke (for single mode)" })),
	task: Type.Optional(Type.String({ description: "Task to delegate (for single mode)" })),
	async: Type.Optional(
		Type.Boolean({
			description:
				"Run in background, return immediately with ID. Result delivered via subagent:complete event. Supports single, parallel, and chain modes.",
		}),
	),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Array of {agent, task} for parallel execution" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Array of {agent, task} for sequential execution" })),
	agentScope: Type.Optional(AgentScopeSchema),
	confirmProjectAgents: Type.Optional(
		Type.Boolean({ description: "Prompt before running project-local agents. Default: true.", default: true }),
	),
	cwd: Type.Optional(Type.String({ description: "Working directory for the agent process (single mode)" })),
});

const factory: CustomToolFactory = (pi) => {
	fs.mkdirSync(RESULTS_DIR, { recursive: true });
	const pendingPrompts = new Map<string, { dir: string; filePath: string }>();

	const handleResultFile = (filename: string) => {
		const filePath = path.join(RESULTS_DIR, filename);
		if (!fs.existsSync(filePath)) return;

		let raw = "";
		try {
			raw = fs.readFileSync(filePath, "utf-8");
		} catch {
			return;
		}

		try {
			const data = JSON.parse(raw) as SubagentAsyncResult;
			const id = (data as { id?: unknown }).id;
			if (typeof id === "string") {
				const prompt = pendingPrompts.get(id);
				if (prompt) {
					try {
						fs.unlinkSync(prompt.filePath);
					} catch {
						/* ignore */
					}
					try {
						fs.rmdirSync(prompt.dir);
					} catch {
						/* ignore */
					}
					pendingPrompts.delete(id);
				}
			}
			pi.events.emit("subagent:complete", data);
		} catch {
			/* ignore parse errors */
		} finally {
			try {
				fs.unlinkSync(filePath);
			} catch {
				/* ignore */
			}
		}
	};

	const watcher = fs.watch(RESULTS_DIR, (eventType, filename) => {
		if (eventType !== "rename") return;
		if (!filename) return;
		const name = filename.toString();
		if (!name.endsWith(".json")) return;
		setTimeout(() => {
			handleResultFile(name);
		}, 50);
	});

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
				"Modes: single (agent + task), parallel (tasks array), chain (sequential with @pi:previous placeholder).",
				"Use async:true for background execution (single/chain); returns ID immediately, result via event.",
				'Default agent scope is "user" (from ~/.pi/agent/agents).',
				'To enable project-local agents in .pi/agents, set agentScope: "both" (or "project").',
				`User agents: ${userList.text}${userSuffix}.`,
				`Project agents${projectDirNote}: ${projectList.text}${projectSuffix}.`,
			].join(" ");
		},
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate) {
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
				(results: SingleResult[]): SubagentDetails => ({
					mode,
					agentScope,
					projectAgentsDir: discovery.projectAgentsDir,
					results,
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

			if (params.async) {
				const id = randomUUID();

				if (hasTasks && params.tasks) {
					if (params.tasks.length > MAX_PARALLEL_TASKS) {
						return {
							content: [
								{
									type: "text",
									text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
								},
							],
							details: makeDetails("parallel")([]),
							isError: true,
						};
					}

					const missingAgents = params.tasks
						.map((t) => t.agent)
						.filter((name) => !agents.some((a) => a.name === name));
					if (missingAgents.length > 0) {
						return {
							content: [{ type: "text", text: `Unknown agent(s): ${missingAgents.join(", ")}` }],
							details: makeDetails("parallel")([]),
							isError: true,
						};
					}

					const jitiCli = pi.jitiCliPath;
					if (!jitiCli) throw new Error("jitiCliPath not available. Async parallel requires pi 0.13+");
					const runnerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "chain-runner.ts");
					const totalTasks = params.tasks.length;

					for (let i = 0; i < params.tasks.length; i++) {
						const task = params.tasks[i];
						const agent = agents.find((a: AgentConfig) => a.name === task.agent)!;
						const resultPath = path.join(RESULTS_DIR, `${id}-${i}.json`);

						const chainConfig = {
							id,
							steps: [
								{
									agent: task.agent,
									task: task.task,
									cwd: task.cwd,
									model: agent.model,
									tools: agent.tools,
									systemPrompt: agent.systemPrompt.trim() || null,
								},
							],
							resultPath,
							cwd: task.cwd ?? params.cwd ?? pi.cwd,
							placeholder: "@pi:previous",
							taskIndex: i,
							totalTasks,
						};

						const configPath = path.join(os.tmpdir(), `pi-chain-config-${id}-${i}.json`);
						fs.writeFileSync(configPath, JSON.stringify(chainConfig));

						const proc = spawn("node", [jitiCli, runnerPath, configPath], {
							cwd: task.cwd ?? params.cwd ?? pi.cwd,
							detached: true,
							stdio: "ignore",
						});
						proc.unref();
					}

					const agentNames = params.tasks.map((t) => t.agent).join(", ");
					return {
						content: [
							{ type: "text", text: `Async parallel started: ${totalTasks} tasks (${agentNames}) (${id})` },
						],
						details: { ...makeDetails("parallel")([]), asyncId: id, totalTasks },
					};
				}
				const resultPath = path.join(RESULTS_DIR, `${id}.json`);

				if (hasChain && params.chain) {
					const chainSteps = params.chain.map((step) => {
						const agent = agents.find((a: AgentConfig) => a.name === step.agent);
						return {
							agent: step.agent,
							task: step.task,
							cwd: step.cwd,
							model: agent?.model,
							tools: agent?.tools,
							systemPrompt: agent?.systemPrompt?.trim() || null,
						};
					});

					const chainConfig = {
						id,
						steps: chainSteps,
						resultPath,
						cwd: params.cwd ?? pi.cwd,
						placeholder: "@pi:previous",
					};

					const jitiCli = pi.jitiCliPath;
					if (!jitiCli) throw new Error("jitiCliPath not available. Async chains require pi 0.13+");
					const runnerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "chain-runner.ts");

					const configPath = path.join(os.tmpdir(), `pi-chain-config-${id}.json`);
					fs.writeFileSync(configPath, JSON.stringify(chainConfig));

					const proc = spawn("node", [jitiCli, runnerPath, configPath], {
						cwd: params.cwd ?? pi.cwd,
						detached: true,
						stdio: "ignore",
					});
					proc.unref();

					const agentNames = params.chain.map((s) => s.agent).join(" -> ");
					return {
						content: [{ type: "text", text: `Async chain started: ${agentNames} (${id})` }],
						details: { ...makeDetails("chain")([]), asyncId: id },
					};
				}

				const agentName = params.agent as string;
				const agent = agents.find((a) => a.name === agentName);
				if (!agent) {
					return {
						content: [{ type: "text", text: `Unknown agent: ${agentName}` }],
						details: makeDetails("single")([]),
						isError: true,
					};
				}

				const spawnArgs: string[] = ["-p", "--no-session"];
				if (agent.model) spawnArgs.push("--model", agent.model);
				if (agent.tools && agent.tools.length > 0) spawnArgs.push("--tools", agent.tools.join(","));

				if (agent.systemPrompt.trim()) {
					const tmp = writePromptToTempFile(agent.name, agent.systemPrompt);
					pendingPrompts.set(id, tmp);
					spawnArgs.push("--append-system-prompt", tmp.filePath);
				}

				spawnArgs.push(`Task: ${params.task}`);

				const proc = spawn("pi", spawnArgs, {
					cwd: params.cwd ?? pi.cwd,
					detached: true,
					stdio: "ignore",
					env: {
						...process.env,
						PI_ASYNC_RESULT: resultPath,
						PI_ASYNC_ID: id,
						PI_ASYNC_AGENT: agentName,
					},
				});
				proc.unref();

				return {
					content: [{ type: "text", text: `Async subagent started: ${agentName} (${id})` }],
					details: { ...makeDetails("single")([]), asyncId: id },
				};
			}

			if (params.chain && params.chain.length > 0) {
				const results: SingleResult[] = [];
				let previousOutput = "";

				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const taskWithContext = step.task.replace(/@pi:previous/g, () => previousOutput);

					const chainUpdate: OnUpdateCallback | undefined = onUpdate
						? (partial) => {
								const currentResult = partial.details?.results[0];
								if (currentResult) {
									const allResults = [...results, currentResult];
									onUpdate({
										content: partial.content,
										details: makeDetails("chain")(allResults),
									});
								}
							}
						: undefined;

					const result = await runSingleAgent(
						pi,
						agents,
						step.agent,
						taskWithContext,
						step.cwd,
						i + 1,
						signal,
						chainUpdate,
						makeDetails("chain"),
					);
					results.push(result);

					const isError =
						result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
					if (isError) {
						const errorMsg =
							result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
						return {
							content: [{ type: "text", text: `Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}` }],
							details: makeDetails("chain")(results),
							isError: true,
						};
					}
					previousOutput = getFinalOutput(result.messages);
				}
				return {
					content: [{ type: "text", text: getFinalOutput(results[results.length - 1].messages) || "(no output)" }],
					details: makeDetails("chain")(results),
				};
			}

			if (params.tasks && params.tasks.length > 0) {
				if (params.tasks.length > MAX_PARALLEL_TASKS)
					return {
						content: [
							{
								type: "text",
								text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
							},
						],
						details: makeDetails("parallel")([]),
					};

				const allResults: SingleResult[] = new Array(params.tasks.length);

				for (let i = 0; i < params.tasks.length; i++) {
					allResults[i] = {
						agent: params.tasks[i].agent,
						agentSource: "unknown",
						task: params.tasks[i].task,
						exitCode: -1,
						messages: [],
						stderr: "",
						usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
					};
				}

				const emitParallelUpdate = () => {
					if (onUpdate) {
						const running = allResults.filter((r) => r.exitCode === -1).length;
						const done = allResults.filter((r) => r.exitCode !== -1).length;
						onUpdate({
							content: [
								{ type: "text", text: `Parallel: ${done}/${allResults.length} done, ${running} running...` },
							],
							details: makeDetails("parallel")([...allResults]),
						});
					}
				};

				const results = await mapWithConcurrencyLimit(params.tasks, MAX_CONCURRENCY, async (t, index) => {
					const result = await runSingleAgent(
						pi,
						agents,
						t.agent,
						t.task,
						t.cwd,
						undefined,
						signal,
						(partial) => {
							if (partial.details?.results[0]) {
								allResults[index] = partial.details.results[0];
								emitParallelUpdate();
							}
						},
						makeDetails("parallel"),
					);
					allResults[index] = result;
					emitParallelUpdate();
					return result;
				});

				const successCount = results.filter((r) => r.exitCode === 0).length;
				const summaries = results.map((r) => {
					const output = getFinalOutput(r.messages);
					const preview = output.slice(0, 100) + (output.length > 100 ? "..." : "");
					return `[${r.agent}] ${r.exitCode === 0 ? "completed" : "failed"}: ${preview || "(no output)"}`;
				});
				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}`,
						},
					],
					details: makeDetails("parallel")(results),
				};
			}

			if (params.agent && params.task) {
				const result = await runSingleAgent(
					pi,
					agents,
					params.agent,
					params.task,
					params.cwd,
					undefined,
					signal,
					onUpdate,
					makeDetails("single"),
				);
				const isError = result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
				if (isError) {
					const errorMsg =
						result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
					return {
						content: [{ type: "text", text: `Agent ${result.stopReason || "failed"}: ${errorMsg}` }],
						details: makeDetails("single")([result]),
						isError: true,
					};
				}
				return {
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
					details: makeDetails("single")([result]),
				};
			}

			const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
			return {
				content: [{ type: "text", text: `Invalid parameters. Available agents: ${available}` }],
				details: makeDetails("single")([]),
			};
		},

		renderCall(args, theme) {
			return renderCall(args, theme);
		},

		renderResult(result, options, theme) {
			return renderResult(result, options, theme);
		},

		dispose() {
			watcher.close();
		},
	};

	return tool;
};

export default factory;
