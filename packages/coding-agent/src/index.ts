// Core session management
export {
	AgentSession,
	type AgentSessionConfig,
	type AgentSessionEvent,
	type AgentSessionEventListener,
	type ModelCycleResult,
	type PromptOptions,
	type SessionStats,
} from "./core/agent-session.js";
// Auth and model registry
export { type ApiKeyCredential, type AuthCredential, AuthStorage, type OAuthCredential } from "./core/auth-storage.js";
// Compaction
export {
	type BranchPreparation,
	type BranchSummaryResult,
	type CompactionResult,
	type CutPointResult,
	calculateContextTokens,
	compact,
	DEFAULT_COMPACTION_SETTINGS,
	estimateTokens,
	type FileOperations,
	findCutPoint,
	findTurnStartIndex,
	generateBranchSummary,
	generateSummary,
	getLastAssistantUsage,
	prepareBranchEntries,
	shouldCompact,
} from "./core/compaction/index.js";
// Custom tools
export type {
	AgentToolUpdateCallback,
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
export type * from "./core/hooks/index.js";
// Hook system types and type guards
export {
	isBashToolResult,
	isEditToolResult,
	isFindToolResult,
	isGrepToolResult,
	isLsToolResult,
	isReadToolResult,
	isWriteToolResult,
} from "./core/hooks/index.js";
export { convertToLlm } from "./core/messages.js";
export { ModelRegistry } from "./core/model-registry.js";
// SDK for programmatic usage
export {
	type BuildSystemPromptOptions,
	buildSystemPrompt,
	type CreateAgentSessionOptions,
	type CreateAgentSessionResult,
	// Factory
	createAgentSession,
	createBashTool,
	// Tool factories (for custom cwd)
	createCodingTools,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadOnlyTools,
	createReadTool,
	createWriteTool,
	// Discovery
	discoverAuthStorage,
	discoverContextFiles,
	discoverCustomTools,
	discoverHooks,
	discoverModels,
	discoverSkills,
	discoverSlashCommands,
	type FileSlashCommand,
	loadSettings,
	// Pre-built tools (use process.cwd())
	readOnlyTools,
} from "./core/sdk.js";
export {
	type BranchSummaryEntry,
	buildSessionContext,
	type CompactionEntry,
	CURRENT_SESSION_VERSION,
	type CustomEntry,
	type CustomMessageEntry,
	type FileEntry,
	getLatestCompactionEntry,
	type ModelChangeEntry,
	migrateSessionEntries,
	parseSessionEntries,
	type SessionContext,
	type SessionEntry,
	type SessionEntryBase,
	type SessionHeader,
	type SessionInfo,
	SessionManager,
	type SessionMessageEntry,
	type ThinkingLevelChangeEntry,
} from "./core/session-manager.js";
export {
	type CompactionSettings,
	type RetrySettings,
	type Settings,
	SettingsManager,
	type SkillsSettings,
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
export {
	type BashToolDetails,
	bashTool,
	codingTools,
	editTool,
	type FindToolDetails,
	findTool,
	type GrepToolDetails,
	grepTool,
	type LsToolDetails,
	lsTool,
	type ReadToolDetails,
	readTool,
	type TruncationResult,
	writeTool,
} from "./core/tools/index.js";
// Main entry point
export { main } from "./main.js";
// Theme utilities for custom tools
export { getMarkdownTheme } from "./modes/interactive/theme/theme.js";
