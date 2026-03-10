/**
 * Layer 6: Memory Architecture — 四层记忆体系
 *
 * From cognitive science:
 * ① Working Memory (工作记忆) — current session context, immediate processing buffer
 * ② Episodic Memory (情景记忆) — what happened, session summaries, timelines
 * ③ Semantic & Procedural Memory (语义 & 程序性记忆) — world knowledge + identity + skills
 * ④ Cognitive Memory (认知记忆) — how you think, cognitive frameworks, worldview
 *
 * Human brain analogy:
 * Working → Immediate processing buffer
 * Episodic → Hippocampus
 * Semantic → Cortical storage
 * Cognitive → Prefrontal cortex connection patterns
 */

import type { MemoryConfig } from "../types.js";
import { CognitiveMemory } from "./cognitive/index.js";
import { EpisodicMemory } from "./episodic/index.js";
import { SemanticMemory } from "./semantic/index.js";
import { WorkingMemory } from "./working/index.js";

export { CognitiveMemory } from "./cognitive/index.js";
export { EpisodicMemory } from "./episodic/index.js";
export { SemanticMemory } from "./semantic/index.js";
export { WorkingMemory } from "./working/index.js";

/**
 * Unified memory manager that coordinates all four memory layers.
 */
export class MemoryManager {
	readonly working: WorkingMemory;
	readonly episodic: EpisodicMemory;
	readonly semantic: SemanticMemory;
	readonly cognitive: CognitiveMemory;

	constructor(config: MemoryConfig = {}) {
		this.working = new WorkingMemory(config.working);
		this.episodic = new EpisodicMemory(config.episodic);
		this.semantic = new SemanticMemory(config.semantic);
		this.cognitive = new CognitiveMemory(config.cognitive);
	}

	/**
	 * Build complete memory context for system prompt injection.
	 * Priority order: cognitive > semantic facts > episodic summaries
	 */
	buildMemoryContext(currentContent: string): string {
		const parts: string[] = [];

		// 1. Cognitive framework (highest priority)
		const cognitiveCtx = this.cognitive.buildCognitiveContext(currentContent);
		if (cognitiveCtx) {
			parts.push("## Your Cognitive Framework\n" + cognitiveCtx);
		}

		// 2. Personal facts and preferences
		const personalFacts = this.semantic.getPersonalProfile();
		const preferences = this.semantic.getPreferences();
		if (personalFacts.length > 0 || preferences.length > 0) {
			parts.push("## About the User");
			for (const fact of personalFacts) {
				parts.push(`- ${fact.content}`);
			}
			if (preferences.length > 0) {
				parts.push("\n### Preferences");
				for (const pref of preferences) {
					parts.push(`- ${pref.content}`);
				}
			}
		}

		// 3. Recent episode summaries (for continuity)
		const recentEpisodes = this.episodic.getRecent(3);
		if (recentEpisodes.length > 0) {
			parts.push("## Recent Interactions");
			for (const ep of recentEpisodes) {
				parts.push(`- [${new Date(ep.timestamp).toISOString().slice(0, 10)}] ${ep.summary}`);
			}
		}

		return parts.join("\n\n");
	}

	/**
	 * Post-conversation memory update.
	 * Called after each conversation turn to extract and store memories.
	 */
	async updateFromConversation(
		userMessage: string,
		assistantResponse: string,
		sessionId: string,
	): Promise<void> {
		// Extract semantic facts
		if (this.semantic) {
			await this.semantic.extractFromConversation(userMessage, assistantResponse, sessionId);
		}

		// Extract cognitive insights
		if (this.cognitive) {
			await this.cognitive.extractFromConversation(userMessage, assistantResponse, sessionId);
		}
	}
}
