import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { spawn } from "child_process";
import { getShellConfig } from "../shell-config.js";

/**
 * Kill a process and all its children
 */
function killProcessTree(pid: number): void {
	if (process.platform === "win32") {
		// Use taskkill on Windows to kill process tree
		try {
			spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
				stdio: "ignore",
				detached: true,
			});
		} catch (e) {
			// Ignore errors if taskkill fails
		}
	} else {
		// Use SIGKILL on Unix/Linux/Mac
		try {
			process.kill(-pid, "SIGKILL");
		} catch (e) {
			// Fallback to killing just the child if process group kill fails
			try {
				process.kill(pid, "SIGKILL");
			} catch (e2) {
				// Process already dead
			}
		}
	}
}

const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
});

export const bashTool: AgentTool<typeof bashSchema> = {
	name: "bash",
	label: "bash",
	description:
		"Execute a bash command in the current working directory. Returns stdout and stderr. Optionally provide a timeout in seconds.",
	parameters: bashSchema,
	execute: async (
		_toolCallId: string,
		{ command, timeout }: { command: string; timeout?: number },
		signal?: AbortSignal,
	) => {
		return new Promise((resolve, _reject) => {
			const { shell, args } = getShellConfig();
			const child = spawn(shell, [...args, command], {
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let stdout = "";
			let stderr = "";
			let timedOut = false;

			// Set timeout if provided
			let timeoutHandle: NodeJS.Timeout | undefined;
			if (timeout !== undefined && timeout > 0) {
				timeoutHandle = setTimeout(() => {
					timedOut = true;
					onAbort();
				}, timeout * 1000);
			}

			// Collect stdout
			if (child.stdout) {
				child.stdout.on("data", (data) => {
					stdout += data.toString();
					// Limit buffer size
					if (stdout.length > 10 * 1024 * 1024) {
						stdout = stdout.slice(0, 10 * 1024 * 1024);
					}
				});
			}

			// Collect stderr
			if (child.stderr) {
				child.stderr.on("data", (data) => {
					stderr += data.toString();
					// Limit buffer size
					if (stderr.length > 10 * 1024 * 1024) {
						stderr = stderr.slice(0, 10 * 1024 * 1024);
					}
				});
			}

			// Handle process exit
			child.on("close", (code) => {
				if (timeoutHandle) {
					clearTimeout(timeoutHandle);
				}
				if (signal) {
					signal.removeEventListener("abort", onAbort);
				}

				if (signal?.aborted) {
					let output = "";
					if (stdout) output += stdout;
					if (stderr) {
						if (output) output += "\n";
						output += stderr;
					}
					if (output) output += "\n\n";
					output += "Command aborted";
					_reject(new Error(output));
					return;
				}

				if (timedOut) {
					let output = "";
					if (stdout) output += stdout;
					if (stderr) {
						if (output) output += "\n";
						output += stderr;
					}
					if (output) output += "\n\n";
					output += `Command timed out after ${timeout} seconds`;
					_reject(new Error(output));
					return;
				}

				let output = "";
				if (stdout) output += stdout;
				if (stderr) {
					if (output) output += "\n";
					output += stderr;
				}

				if (code !== 0 && code !== null) {
					if (output) output += "\n\n";
					_reject(new Error(`${output}Command exited with code ${code}`));
				} else {
					resolve({ content: [{ type: "text", text: output || "(no output)" }], details: undefined });
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
