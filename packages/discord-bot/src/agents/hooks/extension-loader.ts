/**
 * Hook Extension Loader
 *
 * Allows loading custom hooks from the skills directory.
 * Extensions are JavaScript/TypeScript modules that export a hook factory.
 *
 * Extension Format:
 * ```typescript
 * // skills/hooks/my-hook.ts
 * import type { AgentHookAPI } from '../agents/hooks/types';
 *
 * export const id = 'my-hook';
 * export const name = 'My Custom Hook';
 * export const description = 'Does something cool';
 *
 * export default function(api: AgentHookAPI) {
 *   api.on('turn_start', async (event, ctx) => {
 *     // Custom logic
 *   });
 * }
 * ```
 */

import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import type { AgentHookFactory, HookRegistration } from "./types.js";

// ============================================================================
// Types
// ============================================================================

export interface HookExtension {
	id: string;
	name: string;
	description?: string;
	path: string;
	factory: AgentHookFactory;
	enabled: boolean;
	loadedAt: number;
}

export interface ExtensionLoadResult {
	success: boolean;
	extension?: HookExtension;
	error?: string;
}

// ============================================================================
// Extension Discovery
// ============================================================================

const HOOKS_SUBDIR = "hooks";
const VALID_EXTENSIONS = [".js", ".mjs", ".ts"];

/**
 * Find hook extension files in a directory
 */
export function discoverExtensions(skillsDir: string): string[] {
	const hooksDir = join(skillsDir, HOOKS_SUBDIR);

	if (!existsSync(hooksDir)) {
		return [];
	}

	const files: string[] = [];

	try {
		const entries = readdirSync(hooksDir);
		for (const entry of entries) {
			const fullPath = join(hooksDir, entry);
			const stat = statSync(fullPath);

			if (stat.isFile()) {
				const ext = entry.substring(entry.lastIndexOf("."));
				if (VALID_EXTENSIONS.includes(ext)) {
					files.push(fullPath);
				}
			}
		}
	} catch {
		// Directory doesn't exist or can't be read
	}

	return files;
}

// ============================================================================
// Extension Loading
// ============================================================================

/**
 * Load a single hook extension from a file
 */
export async function loadExtension(filePath: string): Promise<ExtensionLoadResult> {
	try {
		// Dynamic import
		const module = await import(filePath);

		// Validate required exports
		if (typeof module.default !== "function") {
			return {
				success: false,
				error: `Extension ${filePath} must export a default function`,
			};
		}

		const id =
			module.id ||
			filePath
				.split("/")
				.pop()
				?.replace(/\.[^.]+$/, "") ||
			"unknown";
		const name = module.name || id;
		const description = module.description;

		const extension: HookExtension = {
			id,
			name,
			description,
			path: filePath,
			factory: module.default,
			enabled: true,
			loadedAt: Date.now(),
		};

		return { success: true, extension };
	} catch (error) {
		return {
			success: false,
			error: `Failed to load ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Load all extensions from a skills directory
 */
export async function loadAllExtensions(skillsDir: string): Promise<{
	extensions: HookExtension[];
	errors: Array<{ path: string; error: string }>;
}> {
	const paths = discoverExtensions(skillsDir);
	const extensions: HookExtension[] = [];
	const errors: Array<{ path: string; error: string }> = [];

	for (const path of paths) {
		const result = await loadExtension(path);
		if (result.success && result.extension) {
			extensions.push(result.extension);
		} else if (result.error) {
			errors.push({ path, error: result.error });
		}
	}

	return { extensions, errors };
}

// ============================================================================
// Extension Management
// ============================================================================

/**
 * Convert extension to hook registration
 */
export function extensionToRegistration(ext: HookExtension): HookRegistration {
	return {
		id: `ext:${ext.id}`,
		name: ext.name,
		description: ext.description,
		factory: ext.factory,
		enabled: ext.enabled,
	};
}

/**
 * Extension manager for runtime management
 */
export class ExtensionManager {
	private extensions = new Map<string, HookExtension>();
	private skillsDir: string;

	constructor(skillsDir: string) {
		this.skillsDir = skillsDir;
	}

	/**
	 * Load all extensions from skills directory
	 */
	async loadAll(): Promise<{ loaded: number; errors: string[] }> {
		const { extensions, errors } = await loadAllExtensions(this.skillsDir);

		for (const ext of extensions) {
			this.extensions.set(ext.id, ext);
		}

		return {
			loaded: extensions.length,
			errors: errors.map((e) => e.error),
		};
	}

	/**
	 * Reload a specific extension
	 */
	async reload(id: string): Promise<ExtensionLoadResult> {
		const existing = this.extensions.get(id);
		if (!existing) {
			return { success: false, error: `Extension ${id} not found` };
		}

		// Clear module cache for hot reload
		try {
			delete require.cache[existing.path];
		} catch {
			// ESM doesn't use require.cache
		}

		const result = await loadExtension(existing.path);
		if (result.success && result.extension) {
			this.extensions.set(id, result.extension);
		}

		return result;
	}

	/**
	 * Get all loaded extensions
	 */
	list(): HookExtension[] {
		return Array.from(this.extensions.values());
	}

	/**
	 * Get extension by ID
	 */
	get(id: string): HookExtension | undefined {
		return this.extensions.get(id);
	}

	/**
	 * Enable/disable extension
	 */
	setEnabled(id: string, enabled: boolean): boolean {
		const ext = this.extensions.get(id);
		if (!ext) return false;
		ext.enabled = enabled;
		return true;
	}

	/**
	 * Get all as hook registrations
	 */
	getRegistrations(): HookRegistration[] {
		return this.list()
			.filter((ext) => ext.enabled)
			.map(extensionToRegistration);
	}
}

// ============================================================================
// Exports
// ============================================================================

export const ExtensionUtils = {
	discoverExtensions,
	loadExtension,
	loadAllExtensions,
	extensionToRegistration,
	ExtensionManager,
};
