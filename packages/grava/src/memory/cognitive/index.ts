/**
 * Layer 6.4: Cognitive Memory · 认知记忆 — 护城河 ③ · v0.3 核心差异化
 *
 * "不是'关于你的信息'，是'你怎么想'"
 * "你的认知框架、世界观、决策方法论"
 *
 * This is NOT prompt templates, NOT skills — it's a cognitive lens.
 *
 * Key principles:
 * - Each cognitive module = a Markdown file describing how you think about a domain
 * - Core modules (worldview, decision) → always in system prompt
 * - Domain modules (finance, AI) → injected when topic matches
 * - Evolution: not append-only — cognitive views get revised over time
 * - Full evolution timeline is trackable
 *
 * Why this matters:
 * Fact memory lets the agent know you. Cognitive memory lets the agent
 * become an extension of your thinking. Other agents know you're Leo at NYU
 * studying economics. Your agent knows you believe AGI emerges from the
 * efficient combination of input and output, and uses this framework
 * to interpret all new information.
 */

import type { CognitiveEvolution, CognitiveMemoryConfig, CognitiveModule } from "../../types.js";

export class CognitiveMemory {
	private modules = new Map<string, CognitiveModule>();

	constructor(private config: CognitiveMemoryConfig = {}) {
		this.config.coreModules ??= ["worldview", "decision"];
		this.config.autoEvolve ??= true;
	}

	/** Register a cognitive module */
	register(module: CognitiveModule): void {
		this.modules.set(module.id, module);
	}

	/** Get a module by ID */
	get(id: string): CognitiveModule | undefined {
		return this.modules.get(id);
	}

	/** Get all core modules (always injected into system prompt) */
	getCoreModules(): CognitiveModule[] {
		return Array.from(this.modules.values()).filter((m) => m.injection === "core");
	}

	/** Get modules relevant to a given topic/content */
	getRelevantModules(content: string): CognitiveModule[] {
		const lowerContent = content.toLowerCase();

		// Core modules always included
		const core = this.getCoreModules();

		// Topic-matched modules
		const topicMatched = Array.from(this.modules.values()).filter(
			(m) => m.injection === "topic-matched" && m.topics?.some((t) => lowerContent.includes(t.toLowerCase())),
		);

		// Deduplicate
		const seen = new Set<string>();
		const result: CognitiveModule[] = [];
		for (const m of [...core, ...topicMatched]) {
			if (!seen.has(m.id)) {
				seen.add(m.id);
				result.push(m);
			}
		}

		return result;
	}

	/**
	 * Build the cognitive context string for system prompt injection.
	 * Called between Search and Runtime in the pipeline:
	 * ... → AI Search → Cognitive Injection → Agent Runtime → ...
	 */
	buildCognitiveContext(content: string): string {
		const modules = this.getRelevantModules(content);
		if (modules.length === 0) return "";

		const parts = modules.map((m) => `### ${m.filename}\n${m.content}`);
		return parts.join("\n\n---\n\n");
	}

	/**
	 * Evolve a cognitive module based on new insights from conversation.
	 *
	 * This is NOT append — it's revision. Cognitive views change over time.
	 * The previous version is preserved in the evolution history.
	 */
	evolve(moduleId: string, newContent: string, reason: string, sourceSessionId: string): boolean {
		const module = this.modules.get(moduleId);
		if (!module) return false;

		const evolution: CognitiveEvolution = {
			timestamp: Date.now(),
			previousContent: module.content,
			newContent,
			reason,
			sourceSessionId,
		};

		module.evolution.push(evolution);
		module.content = newContent;
		module.updatedAt = Date.now();

		return true;
	}

	/** Get the evolution timeline for a module */
	getEvolutionTimeline(moduleId: string): CognitiveEvolution[] {
		return this.modules.get(moduleId)?.evolution ?? [];
	}

	/** Get all modules */
	all(): CognitiveModule[] {
		return Array.from(this.modules.values());
	}

	/** Total module count */
	get count(): number {
		return this.modules.size;
	}

	/**
	 * Auto-extract cognitive insights from a conversation.
	 * In production, uses LLM to identify shifts in thinking patterns.
	 */
	async extractFromConversation(
		_userMessage: string,
		_assistantResponse: string,
		_sessionId: string,
	): Promise<{ moduleId: string; suggestedRevision: string; reason: string }[]> {
		// Placeholder — requires LLM-based cognitive extraction
		// Real implementation would:
		// 1. Analyze conversation for cognitive patterns (worldview statements, decision frameworks)
		// 2. Compare against existing cognitive modules
		// 3. Suggest revisions if views have shifted
		// 4. Flag new cognitive domains not yet captured
		return [];
	}
}
