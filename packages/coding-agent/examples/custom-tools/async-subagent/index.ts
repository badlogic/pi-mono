/**
 * Async Subagent Tool
 *
 * Full-featured subagent with sync and async modes.
 * - Sync: Streams output, renders markdown, tracks usage
 * - Async: Background execution, emits events when done
 *
 * Modes: single (agent + task), parallel (tasks[]), chain (chain[] with {previous})
 * Toggle: async parameter (default: true)
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";
import { StringEnum } from "@mariozechner/pi-ai";
import {
	type CustomTool,
	type CustomToolAPI,
	type CustomToolFactory,
	getMarkdownTheme,
} from "@mariozechner/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { type AgentConfig, type AgentScope, discoverAgents, formatAgentList } from "./agents.js";

const MAX_PARALLEL = 8;
const MAX_CONCURRENCY = 4;
const COLLAPSED_ITEMS = 8;
const RESULTS_DIR = "/tmp/pi-async-subagent-results";

const require = createRequire(import.meta.url);
const jitiCliPath: string | undefined = (() => {
	try {
		return path.join(path.dirname(require.resolve("jiti/package.json")), "lib/jiti-cli.mjs");
	} catch {
		return undefined;
	}
})();

interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
}

interface SingleResult {
	agent: string;
	task: string;
	exitCode: number;
	messages: Message[];
	usage: Usage;
	model?: string;
	error?: string;
}

interface Details {
	mode: "single" | "parallel" | "chain";
	results: SingleResult[];
	asyncId?: string;
}

type DisplayItem = { type: "text"; text: string } | { type: "tool"; name: string; args: Record<string, unknown> };

function formatTokens(n: number): string {
	return n < 1000 ? String(n) : n < 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`;
}

function formatUsage(u: Usage, model?: string): string {
	const parts: string[] = [];
	if (u.turns) parts.push(`${u.turns} turn${u.turns > 1 ? "s" : ""}`);
	if (u.input) parts.push(`in:${formatTokens(u.input)}`);
	if (u.output) parts.push(`out:${formatTokens(u.output)}`);
	if (u.cacheRead) parts.push(`R${formatTokens(u.cacheRead)}`);
	if (u.cacheWrite) parts.push(`W${formatTokens(u.cacheWrite)}`);
	if (u.cost) parts.push(`$${u.cost.toFixed(4)}`);
	if (model) parts.push(model);
	return parts.join(" ");
}

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

interface ErrorInfo {
	hasError: boolean;
	exitCode?: number;
	errorType?: string;
	details?: string;
}

function detectSubagentError(messages: Message[]): ErrorInfo {
	for (const msg of messages) {
		if (msg.role === "toolResult" && (msg as any).isError) {
			const text = msg.content.find((c) => c.type === "text");
			const details = text && "text" in text ? text.text : undefined;
			const exitMatch = details?.match(/exit(?:ed)?\s*(?:with\s*)?(?:code|status)?\s*[:\s]?\s*(\d+)/i);
			return {
				hasError: true,
				exitCode: exitMatch ? parseInt(exitMatch[1], 10) : 1,
				errorType: (msg as any).toolName || "tool",
				details: details?.slice(0, 200),
			};
		}
	}

	for (const msg of messages) {
		if (msg.role !== "toolResult") continue;
		const toolName = (msg as any).toolName;
		if (toolName !== "bash") continue;

		const text = msg.content.find((c) => c.type === "text");
		if (!text || !("text" in text)) continue;
		const output = text.text;

		const exitMatch = output.match(/exit(?:ed)?\s*(?:with\s*)?(?:code|status)?\s*[:\s]?\s*(\d+)/i);
		if (exitMatch) {
			const code = parseInt(exitMatch[1], 10);
			if (code !== 0) {
				return { hasError: true, exitCode: code, errorType: "bash", details: output.slice(0, 200) };
			}
		}

		const errorPatterns = [
			/command not found/i,
			/permission denied/i,
			/no such file or directory/i,
			/segmentation fault/i,
			/killed|terminated/i,
			/out of memory/i,
			/connection refused/i,
			/timeout/i,
		];
		for (const pattern of errorPatterns) {
			if (pattern.test(output)) {
				return { hasError: true, exitCode: 1, errorType: "bash", details: output.slice(0, 200) };
			}
		}
	}

	return { hasError: false };
}

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall") items.push({ type: "tool", name: part.name, args: part.arguments });
			}
		}
	}
	return items;
}

function shortenPath(p: string): string {
	const home = os.homedir();
	return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function formatToolCall(name: string, args: Record<string, unknown>): string {
	switch (name) {
		case "bash":
			return `$ ${((args.command as string) || "").slice(0, 60)}${(args.command as string)?.length > 60 ? "..." : ""}`;
		case "read":
			return `read ${shortenPath((args.path || args.file_path || "") as string)}`;
		case "write":
			return `write ${shortenPath((args.path || args.file_path || "") as string)}`;
		case "edit":
			return `edit ${shortenPath((args.path || args.file_path || "") as string)}`;
		default: {
			const s = JSON.stringify(args);
			return `${name} ${s.slice(0, 40)}${s.length > 40 ? "..." : ""}`;
		}
	}
}

function writePrompt(agent: string, prompt: string): { dir: string; path: string } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
	const p = path.join(dir, `${agent.replace(/[^\w.-]/g, "_")}.md`);
	fs.writeFileSync(p, prompt, { mode: 0o600 });
	return { dir, path: p };
}

async function runSync(
	pi: CustomToolAPI,
	agents: AgentConfig[],
	agentName: string,
	task: string,
	cwd?: string,
	signal?: AbortSignal,
	onUpdate?: (r: AgentToolResult<Details>) => void,
): Promise<SingleResult> {
	const agent = agents.find((a) => a.name === agentName);
	if (!agent) {
		return {
			agent: agentName,
			task,
			exitCode: 1,
			messages: [],
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
			error: `Unknown agent: ${agentName}`,
		};
	}

	const args = ["--mode", "json", "-p", "--no-session"];
	if (agent.model) args.push("--model", agent.model);
	if (agent.tools?.length) args.push("--tools", agent.tools.join(","));

	let tmpDir: string | null = null;
	if (agent.systemPrompt?.trim()) {
		const tmp = writePrompt(agent.name, agent.systemPrompt);
		tmpDir = tmp.dir;
		args.push("--append-system-prompt", tmp.path);
	}
	args.push(`Task: ${task}`);

	const result: SingleResult = {
		agent: agentName,
		task,
		exitCode: 0,
		messages: [],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 },
	};

	const exitCode = await new Promise<number>((resolve) => {
		const proc = spawn("pi", args, { cwd: cwd ?? pi.cwd, stdio: ["ignore", "pipe", "pipe"] });
		let buf = "";

		const processLine = (line: string) => {
			if (!line.trim()) return;
			try {
				const evt = JSON.parse(line) as { type?: string; message?: Message };
				if (evt.type === "message_end" && evt.message) {
					result.messages.push(evt.message);
					if (evt.message.role === "assistant") {
						result.usage.turns++;
						const u = evt.message.usage;
						if (u) {
							result.usage.input += u.input || 0;
							result.usage.output += u.output || 0;
							result.usage.cacheRead += u.cacheRead || 0;
							result.usage.cacheWrite += u.cacheWrite || 0;
							result.usage.cost += u.cost?.total || 0;
						}
						if (!result.model && evt.message.model) result.model = evt.message.model;
						if (evt.message.errorMessage) result.error = evt.message.errorMessage;
					}
					if (onUpdate)
						onUpdate({
							content: [{ type: "text", text: getFinalOutput(result.messages) || "(running...)" }],
							details: { mode: "single", results: [result] },
						});
				}
				if (evt.type === "tool_result_end" && evt.message) {
					result.messages.push(evt.message);
					if (onUpdate)
						onUpdate({
							content: [{ type: "text", text: getFinalOutput(result.messages) || "(running...)" }],
							details: { mode: "single", results: [result] },
						});
				}
			} catch {}
		};

		let stderrBuf = "";
		proc.stdout.on("data", (d) => {
			buf += d.toString();
			const lines = buf.split("\n");
			buf = lines.pop() || "";
			lines.forEach(processLine);
		});
		proc.stderr.on("data", (d) => {
			stderrBuf += d.toString();
		});
		proc.on("close", (code) => {
			if (buf.trim()) processLine(buf);
			if (code !== 0 && stderrBuf.trim() && !result.error) {
				result.error = stderrBuf.trim();
			}
			resolve(code ?? 0);
		});
		proc.on("error", () => resolve(1));

		if (signal) {
			const kill = () => {
				proc.kill("SIGTERM");
				setTimeout(() => !proc.killed && proc.kill("SIGKILL"), 3000);
			};
			if (signal.aborted) kill();
			else signal.addEventListener("abort", kill, { once: true });
		}
	});

	if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
	result.exitCode = exitCode;

	if (exitCode === 0 && !result.error) {
		const errInfo = detectSubagentError(result.messages);
		if (errInfo.hasError) {
			result.exitCode = errInfo.exitCode ?? 1;
			result.error = errInfo.details
				? `${errInfo.errorType} failed (exit ${errInfo.exitCode}): ${errInfo.details}`
				: `${errInfo.errorType} failed with exit code ${errInfo.exitCode}`;
		}
	}

	return result;
}

async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	await Promise.all(
		Array(Math.min(limit, items.length))
			.fill(0)
			.map(async () => {
				while (next < items.length) {
					const i = next++;
					results[i] = await fn(items[i], i);
				}
			}),
	);
	return results;
}

const TaskItem = Type.Object({ agent: Type.String(), task: Type.String(), cwd: Type.Optional(Type.String()) });
const ChainItem = Type.Object({
	agent: Type.String(),
	task: Type.String({ description: "Use {previous} for prior output" }),
	cwd: Type.Optional(Type.String()),
});

const Params = Type.Object({
	agent: Type.Optional(Type.String({ description: "Agent name (single mode)" })),
	task: Type.Optional(Type.String({ description: "Task (single mode)" })),
	tasks: Type.Optional(Type.Array(TaskItem, { description: "Parallel tasks" })),
	chain: Type.Optional(Type.Array(ChainItem, { description: "Sequential chain" })),
	async: Type.Optional(Type.Boolean({ description: "Run in background (default: true)", default: true })),
	agentScope: Type.Optional(StringEnum(["user", "project", "both"] as const, { default: "user" })),
	cwd: Type.Optional(Type.String()),
});

const factory: CustomToolFactory = (pi) => {
	fs.mkdirSync(RESULTS_DIR, { recursive: true });
	for (const f of fs.readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"))) {
		fs.unlinkSync(path.join(RESULTS_DIR, f));
	}

	const handleResult = (file: string) => {
		const p = path.join(RESULTS_DIR, file);
		if (!fs.existsSync(p)) return;
		try {
			const data = JSON.parse(fs.readFileSync(p, "utf-8"));
			pi.events.emit("async_subagent:complete", data);
		} catch {}
		fs.unlinkSync(p);
	};

	const watcher = fs.watch(RESULTS_DIR, (ev, file) => {
		if (ev === "rename" && file?.toString().endsWith(".json")) setTimeout(() => handleResult(file.toString()), 50);
	});
	fs.readdirSync(RESULTS_DIR)
		.filter((f) => f.endsWith(".json"))
		.forEach(handleResult);

	const tool: CustomTool<typeof Params, Details> = {
		name: "async_subagent",
		label: "Async Subagent",
		get description() {
			const u = discoverAgents(pi.cwd, "user");
			const p = discoverAgents(pi.cwd, "project");
			return `Subagents with sync/async modes. User: ${formatAgentList(u.agents, 8).text}. Project: ${formatAgentList(p.agents, 8).text}.`;
		},
		parameters: Params,

		async execute(_id, params, onUpdate, _ctx, signal) {
			const scope: AgentScope = params.agentScope ?? "user";
			const agents = discoverAgents(pi.cwd, scope).agents;
			const isAsync = params.async !== false;

			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.agent && params.task);

			if (Number(hasChain) + Number(hasTasks) + Number(hasSingle) !== 1) {
				return {
					content: [
						{
							type: "text",
							text: `Provide exactly one mode. Agents: ${agents.map((a) => a.name).join(", ") || "none"}`,
						},
					],
					isError: true,
					details: { mode: "single" as const, results: [] },
				};
			}

			if (isAsync) {
				if (!jitiCliPath)
					return {
						content: [{ type: "text", text: "jiti not found" }],
						isError: true,
						details: { mode: "single" as const, results: [] },
					};
				const id = randomUUID();
				const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), "subagent-runner.ts");

				const spawnRunner = (cfg: object, suffix: string) => {
					const cfgPath = path.join(os.tmpdir(), `pi-async-cfg-${suffix}.json`);
					fs.writeFileSync(cfgPath, JSON.stringify(cfg));
					const proc = spawn("node", [jitiCliPath!, runner, cfgPath], {
						cwd: (cfg as any).cwd ?? pi.cwd,
						detached: true,
						stdio: "ignore",
					});
					proc.unref();
				};

				if (hasTasks && params.tasks) {
					if (params.tasks.length > MAX_PARALLEL)
						return {
							content: [{ type: "text", text: `Max ${MAX_PARALLEL} tasks` }],
							isError: true,
							details: { mode: "single" as const, results: [] },
						};
					for (let i = 0; i < params.tasks.length; i++) {
						const t = params.tasks[i];
						const a = agents.find((x) => x.name === t.agent);
						if (!a)
							return {
								content: [{ type: "text", text: `Unknown: ${t.agent}` }],
								isError: true,
								details: { mode: "single" as const, results: [] },
							};
						spawnRunner(
							{
								id,
								steps: [
									{
										agent: t.agent,
										task: t.task,
										cwd: t.cwd,
										model: a.model,
										tools: a.tools,
										systemPrompt: a.systemPrompt?.trim() || null,
									},
								],
								resultPath: path.join(RESULTS_DIR, `${id}-${i}.json`),
								cwd: t.cwd ?? params.cwd ?? pi.cwd,
								placeholder: "{previous}",
								taskIndex: i,
								totalTasks: params.tasks.length,
							},
							`${id}-${i}`,
						);
					}
					return {
						content: [{ type: "text", text: `Async parallel: ${params.tasks.length} tasks [${id}]` }],
						details: { mode: "parallel", results: [], asyncId: id },
					};
				}

				if (hasChain && params.chain) {
					const steps = params.chain.map((s) => {
						const a = agents.find((x) => x.name === s.agent);
						if (!a) throw new Error(`Unknown: ${s.agent}`);
						return {
							agent: s.agent,
							task: s.task,
							cwd: s.cwd,
							model: a.model,
							tools: a.tools,
							systemPrompt: a.systemPrompt?.trim() || null,
						};
					});
					spawnRunner(
						{
							id,
							steps,
							resultPath: path.join(RESULTS_DIR, `${id}.json`),
							cwd: params.cwd ?? pi.cwd,
							placeholder: "{previous}",
						},
						id,
					);
					return {
						content: [
							{ type: "text", text: `Async chain: ${params.chain.map((s) => s.agent).join(" -> ")} [${id}]` },
						],
						details: { mode: "chain", results: [], asyncId: id },
					};
				}

				if (hasSingle) {
					const a = agents.find((x) => x.name === params.agent);
					if (!a)
						return {
							content: [{ type: "text", text: `Unknown: ${params.agent}` }],
							isError: true,
							details: { mode: "single" as const, results: [] },
						};
					spawnRunner(
						{
							id,
							steps: [
								{
									agent: params.agent,
									task: params.task,
									cwd: params.cwd,
									model: a.model,
									tools: a.tools,
									systemPrompt: a.systemPrompt?.trim() || null,
								},
							],
							resultPath: path.join(RESULTS_DIR, `${id}.json`),
							cwd: params.cwd ?? pi.cwd,
							placeholder: "{previous}",
						},
						id,
					);
					return {
						content: [{ type: "text", text: `Async: ${params.agent} [${id}]` }],
						details: { mode: "single", results: [], asyncId: id },
					};
				}
			}

			if (hasChain && params.chain) {
				const results: SingleResult[] = [];
				let prev = "";
				for (const step of params.chain) {
					const taskWithPrev = step.task.replace(/\{previous\}/g, prev);
					const r = await runSync(
						pi,
						agents,
						step.agent,
						taskWithPrev,
						step.cwd ?? params.cwd,
						signal,
						onUpdate
							? (p) =>
									onUpdate({
										...p,
										details: { mode: "chain", results: [...results, ...(p.details?.results || [])] },
									})
							: undefined,
					);
					results.push(r);
					if (r.exitCode !== 0)
						return {
							content: [{ type: "text", text: r.error || "Chain failed" }],
							details: { mode: "chain", results },
							isError: true,
						};
					prev = getFinalOutput(r.messages);
				}
				return { content: [{ type: "text", text: prev || "(no output)" }], details: { mode: "chain", results } };
			}

			if (hasTasks && params.tasks) {
				if (params.tasks.length > MAX_PARALLEL)
					return {
						content: [{ type: "text", text: `Max ${MAX_PARALLEL} tasks` }],
						isError: true,
						details: { mode: "single" as const, results: [] },
					};
				const results = await mapConcurrent(params.tasks, MAX_CONCURRENCY, async (t) =>
					runSync(pi, agents, t.agent, t.task, t.cwd ?? params.cwd, signal),
				);
				const ok = results.filter((r) => r.exitCode === 0).length;
				return {
					content: [{ type: "text", text: `${ok}/${results.length} succeeded` }],
					details: { mode: "parallel", results },
				};
			}

			if (hasSingle) {
				const r = await runSync(pi, agents, params.agent!, params.task!, params.cwd, signal, onUpdate);
				if (r.exitCode !== 0)
					return {
						content: [{ type: "text", text: r.error || "Failed" }],
						details: { mode: "single", results: [r] },
						isError: true,
					};
				return {
					content: [{ type: "text", text: getFinalOutput(r.messages) || "(no output)" }],
					details: { mode: "single", results: [r] },
				};
			}

			return {
				content: [{ type: "text", text: "Invalid params" }],
				isError: true,
				details: { mode: "single" as const, results: [] },
			};
		},

		renderCall(args, theme) {
			const asyncLabel = args.async !== false ? theme.fg("warning", " [async]") : "";
			if (args.chain?.length)
				return new Text(
					`${theme.fg("toolTitle", theme.bold("async_subagent "))}chain (${args.chain.length})${asyncLabel}`,
					0,
					0,
				);
			if (args.tasks?.length)
				return new Text(
					`${theme.fg("toolTitle", theme.bold("async_subagent "))}parallel (${args.tasks.length})${asyncLabel}`,
					0,
					0,
				);
			return new Text(
				`${theme.fg("toolTitle", theme.bold("async_subagent "))}${theme.fg("accent", args.agent || "?")}${asyncLabel}`,
				0,
				0,
			);
		},

		renderResult(result, { expanded }, theme) {
			const d = result.details;
			if (!d || !d.results.length) {
				const t = result.content[0];
				return new Text(t?.type === "text" ? t.text : "(no output)", 0, 0);
			}

			const mdTheme = getMarkdownTheme();

			if (d.mode === "single" && d.results.length === 1) {
				const r = d.results[0];
				const icon = r.exitCode === 0 ? theme.fg("success", "ok") : theme.fg("error", "X");
				const output = getFinalOutput(r.messages);

				if (expanded) {
					const c = new Container();
					c.addChild(new Text(`${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}`, 0, 0));
					c.addChild(new Spacer(1));
					c.addChild(
						new Text(theme.fg("dim", `Task: ${r.task.slice(0, 100)}${r.task.length > 100 ? "..." : ""}`), 0, 0),
					);
					c.addChild(new Spacer(1));

					const items = getDisplayItems(r.messages);
					for (const item of items) {
						if (item.type === "tool")
							c.addChild(new Text(theme.fg("muted", formatToolCall(item.name, item.args)), 0, 0));
					}
					if (items.length) c.addChild(new Spacer(1));

					if (output) c.addChild(new Markdown(output, 0, 0, mdTheme));
					c.addChild(new Spacer(1));
					c.addChild(new Text(theme.fg("dim", formatUsage(r.usage, r.model)), 0, 0));
					return c;
				}

				const items = getDisplayItems(r.messages).slice(-COLLAPSED_ITEMS);
				const lines = [`${icon} ${theme.fg("toolTitle", theme.bold(r.agent))}`];
				for (const item of items) {
					if (item.type === "tool") lines.push(theme.fg("muted", formatToolCall(item.name, item.args)));
					else lines.push(item.text.slice(0, 80) + (item.text.length > 80 ? "..." : ""));
				}
				lines.push(theme.fg("dim", formatUsage(r.usage, r.model)));
				return new Text(lines.join("\n"), 0, 0);
			}

			const ok = d.results.filter((r) => r.exitCode === 0).length;
			const icon = ok === d.results.length ? theme.fg("success", "ok") : theme.fg("error", "X");

			if (expanded) {
				const c = new Container();
				c.addChild(
					new Text(`${icon} ${theme.fg("toolTitle", theme.bold(d.mode))} ${ok}/${d.results.length}`, 0, 0),
				);
				for (const r of d.results) {
					c.addChild(new Spacer(1));
					const rIcon = r.exitCode === 0 ? theme.fg("success", "ok") : theme.fg("error", "X");
					c.addChild(new Text(`${rIcon} ${theme.bold(r.agent)}`, 0, 0));
					const out = getFinalOutput(r.messages);
					if (out) c.addChild(new Markdown(out, 0, 0, mdTheme));
					c.addChild(new Text(theme.fg("dim", formatUsage(r.usage, r.model)), 0, 0));
				}
				return c;
			}

			return new Text(`${icon} ${theme.fg("toolTitle", theme.bold(d.mode))} ${ok}/${d.results.length}`, 0, 0);
		},

		onSession(ev) {
			if (ev.reason === "shutdown") watcher.close();
		},
	};

	return tool;
};

export default factory;
