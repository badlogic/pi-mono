import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { spawn } from "child_process";
import { isInteractiveCommand } from "../../utils/interactive-commands.js";
import { getShellConfig, killProcessTree } from "../../utils/shell.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult, truncateTail } from "./truncate.js";

/**
 * Function type for executing interactive commands.
 * Called when the bash tool detects an interactive command.
 * @param command - The command to execute interactively
 * @returns The exit code of the command (null if killed by signal)
 */
export type InteractiveExecutor = (command: string) => number | null;

/**
 * Generate a unique temp file path for bash output
 */
function getTempFilePath(): string {
	const id = randomBytes(8).toString("hex");
	return join(tmpdir(), `pi-bash-${id}.log`);
}

const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
});

export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

export interface BashToolOptions {
	/** Function to execute interactive commands with full terminal access */
	interactiveExecutor?: InteractiveExecutor;
}

/**
 * Holder for an interactive executor that can be set after tool creation.
 * This allows the bash tool to be created before the TUI is available,
 * and the executor to be injected later from InteractiveMode.
 */
export interface InteractiveExecutorHolder {
	executor?: InteractiveExecutor;
}

/**
 * Create a holder for the interactive executor.
 * Pass this to createBashTool, then set holder.executor later from InteractiveMode.
 */
export function createInteractiveExecutorHolder(): InteractiveExecutorHolder {
	return { executor: undefined };
}

export function createBashTool(cwd: string, options?: BashToolOptions): AgentTool<typeof bashSchema> {
	// Support both direct executor and holder pattern
	const getInteractiveExecutor = (): InteractiveExecutor | undefined => {
		if (options?.interactiveExecutor) {
			return options.interactiveExecutor;
		}
		// Check if options is a holder
		if (options && "executor" in options) {
			return (options as InteractiveExecutorHolder).executor;
		}
		return undefined;
	};

	return {
		name: "bash",
		label: "bash",
		description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
		parameters: bashSchema,
		execute: async (
			_toolCallId: string,
			{ command, timeout }: { command: string; timeout?: number },
			signal?: AbortSignal,
			onUpdate?,
		) => {
			// Check if this is an interactive command and we have an executor
			const executor = getInteractiveExecutor();
			if (executor && isInteractiveCommand(command)) {
				const exitCode = executor(command);
				const outputText =
					exitCode === 0
						? "(interactive command completed successfully)"
						: `(interactive command exited with code ${exitCode})`;
				return { content: [{ type: "text", text: outputText }], details: undefined };
			}

			return new Promise((resolve, reject) => {
				const { shell, args } = getShellConfig();

				if (!existsSync(cwd)) {
					throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
				}

				const child = spawn(shell, [...args, command], {
					cwd,
					detached: true,
					stdio: ["ignore", "pipe", "pipe"],
				});

				// We'll stream to a temp file if output gets large
				let tempFilePath: string | undefined;
				let tempFileStream: ReturnType<typeof createWriteStream> | undefined;
				let totalBytes = 0;

				// Keep a rolling buffer of the last chunk for tail truncation
				const chunks: Buffer[] = [];
				let chunksBytes = 0;
				// Keep more than we need so we have enough for truncation
				const maxChunksBytes = DEFAULT_MAX_BYTES * 2;

				let timedOut = false;

				// Set timeout if provided
				let timeoutHandle: NodeJS.Timeout | undefined;
				if (timeout !== undefined && timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						onAbort();
					}, timeout * 1000);
				}

				const handleData = (data: Buffer) => {
					totalBytes += data.length;

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
						const removed = chunks.shift()!;
						chunksBytes -= removed.length;
					}

					// Stream partial output to callback (truncated rolling buffer)
					if (onUpdate) {
						const fullBuffer = Buffer.concat(chunks);
						const fullText = fullBuffer.toString("utf-8");
						const truncation = truncateTail(fullText);
						onUpdate({
							content: [{ type: "text", text: truncation.content || "" }],
							details: {
								truncation: truncation.truncated ? truncation : undefined,
								fullOutputPath: tempFilePath,
							},
						});
					}
				};

				// Collect stdout and stderr together
				if (child.stdout) {
					child.stdout.on("data", handleData);
				}
				if (child.stderr) {
					child.stderr.on("data", handleData);
				}

				// Handle shell spawn errors to prevent session from crashing
				child.on("error", (err) => {
					if (timeoutHandle) {
						clearTimeout(timeoutHandle);
					}
					if (signal) {
						signal.removeEventListener("abort", onAbort);
					}
					reject(err);
				});

				// Handle process exit
				child.on("close", (code) => {
					if (timeoutHandle) {
						clearTimeout(timeoutHandle);
					}
					if (signal) {
						signal.removeEventListener("abort", onAbort);
					}

					// Close temp file stream
					if (tempFileStream) {
						tempFileStream.end();
					}

					// Combine all buffered chunks
					const fullBuffer = Buffer.concat(chunks);
					const fullOutput = fullBuffer.toString("utf-8");

					if (signal?.aborted) {
						let output = fullOutput;
						if (output) output += "\n\n";
						output += "Command aborted";
						reject(new Error(output));
						return;
					}

					if (timedOut) {
						let output = fullOutput;
						if (output) output += "\n\n";
						output += `Command timed out after ${timeout} seconds`;
						reject(new Error(output));
						return;
					}

					// Apply tail truncation
					const truncation = truncateTail(fullOutput);
					let outputText = truncation.content || "(no output)";

					// Build details with truncation info
					let details: BashToolDetails | undefined;

					if (truncation.truncated) {
						details = {
							truncation,
							fullOutputPath: tempFilePath,
						};

						// Build actionable notice
						const startLine = truncation.totalLines - truncation.outputLines + 1;
						const endLine = truncation.totalLines;

						if (truncation.lastLinePartial) {
							// Edge case: last line alone > 30KB
							const lastLineSize = formatSize(Buffer.byteLength(fullOutput.split("\n").pop() || "", "utf-8"));
							outputText += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${tempFilePath}]`;
						} else if (truncation.truncatedBy === "lines") {
							outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${tempFilePath}]`;
						} else {
							outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${tempFilePath}]`;
						}
					}

					if (code !== 0 && code !== null) {
						outputText += `\n\nCommand exited with code ${code}`;
						reject(new Error(outputText));
					} else {
						resolve({ content: [{ type: "text", text: outputText }], details });
					}
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
			});
		},
	};
}

/** Default bash tool using process.cwd() - for backwards compatibility */
export const bashTool = createBashTool(process.cwd());
