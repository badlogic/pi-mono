/**
 * Grava — Core type definitions
 *
 * Architecture: 7-layer pipeline
 * User → Client → Gateway → AI Search → Cognitive Injection → Agent Runtime → LLM → Audit → User + Memory
 *
 * Three competitive moats:
 * 1. Input-side: AI Search pre-filter (fact grounding)
 * 2. Output-side: Multi-model audit (cross-validation)
 * 3. Cognitive: Cognitive memory system (thinking patterns, not just facts)
 */

// ─── Common ───

export interface GravaConfig {
	/** Unique instance identifier */
	instanceId: string;
	/** Layers to enable (all enabled by default) */
	enabledLayers?: LayerName[];
	/** Global audit mode default */
	defaultAuditMode?: AuditMode;
	/** Gateway configuration */
	gateway?: GatewayConfig;
	/** Memory configuration */
	memory?: MemoryConfig;
	/** Search configuration */
	search?: SearchConfig;
	/** Audit configuration */
	audit?: AuditConfig;
	/** LLM provider configuration */
	llm?: LlmConfig;
}

export type LayerName = "client" | "gateway" | "search" | "runtime" | "audit" | "memory" | "llm";

// ─── Layer 1: Client ───

export interface ClientMessage {
	id: string;
	channel: ChannelType;
	userId: string;
	content: string;
	attachments?: Attachment[];
	timestamp: number;
	metadata?: Record<string, unknown>;
}

export type ChannelType =
	| "ios"
	| "macos"
	| "wechat"
	| "telegram"
	| "slack"
	| "discord"
	| "whatsapp"
	| "signal"
	| "imessage"
	| "teams"
	| "feishu"
	| "line"
	| "web"
	| string;

export interface Attachment {
	type: "image" | "file" | "audio" | "video";
	url: string;
	mimeType: string;
	name?: string;
	size?: number;
}

/** Normalized message after channel adapter processing */
export interface NormalizedMessage {
	id: string;
	userId: string;
	content: string;
	attachments: Attachment[];
	sourceChannel: ChannelType;
	timestamp: number;
	metadata: Record<string, unknown>;
}

// ─── Layer 2: Gateway ───

export interface GatewayConfig {
	auth: AuthConfig;
	sessionRouter: SessionRouterConfig;
}

export interface AuthConfig {
	mode: "token" | "device-pair" | "allowlist";
	allowedUsers?: string[];
}

export interface SessionRouterConfig {
	/** Max concurrent sessions per user */
	maxConcurrentSessions?: number;
	/** Default agent persona to route to */
	defaultAgent?: string;
}

export interface Session {
	id: string;
	userId: string;
	agentId: string;
	createdAt: number;
	lastActiveAt: number;
	state: "active" | "suspended" | "archived";
}

// ─── Layer 3: AI Search ───

export interface SearchConfig {
	/** Search providers to use */
	providers: SearchProvider[];
	/** Max results per provider */
	maxResultsPerProvider?: number;
	/** Token budget for search context injection */
	tokenBudget?: number;
	/** Whether to enable automatic search decision */
	autoDecision?: boolean;
}

export interface SearchProvider {
	name: SearchProviderName;
	apiKey?: string;
	enabled: boolean;
	priority?: number;
}

export type SearchProviderName =
	| "perplexity"
	| "exa"
	| "tavily"
	| "google"
	| "bing"
	| "custom";

export interface SearchResult {
	provider: SearchProviderName;
	query: string;
	results: SearchResultItem[];
	timestamp: number;
}

export interface SearchResultItem {
	title: string;
	url: string;
	snippet: string;
	relevanceScore: number;
	freshness?: "realtime" | "recent" | "archival";
	source: string;
}

export interface EnrichedContext {
	originalMessage: NormalizedMessage;
	searchResults: SearchResult[];
	injectedFacts: InjectedFact[];
	tokenUsage: number;
}

export interface InjectedFact {
	claim: string;
	sources: string[];
	confidence: number;
}

// ─── Layer 4: Agent Runtime ───

export interface AgentPersona {
	id: string;
	name: string;
	/** SOUL.md — personality and behavior definition */
	soulDefinition: string;
	/** Routing rules: when to activate this persona */
	routingRules?: RoutingRule[];
	/** Skills available to this persona */
	skills?: string[];
}

export interface RoutingRule {
	type: "keyword" | "intent" | "explicit" | "fallback";
	pattern?: string;
	priority: number;
}

export interface HeartbeatTask {
	id: string;
	schedule: string; // cron expression
	agentId: string;
	description: string;
	action: HeartbeatAction;
	enabled: boolean;
}

export type HeartbeatAction =
	| { type: "report"; template: string }
	| { type: "monitor"; target: string; condition: string }
	| { type: "remind"; message: string }
	| { type: "custom"; handler: string };

// ─── Layer 5: Audit ───

export type AuditMode = "fast" | "audit" | "deep";

export interface AuditConfig {
	/** Default audit mode */
	defaultMode: AuditMode;
	/** Models to use for cross-validation in audit/deep mode */
	auditModels: AuditModelConfig[];
	/** Consensus threshold (0-1) */
	consensusThreshold?: number;
	/** Enable fact verification against search results */
	factVerification?: boolean;
}

export interface AuditModelConfig {
	provider: string;
	model: string;
	weight?: number;
}

export interface AuditReport {
	mode: AuditMode;
	/** High-confidence consensus conclusions */
	consensus: AuditClaim[];
	/** Divergent opinions across models */
	divergences: AuditDivergence[];
	/** Unverified or contradictory claims */
	unverified: AuditClaim[];
	/** Decision recommendations (not conclusions) */
	recommendations: string[];
	/** Overall confidence score (0-1) */
	confidence: number;
	/** Models that participated */
	participants: string[];
	timestamp: number;
}

export interface AuditClaim {
	claim: string;
	confidence: number;
	sources: string[];
}

export interface AuditDivergence {
	topic: string;
	opinions: { model: string; opinion: string }[];
}

// ─── Layer 6: Memory ───

export interface MemoryConfig {
	/** Working memory (context window) config */
	working?: WorkingMemoryConfig;
	/** Episodic memory (session history) config */
	episodic?: EpisodicMemoryConfig;
	/** Semantic & procedural memory config */
	semantic?: SemanticMemoryConfig;
	/** Cognitive memory config */
	cognitive?: CognitiveMemoryConfig;
}

// Layer 6.1: Working Memory
export interface WorkingMemoryConfig {
	/** Max tokens for context window */
	maxTokens?: number;
	/** Auto-compaction strategy */
	compactionStrategy?: "summarize" | "truncate" | "hybrid";
}

// Layer 6.2: Episodic Memory
export interface EpisodicMemoryConfig {
	/** Auto-summarize sessions */
	autoSummarize?: boolean;
	/** Retention period in days (0 = forever) */
	retentionDays?: number;
}

export interface Episode {
	sessionId: string;
	summary: string;
	keyTopics: string[];
	decisions: string[];
	timestamp: number;
	duration: number;
}

// Layer 6.3: Semantic & Procedural Memory
export interface SemanticMemoryConfig {
	/** Backend for semantic storage */
	backend?: "local" | "vector-db";
	/** Auto-extract facts from conversations */
	autoExtract?: boolean;
}

export interface SemanticFact {
	id: string;
	category: "personal" | "preference" | "knowledge" | "skill" | "workflow";
	content: string;
	confidence: number;
	sources: string[]; // session IDs where this was learned
	createdAt: number;
	updatedAt: number;
}

// Layer 6.4: Cognitive Memory (v0.3 core differentiator)
export interface CognitiveMemoryConfig {
	/** Directory containing cognitive module .md files */
	modulesDir?: string;
	/** Core modules always injected into system prompt */
	coreModules?: string[];
	/** Auto-evolve cognitive modules from conversations */
	autoEvolve?: boolean;
}

export interface CognitiveModule {
	id: string;
	/** Module filename (e.g., "worldview.md", "ai-philosophy.md") */
	filename: string;
	/** The cognitive framework content (Markdown) */
	content: string;
	/** Injection strategy */
	injection: "core" | "topic-matched";
	/** Topics that trigger injection (for topic-matched modules) */
	topics?: string[];
	/** Evolution history */
	evolution: CognitiveEvolution[];
	createdAt: number;
	updatedAt: number;
}

export interface CognitiveEvolution {
	timestamp: number;
	previousContent: string;
	newContent: string;
	reason: string;
	sourceSessionId: string;
}

// ─── Layer 7: LLM Provider ───

export interface LlmConfig {
	/** Primary provider for fast mode */
	primaryProvider: string;
	/** Primary model for fast mode */
	primaryModel: string;
	/** Providers available for audit mode */
	auditProviders?: { provider: string; model: string }[];
}

// ─── Pipeline Events ───

export type GravaEvent =
	| { type: "message_received"; message: ClientMessage }
	| { type: "message_normalized"; message: NormalizedMessage }
	| { type: "search_started"; query: string; providers: SearchProviderName[] }
	| { type: "search_completed"; results: SearchResult[] }
	| { type: "context_enriched"; context: EnrichedContext }
	| { type: "cognitive_injected"; modules: string[] }
	| { type: "agent_processing"; agentId: string }
	| { type: "llm_response"; provider: string; model: string }
	| { type: "audit_started"; mode: AuditMode }
	| { type: "audit_completed"; report: AuditReport }
	| { type: "memory_updated"; layers: LayerName[] }
	| { type: "response_delivered"; sessionId: string };

export type GravaEventHandler = (event: GravaEvent) => void | Promise<void>;

// ─── Pipeline ───

export interface GravaPipeline {
	config: GravaConfig;
	process(message: ClientMessage): Promise<GravaResponse>;
	on(handler: GravaEventHandler): () => void;
}

export interface GravaResponse {
	content: string;
	auditReport?: AuditReport;
	searchSources?: SearchResultItem[];
	cognitiveModulesUsed?: string[];
	metadata: {
		sessionId: string;
		processingTime: number;
		tokensUsed: number;
		auditMode: AuditMode;
	};
}
