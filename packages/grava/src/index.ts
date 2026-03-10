/**
 * Grava — AI agent framework
 *
 * Three competitive moats:
 * 1. Input-side:  AI Search pre-filter (fact grounding, not hallucination)
 * 2. Output-side: Multi-model audit (cross-validation, not blind trust)
 * 3. Cognitive:   Cognitive memory (thinking patterns, not just facts)
 *
 * "Grava doesn't make AI smarter. It makes human intent more complete."
 *
 * @module @mariozechner/pi-grava
 */

// ─── Core Types ───
export type {
	GravaConfig,
	GravaPipeline,
	GravaResponse,
	GravaEvent,
	GravaEventHandler,
	LayerName,
	// Client
	ClientMessage,
	NormalizedMessage,
	ChannelType,
	Attachment,
	// Gateway
	GatewayConfig,
	AuthConfig,
	SessionRouterConfig,
	Session,
	// Search
	SearchConfig,
	SearchProvider,
	SearchProviderName,
	SearchResult,
	SearchResultItem,
	EnrichedContext,
	InjectedFact,
	// Runtime
	AgentPersona,
	RoutingRule,
	HeartbeatTask,
	HeartbeatAction,
	// Audit
	AuditMode,
	AuditConfig,
	AuditModelConfig,
	AuditReport,
	AuditClaim,
	AuditDivergence,
	// Memory
	MemoryConfig,
	WorkingMemoryConfig,
	EpisodicMemoryConfig,
	Episode,
	SemanticMemoryConfig,
	SemanticFact,
	CognitiveMemoryConfig,
	CognitiveModule,
	CognitiveEvolution,
	// LLM
	LlmConfig,
} from "./types.js";

// ─── Pipeline ───
export { createPipeline } from "./pipeline.js";

// ─── Layer Implementations ───
export { normalizeMessage, ChannelRegistry } from "./client/index.js";
export type { ChannelAdapter, SessionViewerQuery, SessionViewerEntry } from "./client/index.js";

export { Gateway, SessionRouter, EventBus, createAuthProvider } from "./gateway/index.js";
export type { AuthProvider, AuthResult } from "./gateway/index.js";

export { SearchLayer, SearchExecutor, FactInjector, makeSearchDecision } from "./search/index.js";
export type { SearchSource, SearchDecision } from "./search/index.js";

export { AgentRuntime, PersonaManager, HeartbeatScheduler, SkillRegistry } from "./runtime/index.js";
export type { Skill } from "./runtime/index.js";

export { AuditEngine } from "./audit/index.js";
export type { LlmResponse, LlmCaller } from "./audit/index.js";

export { MemoryManager, WorkingMemory, EpisodicMemory, SemanticMemory, CognitiveMemory } from "./memory/index.js";

export { LlmLayer } from "./llm/index.js";
export type { LlmCallOptions } from "./llm/index.js";
