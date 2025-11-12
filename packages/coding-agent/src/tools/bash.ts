import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { spawn } from "child_process";

const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
});

export const bashTool: AgentTool<typeof bashSchema> = {
	name: "bash",
	label: "bash",
	description:
		"Execute a bash command in the current working directory. Returns stdout and stderr. Commands run with a 30 second timeout.",
	parameters: bashSchema,
	execute: async (_toolCallId: string, { command }: { command: string }, signal?: AbortSignal) => {
		return new Promise((resolve, reject) => {
			const child = spawn("sh", ["-c", command], {
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let stdout = "";
			let stderr = "";
			let timedOut = false;

			// Set timeout
			const timeout = setTimeout(() => {
				timedOut = true;
				onAbort();
			}, 30000);

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
				clearTimeout(timeout);
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
					reject(new Error(output));
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
					output += "Command timed out after 30 seconds";
					reject(new Error(output));
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
					reject(new Error(`${output}Command exited with code ${code}`));
				} else {
					resolve({ content: [{ type: "text", text: output || "(no output)" }], details: undefined });
				}
			});

			// Handle abort signal - kill entire process tree
			const onAbort = () => {
				if (child.pid) {
					// Kill the entire process group (negative PID kills all processes in the group)
					try {
						process.kill(-child.pid, "SIGKILL");
					} catch (e) {
						// Fallback to killing just the child if process group kill fails
						try {
							child.kill("SIGKILL");
						} catch (e2) {
							// Process already dead
						}
					}
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
