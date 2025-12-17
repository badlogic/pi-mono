/**
 * Agents Module
 * Claude Code subagent spawning and OpenHands Software Agent SDK integration
 */

// Claude Agent exports
export {
	type AgentOptions,
	AgentPresets,
	type AgentResult,
	ClaudeAgent,
	getClaudeAgent,
	runAgent,
} from "./claude-agent.js";
// OpenHands Software Agent SDK integration - Core
// OpenHands Expert Functions - Convenience exports
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
