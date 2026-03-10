/**
 * Layer 6.3: Semantic & Procedural Memory · 语义 & 程序性记忆
 *
 * "世界知识 + 你是谁 + 怎么做事"
 * - Fact memory (Leo, NYU, 经济学)
 * - Skill memory (沟通偏好, 工作流)
 * - RAG / Knowledge graph
 * - Mem0-style extract-update
 */

import type { SemanticFact, SemanticMemoryConfig } from "../../types.js";

export class SemanticMemory {
	private facts = new Map<string, SemanticFact>();

	constructor(private config: SemanticMemoryConfig = {}) {
		this.config.backend ??= "local";
		this.config.autoExtract ??= true;
	}

	/** Add or update a fact */
	upsert(fact: Omit<SemanticFact, "createdAt" | "updatedAt"> & { createdAt?: number; updatedAt?: number }): void {
		const existing = this.facts.get(fact.id);
		const now = Date.now();

		if (existing) {
			// Update existing fact
			this.facts.set(fact.id, {
				...existing,
				content: fact.content,
				confidence: Math.max(existing.confidence, fact.confidence),
				sources: [...new Set([...existing.sources, ...fact.sources])],
				updatedAt: now,
			});
		} else {
			this.facts.set(fact.id, {
				...fact,
				createdAt: fact.createdAt ?? now,
				updatedAt: fact.updatedAt ?? now,
			});
		}
	}

	/** Get a fact by ID */
	get(id: string): SemanticFact | undefined {
		return this.facts.get(id);
	}

	/** Search facts by category */
	getByCategory(category: SemanticFact["category"]): SemanticFact[] {
		return Array.from(this.facts.values()).filter((f) => f.category === category);
	}

	/** Search facts by content */
	search(query: string): SemanticFact[] {
		const lowerQuery = query.toLowerCase();
		return Array.from(this.facts.values())
			.filter((f) => f.content.toLowerCase().includes(lowerQuery))
			.sort((a, b) => b.confidence - a.confidence);
	}

	/** Get all personal facts (useful for system prompt) */
	getPersonalProfile(): SemanticFact[] {
		return this.getByCategory("personal").sort((a, b) => b.confidence - a.confidence);
	}

	/** Get preference facts */
	getPreferences(): SemanticFact[] {
		return this.getByCategory("preference").sort((a, b) => b.confidence - a.confidence);
	}

	/** Remove a fact */
	remove(id: string): boolean {
		return this.facts.delete(id);
	}

	/** Get all facts */
	all(): SemanticFact[] {
		return Array.from(this.facts.values());
	}

	/** Total fact count */
	get count(): number {
		return this.facts.size;
	}

	/**
	 * Extract facts from a conversation turn.
	 * In production, this would use an LLM to identify and extract factual claims.
	 */
	async extractFromConversation(
		_userMessage: string,
		_assistantResponse: string,
		_sessionId: string,
	): Promise<SemanticFact[]> {
		// Placeholder — requires LLM-based extraction
		// Real implementation would:
		// 1. Send conversation to LLM with extraction prompt
		// 2. Parse extracted facts
		// 3. Deduplicate against existing facts
		// 4. Upsert new/updated facts
		return [];
	}
}
