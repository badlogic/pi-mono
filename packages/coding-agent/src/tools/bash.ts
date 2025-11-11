import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { exec } from "child_process";

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
		return new Promise((resolve) => {
			const child = exec(
				command,
				{
					timeout: 30000,
					maxBuffer: 10 * 1024 * 1024, // 10MB
				},
				(error, stdout, stderr) => {
					if (signal) {
						signal.removeEventListener("abort", onAbort);
					}

					if (signal?.aborted) {
						resolve({
							output: `Command aborted by user\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`,
							details: undefined,
						});
						return;
					}

					let output = "";
					if (stdout) output += stdout;
					if (stderr) output += stderr ? `\nSTDERR:\n${stderr}` : "";

					if (error && !error.killed) {
						resolve({
							output: `Error executing command: ${error.message}\n${output}`,
							details: undefined,
						});
					} else {
						resolve({ output: output || "(no output)", details: undefined });
					}
				},
			);

			// Handle abort signal
			const onAbort = () => {
				child.kill("SIGKILL");
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
