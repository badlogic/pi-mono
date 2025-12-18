// Core session management
export {
	AgentSession,
	type AgentSessionConfig,
	type AgentSessionEvent,
	type AgentSessionEventListener,
	type CompactionResult,
	type ModelCycleResult,
	type PromptOptions,
	type SessionStats,
} from "./core/agent-session.js";
// Compaction
export {
	type CutPointResult,
	calculateContextTokens,
	compact,
	DEFAULT_COMPACTION_SETTINGS,
	estimateTokens,
	findCutPoint,
	findTurnStartIndex,
	generateSummary,
	getLastAssistantUsage,
	shouldCompact,
} from "./core/compaction.js";
// Custom tools
export type {
	CustomAgentTool,
	CustomToolFactory,
	CustomToolsLoadResult,
	ExecResult,
	LoadedCustomTool,
	RenderResultOptions,
	SessionEvent as ToolSessionEvent,
	ToolAPI,
	ToolUIContext,
} from "./core/custom-tools/index.js";
export { discoverAndLoadCustomTools, loadCustomTools } from "./core/custom-tools/index.js";
// Hook system types
export type {
	AgentEndEvent,
	AgentStartEvent,
	BranchEvent,
	BranchEventResult,
	HookAPI,
	HookEvent,
	HookEventContext,
	HookFactory,
	HookUIContext,
	SessionEvent,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
	TurnEndEvent,
	TurnStartEvent,
} from "./core/hooks/index.js";
export { messageTransformer } from "./core/messages.js";
export {
	type CompactionEntry,
	createSummaryMessage,
	getLatestCompactionEntry,
	type LoadedSession,
	loadSessionFromEntries,
	type ModelChangeEntry,
	parseSessionEntries,
	type SessionEntry,
	type SessionHeader,
	SessionManager,
	type SessionMessageEntry,
	SUMMARY_PREFIX,
	SUMMARY_SUFFIX,
	type ThinkingLevelChangeEntry,
} from "./core/session-manager.js";
export {
	type CompactionSettings,
	type RetrySettings,
	type Settings,
	SettingsManager,
} from "./core/settings-manager.js";
// Skills
export {
	formatSkillsForPrompt,
	type LoadSkillsFromDirOptions,
	type LoadSkillsResult,
	loadSkills,
	loadSkillsFromDir,
	type Skill,
	type SkillFrontmatter,
	type SkillWarning,
} from "./core/skills.js";
// Tools
export { bashTool, codingTools, editTool, readTool, writeTool } from "./core/tools/index.js";

// Main entry point
export { main } from "./main.js";
