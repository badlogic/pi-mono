/**
 * Docker Sandbox for Secure Code Execution
 * Provides isolated execution environments for Python, Bash, and Node.js code
 */

import { exec, execFile } from "child_process";
import { randomUUID } from "crypto";
import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface ExecutionResult {
	output: string;
	error?: string;
	exitCode?: number;
	executionTime: number;
}

export interface SandboxOptions {
	timeout?: number; // in seconds
	memory?: string; // e.g., "256m"
	cpus?: string; // e.g., "0.5"
	network?: boolean;
	workdir?: string;
}

export class DockerSandbox {
	private readonly defaultTimeout = 30; // seconds
	private readonly maxTimeout = 120; // seconds
	private readonly tempDir: string;

	constructor(tempDir?: string) {
		this.tempDir = tempDir || join(tmpdir(), "discord-bot-sandbox");
	}

	/**
	 * Execute Python code in an isolated Docker container
	 */
	async runPython(code: string, timeout?: number): Promise<ExecutionResult> {
		const safeTimeout = this.getSafeTimeout(timeout);
		const startTime = Date.now();

		try {
			const image = "python:3.11-slim";
			const containerName = `sandbox-python-${randomUUID()}`;

			// Ensure image is available
			await this.ensureImage(image);

			// Create temp directory for this execution
			const execDir = join(this.tempDir, containerName);
			await mkdir(execDir, { recursive: true });

			// Write code to file
			const codeFile = join(execDir, "script.py");
			await writeFile(codeFile, code, "utf-8");

			try {
				const result = await this.runContainer({
					image,
					containerName,
					command: ["python3", "/workspace/script.py"],
					timeout: safeTimeout,
					volumeMount: `${execDir}:/workspace:ro`,
					options: {
						memory: "256m",
						cpus: "0.5",
						network: false,
					},
				});

				const executionTime = Date.now() - startTime;
				return { ...result, executionTime };
			} finally {
				// Cleanup
				await this.cleanup(execDir, containerName);
			}
		} catch (error) {
			const executionTime = Date.now() - startTime;
			return {
				output: "",
				error: this.formatError(error),
				exitCode: 1,
				executionTime,
			};
		}
	}

	/**
	 * Execute Bash commands in an isolated Docker container
	 */
	async runBash(command: string, timeout?: number): Promise<ExecutionResult> {
		const safeTimeout = this.getSafeTimeout(timeout);
		const startTime = Date.now();

		try {
			const image = "alpine:latest";
			const containerName = `sandbox-bash-${randomUUID()}`;

			// Ensure image is available
			await this.ensureImage(image);

			// Create temp directory for this execution
			const execDir = join(this.tempDir, containerName);
			await mkdir(execDir, { recursive: true });

			// Write script to file
			const scriptFile = join(execDir, "script.sh");
			await writeFile(scriptFile, command, "utf-8");

			try {
				const result = await this.runContainer({
					image,
					containerName,
					command: ["sh", "/workspace/script.sh"],
					timeout: safeTimeout,
					volumeMount: `${execDir}:/workspace:ro`,
					options: {
						memory: "256m",
						cpus: "0.5",
						network: false,
					},
				});

				const executionTime = Date.now() - startTime;
				return { ...result, executionTime };
			} finally {
				// Cleanup
				await this.cleanup(execDir, containerName);
			}
		} catch (error) {
			const executionTime = Date.now() - startTime;
			return {
				output: "",
				error: this.formatError(error),
				exitCode: 1,
				executionTime,
			};
		}
	}

	/**
	 * Execute Node.js code in an isolated Docker container
	 */
	async runNode(code: string, timeout?: number): Promise<ExecutionResult> {
		const safeTimeout = this.getSafeTimeout(timeout);
		const startTime = Date.now();

		try {
			const image = "node:20-slim";
			const containerName = `sandbox-node-${randomUUID()}`;

			// Ensure image is available
			await this.ensureImage(image);

			// Create temp directory for this execution
			const execDir = join(this.tempDir, containerName);
			await mkdir(execDir, { recursive: true });

			// Write code to file
			const codeFile = join(execDir, "script.js");
			await writeFile(codeFile, code, "utf-8");

			try {
				const result = await this.runContainer({
					image,
					containerName,
					command: ["node", "/workspace/script.js"],
					timeout: safeTimeout,
					volumeMount: `${execDir}:/workspace:ro`,
					options: {
						memory: "256m",
						cpus: "0.5",
						network: false,
					},
				});

				const executionTime = Date.now() - startTime;
				return { ...result, executionTime };
			} finally {
				// Cleanup
				await this.cleanup(execDir, containerName);
			}
		} catch (error) {
			const executionTime = Date.now() - startTime;
			return {
				output: "",
				error: this.formatError(error),
				exitCode: 1,
				executionTime,
			};
		}
	}

	/**
	 * Run a Docker container with specified parameters
	 */
	private async runContainer(params: {
		image: string;
		containerName: string;
		command: string[];
		timeout: number;
		volumeMount?: string;
		options: SandboxOptions;
	}): Promise<{ output: string; error?: string; exitCode: number }> {
		const { image, containerName, command, timeout, volumeMount, options } = params;

		// Build docker run command
		const dockerArgs = [
			"run",
			"--rm",
			"--name",
			containerName,
			`--memory=${options.memory || "256m"}`,
			`--cpus=${options.cpus || "0.5"}`,
			"--pids-limit=50",
			"--ulimit",
			"nofile=100:100",
			"--security-opt=no-new-privileges",
			"--cap-drop=ALL",
		];

		// Network isolation
		if (options.network === false) {
			dockerArgs.push("--network=none");
		}

		// Volume mount
		if (volumeMount) {
			dockerArgs.push("-v", volumeMount);
		}

		// Working directory
		if (options.workdir) {
			dockerArgs.push("-w", options.workdir);
		}

		// Add image and command
		dockerArgs.push(image, ...command);

		try {
			// Execute with timeout
			const { stdout, stderr } = await execFileAsync("docker", dockerArgs, {
				timeout: timeout * 1000,
				maxBuffer: 1024 * 1024, // 1MB
				killSignal: "SIGKILL",
			});

			return {
				output: stdout,
				error: stderr || undefined,
				exitCode: 0,
			};
		} catch (error: any) {
			// Handle execution errors
			const stdout = error.stdout?.toString() || "";
			const stderr = error.stderr?.toString() || "";
			const exitCode = error.code || 1;

			// If timeout, try to force stop the container
			if (error.killed || error.signal === "SIGKILL") {
				await this.forceStopContainer(containerName);
				return {
					output: stdout,
					error: `Execution timed out after ${timeout} seconds\n${stderr}`,
					exitCode: 124, // Standard timeout exit code
				};
			}

			return {
				output: stdout,
				error: stderr || error.message,
				exitCode,
			};
		}
	}

	/**
	 * Ensure Docker image is available, pull if not
	 */
	private async ensureImage(image: string): Promise<void> {
		try {
			// Check if image exists
			await execAsync(`docker image inspect ${image} > /dev/null 2>&1`);
		} catch {
			// Image doesn't exist, try to pull it
			try {
				console.log(`Pulling Docker image: ${image}`);
				await execAsync(`docker pull ${image}`, {
					timeout: 60000, // 1 minute timeout for pulling
				});
			} catch (pullError) {
				throw new Error(`Failed to pull Docker image ${image}: ${pullError}`);
			}
		}
	}

	/**
	 * Force stop and remove a container
	 */
	private async forceStopContainer(containerName: string): Promise<void> {
		try {
			await execAsync(`docker stop -t 1 ${containerName} 2>/dev/null || true`);
			await execAsync(`docker rm -f ${containerName} 2>/dev/null || true`);
		} catch {
			// Ignore errors during forced cleanup
		}
	}

	/**
	 * Cleanup temporary files and containers
	 */
	private async cleanup(execDir: string, containerName: string): Promise<void> {
		// Remove temp directory
		try {
			await rm(execDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}

		// Ensure container is removed (in case --rm failed)
		try {
			await execAsync(`docker rm -f ${containerName} 2>/dev/null || true`);
		} catch {
			// Ignore cleanup errors
		}
	}

	/**
	 * Get safe timeout value
	 */
	private getSafeTimeout(timeout?: number): number {
		if (!timeout) {
			return this.defaultTimeout;
		}
		return Math.min(Math.max(1, timeout), this.maxTimeout);
	}

	/**
	 * Format error message
	 */
	private formatError(error: any): string {
		if (typeof error === "string") {
			return error;
		}
		if (error instanceof Error) {
			return error.message;
		}
		if (error && typeof error === "object" && error.message) {
			return error.message;
		}
		return "Unknown error occurred";
	}

	/**
	 * Clean up all sandbox resources (call this on shutdown)
	 */
	async cleanupAll(): Promise<void> {
		try {
			// Remove all temp directories
			await rm(this.tempDir, { recursive: true, force: true });

			// Force remove any lingering containers
			const { stdout } = await execAsync(
				`docker ps -a --filter "name=sandbox-" --format "{{.Names}}" 2>/dev/null || true`,
			);

			const containers = stdout.trim().split("\n").filter(Boolean);
			for (const container of containers) {
				try {
					await execAsync(`docker rm -f ${container} 2>/dev/null || true`);
				} catch {
					// Ignore individual cleanup errors
				}
			}
		} catch {
			// Ignore cleanup errors
		}
	}
}
