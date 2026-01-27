/**
 * Extension system for lifecycle events and custom tools.
 */

export {
	createExtensionRuntime,
	discoverAndLoadExtensions,
	loadExtensionFromFactory,
	loadExtensions,
} from "./loader.js";
export type {
	ExtensionErrorListener,
	ForkHandler,
	NavigateTreeHandler,
	NewSessionHandler,
	ShutdownHandler,
} from "./runner.js";
export { ExtensionRunner } from "./runner.js";
export type {
	// Commands
	AfterCommandHandler,
	AgentEndEvent,
	AgentStartEvent,
	// Re-exports
	AgentToolResult,
	AgentToolUpdateCallback,
	// App keybindings (for custom editors)
	AppAction,
	AppendEntryHandler,
	BashToolResultEvent,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	BeforeCommandHandler,
	BeforeCommandResult,
	CommandDataMap,
	CommandHandlerOptions,
	CommandMetadata,
	CommandResult,
	// Context
	CompactOptions,
	// Events - Agent
	ContextEvent,
	// Event Results
	ContextEventResult,
	ContextUsage,
	CopyCommandData,
	CustomToolResultEvent,
	EditToolResultEvent,
	ExecOptions,
	ExecResult,
	ExportCommandData,
	Extension,
	ExtensionActions,
	// API
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionCommandContextActions,
	ExtensionContext,
	ExtensionContextActions,
	// Errors
	ExtensionError,
	ExtensionEvent,
	ExtensionFactory,
	ExtensionFlag,
	ExtensionHandler,
	// Runtime
	ExtensionRuntime,
	ExtensionShortcut,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ExtensionWidgetOptions,
	FindToolResultEvent,
	GetActiveToolsHandler,
	GetAllToolsHandler,
	GetPipelineHandler,
	GetThinkingLevelHandler,
	GrepToolResultEvent,
	// Events - Input
	InputEvent,
	InputEventResult,
	InputSource,
	KeybindingsManager,
	LoadExtensionsResult,
	LsToolResultEvent,
	// Message Rendering
	MessageRenderer,
	MessageRenderOptions,
	ModelSelectEvent,
	ModelSelectSource,
	PipelineStageInfo,
	// Provider Registration
	ProviderConfig,
	ProviderModelConfig,
	ReadToolResultEvent,
	RegisteredCommand,
	RegisteredTool,
	ResumeCommandData,
	SendMessageHandler,
	SendUserMessageHandler,
	SessionBeforeCompactEvent,
	SessionBeforeCompactResult,
	SessionBeforeForkEvent,
	SessionBeforeForkResult,
	SessionBeforeSwitchEvent,
	SessionBeforeSwitchResult,
	SessionBeforeTreeEvent,
	SessionBeforeTreeResult,
	SessionCompactEvent,
	SessionEvent,
	SessionForkEvent,
	SessionShutdownEvent,
	// Events - Session
	SessionStartEvent,
	SessionSwitchEvent,
	SessionTreeEvent,
	SetActiveToolsHandler,
	SetLabelHandler,
	SetModelHandler,
	SetThinkingLevelHandler,
	ShareCommandData,
	// Events - Tool
	ToolCallEvent,
	ToolCallEventResult,
	// Tools
	ToolDefinition,
	ToolInfo,
	ToolRenderResultOptions,
	ToolResultEvent,
	ToolResultEventResult,
	TreePreparation,
	TurnEndEvent,
	TurnStartEvent,
	// Events - User Bash
	UserBashEvent,
	UserBashEventResult,
	WidgetPlacement,
	WriteToolResultEvent,
} from "./types.js";
// Type guards
export {
	isBashToolResult,
	isEditToolResult,
	isFindToolResult,
	isGrepToolResult,
	isLsToolResult,
	isReadToolResult,
	isWriteToolResult,
} from "./types.js";
export {
	wrapRegisteredTool,
	wrapRegisteredTools,
	wrapToolsWithExtensions,
	wrapToolWithExtensions,
} from "./wrapper.js";
