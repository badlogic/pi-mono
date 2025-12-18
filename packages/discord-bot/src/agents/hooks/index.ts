/**
 * Agent Hooks Module
 *
 * Provides pi-coding-agent compatible hooks for discord-bot agent system.
 *
 * Includes:
 * - Checkpoint Hook: Git-based state checkpointing for conversation branching
 * - LSP Hook: Language Server Protocol diagnostics integration
 * - Expert Hook: Act-Learn-Reuse expertise integration (TAC Lesson 13)
 *
 * Usage:
 *   import { AgentHookManager, checkpointHook, lspHook, expertHook } from './hooks';
 *
 *   const manager = new AgentHookManager(process.cwd());
 *   manager.register(createHookRegistration('checkpoint', checkpointHook));
 *   manager.register(createHookRegistration('lsp', lspHook));
 *   manager.register(createHookRegistration('expert', expertHook));
 *
 *   // Emit events
 *   await manager.emit({ type: 'session', ... });
 */

// Blocking Rules
export {
	addBlockingRule,
	applyPresetRules,
	type BlockedAction,
	type BlockingResult,
	type BlockingRule,
	BlockingRulesUtils,
	checkBlocking,
	clearBlockedActions,
	closeBlockingRulesDb,
	getBlockedActions,
	getBlockingRule,
	listBlockingRules,
	PRESET_RULES,
	removeBlockingRule,
	setRuleEnabled,
} from "./blocking-rules.js";
// Checkpoint Hook
export {
	autoCleanup,
	type BranchMetadata,
	type CheckpointDiff,
	type CheckpointTag,
	CheckpointUtils,
	type CleanupResult,
	checkpointHook,
	cleanupOldCheckpoints,
	createBranchPoint,
	createCheckpoint,
	createCheckpointHook,
	deleteBranch,
	deleteTag,
	getCheckpointByTag,
	getCheckpointDiff,
	getFileDiff,
	listBranches,
	listCheckpointRefs,
	listTags,
	loadAllCheckpoints,
	loadCheckpointFromRef,
	restoreCheckpoint,
	switchToBranch,
	tagCheckpoint,
} from "./checkpoint-hook.js";
// Discord Integration
export {
	createDiscordHookIntegration,
	type DiscordHookConfig,
	disposeAllHookIntegrations,
	disposeChannelHookIntegration,
	generateSessionId,
	getChannelHookIntegration,
	type HookIntegration,
	wrapToolWithHooks,
} from "./discord-integration.js";
// Expert Hook
export {
	buildExpertContext,
	clearAllExpertise,
	clearExpertise,
	createExpertHook,
	createExpertPrompt,
	createTaskAwareExpertHook,
	detectDomain,
	type ExpertiseInfo,
	ExpertUtils,
	expertHook,
	exportExpertise,
	getDomainRiskLevel,
	getExpertiseSummary,
	listExpertise,
	processAgentOutput,
} from "./expert-hook.js";
// Hook Manager
export {
	AgentHookManager,
	createDefaultHookManager,
	createDiscordContext,
	createHookRegistration,
	enableDebugLogging,
	type HookMetrics,
	isDebugLoggingEnabled,
} from "./hook-manager.js";
// LSP Hook
export {
	createLSPHook,
	detectProjectLanguages,
	disableLSP,
	enableLSP,
	getEnabledLSP,
	getLSPStatus,
	isLSPAvailable,
	type LSPStatus,
	LSPUtils,
	lspHook,
	resetLSPConfig,
} from "./lsp-hook.js";
// Types
export * from "./types.js";

// ============================================================================
// Convenience: Pre-configured hook sets
// ============================================================================

import { checkpointHook } from "./checkpoint-hook.js";
import { expertHook } from "./expert-hook.js";
import { createHookRegistration } from "./hook-manager.js";
import { lspHook } from "./lsp-hook.js";

/**
 * All available hooks as registrations
 */
export const ALL_HOOKS = {
	checkpoint: createHookRegistration("checkpoint", checkpointHook, {
		name: "Checkpoint Hook",
		description: "Git-based state checkpointing for conversation branching",
	}),
	lsp: createHookRegistration("lsp", lspHook, {
		name: "LSP Hook",
		description: "Language Server Protocol diagnostics integration",
	}),
	expert: createHookRegistration("expert", expertHook, {
		name: "Expert Hook",
		description: "Act-Learn-Reuse expertise integration (TAC Lesson 13)",
	}),
};

/**
 * Recommended hooks for coding tasks
 */
export const CODING_HOOKS = [ALL_HOOKS.checkpoint, ALL_HOOKS.lsp, ALL_HOOKS.expert];

/**
 * Minimal hooks for non-coding tasks
 */
export const MINIMAL_HOOKS = [ALL_HOOKS.expert];

/**
 * Security-focused hooks (checkpoint + expert)
 */
export const SECURITY_HOOKS = [ALL_HOOKS.checkpoint, ALL_HOOKS.expert];
