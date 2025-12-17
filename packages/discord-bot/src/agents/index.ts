/**
 * Agents Module
 * Lightweight agent (pi-agent-core) and OpenHands Software Agent SDK integration
 */

// Lightweight Agent exports (pi-mono pattern)
export {
	AgentPresets,
	type AgentOptions,
	type AgentResult,
	AGENT_MODELS,
	DEFAULT_AGENT_MODEL,
	getAgentModels,
	isAgentAvailable,
	runAgent,
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
