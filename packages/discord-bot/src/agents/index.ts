/**
 * Agents Module
 * Lightweight agent (pi-agent-core), OpenHands SDK, Claude SDK, and Agent Experts system
 *
 * TAC Lesson 13: Agent Experts - Act-Learn-Reuse Pattern
 * "The massive problem with agents is they forget - Agent Experts solve this"
 *
 * Includes pi-coding-agent compatible hooks:
 * - Checkpoint Hook: Git-based state checkpointing
 * - LSP Hook: Language Server Protocol diagnostics
 * - Expert Hook: Act-Learn-Reuse integration
 */

// Agent Experts - Advanced TAC Lesson 13 (Codebase Experts, Meta-Agentics)
export {
	CODEBASE_EXPERTS,
	createCodebaseExpert,
	detectExpertDomain,
	executeWithAutoExpert,
	executeWithExpert,
	generateSelfImprovePrompt,
	getExpert,
	loadExpertConfig,
	META_PROMPT_TEMPLATE,
	PRODUCT_EXPERTS,
} from "./agent-experts.js";
// Claude SDK Agent - Two-Agent Pattern (Initializer + Coding)
export {
	type ClaudeAgentOptions,
	type ClaudeAgentResult,
	executeNextFeature as executeClaudeFeature,
	type FeatureSpec,
	getTaskStatus as getClaudeTaskStatus,
	initializeTask as initializeClaudeTask,
	isClaudeSDKAvailable,
	loadTaskSpec as loadClaudeTaskSpec,
	resumeTask as resumeClaudeTask,
	runTwoAgentWorkflow,
	type TaskSpec as ClaudeTaskSpec,
} from "./claude-sdk-agent.js";
// Agent Experts - Act-Learn-Reuse System (Basic)
export {
	actLearnReuse,
	createLearningPrompt,
	type ExpertiseConfig,
	extractLearnings,
	getExpertiseModes,
	getExpertisePath,
	type LearningResult,
	loadExpertise,
	SELF_IMPROVE_PROMPTS,
	updateExpertise,
} from "./expertise-manager.js";
// Agent Hooks - pi-coding-agent compatible (checkpoint, LSP, expert)
export {
	// Types
	type AgentHookAPI,
	type AgentHookContext,
	type AgentHookEvent,
	type AgentHookFactory,
	// Hook Manager
	AgentHookManager,
	ALL_HOOKS,
	type BranchEvent,
	type BranchEventResult,
	// Expert Hook
	buildExpertContext,
	type CheckpointConfig,
	type CheckpointData,
	CheckpointUtils,
	CODING_HOOKS,
	// Checkpoint Hook
	checkpointHook,
	cleanupOldCheckpoints,
	createCheckpoint,
	createCheckpointHook,
	createDefaultHookManager,
	createDiscordContext,
	createExpertHook,
	createExpertPrompt,
	createHookRegistration,
	// LSP Hook
	createLSPHook,
	createTaskAwareExpertHook,
	detectDomain,
	type ExpertContext,
	type ExpertHookConfig,
	ExpertUtils,
	expertHook,
	getDomainRiskLevel,
	type HookManager,
	type HookRegistration,
	type LSPConfig,
	type LSPDiagnostic,
	LSPUtils,
	listCheckpointRefs,
	loadAllCheckpoints,
	loadCheckpointFromRef,
	lspHook,
	MINIMAL_HOOKS,
	processAgentOutput,
	restoreCheckpoint,
	SECURITY_HOOKS,
	type SessionEvent,
	type ToolCallEvent,
	type ToolCallEventResult,
	type ToolResultEvent,
	type ToolResultEventResult,
	type TurnEndEvent,
	type TurnStartEvent,
} from "./hooks/index.js";
// Lightweight Agent exports (pi-mono pattern)
export {
	AGENT_MODELS,
	type AgentOptions,
	AgentPresets,
	type AgentResult,
	DEFAULT_AGENT_MODEL,
	getAgentModels,
	isAgentAvailable,
	// Learning-enabled agent (Act-Learn-Reuse)
	type LearningAgentOptions,
	type LearningAgentResult,
	LearningPresets,
	runAgent,
	runLearningAgent,
} from "./lightweight-agent.js";

// OpenHands Software Agent SDK integration
export {
	getOpenHandsModes,
	isOpenHandsAvailable,
	type OpenHandsMode,
	OpenHandsModeDescriptions,
	type OpenHandsOptions,
	OpenHandsPresets,
	type OpenHandsResult,
	OpenHandsTools,
	runCodeReview,
	runDebug,
	runDocGeneration,
	runOpenHandsAgent,
	runOptimize,
	runRefactor,
	runSecurityScan,
	runTestGeneration,
} from "./openhands-agent.js";
