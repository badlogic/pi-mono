/**
 * PAI Core - Personal AI Infrastructure Principles
 *
 * Based on TAC Lesson 14: Personal AI Infrastructure
 *
 * This module provides the foundational primitives for building
 * agent systems following the 13 PAI principles.
 */

// History system
export {
	History,
	type HistoryEntry,
	type HistoryEntryType,
	HistoryManager,
	type HistoryQuery,
	type HistoryStats,
} from "./history.js";
// Hooks system
export {
	BuiltInHooks,
	globalHooks,
	type HookContext,
	type HookFunction,
	HookPipeline,
	type HookPriority,
	HookRegistry,
	type HookResult,
	Hooks,
	type HookType,
	setupAgentHooks,
} from "./hooks.js";
// Principle exports
export {
	ARCHITECTURE_OVER_MODEL,
	CLEAR_THINKING,
	CODE_BEFORE_PROMPTS,
	COMPOSABLE_DESIGN,
	DETERMINISM,
	FAIL_GRACEFULLY,
	OBSERVABLE_SYSTEMS,
	type ObservabilityEvent,
	PAI_PRINCIPLES,
	SPECIFICATION_DRIVEN,
	type TaskSpecification,
	UNIX_PHILOSOPHY,
	validateAgentDesign,
} from "./principles.js";
// Skills system
export {
	createExampleSkill,
	createSkillFromTool,
	type Skill,
	SkillBuilder,
	type SkillContext,
	type SkillHooks,
	type SkillInput,
	type SkillMetadata,
	type SkillOutput,
	SkillRegistry,
} from "./skill.js";

/**
 * PAI Core Version
 */
export const PAI_VERSION = "1.0.0";

import { HistoryManager as HistoryMgr } from "./history.js";
/**
 * Quick start: Initialize PAI infrastructure
 */
import { globalHooks as hooksInstance } from "./hooks.js";
import { SkillRegistry as SkillReg } from "./skill.js";

export function initializePAI(dataDir: string): {
	skills: SkillReg;
	history: HistoryMgr;
	hooks: typeof hooksInstance;
} {
	const skills = new SkillReg(`${dataDir}/skills`);
	const history = new HistoryMgr(`${dataDir}/history`);

	return {
		skills,
		history,
		hooks: hooksInstance,
	};
}

/**
 * Export all principles as a guide
 */
export const PAI_GUIDE = {
	1: {
		name: "Clear Thinking First",
		description: "Quality outcomes depend on prompt quality",
		antiPattern: "Vague prompts hoping the model will figure it out",
		pattern: "Structured inputs with context, constraints, and examples",
	},
	2: {
		name: "Determinism Over Flexibility",
		description: "Same input = predictable output",
		antiPattern: "High temperature for all tasks",
		pattern: "Use temperature=0 for deterministic tasks",
	},
	3: {
		name: "Code Before Prompts",
		description: "Use code to solve; prompts orchestrate",
		antiPattern: "Ask LLM to parse JSON or do math",
		pattern: "Parse JSON with code, only use LLM for interpretation",
	},
	4: {
		name: "Specification-Driven",
		description: "Define expected behavior first",
		antiPattern: "Build and hope it works",
		pattern: "Write specs, tests, then implementation",
	},
	5: {
		name: "UNIX Philosophy",
		description: "Small, focused tools that compose",
		antiPattern: "Monolithic do-everything tools",
		pattern: "Single-responsibility tools with clear contracts",
	},
	6: {
		name: "Skills as Capabilities",
		description: "Self-contained AI modules",
		antiPattern: "Hardcoded prompts scattered everywhere",
		pattern: "Versioned, composable skill modules",
	},
	7: {
		name: "Agents as Personalities",
		description: "Specialized for different tasks",
		antiPattern: "One agent for everything",
		pattern: "Multiple specialized agents (coder, researcher, analyst)",
	},
	8: {
		name: "Hooks for Automation",
		description: "Event-driven state management",
		antiPattern: "Manual steps everywhere",
		pattern: "Lifecycle hooks for validation, logging, learning",
	},
	9: {
		name: "History Preserves Work",
		description: "Compound learning over time",
		antiPattern: "Lose all context every session",
		pattern: "Structured history with query capabilities",
	},
	10: {
		name: "Architecture > Model",
		description: "Structure beats raw power",
		antiPattern: "Use biggest model for everything",
		pattern: "Specialized pipeline with appropriate models",
	},
	11: {
		name: "Fail Gracefully",
		description: "Handle errors without losing work",
		antiPattern: "Crash and restart from scratch",
		pattern: "Checkpoints, retries, fallbacks, partial results",
	},
	12: {
		name: "Observable Systems",
		description: "Know what's happening",
		antiPattern: "Black box execution",
		pattern: "Events, logs, metrics, traces",
	},
	13: {
		name: "Composable Design",
		description: "Build complex from simple",
		antiPattern: "Tightly coupled monoliths",
		pattern: "Pure functions, clear interfaces, composition",
	},
} as const;
