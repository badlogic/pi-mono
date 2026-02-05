import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { loadSoul, loadTaskLists } from "./soul.js";

export interface EvolutionSuggestion {
	target: "soul" | "task_list" | "skill";
	domain?: string;
	action: "update" | "create";
	content: string;
	reasoning: string;
}

export interface EvolutionResult {
	suggestions: EvolutionSuggestion[];
	analysis: string;
}

/**
 * Build the evolution analysis prompt from the agent's current state.
 * This is the prompt that would be sent to an LLM for analysis.
 */
export function buildEvolutionPrompt(options: { dataDir: string; maxDecisions?: number }): string {
	const { dataDir } = options;

	// Load current soul
	const soulPath = join(dataDir, "soul.md");
	const soul = existsSync(soulPath) ? loadSoul(soulPath) : "(no soul defined)";

	// Load task lists
	const taskLists = loadTaskLists(join(dataDir, "tasks"));

	let prompt = `You are the evolution engine for a game-playing agent. Analyze its performance and suggest improvements.

## Current Soul
${soul}

## Current Task Lists
`;

	for (const [domain, content] of taskLists) {
		prompt += `### ${domain}\n${content}\n\n`;
	}

	prompt += `## Instructions

Analyze the agent's performance based on its decisions and current configuration.
Suggest improvements as a JSON array of suggestions.

Each suggestion must have:
- target: "soul" | "task_list" | "skill"
- domain: (optional) domain name for task_list targets
- action: "update" | "create"
- content: the new/updated content
- reasoning: why this change would help

Respond with:
1. A brief analysis section
2. A JSON code block with the suggestions array

\`\`\`json
[
  {
    "target": "soul",
    "action": "update",
    "content": "updated soul content...",
    "reasoning": "why this change..."
  }
]
\`\`\``;

	return prompt;
}

/**
 * Parse evolution suggestions from an LLM response.
 * Extracts the JSON array from a markdown code block.
 */
export function parseEvolutionResult(response: string): EvolutionResult {
	// Extract JSON from code block
	const jsonMatch = response.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
	let suggestions: EvolutionSuggestion[] = [];

	if (jsonMatch) {
		try {
			const parsed = JSON.parse(jsonMatch[1]);
			if (Array.isArray(parsed)) {
				suggestions = parsed
					.filter(
						(s) =>
							s && typeof s.target === "string" && typeof s.action === "string" && typeof s.content === "string",
					)
					.map((s) => ({
						target: s.target,
						domain: s.domain,
						action: s.action,
						content: s.content,
						reasoning: s.reasoning ?? "",
					}));
			}
		} catch {
			// Failed to parse JSON
		}
	}

	// Extract analysis (everything before the JSON block)
	const analysisEnd = response.indexOf("```");
	const analysis = analysisEnd > 0 ? response.slice(0, analysisEnd).trim() : response.trim();

	return { suggestions, analysis };
}

/**
 * Apply evolution suggestions to the agent's files.
 */
export async function applyEvolution(suggestions: EvolutionSuggestion[], dataDir: string): Promise<string[]> {
	const appliedFiles: string[] = [];

	for (const suggestion of suggestions) {
		let filePath: string;

		switch (suggestion.target) {
			case "soul":
				filePath = join(dataDir, "soul.md");
				break;
			case "task_list":
				if (!suggestion.domain) continue;
				filePath = join(dataDir, "tasks", `${suggestion.domain}.md`);
				break;
			case "skill":
				if (!suggestion.domain) continue;
				filePath = join(dataDir, "skills", suggestion.domain, "SKILL.md");
				break;
			default:
				continue;
		}

		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, suggestion.content);
		appliedFiles.push(filePath);
	}

	return appliedFiles;
}
