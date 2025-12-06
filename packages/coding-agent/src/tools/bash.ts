import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { spawn, spawnSync } from "child_process";
import { existsSync } from "fs";
import { SettingsManager } from "../settings-manager.js";

let cachedShellConfig: { shell: string; args: string[] } | null = null;

/**
 * Find bash executable on PATH (Windows)
 */
function findBashOnPath(): string | null {
	try {
		const result = spawnSync("where", ["bash.exe"], { encoding: "utf-8", timeout: 5000 });
		if (result.status === 0 && result.stdout) {
			const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
			if (firstMatch && existsSync(firstMatch)) {
				return firstMatch;
			}
		}
	} catch {
		// Ignore errors
	}
	return null;
}

/**
 * Get shell configuration based on platform.
 * Resolution order:
 * 1. User-specified shellPath in settings.json
 * 2. On Windows: Git Bash in known locations
 * 3. Fallback: bash on PATH (Windows) or sh (Unix)
 */
function getShellConfig(): { shell: string; args: string[] } {
	if (cachedShellConfig) {
		return cachedShellConfig;
	}

	const settings = new SettingsManager();
	const customShellPath = settings.getShellPath();

	// 1. Check user-specified shell path
	if (customShellPath) {
		if (existsSync(customShellPath)) {
			cachedShellConfig = { shell: customShellPath, args: ["-c"] };
			return cachedShellConfig;
		}
		throw new Error(
			`Custom shell path not found: ${customShellPath}\n` + `Please update shellPath in ~/.pi/agent/settings.json`,
		);
	}

	if (process.platform === "win32") {
		// 2. Try Git Bash in known locations
		const paths: string[] = [];
		const programFiles = process.env.ProgramFiles;
		if (programFiles) {
			paths.push(`${programFiles}\\Git\\bin\\bash.exe`);
		}
		const programFilesX86 = process.env["ProgramFiles(x86)"];
		if (programFilesX86) {
			paths.push(`${programFilesX86}\\Git\\bin\\bash.exe`);
		}

		for (const path of paths) {
			if (existsSync(path)) {
				cachedShellConfig = { shell: path, args: ["-c"] };
				return cachedShellConfig;
			}
		}

		// 3. Fallback: search bash.exe on PATH (Cygwin, MSYS2, WSL, etc.)
		const bashOnPath = findBashOnPath();
		if (bashOnPath) {
			cachedShellConfig = { shell: bashOnPath, args: ["-c"] };
			return cachedShellConfig;
		}

		throw new Error(
			`No bash shell found. Options:\n` +
				`  1. Install Git for Windows: https://git-scm.com/download/win\n` +
				`  2. Add your bash to PATH (Cygwin, MSYS2, etc.)\n` +
				`  3. Set shellPath in ~/.pi/agent/settings.json\n\n` +
				`Searched Git Bash in:\n${paths.map((p) => `  ${p}`).join("\n")}`,
		);
	}

	cachedShellConfig = { shell: "sh", args: ["-c"] };
	return cachedShellConfig;
}

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
