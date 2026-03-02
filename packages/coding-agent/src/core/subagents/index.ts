/**
 * Alive Subagents - Module entry point.
 *
 * This module provides subagent functionality for the pi coding agent:
 * - SubagentManager: Lifecycle management for alive subagents
 * - Agent discovery from user/project/builtin sources
 * - Tool registration for LLM delegation
 * - Slash commands for user interaction
 *
 * @module subagents
 */

// Commands
export { registerSubagentCommands } from "./commands.js";
// Discovery
export { discoverAgents, formatAgentList, getAgentByName, getAvailableAgentNames } from "./discovery.js";
// Manager
export { SubagentManager } from "./manager.js";

// Parser
export { parseAgentFile, parseFrontmatter, stripFrontmatter } from "./parser.js";

// Tools
export { registerSubagentTools } from "./tools.js";
// Types
export type {
	AgentFrontmatter,
	AliveSubagent,
	DiscoveryResult,
	MemoryScope,
	RpcClientLike,
	StartSubagentOptions,
	StartSubagentResult,
	SubagentConfig,
	SubagentContextActions,
	SubagentFilter,
	SubagentListDetails,
	SubagentManagerConfig,
	SubagentManagerEvent,
	SubagentManagerEventHandler,
	SubagentMessage,
	SubagentMode,
	SubagentOutput,
	SubagentSendDetails,
	SubagentSource,
	SubagentStartDetails,
	SubagentStatus,
	SubagentUsage,
	ToolFactory,
} from "./types.js";
