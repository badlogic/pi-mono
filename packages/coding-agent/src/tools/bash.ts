import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
});

export const bashTool: AgentTool<typeof bashSchema> = {
	name: "bash",
	label: "bash",
	description:
		"Execute a bash command in the current working directory. Returns stdout and stderr. Commands run with a 30 second timeout.",
	parameters: bashSchema,
	execute: async (_toolCallId: string, { command }: { command: string }) => {
		try {
			const { stdout, stderr } = await execAsync(command, {
				timeout: 30000,
				maxBuffer: 10 * 1024 * 1024, // 10MB
			});

			let output = "";
			if (stdout) output += stdout;
			if (stderr) output += stderr ? `\nSTDERR:\n${stderr}` : "";

			return { output: output || "(no output)", details: undefined };
		} catch (error: any) {
			return {
				output: `Error executing command: ${error.message}\nSTDOUT: ${error.stdout || ""}\nSTDERR: ${error.stderr || ""}`,
				details: undefined,
			};
		}
	},
};
