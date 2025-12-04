/**
 * Runner configuration for different MCP server types
 * Supports npx (npm), uvx (PyPI), pip, and custom commands
 */

import { execSync } from "child_process";

export type RunnerType = "npx" | "uvx" | "pip" | "command";

export interface RunnerConfig {
	cmd: string;
	args: string[];
	suffix: string;
	transform?: (pkg: string) => string;
}

/**
 * Convert package name to Python module name
 * mcp-server-fetch -> mcp_server_fetch
 */
export function toModuleName(pkg: string): string {
	return pkg.replace(/-/g, "_");
}

export const RUNNERS: Record<Exclude<RunnerType, "command">, RunnerConfig> = {
	npx: { cmd: "npx", args: ["-y"], suffix: "@latest" },
	uvx: { cmd: "uvx", args: [], suffix: "" },
	pip: { cmd: "python", args: ["-m"], suffix: "", transform: toModuleName },
};

export interface RunnerOptions {
	uvx?: boolean;
	pip?: boolean;
	command?: string;
}

/**
 * Check if explicit runner was specified
 */
export function hasExplicitRunner(options: RunnerOptions): boolean {
	return !!(options.uvx || options.pip || options.command);
}

/**
 * Determine which runner to use based on options
 */
export function getRunnerType(options: RunnerOptions): RunnerType {
	if (options.command) return "command";
	if (options.uvx) return "uvx";
	if (options.pip) return "pip";
	return "npx";
}

/**
 * Build the MCP command for a given package and runner type
 * @param packageName - Package name
 * @param runnerType - Runner type to use
 * @param customCommand - Custom command (required if runnerType is "command")
 * @returns Full command string
 */
export function buildMcpCommand(packageName: string, runnerType: RunnerType, customCommand?: string): string {
	if (runnerType === "command") {
		if (!customCommand) throw new Error("Custom command required for 'command' runner");
		return customCommand;
	}

	const runner = RUNNERS[runnerType];
	let pkg = packageName;

	// Apply transform if defined (e.g., pip: mcp-server-fetch -> mcp_server_fetch)
	if (runner.transform) {
		pkg = runner.transform(pkg);
	}

	// Add suffix if defined and no version specified
	if (runner.suffix) {
		// For npx, check for scoped packages (@scope/pkg)
		const hasVersion =
			runnerType === "npx"
				? pkg.startsWith("@")
					? pkg.slice(1).includes("@")
					: pkg.includes("@")
				: pkg.includes("@");

		if (!hasVersion) {
			pkg = `${pkg}${runner.suffix}`;
		}
	}

	return [runner.cmd, ...runner.args, pkg].join(" ");
}

/**
 * Check if uvx is available
 */
export function checkUvx(): boolean {
	const isWindows = process.platform === "win32";
	const cmd = isWindows ? "where uvx" : "which uvx";
	try {
		execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 });
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if Python is available
 */
export function checkPython(): boolean {
	const isWindows = process.platform === "win32";
	const cmd = isWindows ? "where python" : "which python3 || which python";
	try {
		execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 5000 });
		return true;
	} catch {
		return false;
	}
}
