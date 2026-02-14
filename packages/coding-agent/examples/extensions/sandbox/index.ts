/**
 * Sandbox Extension - OS-level sandboxing for bash commands
 *
 * Uses @anthropic-ai/sandbox-runtime to enforce filesystem and network
 * restrictions on bash commands at the OS level (sandbox-exec on macOS,
 * bubblewrap on Linux).
 *
 * Config files (merged, project takes precedence):
 * - ~/.pi/agent/sandbox.json (global)
 * - <cwd>/.pi/sandbox.json (project-local)
 *
 * Example .pi/sandbox.json:
 * ```json
 * {
 *   "enabled": true,
 *   "network": {
 *     "allowedDomains": ["github.com", "*.github.com"],
 *     "deniedDomains": [],
 * 	   "allowUnixSockets": ['/tmp/tmux-1000/pi']
 *   },
 *   "filesystem": {
 *     "denyRead": ["~/.ssh", "~/.aws"],
 *     "allowWrite": [".", "/tmp"],
 *     "denyWrite": [".env"]
 *   }
 * }
 * ```
 *
 * Usage:
 * - `pi -e ./sandbox` - sandbox enabled with default/config settings
 * - `pi -e ./sandbox --no-sandbox` - disable sandboxing
 * - `/sandbox` - show current sandbox configuration
 *
 * Setup:
 * 1. Copy sandbox/ directory to ~/.pi/agent/extensions/
 * 2. Run `npm install` in ~/.pi/agent/extensions/sandbox/
 *
 * Linux also requires: bubblewrap, socat, ripgrep
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { type BashOperations, createBashTool } from "@mariozechner/pi-coding-agent";
import { minimatch } from "minimatch";

interface SandboxConfig extends SandboxRuntimeConfig {
	enabled?: boolean;
}

export const DEFAULT_CONFIG: SandboxConfig = {
	enabled: true,
	network: {
		allowedDomains: [
			"npmjs.org",
			"*.npmjs.org",
			"registry.npmjs.org",
			"registry.yarnpkg.com",
			"pypi.org",
			"*.pypi.org",
			"github.com",
			"*.github.com",
			"api.github.com",
			"raw.githubusercontent.com",
		],
		deniedDomains: [],
	},
	filesystem: {
		denyRead: ["~/.ssh", "~/.aws", "~/.gnupg"],
		allowWrite: [".", "/tmp"],
		denyWrite: [".env", ".env.*", "*.pem", "*.key"],
	},
};

/**
 * Expand ~ to home directory
 */
export function expandPath(filePath: string): string {
	if (filePath.startsWith("~")) {
		return join(homedir(), filePath.slice(1));
	}
	return filePath;
}

/**
 * Resolve path into an absolute path
 */
export function resolvePath(filePath: string, cwd: string): string {
	const expanded = expandPath(filePath);
	if (isAbsolute(expanded)) {
		return resolve(expanded);
	}
	return resolve(cwd, expanded);
}

/**
 * Check if a path matches any of the given glob patterns
 * Uses platform-appropriate matching:
 * - macOS: git-style glob patterns (*, **, ?, [abc])
 * - Linux: exact literal path or prefix matching only
 */
export function matchesAnyPattern(
	path: string,
	patterns: string[],
	cwd: string,
	platform: string,
): { matched: boolean; pattern: string } {
	const resolvedPath = resolvePath(path, cwd);
	const _resolvedCwd = resolvePath(cwd, cwd);

	for (const pattern of patterns) {
		// Expand ~ in pattern and resolve against CWD
		const resolvedPattern = resolvePath(pattern, cwd);

		if (platform === "darwin") {
			// macOS: Use minimatch with git-style glob patterns
			// minimatch with ** matches any characters including /
			if (minimatch(resolvedPath, resolvedPattern, { dot: true, nocase: true })) {
				return { matched: true, pattern };
			}
		} else {
			// Linux: Behave like sandbox-runtime - literal path matching only (no glob support)
			// Check if path starts with the pattern (for directory prefixes)
			// or exact match
			if (resolvedPath === resolvedPattern || resolvedPath.startsWith(resolvedPattern + sep)) {
				return { matched: true, pattern };
			}
		}
	}

	return { matched: false, pattern: "" };
}

/**
 * Check if path is allowed for read operations
 *
 * DENY-ONLY pattern: By default, read access is allowed everywhere.
 * You can deny specific paths. An empty deny list means full read access.
 */
export function isReadAllowed(
	path: string,
	cwd: string,
	config: SandboxConfig,
	platform: string,
): { allowed: boolean; reason?: string } {
	const denyRead = config.filesystem?.denyRead ?? [];

	// Empty denyRead = full read access (default allow)
	if (denyRead.length === 0) {
		return { allowed: true };
	}

	// If denyRead is non-empty, check if path matches any deny pattern
	const denyReadMatch = matchesAnyPattern(path, denyRead, cwd, platform);
	if (denyReadMatch.matched) {
		return { allowed: false, reason: `Path matches denyRead pattern: ${denyReadMatch.pattern}` };
	}

	// Path doesn't match any deny pattern = allowed
	return { allowed: true };
}

/**
 * Check if path is allowed for write operations
 *
 * ALLOW-ONLY pattern: By default, write access is denied everywhere.
 * You must explicitly allow paths. An empty allow list means no write access.
 * denyWrite creates exceptions within allowed paths (takes precedence over allowWrite).
 */
export function isWriteAllowed(
	path: string,
	cwd: string,
	config: SandboxConfig,
	platform: string,
): { allowed: boolean; reason?: string } {
	const allowWrite = config.filesystem?.allowWrite ?? [];
	const denyWrite = config.filesystem?.denyWrite ?? [];

	// Empty allowWrite = no write access (default deny)
	if (allowWrite.length === 0) {
		return { allowed: false, reason: `Write access not allowed (allowWrite is empty)` };
	}

	// Check denyWrite patterns (takes precedence over allowWrite)
	const denyWriteMatch = matchesAnyPattern(path, denyWrite, cwd, platform);
	if (denyWrite.length > 0 && denyWriteMatch.matched) {
		return { allowed: false, reason: `Path matches denyWrite pattern: ${denyWriteMatch.pattern}` };
	}

	// Path MUST match one of the allowWrite patterns
	const allowWriteMatch = matchesAnyPattern(path, allowWrite, cwd, platform);
	if (!allowWriteMatch.matched) {
		return { allowed: false, reason: `Path does not match any allowWrite pattern` };
	}

	return { allowed: true };
}

function loadConfig(cwd: string): SandboxConfig {
	const projectConfigPath = join(cwd, ".pi", "sandbox.json");
	const globalConfigPath = join(homedir(), ".pi", "agent", "sandbox.json");

	let globalConfig: Partial<SandboxConfig> = {};
	let projectConfig: Partial<SandboxConfig> = {};

	if (existsSync(globalConfigPath)) {
		try {
			globalConfig = JSON.parse(readFileSync(globalConfigPath, "utf-8"));
		} catch (e) {
			console.error(`Warning: Could not parse ${globalConfigPath}: ${e}`);
		}
	}

	if (existsSync(projectConfigPath)) {
		try {
			projectConfig = JSON.parse(readFileSync(projectConfigPath, "utf-8"));
		} catch (e) {
			console.error(`Warning: Could not parse ${projectConfigPath}: ${e}`);
		}
	}

	return deepMerge(deepMerge(DEFAULT_CONFIG, globalConfig), projectConfig);
}

function deepMerge(base: SandboxConfig, overrides: Partial<SandboxConfig>): SandboxConfig {
	const result: SandboxConfig = { ...base };

	if (overrides.enabled !== undefined) result.enabled = overrides.enabled;
	if (overrides.network) {
		result.network = { ...base.network, ...overrides.network };
	}
	if (overrides.filesystem) {
		result.filesystem = { ...base.filesystem, ...overrides.filesystem };
	}

	const extOverrides = overrides as {
		ignoreViolations?: Record<string, string[]>;
		enableWeakerNestedSandbox?: boolean;
	};
	const extResult = result as { ignoreViolations?: Record<string, string[]>; enableWeakerNestedSandbox?: boolean };

	if (extOverrides.ignoreViolations) {
		extResult.ignoreViolations = extOverrides.ignoreViolations;
	}
	if (extOverrides.enableWeakerNestedSandbox !== undefined) {
		extResult.enableWeakerNestedSandbox = extOverrides.enableWeakerNestedSandbox;
	}

	return result;
}

function createSandboxedBashOps(): BashOperations {
	return {
		async exec(command, cwd, { onData, signal, timeout }) {
			if (!existsSync(cwd)) {
				throw new Error(`Working directory does not exist: ${cwd}`);
			}

			const wrappedCommand = await SandboxManager.wrapWithSandbox(command);

			return new Promise((resolve, reject) => {
				const child = spawn("bash", ["-c", wrappedCommand], {
					cwd,
					detached: true,
					stdio: ["ignore", "pipe", "pipe"],
				});

				let timedOut = false;
				let timeoutHandle: NodeJS.Timeout | undefined;

				if (timeout !== undefined && timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						if (child.pid) {
							try {
								process.kill(-child.pid, "SIGKILL");
							} catch {
								child.kill("SIGKILL");
							}
						}
					}, timeout * 1000);
				}

				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);

				child.on("error", (err) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					reject(err);
				});

				const onAbort = () => {
					if (child.pid) {
						try {
							process.kill(-child.pid, "SIGKILL");
						} catch {
							child.kill("SIGKILL");
						}
					}
				};

				signal?.addEventListener("abort", onAbort, { once: true });

				child.on("close", (code) => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					signal?.removeEventListener("abort", onAbort);

					if (signal?.aborted) {
						reject(new Error("aborted"));
					} else if (timedOut) {
						reject(new Error(`timeout:${timeout}`));
					} else {
						resolve({ exitCode: code });
					}
				});
			});
		},
	};
}

/**
 * Handle tool_call events for path-based restrictions
 */
function handleToolCallEvent(
	event: any,
	ctx: ExtensionContext,
	config: SandboxConfig,
): { block: boolean; reason: string } | undefined {
	// Skip bash tool - it's handled at OS level by sandbox-runtime
	if (event.toolName === "bash") {
		return;
	}

	// Get the path to check
	const path = event?.input?.path;
	if (!path) {
		return;
	}

	// Determine the CWD to use (from context or event)
	const cwd = ctx.cwd;

	// Check read operations
	if (event.toolName === "read" || event.toolName === "ls") {
		const result = isReadAllowed(path, cwd, config, process.platform);
		if (!result.allowed) {
			return {
				block: true,
				reason: `Read access denied: ${result.reason}`,
			};
		}
	}

	// Check write/edit operations
	if (event.toolName === "write" || event.toolName === "edit") {
		const result = isWriteAllowed(path, cwd, config, process.platform);
		if (!result.allowed) {
			return {
				block: true,
				reason: `Write access denied: ${result.reason}`,
			};
		}
	}

	// Check find/grep - these read file contents
	if (event.toolName === "find" || event.toolName === "grep") {
		const result = isReadAllowed(path, cwd, config, process.platform);
		if (!result.allowed) {
			return {
				block: true,
				reason: `Access denied: ${result.reason}`,
			};
		}
	}

	return;
}

export default function (pi: ExtensionAPI) {
	pi.registerFlag("no-sandbox", {
		description: "Disable OS-level sandboxing for bash commands",
		type: "boolean",
		default: false,
	});

	const localCwd = process.cwd();
	const localBash = createBashTool(localCwd);

	let sandboxEnabled = false;
	let sandboxInitialized = false;

	pi.registerTool({
		...localBash,
		label: "bash (sandboxed)",
		async execute(id, params, signal, onUpdate, _ctx) {
			if (!sandboxEnabled || !sandboxInitialized) {
				return localBash.execute(id, params, signal, onUpdate);
			}

			const sandboxedBash = createBashTool(localCwd, {
				operations: createSandboxedBashOps(),
			});
			return sandboxedBash.execute(id, params, signal, onUpdate);
		},
	});

	pi.on("user_bash", () => {
		if (!sandboxEnabled || !sandboxInitialized) return;
		return { operations: createSandboxedBashOps() };
	});

	// Register tool_call handler for path-based restrictions
	pi.on("tool_call", (event, ctx) => {
		if (!sandboxEnabled || !sandboxInitialized) return;
		const config = loadConfig(ctx.cwd);
		return handleToolCallEvent(event, ctx, config);
	});

	pi.on("session_start", async (_event, ctx) => {
		const noSandbox = pi.getFlag("no-sandbox") as boolean;

		if (noSandbox) {
			sandboxEnabled = false;
			ctx.ui.notify("Sandbox disabled via --no-sandbox", "warning");
			return;
		}

		const config = loadConfig(ctx.cwd);

		if (!config.enabled) {
			sandboxEnabled = false;
			ctx.ui.notify("Sandbox disabled via config", "info");
			return;
		}

		const platform = process.platform;
		if (platform !== "darwin" && platform !== "linux") {
			sandboxEnabled = false;
			ctx.ui.notify(`Sandbox not supported on ${platform}`, "warning");
			return;
		}

		try {
			const configExt = config as unknown as {
				ignoreViolations?: Record<string, string[]>;
				enableWeakerNestedSandbox?: boolean;
			};

			await SandboxManager.initialize({
				network: config.network,
				filesystem: config.filesystem,
				ignoreViolations: configExt.ignoreViolations,
				enableWeakerNestedSandbox: configExt.enableWeakerNestedSandbox,
			});

			sandboxEnabled = true;
			sandboxInitialized = true;

			const networkCount = config.network?.allowedDomains?.length ?? 0;
			const writeCount = config.filesystem?.allowWrite?.length ?? 0;
			ctx.ui.setStatus(
				"sandbox",
				ctx.ui.theme.fg("accent", `🔒 Sandbox: ${networkCount} domains, ${writeCount} write paths`),
			);
			ctx.ui.notify("Sandbox initialized", "info");
		} catch (err) {
			sandboxEnabled = false;
			ctx.ui.notify(`Sandbox initialization failed: ${err instanceof Error ? err.message : err}`, "error");
		}
	});

	pi.on("session_shutdown", async () => {
		if (sandboxInitialized) {
			try {
				await SandboxManager.reset();
			} catch {
				// Ignore cleanup errors
			}
		}
	});

	pi.registerCommand("sandbox", {
		description: "Show sandbox configuration",
		handler: async (_args, ctx) => {
			if (!sandboxEnabled) {
				ctx.ui.notify("Sandbox is disabled", "info");
				return;
			}

			const config = loadConfig(ctx.cwd);
			const lines = [
				"Sandbox Configuration:",
				"",
				"Network:",
				`  Allowed: ${config.network?.allowedDomains?.join(", ") || "(none)"}`,
				`  Denied: ${config.network?.deniedDomains?.join(", ") || "(none)"}`,
				"",
				"Filesystem:",
				`  Deny Read: ${config.filesystem?.denyRead?.join(", ") || "(none)"}`,
				`  Allow Write: ${config.filesystem?.allowWrite?.join(", ") || "(none)"}`,
				`  Deny Write: ${config.filesystem?.denyWrite?.join(", ") || "(none)"}`,
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
