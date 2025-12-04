/**
 * MCP Server Discovery via mcporter
 * Discovers available tools and their schemas from an MCP server
 */

import { execSync } from "child_process";

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
}

/**
 * Derive server name from package name
 * @param packageName - npm package name
 * @returns server name for mcporter
 *
 * Examples:
 * - @anthropic-ai/chrome-devtools-mcp@latest -> chrome-devtools
 * - chrome-devtools-mcp -> chrome-devtools
 * - mcp-github -> github
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
 * @param packageName - npm package name
 * @returns directory name
 */
export function deriveDirName(packageName: string): string {
	return deriveServerName(packageName);
}

/**
 * Build the MCP command for npx execution
 * @param packageName - npm package name
 * @returns npx command
 *
 * Examples:
 * - chrome-devtools-mcp -> npx -y chrome-devtools-mcp@latest
 * - @anthropic-ai/chrome-devtools-mcp -> npx -y @anthropic-ai/chrome-devtools-mcp@latest
 * - @anthropic-ai/chrome-devtools-mcp@1.0.0 -> npx -y @anthropic-ai/chrome-devtools-mcp@1.0.0
 */
export function buildMcpCommand(packageName: string): string {
	let pkg = packageName;

	// Add @latest if no version specified
	// Check if package has version: either no @ at all, or only the scope @
	if (!pkg.includes("@") || (pkg.startsWith("@") && !pkg.slice(1).includes("@"))) {
		pkg = `${pkg}@latest`;
	}

	return `npx -y ${pkg}`;
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
	// Use platform-appropriate command to check if pi is in PATH
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
 * Discover tools from an MCP server
 * @param packageName - npm package name
 * @returns Discovery result with server info and tools
 */
export async function discoverTools(packageName: string): Promise<DiscoveryResult> {
	const serverName = deriveServerName(packageName);
	const mcpCommand = buildMcpCommand(packageName);

	// Use mcporter to list tools with schemas in JSON format
	const cmd = `npx mcporter list --stdio "${mcpCommand}" --name "${serverName}" --schema --json`;

	try {
		const output = execSync(cmd, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
			timeout: 60000, // 60 second timeout
		});

		// Parse the JSON output
		const data = JSON.parse(output);

		if (!data.tools || !Array.isArray(data.tools)) {
			throw new Error("Invalid response from mcporter: missing tools array");
		}

		return {
			serverName,
			mcpCommand,
			tools: data.tools,
		};
	} catch (error: any) {
		if (error.killed) {
			throw new Error("Discovery timed out after 60 seconds");
		}
		if (error.stderr) {
			throw new Error(`mcporter error: ${error.stderr}`);
		}
		throw new Error(`Discovery failed: ${error.message}`);
	}
}
