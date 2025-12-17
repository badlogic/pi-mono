/**
 * Agents Module
 * Lightweight agent (pi-agent-core), OpenHands SDK, and Agent Experts system
 */

// Agent Experts - Act-Learn-Reuse System
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
