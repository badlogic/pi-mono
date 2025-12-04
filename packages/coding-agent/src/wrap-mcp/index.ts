/**
 * /wrap-mcp Command
 * Converts MCP servers into standalone CLI tools for Pi agent
 * Supports npm packages (npx), Python packages (uvx/pip), and custom commands
 */

import { checkMcporter, checkPi, deriveDirName, deriveServerName, discoverTools } from "./discovery.js";
import {
	generateAgentsEntry,
	generateFallbackWrapper,
	generatePackageJson,
	generateReadme,
	generateWrapper,
} from "./generator.js";
import { fallbackGrouping, groupTools, type ToolGroup } from "./grouping.js";
import { getDefaultOutputDir, outputExists, resolvePath, writeOutput } from "./output.js";
import { detectLocalAgentsFile, getGlobalAgentsPath, registerEntry } from "./registration.js";
import { checkPython, checkUvx, type RunnerOptions } from "./runner.js";

export interface WrapMcpOptions {
	packageName: string;
	name?: string;
	local?: boolean;
	force?: boolean;
	// Runner options
	uvx?: boolean;
	pip?: boolean;
	command?: string;
	onProgress?: (message: string) => void;
}

export interface WrapMcpResult {
	success: boolean;
	outputDir?: string;
	toolCount?: number;
	registeredPath?: string;
	error?: string;
}

/**
 * Parse /wrap-mcp command arguments
 * @param text - Full command text (e.g., "/wrap-mcp chrome-devtools-mcp --local")
 * @returns Parsed arguments
 */
export function parseWrapMcpArgs(text: string): {
	packageName?: string;
	name?: string;
	local: boolean;
	force: boolean;
	help: boolean;
	uvx: boolean;
	pip: boolean;
	command?: string;
} {
	const parts = text
		.split(/\s+/)
		.slice(1) // Remove "/wrap-mcp"
		.filter((p) => p.length > 0); // Remove empty strings from trailing whitespace

	const args: ReturnType<typeof parseWrapMcpArgs> = {
		local: false,
		force: false,
		help: false,
		uvx: false,
		pip: false,
	};

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part === "--help" || part === "-h") {
			args.help = true;
		} else if (part === "--local") {
			args.local = true;
		} else if (part === "--force" || part === "-f") {
			args.force = true;
		} else if (part === "--uvx") {
			args.uvx = true;
		} else if (part === "--pip") {
			args.pip = true;
		} else if (part === "--command" && parts[i + 1] && !parts[i + 1].startsWith("-")) {
			args.command = parts[++i];
		} else if (part === "--name" && parts[i + 1] && !parts[i + 1].startsWith("-")) {
			args.name = parts[++i];
		} else if (!part.startsWith("-") && !args.packageName) {
			args.packageName = part;
		}
	}

	return args;
}

/**
 * Wrap an MCP server into CLI tools
 * @param options - Wrapping options
 * @returns Result object
 */
export async function wrapMcp(options: WrapMcpOptions): Promise<WrapMcpResult> {
	const { packageName, name, local = false, force = false, uvx = false, pip = false, command, onProgress } = options;

	const progress = (msg: string) => onProgress?.(msg);
	const runnerOptions: RunnerOptions = { uvx, pip, command };

	try {
		// Step 1: Check dependencies
		progress("Checking dependencies...");
		if (!checkMcporter()) {
			return {
				success: false,
				error: "mcporter not available. Install Node.js 18+ and try again.",
			};
		}

		// Check explicit runner dependencies (only if explicitly requested)
		if (uvx && !checkUvx()) {
			return {
				success: false,
				error: "uvx not available. Install uv: https://docs.astral.sh/uv/",
			};
		}
		if (pip && !checkPython()) {
			return {
				success: false,
				error: "Python not available. Install Python 3.8+",
			};
		}
		if (command && !name) {
			return {
				success: false,
				error: "--command requires --name to specify output directory",
			};
		}

		// Validate mutual exclusivity of runner flags
		const runnerCount = [uvx, pip, !!command].filter(Boolean).length;
		if (runnerCount > 1) {
			return {
				success: false,
				error: "Runner flags --uvx, --pip, and --command are mutually exclusive",
			};
		}

		const piAvailable = checkPi();
		if (!piAvailable) {
			progress("Pi CLI not found, will use fallback wrappers");
		}

		// Step 2: Derive names
		const dirName = name || deriveDirName(packageName);
		const serverName = deriveServerName(packageName);
		const outputDir = getDefaultOutputDir(dirName);

		// Step 3: Check if output exists
		if (outputExists(outputDir) && !force) {
			return {
				success: false,
				error: `Output directory exists: ${resolvePath(outputDir)}\nUse --force to overwrite.`,
			};
		}

		// Step 4: Discover tools (with auto-detection if no explicit runner)
		progress(`Discovering tools from ${packageName}...`);
		const discovery = await discoverTools(packageName, runnerOptions, progress);
		progress(`Found ${discovery.tools.length} tools (via ${discovery.runner})`);

		if (discovery.tools.length === 0) {
			return {
				success: false,
				error: "No tools found in MCP server",
			};
		}

		// Step 5: Group tools
		progress("Grouping tools...");
		let groups: ToolGroup[];

		if (piAvailable) {
			try {
				groups = await groupTools(serverName, discovery.tools);
				progress(`Created ${groups.length} groups`);
			} catch (error: any) {
				// Fall back to 1:1 mapping
				progress("Grouping failed, using 1:1 mapping...");
				groups = fallbackGrouping(serverName, discovery.tools);
				progress(`Created ${groups.length} groups (fallback)`);
			}
		} else {
			// Pi not available, use fallback grouping
			groups = fallbackGrouping(serverName, discovery.tools);
			progress(`Created ${groups.length} groups (fallback - pi not available)`);
		}

		// Step 6: Generate wrappers
		const files: Record<string, string> = {};

		for (let i = 0; i < groups.length; i++) {
			const group = groups[i];
			progress(`Generating wrapper ${i + 1}/${groups.length}: ${group.filename}...`);

			if (piAvailable) {
				try {
					const code = await generateWrapper(group, discovery.tools, serverName, discovery.mcpCommand);
					files[group.filename] = code;
				} catch {
					// Fall back to basic wrapper
					progress(`Generation failed for ${group.filename}, using fallback...`);
					files[group.filename] = generateFallbackWrapper(
						group,
						discovery.tools,
						serverName,
						discovery.mcpCommand,
					);
				}
			} else {
				// Pi not available, use fallback wrapper
				files[group.filename] = generateFallbackWrapper(group, discovery.tools, serverName, discovery.mcpCommand);
			}
		}

		// Step 7: Generate supporting files
		progress("Generating supporting files...");
		files["package.json"] = generatePackageJson(dirName, `${serverName} automation`);
		files["README.md"] = generateReadme(dirName, groups);
		files["AGENTS-ENTRY.md"] = generateAgentsEntry(dirName, groups);

		// Step 8: Write files
		progress("Writing files...");
		writeOutput(outputDir, files, { force });

		// Step 9: Register to AGENTS.md
		progress("Registering tools...");
		const targetPath = local ? detectLocalAgentsFile() : getGlobalAgentsPath();
		const agentsEntry = files["AGENTS-ENTRY.md"];
		const regResult = registerEntry(targetPath, agentsEntry);

		if (!regResult.success) {
			return {
				success: true,
				outputDir: resolvePath(outputDir),
				toolCount: groups.length,
				error: `Tools created but registration failed: ${regResult.error}`,
			};
		}

		progress("Done!");

		return {
			success: true,
			outputDir: resolvePath(outputDir),
			toolCount: groups.length,
			registeredPath: targetPath,
		};
	} catch (error: any) {
		return {
			success: false,
			error: error.message || "Unknown error",
		};
	}
}

// Re-export types for convenience
export type { DiscoveryResult, McpTool } from "./discovery.js";
export type { ToolGroup } from "./grouping.js";
export type { RunnerOptions, RunnerType } from "./runner.js";
