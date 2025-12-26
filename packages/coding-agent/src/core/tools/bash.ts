import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { spawn } from "child_process";
import { getShellConfig, killProcessTree } from "../../utils/shell.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult, truncateTail } from "./truncate.js";

/**
 * Generate a unique temp file path for bash output
 */
function getTempFilePath(): string {
	const id = randomBytes(8).toString("hex");
	return join(tmpdir(), `pi-bash-${id}.log`);
}

/**
 * Generate a unique temp file path for background process output
 */
function getBackgroundLogPath(): string {
	const id = randomBytes(8).toString("hex");
	return join(tmpdir(), `pi-bash-bg-${id}.log`);
}

const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
	background: Type.Optional(
		Type.Boolean({
			description:
				"Run the command in the background and return immediately. Returns PID and log file path. Use for long-running processes like dev servers.",
		}),
	),
});

export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
	/** True if command was started in background mode */
	backgrounded?: boolean;
	/** PID of the background process */
	pid?: number;
	/** Path to log file containing background process output */
	logFile?: string;
}

/**
 * Execute a command in the background, returning immediately with PID and log file.
 *
 * Redirects output to a log file and runs the command in background.
 * The key is redirecting stdout/stderr BEFORE the &, so the backgrounded
 * process doesn't inherit Node's stdio pipes (which would cause hanging).
 */
function executeBackground(
	command: string,
	cwd: string,
): Promise<{ content: Array<{ type: "text"; text: string }>; details: BashToolDetails }> {
	return new Promise((resolve, reject) => {
		const { shell, args } = getShellConfig();
		const logFile = getBackgroundLogPath();

		// Wrap command to:
		// 1. Run command in a nested shell
		// 2. Redirect stdout/stderr to log file BEFORE backgrounding
		// 3. Redirect stdin from /dev/null
		// 4. Run in background with &
		// 5. Echo the PID so we can capture it
		//
		// The redirects before & ensure the backgrounded process doesn't
		// inherit Node's pipes, avoiding the hanging issue.
		const escapedCommand = command.replace(/'/g, "'\\''");
		const wrappedCommand = `${shell} ${args.map((a) => `'${a}'`).join(" ")} '${escapedCommand}' > '${logFile}' 2>&1 </dev/null & echo $!`;

		const child = spawn(shell, [...args, wrappedCommand], {
			cwd,
			detached: true,
			// Only pipe stdout to capture the PID, ignore stdin and stderr
			stdio: ["ignore", "pipe", "ignore"],
		});

		let stdout = "";

		child.stdout?.on("data", (data: Buffer) => {
			stdout += data.toString();
		});

		child.on("close", (_code) => {
			const pid = parseInt(stdout.trim(), 10);

			if (Number.isNaN(pid)) {
				reject(new Error(`Failed to start background process: could not parse PID from output: ${stdout}`));
				return;
			}

			const outputText = `Started background process (PID ${pid})
Log file: ${logFile}

Use 'read ${logFile}' to check output.
Use 'kill ${pid}' to stop the process.`;

			resolve({
				content: [{ type: "text", text: outputText }],
				details: {
					backgrounded: true,
					pid,
					logFile,
				},
			});
		});

		child.on("error", (err) => {
			reject(new Error(`Failed to start background process: ${err.message}`));
		});

		// Unref so the parent doesn't wait for the detached child
		child.unref();
	});
}

export function createBashTool(cwd: string): AgentTool<typeof bashSchema> {
	return {
		name: "bash",
		label: "bash",
		description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds. Use background=true for long-running processes (dev servers, watch processes) - returns immediately with PID and log file path.`,
		parameters: bashSchema,
		execute: async (
			_toolCallId: string,
			{ command, timeout, background }: { command: string; timeout?: number; background?: boolean },
			signal?: AbortSignal,
			onUpdate?,
		) => {
			// Background mode: start process detached and return immediately
			if (background) {
				return executeBackground(command, cwd);
			}

			return new Promise((resolve, reject) => {
				const { shell, args } = getShellConfig();
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
