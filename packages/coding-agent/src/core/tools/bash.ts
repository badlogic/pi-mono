import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@sinclair/typebox";
import { spawn } from "child_process";
import { getShellConfig, getShellEnv, killProcessTree } from "../../utils/shell.js";
import type { AsyncJobManager } from "./async-jobs.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult, truncateTail } from "./truncate.js";

/**
 * Generate a unique temp file path for bash output
 */
function getTempFilePath(): string {
	const id = randomBytes(8).toString("hex");
	return join(tmpdir(), `pi-bash-${id}.log`);
}

const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 300)" })),
	cwd: Type.Optional(Type.String({ description: "Working directory (default: current project directory)" })),
	head: Type.Optional(Type.Number({ description: "Return only first N lines of output" })),
	tail: Type.Optional(Type.Number({ description: "Return only last N lines of output" })),
	async: Type.Optional(
		Type.Boolean({ description: "Run command in the background and return immediately with a job ID" }),
	),
	pty: Type.Optional(
		Type.Boolean({ description: "Run in PTY mode when a command needs a real terminal (e.g. sudo/ssh/top/less)" }),
	),
});

export type BashToolInput = Static<typeof bashSchema>;

export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
	async?: {
		state: "running" | "completed" | "failed";
		jobId: string;
		type: "bash";
	};
}

/**
 * Pluggable operations for the bash tool.
 * Override these to delegate command execution to remote systems (e.g., SSH).
 */
export interface BashOperations {
	/**
	 * Execute a command and stream output.
	 * @param command - The command to execute
	 * @param cwd - Working directory
	 * @param options - Execution options
	 * @returns Promise resolving to exit code (null if killed)
	 */
	exec: (
		command: string,
		cwd: string,
		options: {
			onData: (data: Buffer) => void;
			signal?: AbortSignal;
			timeout?: number;
			env?: NodeJS.ProcessEnv;
			usePty?: boolean;
		},
	) => Promise<{ exitCode: number | null }>;
}

let cachedScriptPath: string | undefined | null = null;

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolveScriptPath(): string | undefined {
	if (cachedScriptPath !== null) {
		return cachedScriptPath || undefined;
	}

	if (process.platform === "win32") {
		cachedScriptPath = undefined;
		return undefined;
	}

	const candidates = ["/usr/bin/script", "/bin/script"];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			cachedScriptPath = candidate;
			return candidate;
		}
	}

	cachedScriptPath = undefined;
	return undefined;
}

function canUsePty(): boolean {
	return resolveScriptPath() !== undefined;
}

/**
 * Default bash operations using local shell
 */
const defaultBashOperations: BashOperations = {
	exec: (command, cwd, { onData, signal, timeout, env, usePty }) => {
		return new Promise((resolve, reject) => {
			const { shell, args } = getShellConfig();

			if (!existsSync(cwd)) {
				reject(new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`));
				return;
			}

			const scriptPath = usePty ? resolveScriptPath() : undefined;
			const shouldUsePty = !!(usePty && scriptPath);
			const child = shouldUsePty
				? (() => {
						if (process.platform === "darwin") {
							return spawn(scriptPath, ["-q", "/dev/null", shell, ...args, command], {
								cwd,
								detached: true,
								env: env ?? getShellEnv(),
								stdio: ["ignore", "pipe", "pipe"],
							});
						}

						const wrappedCommand = `${shellQuote(shell)} ${args.map(shellQuote).join(" ")} ${shellQuote(command)}`;
						return spawn(scriptPath, ["-qfc", wrappedCommand, "/dev/null"], {
							cwd,
							detached: true,
							env: env ?? getShellEnv(),
							stdio: ["ignore", "pipe", "pipe"],
						});
					})()
				: spawn(shell, [...args, command], {
						cwd,
						detached: true,
						env: env ?? getShellEnv(),
						stdio: ["ignore", "pipe", "pipe"],
					});

			let timedOut = false;

			// Set timeout if provided
			let timeoutHandle: NodeJS.Timeout | undefined;
			if (timeout !== undefined && timeout > 0) {
				timeoutHandle = setTimeout(() => {
					timedOut = true;
					if (child.pid) {
						killProcessTree(child.pid);
					}
				}, timeout * 1000);
			}

			// Stream stdout and stderr
			if (child.stdout) {
				child.stdout.on("data", onData);
			}
			if (child.stderr) {
				child.stderr.on("data", onData);
			}

			// Handle shell spawn errors
			child.on("error", (err) => {
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (signal) signal.removeEventListener("abort", onAbort);
				reject(err);
			});

			// Handle abort signal - kill entire process tree
			const onAbort = () => {
				if (child.pid) {
					killProcessTree(child.pid);
				}
			};

			if (signal) {
				if (signal.aborted) {
					onAbort();
				} else {
					signal.addEventListener("abort", onAbort, { once: true });
				}
			}

			// Handle process exit
			child.on("close", (code) => {
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (signal) signal.removeEventListener("abort", onAbort);

				if (signal?.aborted) {
					reject(new Error("aborted"));
					return;
				}

				if (timedOut) {
					reject(new Error(`timeout:${timeout}`));
					return;
				}

				resolve({ exitCode: code });
			});
		});
	},
};

export interface BashSpawnContext {
	command: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

function resolveSpawnContext(command: string, cwd: string, spawnHook?: BashSpawnHook): BashSpawnContext {
	const baseContext: BashSpawnContext = {
		command,
		cwd,
		env: { ...getShellEnv() },
	};

	return spawnHook ? spawnHook(baseContext) : baseContext;
}

export interface BashToolOptions {
	/** Custom operations for command execution. Default: local shell */
	operations?: BashOperations;
	/** Command prefix prepended to every command (e.g., "shopt -s expand_aliases" for alias support) */
	commandPrefix?: string;
	/** Hook to adjust command, cwd, or env before execution */
	spawnHook?: BashSpawnHook;
	/** Enable async background mode. */
	asyncEnabled?: boolean;
	/** Shared async job manager for this session. */
	asyncJobManager?: AsyncJobManager;
	/** Default timeout in seconds if no timeout parameter is provided. */
	defaultTimeoutSeconds?: number;
	/** Global maximum timeout in seconds. 0 means unlimited. */
	maxTimeoutSeconds?: number;
	/** Override PTY availability detection (primarily for tests). */
	ptyAvailable?: boolean;
}

interface RunBashResult {
	outputText: string;
	details?: BashToolDetails;
}

function clampTimeoutSeconds(
	inputTimeout: number | undefined,
	defaultTimeoutSeconds: number,
	maxTimeoutSeconds?: number,
): number {
	const base = Number.isFinite(inputTimeout) ? (inputTimeout as number) : defaultTimeoutSeconds;
	const clampedMin = Math.max(1, Math.floor(base));
	if (!maxTimeoutSeconds || maxTimeoutSeconds <= 0) {
		return clampedMin;
	}
	return Math.min(clampedMin, Math.floor(maxTimeoutSeconds));
}

function applyHeadTail(content: string, head?: number, tail?: number): string {
	let lines = content.split("\n");
	if (head !== undefined && Number.isFinite(head) && head >= 0) {
		lines = lines.slice(0, Math.floor(head));
	}
	if (tail !== undefined && Number.isFinite(tail) && tail >= 0) {
		const tailInt = Math.floor(tail);
		lines = tailInt === 0 ? [] : lines.slice(-tailInt);
	}
	return lines.join("\n");
}

function resolveCwd(inputCwd: string | undefined, defaultCwd: string): string {
	if (!inputCwd || inputCwd.trim().length === 0) {
		return defaultCwd;
	}
	return resolve(defaultCwd, inputCwd);
}

async function runBashCommand(
	ops: BashOperations,
	spawnContext: BashSpawnContext,
	timeoutSeconds: number,
	usePty: boolean,
	signal: AbortSignal | undefined,
	onUpdate:
		| ((result: { content: { type: "text"; text: string }[]; details: BashToolDetails | undefined }) => void)
		| undefined,
	head: number | undefined,
	tail: number | undefined,
): Promise<RunBashResult> {
	// We'll stream to a temp file if output gets large
	let tempFilePath: string | undefined;
	let tempFileStream: ReturnType<typeof createWriteStream> | undefined;
	let totalBytes = 0;
	const requestedHead = head !== undefined && Number.isFinite(head) && head >= 0 ? Math.floor(head) : undefined;
	const captureHeadSelection = requestedHead !== undefined;
	let headCaptureComplete = requestedHead === 0;
	const headChunks: Buffer[] = [];
	let selectedHeadOutput = requestedHead === 0 ? "" : undefined;

	// Keep a rolling buffer of the last chunk for tail truncation
	const chunks: Buffer[] = [];
	let chunksBytes = 0;
	// Keep more than we need so we have enough for truncation
	const maxChunksBytes = DEFAULT_MAX_BYTES * 2;

	const handleData = (data: Buffer) => {
		totalBytes += data.length;
		if (captureHeadSelection && !headCaptureComplete) {
			headChunks.push(data);
			const headText = Buffer.concat(headChunks).toString("utf-8");
			const headLines = headText.split("\n");
			if (headLines.length > requestedHead!) {
				selectedHeadOutput = headLines.slice(0, requestedHead).join("\n");
				headCaptureComplete = true;
				headChunks.length = 0;
			}
		}

		// Start writing to temp file once we exceed the threshold
		if (totalBytes > DEFAULT_MAX_BYTES && !tempFilePath) {
			tempFilePath = getTempFilePath();
			tempFileStream = createWriteStream(tempFilePath);
			// Write all buffered chunks to the file
			for (const chunk of chunks) {
				tempFileStream.write(chunk);
			}
		}

		// Write to temp file if we have one
		if (tempFileStream) {
			tempFileStream.write(data);
		}

		// Keep rolling buffer of recent data
		chunks.push(data);
		chunksBytes += data.length;

		// Trim old chunks if buffer is too large
		while (chunksBytes > maxChunksBytes && chunks.length > 1) {
			const removed = chunks.shift();
			if (removed) {
				chunksBytes -= removed.length;
			}
		}

		// Stream partial output to callback (truncated rolling buffer)
		if (onUpdate) {
			const fullText =
				captureHeadSelection && !headCaptureComplete
					? Buffer.concat(headChunks).toString("utf-8")
					: captureHeadSelection
						? (selectedHeadOutput ?? "")
						: Buffer.concat(chunks).toString("utf-8");
			const truncation = truncateTail(fullText);
			let text = truncation.content || "";
			if (head !== undefined || tail !== undefined) {
				text = applyHeadTail(text, head, tail);
			}
			onUpdate({
				content: [{ type: "text", text }],
				details: {
					truncation: truncation.truncated ? truncation : undefined,
					fullOutputPath: tempFilePath,
				},
			});
		}
	};

	try {
		const { exitCode } = await ops.exec(spawnContext.command, spawnContext.cwd, {
			onData: handleData,
			signal,
			timeout: timeoutSeconds,
			env: spawnContext.env,
			usePty,
		});

		if (tempFileStream) {
			tempFileStream.end();
		}

		const fullOutput =
			captureHeadSelection && !headCaptureComplete
				? Buffer.concat(headChunks).toString("utf-8")
				: captureHeadSelection
					? (selectedHeadOutput ?? "")
					: Buffer.concat(chunks).toString("utf-8");
		const truncation = truncateTail(fullOutput);
		let outputText = truncation.content || "(no output)";
		if (head !== undefined || tail !== undefined) {
			outputText = applyHeadTail(outputText, head, tail);
		}

		let details: BashToolDetails | undefined;
		if (truncation.truncated) {
			details = {
				truncation,
				fullOutputPath: tempFilePath,
			};

			const startLine = truncation.totalLines - truncation.outputLines + 1;
			const endLine = truncation.totalLines;
			if (truncation.lastLinePartial) {
				const lastLineSize = formatSize(Buffer.byteLength(fullOutput.split("\n").pop() || "", "utf-8"));
				outputText += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${tempFilePath}]`;
			} else if (truncation.truncatedBy === "lines") {
				outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${tempFilePath}]`;
			} else {
				outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${tempFilePath}]`;
			}
		}

		if (exitCode !== 0 && exitCode !== null) {
			throw new Error(`${outputText}\n\nCommand exited with code ${exitCode}`);
		}

		return { outputText, details };
	} catch (err) {
		if (tempFileStream) {
			tempFileStream.end();
		}

		let output =
			captureHeadSelection && !headCaptureComplete
				? Buffer.concat(headChunks).toString("utf-8")
				: captureHeadSelection
					? (selectedHeadOutput ?? "")
					: Buffer.concat(chunks).toString("utf-8");
		const error = err as Error;

		if (error.message === "aborted") {
			if (output) output += "\n\n";
			output += "Command aborted";
			throw new Error(output);
		}
		if (error.message.startsWith("timeout:")) {
			const timeoutSecs = error.message.split(":")[1];
			if (output) output += "\n\n";
			output += `Command timed out after ${timeoutSecs} seconds`;
			throw new Error(output);
		}
		throw error;
	}
}

export function createBashTool(cwd: string, options?: BashToolOptions): AgentTool<typeof bashSchema> {
	const ops = options?.operations ?? defaultBashOperations;
	const commandPrefix = options?.commandPrefix;
	const spawnHook = options?.spawnHook;
	const asyncEnabled = options?.asyncEnabled ?? false;
	const asyncJobManager = options?.asyncJobManager;
	const defaultTimeoutSeconds = Math.max(1, Math.floor(options?.defaultTimeoutSeconds ?? 300));
	const maxTimeoutSeconds = options?.maxTimeoutSeconds;
	const ptyAvailable = options?.ptyAvailable ?? canUsePty();

	return {
		name: "bash",
		label: "bash",
		description: `Execute a bash command in the current working directory. Supports cwd, timeout, head/tail output selection, and optional async background execution. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file.`,
		parameters: bashSchema,
		execute: async (
			_toolCallId: string,
			{ command, timeout, cwd: commandCwd, head, tail, async, pty }: BashToolInput,
			signal?: AbortSignal,
			onUpdate?,
		) => {
			const usePty = pty === true && ptyAvailable;
			if (pty && !usePty) {
				onUpdate?.({
					content: [
						{
							type: "text",
							text: "PTY mode is unavailable on this system. Executing in standard mode.",
						},
					],
					details: undefined,
				});
			}

			const timeoutSeconds = clampTimeoutSeconds(timeout, defaultTimeoutSeconds, maxTimeoutSeconds);
			const resolvedCwd = resolveCwd(commandCwd, cwd);

			const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
			const spawnContext = resolveSpawnContext(resolvedCommand, resolvedCwd, spawnHook);

			if (async) {
				if (!asyncEnabled || !asyncJobManager) {
					throw new Error("Async bash execution is disabled. Enable async.enabled to use async mode.");
				}

				const label = command.length > 120 ? `${command.slice(0, 117)}...` : command;
				const jobId = asyncJobManager.register(
					"bash",
					label,
					async ({ signal: jobSignal, reportProgress }) => {
						const result = await runBashCommand(
							ops,
							spawnContext,
							timeoutSeconds,
							usePty,
							jobSignal,
							(progress) => {
								void reportProgress(progress.content[0]?.text || "", {
									...(progress.details ?? {}),
									async: { state: "running", jobId, type: "bash" },
								});
							},
							head,
							tail,
						);
						await reportProgress(result.outputText, {
							...(result.details ?? {}),
							async: { state: "completed", jobId, type: "bash" },
						});
						return result.outputText;
					},
					{
						onProgress: async (text, details) => {
							onUpdate?.({
								content: [{ type: "text", text }],
								details: details as BashToolDetails | undefined,
							});
						},
					},
				);

				return {
					content: [{ type: "text", text: `Background job ${jobId} started: ${label}` }],
					details: {
						async: { state: "running", jobId, type: "bash" },
					},
				};
			}

			const result = await runBashCommand(ops, spawnContext, timeoutSeconds, usePty, signal, onUpdate, head, tail);
			return { content: [{ type: "text", text: result.outputText }], details: result.details };
		},
	};
}

/** Default bash tool using process.cwd() - for backwards compatibility */
export const bashTool = createBashTool(process.cwd());
