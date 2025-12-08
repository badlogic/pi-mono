import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { HookConfig, HookModule } from "./types.js";
import { KNOWN_HOOK_EVENTS } from "./types.js";

/**
 * Result of loading hooks.
 */
export interface LoadHooksResult {
	/** Successfully loaded hooks */
	hooks: Map<string, HookModule>;
	/** Errors encountered during loading */
	errors: Array<{ hookId: string; error: string }>;
	/** Warnings (e.g., unknown event types) */
	warnings: Array<{ hookId: string; warning: string }>;
}

/**
 * Expand path with ~ support.
 */
function expandPath(p: string): string {
	if (p.startsWith("~/")) {
		return path.join(os.homedir(), p.slice(2));
	}
	if (p.startsWith("~")) {
		return path.join(os.homedir(), p.slice(1));
	}
	return p;
}

/**
 * Resolve hook path.
 * - Absolute paths used as-is
 * - Relative paths resolved from ~/.pi/hooks/
 * - ~ expanded to home directory
 */
function resolveHookPath(hookPath: string): string {
	const expanded = expandPath(hookPath);

	if (path.isAbsolute(expanded)) {
		return expanded;
	}

	// Relative paths resolved from ~/.pi/hooks/
	return path.join(os.homedir(), ".pi", "hooks", expanded);
}

/**
 * Validate that a module implements the HookModule interface.
 */
function validateHookModule(module: unknown, hookId: string): HookModule | null {
	if (!module || typeof module !== "object") {
		return null;
	}

	const hook = module as Record<string, unknown>;

	// id is required (can be set from config if not in module)
	if (typeof hook.id !== "string" && typeof hook.id !== "undefined") {
		return null;
	}

	// Check that any defined handlers are functions
	const handlerNames = [
		"onAgentStart",
		"onAgentEnd",
		"onTurnStart",
		"onTurnEnd",
		"onMessageStart",
		"onMessageUpdate",
		"onMessageEnd",
		"onToolExecutionStart",
		"onToolExecutionEnd",
		"onBranch",
		"onCommand",
		"onSessionLoad",
		"onSessionSave",
	];

	for (const name of handlerNames) {
		if (name in hook && typeof hook[name] !== "function") {
			return null;
		}
	}

	// Set id from config if not defined
	if (!hook.id) {
		hook.id = hookId;
	}

	return hook as unknown as HookModule;
}

/**
 * Validate event names in config and return warnings for unknown events.
 */
function validateEventNames(config: HookConfig): string[] {
	const warnings: string[] = [];
	const knownEvents = new Set<string>(KNOWN_HOOK_EVENTS);

	for (const event of config.events) {
		if (!knownEvents.has(event)) {
			warnings.push(`Unknown event type "${event}"`);
		}
	}

	return warnings;
}

/**
 * Load a single hook module.
 */
async function loadHook(config: HookConfig): Promise<{ hook: HookModule | null; error: string | null }> {
	const resolvedPath = resolveHookPath(config.path);

	// Check if file exists
	try {
		await fs.access(resolvedPath);
	} catch {
		return { hook: null, error: `Hook file not found: ${resolvedPath}` };
	}

	// Dynamic import
	try {
		// Use file:// URL for Windows compatibility
		const fileUrl = `file://${resolvedPath}`;
		const module = await import(fileUrl);

		// Handle both default export and module.exports
		const hookModule = module.default ?? module;
		const validated = validateHookModule(hookModule, config.id);

		if (!validated) {
			return { hook: null, error: "Invalid hook module: missing required interface" };
		}

		return { hook: validated, error: null };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { hook: null, error: `Failed to load hook: ${message}` };
	}
}

/**
 * Load all hooks from configuration.
 * Returns successfully loaded hooks, errors, and warnings.
 */
export async function loadHooks(configs: HookConfig[]): Promise<LoadHooksResult> {
	const hooks = new Map<string, HookModule>();
	const errors: Array<{ hookId: string; error: string }> = [];
	const warnings: Array<{ hookId: string; warning: string }> = [];

	for (const config of configs) {
		// Validate event names (even for disabled hooks, to catch config errors)
		const eventWarnings = validateEventNames(config);
		for (const warning of eventWarnings) {
			warnings.push({ hookId: config.id, warning });
		}

		// Skip disabled hooks for loading
		if (!config.enabled) {
			continue;
		}

		const { hook, error } = await loadHook(config);

		if (error) {
			errors.push({ hookId: config.id, error });
			continue;
		}

		if (hook) {
			hooks.set(hook.id, hook);
		}
	}

	return { hooks, errors, warnings };
}
