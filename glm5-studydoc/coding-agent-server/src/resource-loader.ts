import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import {
	createExtensionRuntime,
	loadSkills,
	loadSkillsFromDir,
	type ResourceLoader,
	type Skill,
	type LoadExtensionsResult,
	type ResourceDiagnostic,
	type Extension,
} from "@mariozechner/pi-coding-agent";

export interface PiResourceLoaderOptions {
	repoPath: string;
	extensionPaths?: string[];
	skillPaths?: string[];
	noExtensions?: boolean;
	noSkills?: boolean;
	/** Custom system prompt (optional) */
	systemPrompt?: string;
}

/**
 * Load skills from .pi/skills directory
 */
function loadSkillsFromPiDir(repoPath: string): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
	const piSkillsDir = join(repoPath, ".pi", "skills");
	
	if (!existsSync(piSkillsDir)) {
		return { skills: [], diagnostics: [] };
	}

	// Load skills from .pi/skills directory
	return loadSkillsFromDir({ dir: piSkillsDir, source: "project" });
}

/**
 * Load extensions from .pi/extensions directory
 * Note: Extensions are loaded dynamically at runtime, but in server mode
 * we just collect the paths and log them since full extension loading
 * requires the ExtensionRunner which needs a UI context.
 */
async function loadExtensionsFromPiDir(
	repoPath: string,
	cwd: string,
): Promise<LoadExtensionsResult> {
	const piExtensionsDir = join(repoPath, ".pi", "extensions");
	
	if (!existsSync(piExtensionsDir)) {
		return { extensions: [], errors: [], runtime: createExtensionRuntime() };
	}

	// Find all .ts and .js files in .pi/extensions
	const entries = readdirSync(piExtensionsDir, { withFileTypes: true });
	const extensionPaths: string[] = [];

	for (const entry of entries) {
		if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
			extensionPaths.push(join(piExtensionsDir, entry.name));
		}
	}

	if (extensionPaths.length === 0) {
		return { extensions: [], errors: [], runtime: createExtensionRuntime() };
	}

	// For now, just log the extensions found but don't fully load them
	// as server mode doesn't have the ExtensionRunner setup
	const errors: Array<{ path: string; error: string }> = [];
	const extensions: Extension[] = [];

	for (const extPath of extensionPaths) {
		// Log that we found an extension but note it requires interactive mode
		console.log(`[ResourceLoader] Found extension: ${extPath} (requires interactive mode for full functionality)`);
	}

	return { extensions, errors, runtime: createExtensionRuntime() };
}

/**
 * Load prompts from .pi/prompts directory
 */
function loadPromptsFromPiDir(repoPath: string): { prompts: Array<{ name: string; content: string; path: string }>; diagnostics: ResourceDiagnostic[] } {
	const piPromptsDir = join(repoPath, ".pi", "prompts");
	const prompts: Array<{ name: string; content: string; path: string }> = [];
	const diagnostics: ResourceDiagnostic[] = [];

	if (!existsSync(piPromptsDir)) {
		return { prompts, diagnostics };
	}

	const entries = readdirSync(piPromptsDir, { withFileTypes: true });

	for (const entry of entries) {
		if (entry.isFile() && entry.name.endsWith(".md")) {
			const filePath = join(piPromptsDir, entry.name);
			try {
				const content = readFileSync(filePath, "utf-8");
				prompts.push({
					name: entry.name.replace(".md", ""),
					content,
					path: filePath,
				});
			} catch (error) {
				diagnostics.push({
					type: "warning",
					message: `Failed to read prompt file: ${error}`,
					path: filePath,
				});
			}
		}
	}

	return { prompts, diagnostics };
}

/**
 * Load AGENTS.md or CLAUDE.md from repo root
 */
function loadAgentsFile(repoPath: string): { path: string; content: string } | null {
	const candidates = ["AGENTS.md", "CLAUDE.md"];
	for (const filename of candidates) {
		const filePath = join(repoPath, filename);
		if (existsSync(filePath)) {
			try {
				return {
					path: filePath,
					content: readFileSync(filePath, "utf-8"),
				};
			} catch {
				// Ignore errors
			}
		}
	}
	return null;
}

/**
 * Load system prompt from .pi/system-prompt.md or .pi/SYSTEM_PROMPT.md
 */
function loadSystemPromptFromFile(repoPath: string): string | undefined {
	const candidates = [".pi/system-prompt.md", ".pi/SYSTEM_PROMPT.md", "system-prompt.md", "SYSTEM_PROMPT.md"];
	for (const filename of candidates) {
		const filePath = join(repoPath, filename);
		if (existsSync(filePath)) {
			try {
				const content = readFileSync(filePath, "utf-8");
				console.log(`[ResourceLoader] Loaded system prompt from: ${filePath}`);
				return content;
			} catch {
				// Ignore errors
			}
		}
	}
	return undefined;
}

/**
 * Create a ResourceLoader that loads resources from .pi directory
 */
export async function createPiResourceLoader(options: PiResourceLoaderOptions): Promise<ResourceLoader> {
	const { repoPath, extensionPaths = [], skillPaths = [], noExtensions = false, noSkills = false, systemPrompt } = options;
	const cwd = resolve(repoPath);

	// Load extensions
	let extensionsResult: LoadExtensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
	if (!noExtensions) {
		// Load from .pi/extensions
		const piExtensions = await loadExtensionsFromPiDir(repoPath, cwd);
		extensionsResult.extensions.push(...piExtensions.extensions);
		extensionsResult.errors.push(...piExtensions.errors);

		// Load from additional paths
		if (extensionPaths.length > 0) {
			// Log additional extension paths but don't load them in server mode
			for (const extPath of extensionPaths) {
				console.log(`[ResourceLoader] Found extension: ${extPath} (requires interactive mode for full functionality)`);
			}
		}
	}

	// Load skills
	let skillsResult: { skills: Skill[]; diagnostics: ResourceDiagnostic[] } = { skills: [], diagnostics: [] };
	if (!noSkills) {
		// Load from .pi/skills
		const piSkills = loadSkillsFromPiDir(repoPath);
		skillsResult.skills.push(...piSkills.skills);
		skillsResult.diagnostics.push(...piSkills.diagnostics);

		// Load from additional paths
		if (skillPaths.length > 0) {
			const additionalSkills = loadSkills({
				cwd,
				skillPaths,
				includeDefaults: false,
			});
			skillsResult.skills.push(...additionalSkills.skills);
			skillsResult.diagnostics.push(...additionalSkills.diagnostics);
		}
	}

	// Load prompts
	const promptsResult = loadPromptsFromPiDir(repoPath);

	// Load agents file
	const agentsFile = loadAgentsFile(repoPath);
	const agentsFiles = agentsFile ? [agentsFile] : [];

	// Determine system prompt (priority: 1. options.systemPrompt, 2. file, 3. undefined)
	const finalSystemPrompt = systemPrompt ?? loadSystemPromptFromFile(repoPath);

	// Log loaded resources
	if (extensionsResult.extensions.length > 0) {
		console.log(`[ResourceLoader] Loaded ${extensionsResult.extensions.length} extensions from .pi/extensions`);
	}
	if (skillsResult.skills.length > 0) {
		console.log(`[ResourceLoader] Loaded ${skillsResult.skills.length} skills from .pi/skills`);
	}
	if (promptsResult.prompts.length > 0) {
		console.log(`[ResourceLoader] Loaded ${promptsResult.prompts.length} prompts from .pi/prompts`);
	}
	if (agentsFiles.length > 0) {
		console.log(`[ResourceLoader] Loaded agents file: ${agentsFiles[0].path}`);
	}

	return {
		getExtensions: () => extensionsResult,
		getSkills: () => skillsResult,
		getPrompts: () => ({ 
			prompts: promptsResult.prompts.map(p => ({ 
				name: p.name, 
				description: p.content.slice(0, 100),
				filePath: p.path,
				content: p.content,
				source: "project",
			})), 
			diagnostics: promptsResult.diagnostics 
		}),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles }),
		getSystemPrompt: () => finalSystemPrompt,
		getAppendSystemPrompt: () => [],
		getPathMetadata: () => new Map(),
		extendResources: () => {},
		reload: async () => {},
	};
}
