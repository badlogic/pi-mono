import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AgentToolResult,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionAPI,
	formatSize,
	type ToolRenderResultOptions,
	type TruncationResult,
	truncateHead,
} from "@apholdings/jensen-code";
import { Text } from "@apholdings/jensen-tui";
import { Type } from "@sinclair/typebox";

const OSGREP_BIN = process.platform === "win32" ? "osgrep.cmd" : "osgrep";

const OsgrepSearchParams = Type.Object({
	query: Type.String({
		description: "Semantic search query, e.g. 'where do we validate JWT tokens?'",
	}),
	maxResults: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: 200,
			description: "Maximum total results to return (-m). Default: 12",
		}),
	),
	perFile: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: 50,
			description: "Maximum matches per file (--per-file). Default: 2",
		}),
	),
	content: Type.Optional(
		Type.Boolean({
			description: "Show full chunk content instead of snippets (--content)",
			default: false,
		}),
	),
	scores: Type.Optional(
		Type.Boolean({
			description: "Show relevance scores (--scores)",
			default: false,
		}),
	),
	minScore: Type.Optional(
		Type.Number({
			minimum: 0,
			maximum: 1,
			description: "Minimum score threshold (--min-score)",
		}),
	),
	compact: Type.Optional(
		Type.Boolean({
			description: "Show file paths only (--compact)",
			default: false,
		}),
	),
	sync: Type.Optional(
		Type.Boolean({
			description: "Force re-index changed files before searching (--sync)",
			default: false,
		}),
	),
	reset: Type.Optional(
		Type.Boolean({
			description: "Reset the index and re-index from scratch before searching (--reset)",
			default: false,
		}),
	),
});

const OsgrepTraceParams = Type.Object({
	symbol: Type.String({
		description: "Function, method, or symbol to trace, e.g. 'registerTool'",
	}),
});

interface BaseDetails {
	tool: "osgrep_search" | "osgrep_trace";
	cwd: string;
	args: string[];
	outputLines: number;
	exitCode?: number | null;
	durationMs?: number;
	truncation?: TruncationResult;
	fullOutputPath?: string;
	error?: string;
}

interface OsgrepSearchDetails extends BaseDetails {
	tool: "osgrep_search";
	query: string;
}

interface OsgrepTraceDetails extends BaseDetails {
	tool: "osgrep_trace";
	symbol: string;
}

type OsgrepDetails = OsgrepSearchDetails | OsgrepTraceDetails;

function getTextContent(result: { content?: Array<{ type: string; text?: string }> }): string {
	const block = result.content?.find((c) => c.type === "text");
	return block?.text ?? "";
}

function countOutputLines(text: string): number {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean).length;
}

function summarizeError(err: unknown): string {
	if (typeof err === "string") return err;
	if (err && typeof err === "object" && "message" in err) {
		const message = (err as { message?: unknown }).message;
		if (typeof message === "string") return message;
	}
	return "unknown error";
}

async function runOsgrep(
	args: string[],
	cwd: string,
	signal?: AbortSignal,
): Promise<{
	stdout: string;
	stderr: string;
	code: number | null;
	durationMs: number;
}> {
	const started = Date.now();

	return await new Promise((resolve, reject) => {
		const child = spawn(OSGREP_BIN, args, {
			cwd,
			env: {
				...process.env,
				NO_COLOR: "1",
			},
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});

		let stdout = "";
		let stderr = "";
		let settled = false;

		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			fn();
		};

		const onAbort = () => {
			try {
				child.kill("SIGTERM");
			} catch {
				// ignore
			}

			setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {
					// ignore
				}
			}, 250).unref?.();
		};

		signal?.addEventListener("abort", onAbort, { once: true });

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});

		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});

		child.on("error", (err) => {
			finish(() => reject(err));
		});

		child.on("close", (code) => {
			finish(() =>
				resolve({
					stdout: stdout.trim(),
					stderr: stderr.trim(),
					code,
					durationMs: Date.now() - started,
				}),
			);
		});
	});
}

function withTruncation(text: string, details: OsgrepDetails): string {
	const truncation = truncateHead(text, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});

	let resultText = truncation.content;

	if (truncation.truncated) {
		const tempDir = mkdtempSync(join(tmpdir(), "pi-osgrep-"));
		const tempFile = join(tempDir, "output.txt");
		writeFileSync(tempFile, text, { mode: 0o600 });

		details.truncation = truncation;
		details.fullOutputPath = tempFile;

		resultText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
		resultText += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
		resultText += ` Full output saved to ${tempFile}]`;
	}

	return resultText;
}

function renderSearchCall(
	args: {
		query: string;
		maxResults?: number;
		perFile?: number;
		content?: boolean;
		scores?: boolean;
		minScore?: number;
		compact?: boolean;
		sync?: boolean;
		reset?: boolean;
	},
	theme: any,
) {
	const flags: string[] = [];
	if (args.maxResults !== undefined) flags.push(`m=${args.maxResults}`);
	if (args.perFile !== undefined) flags.push(`per-file=${args.perFile}`);
	if (args.content) flags.push("content");
	if (args.scores) flags.push("scores");
	if (args.compact) flags.push("compact");
	if (args.sync) flags.push("sync");
	if (args.reset) flags.push("reset");
	if (typeof args.minScore === "number") flags.push(`min-score=${args.minScore}`);

	let text = theme.fg("toolTitle", theme.bold("osgrep_search ")) + theme.fg("accent", JSON.stringify(args.query));

	if (flags.length > 0) {
		text += theme.fg("muted", ` [${flags.join(" ")}]`);
	}

	return new Text(text, 0, 0);
}

function renderTraceCall(args: { symbol: string }, theme: any) {
	const text = theme.fg("toolTitle", theme.bold("osgrep_trace ")) + theme.fg("accent", JSON.stringify(args.symbol));

	return new Text(text, 0, 0);
}

function renderToolResult(
	result: AgentToolResult<OsgrepDetails> & { isError?: boolean },
	expanded: boolean,
	theme: any,
) {
	const details = result.details;
	const content = getTextContent(result);

	let header = theme.fg("toolTitle", theme.bold(details?.tool ?? "osgrep"));
	if (details) header += theme.fg("muted", ` · ${details.outputLines} lines`);
	if (details?.durationMs !== undefined) header += theme.fg("muted", ` · ${details.durationMs}ms`);
	if (details?.truncation?.truncated) header += theme.fg("warning", " · truncated");
	if (details?.error || result.isError) header += theme.fg("error", " · error");

	if (expanded) {
		return new Text(`${header}\n${content || "(no output)"}`, 0, 0);
	}

	const lines = (content || "(no output)").split("\n");
	const preview = lines.slice(0, 12).join("\n");
	const needsMore = lines.length > 12;

	let text = `${header}\n${preview}`;
	if (needsMore) text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;

	return new Text(text, 0, 0);
}

export default function (pi: ExtensionAPI) {
	pi.registerTool<typeof OsgrepSearchParams, OsgrepSearchDetails>({
		name: "osgrep_search",
		label: "osgrep search",
		description: `Semantic code search using local osgrep in the current working directory. Best for concept-based repository reconnaissance. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; if truncated, full output is saved to a temp file.`,
		promptSnippet: "Semantic repository search with osgrep for concept-level code discovery.",
		promptGuidelines: [
			"Use osgrep_search when the task is about behavior, responsibility, or architecture rather than exact text.",
			"Use grep for exact strings/symbols and osgrep_search for semantic reconnaissance.",
			"Use compact=true for broad discovery, then rerun a targeted query for detailed content.",
			"Keep queries concrete and repository-specific.",
		],
		parameters: OsgrepSearchParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (params.content && params.compact) {
				return {
					content: [
						{
							type: "text",
							text: "Invalid parameters: content and compact cannot both be true.",
						},
					],
					details: {
						tool: "osgrep_search",
						query: params.query,
						cwd: ctx.cwd,
						args: [],
						outputLines: 0,
						error: "invalid_parameters",
					} as OsgrepSearchDetails,
					isError: true,
				};
			}

			const args: string[] = [];
			const maxResults = params.maxResults ?? 12;
			const perFile = params.perFile ?? 2;

			args.push("-m", String(maxResults));
			args.push("--per-file", String(perFile));

			if (params.content) args.push("--content");
			if (params.scores) args.push("--scores");
			if (typeof params.minScore === "number") args.push("--min-score", String(params.minScore));
			if (params.compact) args.push("--compact");
			if (params.sync) args.push("--sync");
			if (params.reset) args.push("--reset");

			args.push(params.query);

			try {
				const execResult = await runOsgrep(args, ctx.cwd, signal);
				const combined = [execResult.stderr, execResult.stdout].filter(Boolean).join("\n").trim();

				if (signal?.aborted) {
					return {
						content: [{ type: "text", text: "osgrep search was aborted." }],
						details: {
							tool: "osgrep_search",
							query: params.query,
							cwd: ctx.cwd,
							args,
							outputLines: 0,
							exitCode: execResult.code,
							durationMs: execResult.durationMs,
							error: "aborted",
						} as OsgrepSearchDetails,
						isError: true,
					};
				}

				if (execResult.code && execResult.code !== 0) {
					if (execResult.code === 1 || /no matches/i.test(combined)) {
						return {
							content: [{ type: "text", text: "No matches found" }],
							details: {
								tool: "osgrep_search",
								query: params.query,
								cwd: ctx.cwd,
								args,
								outputLines: 0,
								exitCode: execResult.code,
								durationMs: execResult.durationMs,
							} as OsgrepSearchDetails,
						};
					}

					return {
						content: [
							{
								type: "text",
								text: `osgrep failed: ${combined || `exit code ${String(execResult.code)}`}`,
							},
						],
						details: {
							tool: "osgrep_search",
							query: params.query,
							cwd: ctx.cwd,
							args,
							outputLines: 0,
							exitCode: execResult.code,
							durationMs: execResult.durationMs,
							error: combined || `exit code ${String(execResult.code)}`,
						} as OsgrepSearchDetails,
						isError: true,
					};
				}

				if (!execResult.stdout.trim()) {
					return {
						content: [{ type: "text", text: "No matches found" }],
						details: {
							tool: "osgrep_search",
							query: params.query,
							cwd: ctx.cwd,
							args,
							outputLines: 0,
							exitCode: execResult.code,
							durationMs: execResult.durationMs,
						} as OsgrepSearchDetails,
					};
				}

				const details: OsgrepSearchDetails = {
					tool: "osgrep_search",
					query: params.query,
					cwd: ctx.cwd,
					args,
					outputLines: countOutputLines(execResult.stdout),
					exitCode: execResult.code,
					durationMs: execResult.durationMs,
				};

				const resultText = withTruncation(execResult.stdout, details);

				return {
					content: [{ type: "text", text: resultText }],
					details,
				};
			} catch (err) {
				const message = summarizeError(err);

				if (/ENOENT/i.test(message) || /not found/i.test(message)) {
					return {
						content: [
							{
								type: "text",
								text: "osgrep executable not found in PATH. Install osgrep and ensure Jensen can see it.",
							},
						],
						details: {
							tool: "osgrep_search",
							query: params.query,
							cwd: ctx.cwd,
							args,
							outputLines: 0,
							error: "ENOENT",
						} as OsgrepSearchDetails,
						isError: true,
					};
				}

				return {
					content: [
						{
							type: "text",
							text: `osgrep failed: ${message}`,
						},
					],
					details: {
						tool: "osgrep_search",
						query: params.query,
						cwd: ctx.cwd,
						args,
						outputLines: 0,
						error: message,
					} as OsgrepSearchDetails,
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			return renderSearchCall(args, theme);
		},

		renderResult(result: AgentToolResult<OsgrepSearchDetails>, { expanded }: ToolRenderResultOptions, theme) {
			return renderToolResult(result, expanded, theme);
		},
	});

	pi.registerTool<typeof OsgrepTraceParams, OsgrepTraceDetails>({
		name: "osgrep_trace",
		label: "osgrep trace",
		description: `Call-graph tracing using local osgrep in the current working directory. Use it for impact analysis: who calls a symbol and what it calls. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}; if truncated, full output is saved to a temp file.`,
		promptSnippet: "Call-graph and impact tracing with osgrep for upstream/downstream code understanding.",
		promptGuidelines: [
			"Use osgrep_trace when you need blast-radius analysis for a function, method, or symbol.",
			"Use osgrep_trace before refactors that may affect callers or callees.",
			"Use osgrep_search to find concepts; use osgrep_trace to understand dependencies around a specific symbol.",
		],
		parameters: OsgrepTraceParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const args = ["trace", params.symbol];

			try {
				const execResult = await runOsgrep(args, ctx.cwd, signal);
				const combined = [execResult.stderr, execResult.stdout].filter(Boolean).join("\n").trim();

				if (signal?.aborted) {
					return {
						content: [{ type: "text", text: "osgrep trace was aborted." }],
						details: {
							tool: "osgrep_trace",
							symbol: params.symbol,
							cwd: ctx.cwd,
							args,
							outputLines: 0,
							exitCode: execResult.code,
							durationMs: execResult.durationMs,
							error: "aborted",
						} as OsgrepTraceDetails,
						isError: true,
					};
				}

				if (execResult.code && execResult.code !== 0) {
					if (execResult.code === 1 || /no matches|not found|no trace/i.test(combined)) {
						return {
							content: [{ type: "text", text: "No trace data found" }],
							details: {
								tool: "osgrep_trace",
								symbol: params.symbol,
								cwd: ctx.cwd,
								args,
								outputLines: 0,
								exitCode: execResult.code,
								durationMs: execResult.durationMs,
							} as OsgrepTraceDetails,
						};
					}

					return {
						content: [
							{
								type: "text",
								text: `osgrep trace failed: ${combined || `exit code ${String(execResult.code)}`}`,
							},
						],
						details: {
							tool: "osgrep_trace",
							symbol: params.symbol,
							cwd: ctx.cwd,
							args,
							outputLines: 0,
							exitCode: execResult.code,
							durationMs: execResult.durationMs,
							error: combined || `exit code ${String(execResult.code)}`,
						} as OsgrepTraceDetails,
						isError: true,
					};
				}

				if (!execResult.stdout.trim()) {
					return {
						content: [{ type: "text", text: "No trace data found" }],
						details: {
							tool: "osgrep_trace",
							symbol: params.symbol,
							cwd: ctx.cwd,
							args,
							outputLines: 0,
							exitCode: execResult.code,
							durationMs: execResult.durationMs,
						} as OsgrepTraceDetails,
					};
				}

				const details: OsgrepTraceDetails = {
					tool: "osgrep_trace",
					symbol: params.symbol,
					cwd: ctx.cwd,
					args,
					outputLines: countOutputLines(execResult.stdout),
					exitCode: execResult.code,
					durationMs: execResult.durationMs,
				};

				const resultText = withTruncation(execResult.stdout, details);

				return {
					content: [{ type: "text", text: resultText }],
					details,
				};
			} catch (err) {
				const message = summarizeError(err);

				if (/ENOENT/i.test(message) || /not found/i.test(message)) {
					return {
						content: [
							{
								type: "text",
								text: "osgrep executable not found in PATH. Install osgrep and ensure Jensen can see it.",
							},
						],
						details: {
							tool: "osgrep_trace",
							symbol: params.symbol,
							cwd: ctx.cwd,
							args,
							outputLines: 0,
							error: "ENOENT",
						} as OsgrepTraceDetails,
						isError: true,
					};
				}

				return {
					content: [
						{
							type: "text",
							text: `osgrep trace failed: ${message}`,
						},
					],
					details: {
						tool: "osgrep_trace",
						symbol: params.symbol,
						cwd: ctx.cwd,
						args,
						outputLines: 0,
						error: message,
					} as OsgrepTraceDetails,
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			return renderTraceCall(args, theme);
		},

		renderResult(result: AgentToolResult<OsgrepTraceDetails>, { expanded }: ToolRenderResultOptions, theme) {
			return renderToolResult(result, expanded, theme);
		},
	});
}
