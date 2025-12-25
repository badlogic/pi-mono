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
// Auth and model registry
export { type ApiKeyCredential, type AuthCredential, AuthStorage, type OAuthCredential } from "./core/auth-storage.js";
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
export type {
	AgentEndEvent,
	AgentStartEvent,
	BashToolResultEvent,
	CustomToolResultEvent,
	EditToolResultEvent,
	FindToolResultEvent,
	GrepToolResultEvent,
	HookAPI,
	HookEvent,
	HookEventContext,
	HookFactory,
	HookUIContext,
	LsToolResultEvent,
	ReadToolResultEvent,
	SessionEvent,
	SessionEventResult,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
	TurnEndEvent,
	TurnStartEvent,
	WriteToolResultEvent,
} from "./core/hooks/index.js";
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
export { messageTransformer } from "./core/messages.js";
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
	type BranchSummaryContent,
	type BranchSummaryEntry,
	buildSessionContext,
	type CompactionContent,
	type CompactionEntry,
	type ConversationContent,
	type ConversationEntry,
	CURRENT_SESSION_VERSION,
	createSummaryMessage,
	type FileEntry,
	getLatestCompactionEntry,
	type MessageContent,
	type ModelChangeContent,
	type ModelChangeEntry,
	migrateSessionEntries,
	parseSessionEntries,
	type SessionContext as LoadedSession,
	type SessionEntry,
	type SessionHeader,
	type SessionInfo,
	SessionManager,
	type SessionMessageEntry,
	SUMMARY_PREFIX,
	SUMMARY_SUFFIX,
	type ThinkingLevelChangeEntry,
	type ThinkingLevelContent,
	// Tree types (v2)
	type TreeNode,
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
