/**
 * MCP Server Discovery via mcporter
 * Discovers available tools and their schemas from an MCP server
 * Supports auto-detection between npm and PyPI packages
 */

import { execSync, spawn } from "child_process";
import { existsSync } from "fs";
import {
	buildMcpCommand,
	checkUvx,
	fetchPackageDescription,
	getRunnerType,
	hasExplicitRunner,
	type RunnerOptions,
	type RunnerType,
} from "./runner.js";

export interface McpTool {
	name: string;
	description?: string;
	inputSchema?: {
		properties?: Record<string, any>;
		required?: string[];
	};
}

export interface DiscoveryResult {
	serverName: string;
	mcpCommand: string;
	tools: McpTool[];
	runner: RunnerType;
	description?: string;
}

/**
 * Derive server name from package name
 * @param packageName - Package name (npm or PyPI)
 * @returns server name for mcporter
 *
 * Examples:
 * - @anthropic-ai/chrome-devtools-mcp@latest -> chrome-devtools
 * - chrome-devtools-mcp -> chrome-devtools
 * - mcp-github -> github
 * - mcp-server-fetch -> server-fetch
 */
export function deriveServerName(packageName: string): string {
	const name = packageName
		.replace(/^@[^/]+\//, "") // Remove scope
		.replace(/@.*$/, "") // Remove version
		.replace(/-mcp$/, "") // Remove -mcp suffix
		.replace(/^mcp-/, ""); // Remove mcp- prefix

	return name;
}

/**
 * Derive output directory name from package name
 * @param packageName - Package name
 * @returns directory name
 */
export function deriveDirName(packageName: string): string {
	return deriveServerName(packageName);
}

/**
 * Check if mcporter is available via npx
 * @returns true if mcporter can be run
 */
export function checkMcporter(): boolean {
	try {
		execSync("npx mcporter --version", {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 30000,
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if pi CLI is available
 * Uses `which pi` (Unix) or `where pi` (Windows) instead of `pi --version`
 * to avoid launching interactive TUI
 * @returns true if pi is in PATH
 */
export function checkPi(): boolean {
	const isWindows = process.platform === "win32";
	const cmd = isWindows ? "where pi" : "which pi";

	try {
		execSync(cmd, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 5000,
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * Get shell configuration based on platform
 */
function getShellConfig(): { shell: string; args: string[] } {
	if (process.platform === "win32") {
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
				return { shell: path, args: ["-c"] };
			}
		}

		throw new Error(
			"Git Bash not found. Please install Git for Windows from https://git-scm.com/download/win\n" +
				`Searched in:\n${paths.map((p) => `  ${p}`).join("\n")}`,
		);
	}
	return { shell: "sh", args: ["-c"] };
}

/**
 * Run a shell command asynchronously (non-blocking)
 * @param cmd - Command to run
 * @param timeout - Timeout in ms
 * @returns stdout output
 */
export function execAsync(cmd: string, timeout: number): Promise<string> {
	const { shell, args } = getShellConfig();

	return new Promise((resolve, reject) => {
		const child = spawn(shell, [...args, cmd], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let timedOut = false;

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
		}, timeout);

		child.stdout?.on("data", (data) => {
			stdout += data.toString();
		});

		child.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		child.on("close", (code) => {
			clearTimeout(timer);
			if (timedOut) {
				reject(new Error("Command timed out"));
			} else if (code !== 0) {
				reject(new Error(stderr || `Command exited with code ${code}`));
			} else {
				resolve(stdout);
			}
		});

		child.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

/**
 * Run a shell command asynchronously, capturing stdout and stderr separately
 * Unlike execAsync, this always resolves (unless timeout/spawn error) and lets caller handle errors
 * @param cmd - Command to run
 * @param timeout - Timeout in ms
 * @returns Object with stdout and stderr
 */
export function execAsyncWithStderr(cmd: string, timeout: number): Promise<{ stdout: string; stderr: string }> {
	const { shell, args } = getShellConfig();

	return new Promise((resolve, reject) => {
		const child = spawn(shell, [...args, cmd], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		let timedOut = false;

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
		}, timeout);

		child.stdout?.on("data", (data) => {
			stdout += data.toString();
		});

		child.stderr?.on("data", (data) => {
			stderr += data.toString();
		});

		child.on("close", () => {
			clearTimeout(timer);
			if (timedOut) {
				reject(new Error("Command timed out"));
			} else {
				// Always resolve with stdout/stderr, let caller handle errors
				// mcporter exits 0 even when server is offline
				resolve({ stdout, stderr });
			}
		});

		child.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
	});
}

/**
 * Check if error indicates npm package not found
 */
export function isNpmNotFoundError(stderr: string): boolean {
	const lower = stderr.toLowerCase();
	return lower.includes("e404") || lower.includes("404 not found") || lower.includes("is not in this registry");
}

/**
 * Check if error indicates uvx/PyPI package not found
 */
export function isUvxNotFoundError(stderr: string): boolean {
	const lower = stderr.toLowerCase();
	return lower.includes("no solution found") || lower.includes("not found in the package registry");
}

interface McporterResult {
	status: "ok" | "offline" | string;
	tools?: McpTool[];
	error?: string;
}

/**
 * Escape a string for safe use in shell double quotes
 * Escapes: $ ` \ " !
 */
function shellEscape(str: string): string {
	return str.replace(/[\\$`"!]/g, "\\$&");
}

/**
 * Run mcporter and capture both JSON result and stderr
 * Note: mcporter outputs error info to stdout with "[mcporter] stderr from" prefix,
 * followed by JSON. We need to extract the JSON and treat the prefix as stderr.
 */
async function runMcporter(
	mcpCommand: string,
	serverName: string,
): Promise<{ result: McporterResult; stderr: string }> {
	const safeMcpCommand = shellEscape(mcpCommand);
	const safeServerName = shellEscape(serverName);
	const cmd = `npx mcporter list --stdio "${safeMcpCommand}" --name "${safeServerName}" --schema --json`;

	const { stdout, stderr } = await execAsyncWithStderr(cmd, 60000);

	// mcporter outputs error messages to stdout with "[mcporter] stderr" prefix,
	// followed by JSON starting with "{". Extract the JSON and treat prefix as stderr.
	let jsonStr = stdout;
	let mcporterStderr = stderr;

	const jsonStart = stdout.indexOf("{");
	if (jsonStart > 0) {
		// There's content before the JSON - treat it as stderr info
		mcporterStderr = stdout.slice(0, jsonStart) + (stderr ? `\n${stderr}` : "");
		jsonStr = stdout.slice(jsonStart);
	}

	try {
		const result = JSON.parse(jsonStr);
		return { result, stderr: mcporterStderr };
	} catch {
		// Include all output in error message for debugging
		const stderrHint = mcporterStderr ? `\nstderr: ${mcporterStderr.slice(0, 200)}` : "";
		throw new Error(`Invalid JSON from mcporter: ${jsonStr.slice(0, 200)}${stderrHint}`);
	}
}

/**
 * Try discovery with a specific runner
 * Fetches package description in parallel with mcporter call
 */
async function tryRunner(
	packageName: string,
	serverName: string,
	runnerType: RunnerType,
	customCommand?: string,
): Promise<{ discovery: DiscoveryResult; stderr: string } | { error: Error; stderr: string }> {
	const mcpCommand = buildMcpCommand(packageName, runnerType, customCommand);

	// Run mcporter and description fetch in parallel
	const [mcporterResult, description] = await Promise.all([
		runMcporter(mcpCommand, serverName).catch((error) => ({ error })),
		fetchPackageDescription(packageName, runnerType),
	]);

	// Handle mcporter error
	if ("error" in mcporterResult) {
		return { error: mcporterResult.error, stderr: "" };
	}

	const { result, stderr } = mcporterResult;

	if (result.status !== "ok" || !result.tools) {
		return { error: new Error(result.error || "Discovery failed"), stderr };
	}

	return {
		discovery: {
			serverName,
			mcpCommand,
			tools: result.tools,
			runner: runnerType,
			description,
		},
		stderr,
	};
}

/**
 * Discover tools from an MCP server with auto-detection
 *
 * If no explicit runner specified:
 * 1. Try npx first
 * 2. If npm 404 error, try uvx
 * 3. If both fail, throw descriptive error
 *
 * @param packageName - Package name
 * @param options - Runner options (uvx, pip, command)
 * @param onProgress - Progress callback
 * @returns Discovery result with server info, tools, and runner used
 */
export async function discoverTools(
	packageName: string,
	options: RunnerOptions = {},
	onProgress?: (msg: string) => void,
): Promise<DiscoveryResult> {
	const serverName = deriveServerName(packageName);

	// If explicit runner specified, use it directly (no fallback)
	if (hasExplicitRunner(options)) {
		const runnerType = getRunnerType(options);
		const result = await tryRunner(packageName, serverName, runnerType, options.command);

		if ("error" in result) {
			throw new Error(`Discovery failed with ${runnerType}: ${result.error.message}`);
		}
		return result.discovery;
	}

	// Auto-detection: try npx first
	onProgress?.("Trying npm...");
	const npxResult = await tryRunner(packageName, serverName, "npx");

	if ("discovery" in npxResult) {
		return npxResult.discovery;
	}

	// npx failed - check if it's a "not found" error
	if (!isNpmNotFoundError(npxResult.stderr)) {
		// Not a 404, some other error - don't fallback
		throw npxResult.error;
	}

	// npm 404 - try uvx fallback
	onProgress?.("Not found on npm, trying uvx...");

	// Check if uvx is available before trying
	if (!checkUvx()) {
		throw new Error(
			`Package "${packageName}" not found on npm.\n` + "To try PyPI, install uv: https://docs.astral.sh/uv/",
		);
	}

	const uvxResult = await tryRunner(packageName, serverName, "uvx");

	if ("discovery" in uvxResult) {
		return uvxResult.discovery;
	}

	// Both failed
	if (isUvxNotFoundError(uvxResult.stderr)) {
		throw new Error(`Package "${packageName}" not found on npm or PyPI`);
	}

	// uvx failed for another reason
	throw new Error(`Discovery failed with uvx: ${uvxResult.error.message}`);
}
