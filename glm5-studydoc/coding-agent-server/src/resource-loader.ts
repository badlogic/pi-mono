import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import {
	createExtensionRuntime,
	loadSkills,
	loadSkillsFromDir,
	type ResourceLoader,
	type Skill,
	type ResourceDiagnostic,
} from "@mariozechner/pi-coding-agent";

export interface PiResourceLoaderOptions {
	repoPath: string;
	skillPaths?: string[];
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
	const { repoPath, skillPaths = [], noSkills = false, systemPrompt } = options;
	const cwd = resolve(repoPath);

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
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
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
