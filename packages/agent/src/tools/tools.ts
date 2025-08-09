import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { glob } from "glob";
import type { ChatCompletionTool } from "openai/resources";

// For GPT-OSS models via responses API
export const toolsForResponses = [
	{
		type: "function" as const,
		name: "read",
		description: "Read contents of a file",
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Path to the file to read",
				},
			},
			required: ["path"],
		},
	},
	{
		type: "function" as const,
		name: "list",
		description: "List contents of a directory",
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: "Path to the directory (default: current directory)",
				},
			},
		},
	},
	{
		type: "function" as const,
		name: "bash",
		description: "Execute a command in Bash",
		parameters: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description: "Command to execute",
				},
			},
			required: ["command"],
		},
	},
	{
		type: "function" as const,
		name: "glob",
		description: "Find files matching a glob pattern",
		parameters: {
			type: "object",
			properties: {
				pattern: {
					type: "string",
					description: "Glob pattern to match files (e.g., '**/*.ts', 'src/**/*.json')",
				},
				path: {
					type: "string",
					description: "Directory to search in (default: current directory)",
				},
			},
			required: ["pattern"],
		},
	},
	{
		type: "function" as const,
		name: "rg",
		description: "Search using ripgrep.",
		parameters: {
			type: "object",
			properties: {
				args: {
					type: "string",
					description:
						'Arguments to pass directly to ripgrep. Examples: "-l prompt" or "-i TODO" or "--type ts className" or "functionName src/". Never add quotes around the search pattern.',
				},
			},
			required: ["args"],
		},
	},
];

// For standard chat API (OpenAI format)
export const toolsForChat: ChatCompletionTool[] = toolsForResponses.map((tool) => ({
	type: "function" as const,
	function: {
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	},
}));

// Helper to execute commands with abort support
async function execWithAbort(command: string, signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, {
			shell: true,
			signal,
		});

		let stdout = "";
		let stderr = "";
		const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB limit
		let outputTruncated = false;

		child.stdout?.on("data", (data) => {
			const chunk = data.toString();
			if (stdout.length + chunk.length > MAX_OUTPUT_SIZE) {
				if (!outputTruncated) {
					stdout += "\n... [Output truncated - exceeded 1MB limit] ...";
					outputTruncated = true;
				}
			} else {
				stdout += chunk;
			}
		});

		child.stderr?.on("data", (data) => {
			const chunk = data.toString();
			if (stderr.length + chunk.length > MAX_OUTPUT_SIZE) {
				if (!outputTruncated) {
					stderr += "\n... [Output truncated - exceeded 1MB limit] ...";
					outputTruncated = true;
				}
			} else {
				stderr += chunk;
			}
		});

		child.on("error", (error) => {
			reject(error);
		});

		child.on("close", (code) => {
			if (signal?.aborted) {
				reject(new Error("Interrupted"));
			} else if (code !== 0 && code !== null) {
				// For some commands like ripgrep, exit code 1 is normal (no matches)
				if (code === 1 && command.includes("rg")) {
					resolve(""); // No matches for ripgrep
				} else if (stderr && !stdout) {
					reject(new Error(stderr));
				} else {
					resolve(stdout || "");
				}
			} else {
				resolve(stdout || stderr || "");
			}
		});

		// Kill the process if signal is aborted
		if (signal) {
			signal.addEventListener(
				"abort",
				() => {
					child.kill("SIGTERM");
				},
				{ once: true },
			);
		}
	});
}

export async function executeTool(name: string, args: string, signal?: AbortSignal): Promise<string> {
	const parsed = JSON.parse(args);

	switch (name) {
		case "read": {
			const path = parsed.path;
			if (!path) return "Error: path parameter is required";
			const file = resolve(path);
			if (!existsSync(file)) return `File not found: ${file}`;

			// Check file size before reading
			const stats = statSync(file);
			const MAX_FILE_SIZE = 1024 * 1024; // 1MB limit
			if (stats.size > MAX_FILE_SIZE) {
				// Read only the first 1MB
				const fd = openSync(file, "r");
				const buffer = Buffer.alloc(MAX_FILE_SIZE);
				readSync(fd, buffer, 0, MAX_FILE_SIZE, 0);
				closeSync(fd);
				return buffer.toString("utf8") + "\n\n... [File truncated - exceeded 1MB limit] ...";
			}

			const data = readFileSync(file, "utf8");
			return data;
		}

		case "list": {
			const path = parsed.path || ".";
			const dir = resolve(path);
			if (!existsSync(dir)) return `Directory not found: ${dir}`;
			const entries = readdirSync(dir, { withFileTypes: true });
			return entries.map((entry) => (entry.isDirectory() ? entry.name + "/" : entry.name)).join("\n");
		}

		case "bash": {
			const command = parsed.command;
			if (!command) return "Error: command parameter is required";
			try {
				const output = await execWithAbort(command, signal);
				return output || "Command executed successfully";
			} catch (e: any) {
				if (e.message === "Interrupted") {
					throw e; // Re-throw interruption
				}
				throw new Error(`Command failed: ${e.message}`);
			}
		}

		case "glob": {
			const pattern = parsed.pattern;
			if (!pattern) return "Error: pattern parameter is required";
			const searchPath = parsed.path || process.cwd();

			try {
				const matches = await glob(pattern, {
					cwd: searchPath,
					dot: true,
					nodir: false,
					mark: true, // Add / to directories
				});

				if (matches.length === 0) {
					return "No files found matching the pattern";
				}

				// Sort by modification time (most recent first) if possible
				return matches.sort().join("\n");
			} catch (e: any) {
				return `Glob error: ${e.message}`;
			}
		}

		case "rg": {
			const args = parsed.args;
			if (!args) return "Error: args parameter is required";

			// Force ripgrep to never read from stdin by redirecting stdin from /dev/null
			const cmd = `rg ${args} < /dev/null`;

			try {
				const output = await execWithAbort(cmd, signal);
				return output.trim() || "No matches found";
			} catch (e: any) {
				if (e.message === "Interrupted") {
					throw e; // Re-throw interruption
				}
				return `ripgrep error: ${e.message}`;
			}
		}

		default:
			return `Unknown tool: ${name}`;
	}
}
