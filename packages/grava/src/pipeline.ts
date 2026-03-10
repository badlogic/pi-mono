/**
 * Grava Pipeline — The complete 7-layer processing pipeline
 *
 * Data flow:
 * User Input → Channel 归一化 → Gateway 路由 → AI Search 滤网 → 认知记忆注入
 *   → Agent Runtime → LLM 生成 → 多方审计 → User + Memory
 */

import type {
	AuditMode,
	ClientMessage,
	GravaConfig,
	GravaEvent,
	GravaEventHandler,
	GravaPipeline,
	GravaResponse,
} from "./types.js";
import { normalizeMessage } from "./client/index.js";
import { Gateway } from "./gateway/index.js";
import { SearchLayer } from "./search/index.js";
import { AgentRuntime } from "./runtime/index.js";
import { AuditEngine } from "./audit/index.js";
import { MemoryManager } from "./memory/index.js";
import { LlmLayer } from "./llm/index.js";

export function createPipeline(config: GravaConfig): GravaPipeline {
	const eventHandlers = new Set<GravaEventHandler>();

	// Initialize layers
	const gateway = new Gateway(config.gateway ?? { auth: { mode: "allowlist" }, sessionRouter: {} });
	const search = new SearchLayer(config.search ?? { providers: [] });
	const runtime = new AgentRuntime();
	const audit = new AuditEngine(config.audit ?? { defaultMode: "fast", auditModels: [] });
	const memory = new MemoryManager(config.memory);
	const llm = new LlmLayer(
		config.llm ?? { primaryProvider: "anthropic", primaryModel: "claude-sonnet-4-5-20250514" },
	);

	function emit(event: GravaEvent): void {
		for (const handler of eventHandlers) {
			handler(event);
		}
	}

	async function process(message: ClientMessage): Promise<GravaResponse> {
		const startTime = Date.now();

		// 1. Client: Normalize message
		emit({ type: "message_received", message });
		const normalized = normalizeMessage(message);
		emit({ type: "message_normalized", message: normalized });

		// 2. Gateway: Route
		const gatewayResult = await gateway.process(normalized, message.metadata?.token as string ?? "default");
		if ("error" in gatewayResult) {
			throw new Error(`Gateway error: ${gatewayResult.error}`);
		}
		const { session } = gatewayResult;

		// 3. AI Search: Enrich context with facts
		const searchProviders = config.search?.providers.filter((p) => p.enabled).map((p) => p.name) ?? [];
		emit({ type: "search_started", query: normalized.content, providers: searchProviders });
		const enrichedContext = await search.process(normalized);
		emit({ type: "search_completed", results: enrichedContext.searchResults });
		emit({ type: "context_enriched", context: enrichedContext });

		// 4. Cognitive Memory: Inject cognitive framework
		const cognitiveContext = memory.cognitive.buildCognitiveContext(normalized.content);
		const usedModules = memory.cognitive.getRelevantModules(normalized.content).map((m) => m.id);
		emit({ type: "cognitive_injected", modules: usedModules });

		// 5. Agent Runtime: Build system prompt and route to persona
		const persona = runtime.personas.route(normalized.content) ?? {
			id: "default",
			name: "Default",
			soulDefinition: "You are a helpful AI assistant.",
		};
		emit({ type: "agent_processing", agentId: persona.id });

		const memoryContext = memory.buildMemoryContext(normalized.content);
		const fullSystemPrompt = [
			runtime.buildSystemPrompt(persona, enrichedContext, cognitiveContext),
			memoryContext,
		].join("\n\n---\n\n");

		// 6. LLM: Generate primary response
		const primary = llm.primary;
		const primaryResponse = await llm.call({
			provider: primary.provider,
			model: primary.model,
			systemPrompt: fullSystemPrompt,
			userMessage: normalized.content,
		});
		emit({ type: "llm_response", provider: primary.provider, model: primary.model });

		// 7. Audit: Cross-validate
		const auditMode: AuditMode = (message.metadata?.auditMode as AuditMode) ?? audit.resolveMode();
		emit({ type: "audit_started", mode: auditMode });
		const auditReport = await audit.audit(
			primaryResponse,
			fullSystemPrompt,
			normalized.content,
			enrichedContext.injectedFacts,
			auditMode,
			llm.createCaller(),
		);
		emit({ type: "audit_completed", report: auditReport });

		// 8. Memory: Update from conversation
		memory.working.add({ role: "user", content: normalized.content, timestamp: Date.now() });
		memory.working.add({ role: "assistant", content: primaryResponse.content, timestamp: Date.now() });
		await memory.updateFromConversation(normalized.content, primaryResponse.content, session.id);
		emit({ type: "memory_updated", layers: ["working", "memory"] });

		// Build response
		const response: GravaResponse = {
			content: primaryResponse.content,
			auditReport: auditMode !== "fast" ? auditReport : undefined,
			searchSources: enrichedContext.searchResults.flatMap((r) => r.results),
			cognitiveModulesUsed: usedModules,
			metadata: {
				sessionId: session.id,
				processingTime: Date.now() - startTime,
				tokensUsed: llm.stats.totalTokensUsed,
				auditMode,
			},
		};

		emit({ type: "response_delivered", sessionId: session.id });
		return response;
	}

	return {
		config,
		process,
		on(handler: GravaEventHandler) {
			eventHandlers.add(handler);
			return () => eventHandlers.delete(handler);
		},
	};
}
