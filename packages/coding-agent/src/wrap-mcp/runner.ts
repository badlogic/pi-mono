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

/**
 * Extract package name without version suffix
 * Keeps scope for npm packages: @scope/pkg@1.0.0 -> @scope/pkg
 */
function stripVersion(packageName: string): string {
	// For scoped packages (@scope/pkg@version), find @ after the scope
	if (packageName.startsWith("@")) {
		const slashIndex = packageName.indexOf("/");
		if (slashIndex !== -1) {
			const afterSlash = packageName.slice(slashIndex + 1);
			const versionIndex = afterSlash.indexOf("@");
			if (versionIndex !== -1) {
				return packageName.slice(0, slashIndex + 1 + versionIndex);
			}
		}
		return packageName;
	}
	// For non-scoped packages, just remove @version
	return packageName.replace(/@.*$/, "");
}

/**
 * Extract the first paragraph from a README (after the title)
 */
function extractFirstParagraph(readme: string): string | undefined {
	const lines = readme.split("\n");
	let inParagraph = false;
	let paragraph = "";

	for (const line of lines) {
		const trimmed = line.trim();

		// Skip title, badges, empty lines until we find content
		if (!inParagraph) {
			if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("[![") || trimmed.startsWith("![")) {
				continue;
			}
			inParagraph = true;
		}

		// End paragraph on empty line or new heading
		if (inParagraph && (trimmed === "" || trimmed.startsWith("#"))) {
			break;
		}

		paragraph += (paragraph ? " " : "") + trimmed;
	}

	return paragraph || undefined;
}

/**
 * Fetch package description from npm registry
 * Prefers first README paragraph over short description field
 */
async function fetchNpmDescription(packageName: string): Promise<string | undefined> {
	try {
		const pkgName = stripVersion(packageName);
		const response = await fetch(`https://registry.npmjs.org/${pkgName}`, {
			signal: AbortSignal.timeout(5000),
		});
		if (!response.ok) return undefined;
		const data = await response.json();

		// Try to extract first paragraph from README
		if (data.readme) {
			const paragraph = extractFirstParagraph(data.readme);
			if (paragraph && paragraph.length > 20) {
				return paragraph;
			}
		}

		// Fall back to description field
		return data.description;
	} catch {
		return undefined;
	}
}

/**
 * Fetch package description from PyPI
 * Prefers first README paragraph over short summary field
 */
async function fetchPyPIDescription(packageName: string): Promise<string | undefined> {
	try {
		const pkgName = stripVersion(packageName);
		const response = await fetch(`https://pypi.org/pypi/${pkgName}/json`, {
			signal: AbortSignal.timeout(5000),
		});
		if (!response.ok) return undefined;
		const data = await response.json();

		// Try to extract first paragraph from description (README)
		if (data.info?.description) {
			const paragraph = extractFirstParagraph(data.info.description);
			if (paragraph && paragraph.length > 20) {
				return paragraph;
			}
		}

		// Fall back to summary field
		return data.info?.summary;
	} catch {
		return undefined;
	}
}

/**
 * Fetch package description from the appropriate registry
 * @param packageName - Package name
 * @param runnerType - Runner type (determines which registry to query)
 * @returns Package description or undefined if not found
 */
export async function fetchPackageDescription(
	packageName: string,
	runnerType: RunnerType,
): Promise<string | undefined> {
	switch (runnerType) {
		case "npx":
			return fetchNpmDescription(packageName);
		case "uvx":
		case "pip":
			return fetchPyPIDescription(packageName);
		case "command":
			return undefined; // No registry for custom commands
	}
}
