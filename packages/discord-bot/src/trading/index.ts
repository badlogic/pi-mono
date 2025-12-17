/**
 * Trading Module Exports
 * Nano Trading Agents inspired by Moon Dev's architecture
 */

// Moon Dev Inspired Agents
export {
	IlyaSutskeverAgent,
	JimSimonsAgent,
	JohnCarmackAgent,
	MarketIntelAgent,
	MoonDevAgents,
	RayDalioAgent,
	RiskAssessmentAgent,
} from "./agents/moondev-agents.js";
// Core Agents
export { PriceAgent } from "./agents/price-agent.js";
export { SentimentAgent } from "./agents/sentiment-agent.js";
export { WhaleAgent } from "./agents/whale-agent.js";
// Base agent
export { BaseAgent, type SignalHandler } from "./base-agent.js";
// Consensus
export { ConsensusEngine } from "./consensus.js";
// Learning Service
export { type SessionSummary, type TradingOutcome, tradingLearning } from "./learning-service.js";
// Orchestrator
export { getTradingOrchestrator, TradingOrchestrator } from "./orchestrator.js";
// Types
export * from "./types.js";
