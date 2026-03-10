/**
 * Layer 4: Agent Runtime
 *
 * Built on pi-agent-core's agentLoop.
 *
 * Responsibilities:
 * - Agent loop driving (via pi-agent-core)
 * - Multi-agent persona system (SOUL.md)
 * - Heartbeat (cron-based proactive execution)
 * - Skills (on-demand capability packages)
 * - Tools (built-in + custom + extensions)
 */

import type { AgentPersona, EnrichedContext, HeartbeatTask, RoutingRule } from "../types.js";

// ─── Persona Manager ───

/**
 * Manages multiple agent personas, each defined by a SOUL.md file.
 * Routes incoming messages to the appropriate persona based on rules.
 */
export class PersonaManager {
	private personas = new Map<string, AgentPersona>();
	private defaultPersonaId: string | undefined;

	register(persona: AgentPersona): void {
		this.personas.set(persona.id, persona);
		if (!this.defaultPersonaId) {
			this.defaultPersonaId = persona.id;
		}
	}

	setDefault(personaId: string): void {
		this.defaultPersonaId = personaId;
	}

	/** Route a message to the best-matching persona */
	route(content: string): AgentPersona | undefined {
		let bestMatch: AgentPersona | undefined;
		let bestPriority = -1;

		for (const persona of this.personas.values()) {
			if (!persona.routingRules) continue;

			for (const rule of persona.routingRules) {
				if (rule.priority <= bestPriority) continue;

				if (matchesRule(rule, content)) {
					bestMatch = persona;
					bestPriority = rule.priority;
				}
			}
		}

		return bestMatch ?? (this.defaultPersonaId ? this.personas.get(this.defaultPersonaId) : undefined);
	}

	get(id: string): AgentPersona | undefined {
		return this.personas.get(id);
	}

	all(): AgentPersona[] {
		return Array.from(this.personas.values());
	}
}

function matchesRule(rule: RoutingRule, content: string): boolean {
	switch (rule.type) {
		case "keyword":
			return rule.pattern ? content.toLowerCase().includes(rule.pattern.toLowerCase()) : false;
		case "intent":
			// In production, use LLM-based intent classification
			return false;
		case "explicit":
			return rule.pattern ? content.startsWith(rule.pattern) : false;
		case "fallback":
			return true;
	}
}

// ─── Heartbeat Scheduler ───

/**
 * Manages scheduled tasks that trigger agent actions proactively.
 * Examples: daily reports, monitoring alerts, reminders.
 */
export class HeartbeatScheduler {
	private tasks = new Map<string, HeartbeatTask>();
	private timers = new Map<string, ReturnType<typeof setInterval>>();
	private handler: ((task: HeartbeatTask) => Promise<void>) | undefined;

	onTask(handler: (task: HeartbeatTask) => Promise<void>): void {
		this.handler = handler;
	}

	register(task: HeartbeatTask): void {
		this.tasks.set(task.id, task);
	}

	start(taskId: string): void {
		const task = this.tasks.get(taskId);
		if (!task || !task.enabled || !this.handler) return;

		// Simple interval-based scheduling
		// In production, use a proper cron library (like croner)
		const interval = parseCronToMs(task.schedule);
		if (interval > 0) {
			const timer = setInterval(() => {
				this.handler?.(task);
			}, interval);
			this.timers.set(taskId, timer);
		}
	}

	stop(taskId: string): void {
		const timer = this.timers.get(taskId);
		if (timer) {
			clearInterval(timer);
			this.timers.delete(taskId);
		}
	}

	stopAll(): void {
		for (const [id] of this.timers) {
			this.stop(id);
		}
	}
}

/** Simple cron-to-ms converter for basic intervals */
function parseCronToMs(cron: string): number {
	// Handle simple patterns like "every 1h", "every 30m", "every 1d"
	const match = cron.match(/every\s+(\d+)\s*(s|m|h|d)/i);
	if (!match) return 0;
	const [, value, unit] = match;
	const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
	return parseInt(value) * (multipliers[unit.toLowerCase()] ?? 0);
}

// ─── Skill Loader ───

export interface Skill {
	id: string;
	name: string;
	description: string;
	/** SKILL.md content — loaded progressively to save tokens */
	definition: string;
	/** CLI tools or commands this skill provides */
	commands?: string[];
}

export class SkillRegistry {
	private skills = new Map<string, Skill>();

	register(skill: Skill): void {
		this.skills.set(skill.id, skill);
	}

	get(id: string): Skill | undefined {
		return this.skills.get(id);
	}

	/** Find skills relevant to a given context */
	findRelevant(content: string): Skill[] {
		// Simple keyword matching — in production, use semantic similarity
		return Array.from(this.skills.values()).filter(
			(skill) =>
				content.toLowerCase().includes(skill.name.toLowerCase()) ||
				skill.description.toLowerCase().split(" ").some((word) => content.toLowerCase().includes(word)),
		);
	}

	all(): Skill[] {
		return Array.from(this.skills.values());
	}
}

// ─── Agent Runtime ───

export class AgentRuntime {
	readonly personas: PersonaManager;
	readonly heartbeat: HeartbeatScheduler;
	readonly skills: SkillRegistry;

	constructor() {
		this.personas = new PersonaManager();
		this.heartbeat = new HeartbeatScheduler();
		this.skills = new SkillRegistry();
	}

	/**
	 * Build the system prompt for a given context.
	 * Combines: persona SOUL.md + relevant skills + cognitive modules (injected externally)
	 */
	buildSystemPrompt(persona: AgentPersona, context: EnrichedContext, cognitiveContext?: string): string {
		const parts: string[] = [];

		// 1. Persona definition (SOUL.md)
		parts.push(persona.soulDefinition);

		// 2. Cognitive context (injected from memory layer)
		if (cognitiveContext) {
			parts.push("\n---\n## Cognitive Framework\n" + cognitiveContext);
		}

		// 3. Search-grounded facts
		if (context.injectedFacts.length > 0) {
			parts.push("\n---\n## Grounded Facts (from search)\n");
			for (const fact of context.injectedFacts) {
				parts.push(`- ${fact.claim} [source: ${fact.sources.join(", ")}]`);
			}
		}

		// 4. Relevant skills
		const relevantSkills = this.skills.findRelevant(context.originalMessage.content);
		if (relevantSkills.length > 0) {
			parts.push("\n---\n## Available Skills\n");
			for (const skill of relevantSkills) {
				parts.push(`### ${skill.name}\n${skill.description}`);
			}
		}

		return parts.join("\n");
	}

	shutdown(): void {
		this.heartbeat.stopAll();
	}
}
