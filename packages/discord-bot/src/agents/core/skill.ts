/**
 * PAI Skills System - Principle 6: Skills as Capabilities
 *
 * Skills are self-contained AI modules that:
 * - Have clear input/output contracts
 * - Can be versioned and evolved
 * - Support multiple modes/personalities
 * - Are independently testable
 * - Compose with other skills
 *
 * Based on TAC Lesson 14 + UOCS (User-Owned Coding System)
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import type { TSchema } from "@sinclair/typebox";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Skill input/output types
 */
export interface SkillInput {
	[key: string]: unknown;
}

export interface SkillOutput {
	success: boolean;
	data?: unknown;
	error?: string;
	metadata?: {
		duration?: number;
		tokensUsed?: number;
		confidence?: number;
		version?: string;
	};
}

/**
 * Skill execution context
 */
export interface SkillContext {
	mode?: string; // Execution mode (e.g., "fast", "thorough", "creative")
	userId?: string; // User context for personalization
	workingDir?: string; // Working directory for file operations
	memory?: Map<string, unknown>; // In-memory state
	hooks?: SkillHooks; // Lifecycle hooks
}

/**
 * Skill lifecycle hooks
 */
export interface SkillHooks {
	beforeExecute?: (input: SkillInput) => Promise<void> | void;
	afterExecute?: (output: SkillOutput) => Promise<void> | void;
	onError?: (error: Error) => Promise<void> | void;
}

/**
 * Skill metadata
 */
export interface SkillMetadata {
	name: string;
	version: string;
	description: string;
	author?: string;
	created?: string;
	updated?: string;
	tags?: string[];
	modes?: string[]; // Supported execution modes
	examples?: Array<{ input: SkillInput; output: SkillOutput }>;
	dependencies?: string[]; // Other skills this depends on
}

/**
 * Main Skill interface
 */
export interface Skill {
	metadata: SkillMetadata;

	/**
	 * Validate input before execution
	 */
	validate?(input: SkillInput): { valid: boolean; errors: string[] };

	/**
	 * Execute the skill
	 */
	execute(input: SkillInput, context?: SkillContext): Promise<SkillOutput>;

	/**
	 * Get skill schema for tool integration
	 */
	getSchema?(): TSchema;

	/**
	 * Convert skill to AgentTool (pi-agent-core format)
	 */
	toAgentTool?(): AgentTool<any>;
}

/**
 * Skill Registry - Central management for all skills
 */
export class SkillRegistry {
	private skills: Map<string, Skill> = new Map();
	private skillsDir: string;

	constructor(skillsDir: string) {
		this.skillsDir = skillsDir;
		this.ensureSkillsDir();
	}

	private ensureSkillsDir(): void {
		if (!existsSync(this.skillsDir)) {
			mkdirSync(this.skillsDir, { recursive: true });
		}
	}

	/**
	 * Register a skill
	 */
	register(skill: Skill): void {
		const name = skill.metadata.name;

		// Validate skill
		if (!name) {
			throw new Error("Skill must have a name");
		}

		if (!skill.execute) {
			throw new Error(`Skill "${name}" must have execute method`);
		}

		// Check for version conflicts
		const existing = this.skills.get(name);
		if (existing) {
			const existingVer = existing.metadata.version;
			const newVer = skill.metadata.version;

			if (existingVer === newVer) {
				console.warn(`[SkillRegistry] Overwriting skill "${name}" version ${newVer}`);
			} else {
				console.info(`[SkillRegistry] Upgrading skill "${name}" from ${existingVer} to ${newVer}`);
			}
		}

		this.skills.set(name, skill);
	}

	/**
	 * Unregister a skill
	 */
	unregister(name: string): boolean {
		return this.skills.delete(name);
	}

	/**
	 * Get a skill by name
	 */
	get(name: string): Skill | undefined {
		return this.skills.get(name);
	}

	/**
	 * List all registered skills
	 */
	list(): Skill[] {
		return Array.from(this.skills.values());
	}

	/**
	 * Search skills by tag
	 */
	findByTag(tag: string): Skill[] {
		return this.list().filter((skill) => skill.metadata.tags?.includes(tag));
	}

	/**
	 * Search skills by mode
	 */
	findByMode(mode: string): Skill[] {
		return this.list().filter((skill) => skill.metadata.modes?.includes(mode));
	}

	/**
	 * Execute a skill by name
	 */
	async execute(name: string, input: SkillInput, context?: SkillContext): Promise<SkillOutput> {
		const skill = this.get(name);

		if (!skill) {
			return {
				success: false,
				error: `Skill "${name}" not found`,
			};
		}

		const startTime = Date.now();

		try {
			// Run beforeExecute hook
			await context?.hooks?.beforeExecute?.(input);

			// Validate input if validator exists
			if (skill.validate) {
				const validation = skill.validate(input);
				if (!validation.valid) {
					return {
						success: false,
						error: `Invalid input: ${validation.errors.join(", ")}`,
					};
				}
			}

			// Execute skill
			const output = await skill.execute(input, context);

			// Add metadata
			output.metadata = {
				...output.metadata,
				duration: Date.now() - startTime,
				version: skill.metadata.version,
			};

			// Run afterExecute hook
			await context?.hooks?.afterExecute?.(output);

			return output;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);

			// Run error hook
			if (context?.hooks?.onError) {
				await context.hooks.onError(error instanceof Error ? error : new Error(errorMessage));
			}

			return {
				success: false,
				error: errorMessage,
				metadata: {
					duration: Date.now() - startTime,
					version: skill.metadata.version,
				},
			};
		}
	}

	/**
	 * Save skill to disk (UOCS pattern)
	 */
	async saveSkill(name: string): Promise<boolean> {
		const skill = this.get(name);
		if (!skill) return false;

		const skillPath = join(this.skillsDir, `${name}.json`);

		try {
			const serialized = JSON.stringify(
				{
					metadata: skill.metadata,
					// Note: execute function is not serialized - must be registered at runtime
				},
				null,
				2,
			);

			writeFileSync(skillPath, serialized);
			return true;
		} catch (error) {
			console.error(`[SkillRegistry] Failed to save skill "${name}":`, error);
			return false;
		}
	}

	/**
	 * Load skill metadata from disk
	 */
	loadSkillMetadata(name: string): SkillMetadata | null {
		const skillPath = join(this.skillsDir, `${name}.json`);

		if (!existsSync(skillPath)) {
			return null;
		}

		try {
			const content = readFileSync(skillPath, "utf-8");
			const data = JSON.parse(content);
			return data.metadata;
		} catch (error) {
			console.error(`[SkillRegistry] Failed to load skill "${name}":`, error);
			return null;
		}
	}

	/**
	 * List all available skill files
	 */
	listAvailableSkills(): string[] {
		if (!existsSync(this.skillsDir)) {
			return [];
		}

		return readdirSync(this.skillsDir)
			.filter((file) => file.endsWith(".json"))
			.map((file) => file.replace(".json", ""));
	}

	/**
	 * Get registry statistics
	 */
	getStats(): {
		total: number;
		byMode: Record<string, number>;
		byTag: Record<string, number>;
	} {
		const skills = this.list();

		const byMode: Record<string, number> = {};
		const byTag: Record<string, number> = {};

		for (const skill of skills) {
			// Count modes
			for (const mode of skill.metadata.modes || []) {
				byMode[mode] = (byMode[mode] || 0) + 1;
			}

			// Count tags
			for (const tag of skill.metadata.tags || []) {
				byTag[tag] = (byTag[tag] || 0) + 1;
			}
		}

		return {
			total: skills.length,
			byMode,
			byTag,
		};
	}
}

/**
 * Create a skill from an AgentTool (bridge pattern)
 */
export function createSkillFromTool(tool: AgentTool<any>): Skill {
	return {
		metadata: {
			name: tool.name,
			version: "1.0.0",
			description: tool.description,
			modes: ["default"],
		},

		async execute(input: SkillInput): Promise<SkillOutput> {
			try {
				// Pass input directly to tool's execute function
				const result = await (tool.execute as any)(input);
				return {
					success: true,
					data: result,
				};
			} catch (error) {
				return {
					success: false,
					error: error instanceof Error ? error.message : String(error),
				};
			}
		},

		toAgentTool() {
			return tool;
		},
	};
}

/**
 * Skill builder for fluent API
 */
export class SkillBuilder {
	private skill: {
		metadata: Partial<SkillMetadata>;
		validate?: (input: SkillInput) => { valid: boolean; errors: string[] };
		execute?: (input: SkillInput, context?: SkillContext) => Promise<SkillOutput>;
	} = {
		metadata: {},
	};

	name(name: string): this {
		this.skill.metadata.name = name;
		return this;
	}

	version(version: string): this {
		this.skill.metadata.version = version;
		return this;
	}

	description(description: string): this {
		this.skill.metadata.description = description;
		return this;
	}

	modes(...modes: string[]): this {
		this.skill.metadata.modes = modes;
		return this;
	}

	tags(...tags: string[]): this {
		this.skill.metadata.tags = tags;
		return this;
	}

	validator(validate: (input: SkillInput) => { valid: boolean; errors: string[] }): this {
		this.skill.validate = validate;
		return this;
	}

	executor(execute: (input: SkillInput, context?: SkillContext) => Promise<SkillOutput>): this {
		this.skill.execute = execute;
		return this;
	}

	build(): Skill {
		if (!this.skill.metadata.name) {
			throw new Error("Skill must have a name");
		}

		if (!this.skill.metadata.version) {
			throw new Error("Skill must have a version");
		}

		if (!this.skill.execute) {
			throw new Error("Skill must have execute method");
		}

		// Build complete metadata
		const metadata: SkillMetadata = {
			name: this.skill.metadata.name,
			version: this.skill.metadata.version,
			description: this.skill.metadata.description || "",
			author: this.skill.metadata.author,
			created: this.skill.metadata.created,
			updated: this.skill.metadata.updated,
			tags: this.skill.metadata.tags,
			modes: this.skill.metadata.modes,
			examples: this.skill.metadata.examples,
			dependencies: this.skill.metadata.dependencies,
		};

		return {
			metadata,
			validate: this.skill.validate,
			execute: this.skill.execute,
		};
	}
}

/**
 * Example: Create a simple skill
 */
export function createExampleSkill(): Skill {
	return new SkillBuilder()
		.name("text_summarizer")
		.version("1.0.0")
		.description("Summarize text using AI")
		.modes("fast", "thorough")
		.tags("text", "summarization", "nlp")
		.validator((input) => {
			const errors: string[] = [];

			if (!input.text || typeof input.text !== "string") {
				errors.push("Missing or invalid 'text' field");
			}

			if (input.maxLength && typeof input.maxLength !== "number") {
				errors.push("Invalid 'maxLength' field");
			}

			return { valid: errors.length === 0, errors };
		})
		.executor(async (input, context) => {
			const text = input.text as string;
			const maxLength = (input.maxLength as number) || 100;
			const mode = context?.mode || "fast";

			// Simulate AI summarization
			const summary = text.substring(0, maxLength) + (text.length > maxLength ? "..." : "");

			return {
				success: true,
				data: {
					summary,
					originalLength: text.length,
					mode,
				},
			};
		})
		.build();
}
