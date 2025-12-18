/**
 * Agent Experts - Act-Learn-Reuse System
 *
 * Implements the three-step workflow for learning agents:
 * - ACT: Agent performs useful actions
 * - LEARN: Extract and store new information in expertise files
 * - REUSE: Apply accumulated expertise on next execution
 *
 * Based on TAC Lesson 13: Agent Experts
 * "Never update expertise files directly - teach agents HOW to learn"
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

// Get workspace root from current file location (works in both src and dist)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Navigate up from dist/agents or src/agents to package root, then into src/agents/expertise
const packageRoot = resolve(__dirname, "..", "..");
const EXPERTISE_DIR = join(packageRoot, "src", "agents", "expertise");

export interface ExpertiseConfig {
	mode: string;
	maxInsights: number; // Prevent unbounded growth
	minLearningLength: number; // Minimum chars to consider as learning
}

export interface LearningResult {
	learned: boolean;
	insight: string;
	expertiseFile: string;
}

// Learning markers to look for in agent output
const LEARNING_MARKERS = [
	"## Learnings",
	"## What I Learned",
	"## Insights",
	"### Patterns",
	"### Observations",
	"### Notes",
	"## Key Insight",
	"### Key Insight",
	"## Recommendation",
	"## Anti-Patterns",
	"### Anti-Patterns",
	"## Best Practices",
	"## Summary",
	"### Summary",
	"## Conclusion",
];

// Insight patterns for extracting implicit learnings
const INSIGHT_PATTERNS = [
	/(?:discovered|found|noticed|identified)[:\s]+(.+?)(?:\n|$)/gi,
	/(?:pattern|approach|technique)[:\s]+(.+?)(?:\n|$)/gi,
	/(?:important|notable|key)[:\s]+(.+?)(?:\n|$)/gi,
	/(?:recommend|suggestion|should)[:\s]+(.+?)(?:\n|$)/gi,
	/(?:anti-pattern|issue|problem)[:\s]+(.+?)(?:\n|$)/gi,
	/(?:best practice|optimization)[:\s]+(.+?)(?:\n|$)/gi,
];

/**
 * Self-improve prompts - teach agents HOW to learn
 * These are appended to the task to guide learning extraction
 */
export const SELF_IMPROVE_PROMPTS: Record<string, string> = {
	general: `After completing this task, reflect on what you learned:
1. What patterns did you discover?
2. What approaches worked well?
3. What would you do differently next time?

Format your learnings as markdown that can improve future executions.`,

	coding: `After this coding task, document your learnings:
1. What code patterns were effective?
2. What edge cases did you handle?
3. What best practices should be remembered?

Format as markdown for expertise accumulation.`,

	research: `After this research, note your findings:
1. What sources were most valuable?
2. What patterns emerged in the data?
3. What conclusions should be remembered?

Format as markdown for future reference.`,

	trading: `After this analysis, document your learnings:
1. What market patterns did you identify?
2. What indicators were most useful?
3. What risk factors should be watched?

Format as markdown for strategy improvement.`,
};

/**
 * Ensure expertise directory exists
 */
function ensureExpertiseDir(): void {
	if (!existsSync(EXPERTISE_DIR)) {
		mkdirSync(EXPERTISE_DIR, { recursive: true });
	}
}

/**
 * Get path for mode-specific expertise file
 */
export function getExpertisePath(mode: string): string {
	return join(EXPERTISE_DIR, `${mode}.md`);
}

/**
 * REUSE Phase: Load accumulated expertise for a mode
 * Returns expertise content to inject into system prompt
 */
export function loadExpertise(mode: string): string {
	const path = getExpertisePath(mode);

	if (!existsSync(path)) {
		return "";
	}

	try {
		const content = readFileSync(path, "utf-8");

		// Extract meaningful sections (not just template comments)
		const sections: string[] = [];
		let currentSection: string[] = [];

		for (const line of content.split("\n")) {
			if (line.startsWith("## ") && currentSection.length > 0) {
				const sectionText = currentSection.join("\n").trim();
				// Only include sections with actual content
				if (sectionText && !sectionText.includes("<!-- Agent updates")) {
					sections.push(sectionText);
				}
				currentSection = [line];
			} else {
				currentSection.push(line);
			}
		}

		// Add last section
		if (currentSection.length > 0) {
			const sectionText = currentSection.join("\n").trim();
			if (sectionText && !sectionText.includes("<!-- Agent updates")) {
				sections.push(sectionText);
			}
		}

		// Return if there's meaningful content
		const expertise = sections.join("\n\n");
		if (expertise && expertise.length > 100) {
			return `\n\n## Accumulated Expertise (from ${sections.length} learning sessions)\n${expertise}`;
		}
	} catch {
		// Silently fail - don't break the main task
	}

	return "";
}

/**
 * Extract learnings from agent output
 * Looks for explicit learning markers or infers from patterns
 */
export function extractLearnings(output: string): string {
	const learnings: string[] = [];

	// Look for explicit learning sections
	for (const marker of LEARNING_MARKERS) {
		if (output.includes(marker)) {
			const idx = output.indexOf(marker);
			let section = output.substring(idx);

			// Extract until next ## or end
			const endIdx = section.indexOf("\n## ", marker.length);
			if (endIdx > 0) {
				section = section.substring(0, endIdx);
			}

			// Limit section length
			learnings.push(section.trim().substring(0, 500));
		}
	}

	// If no explicit learnings, extract from patterns
	if (learnings.length === 0 && output) {
		for (const pattern of INSIGHT_PATTERNS) {
			const matches = output.match(pattern);
			if (matches) {
				learnings.push(...matches.slice(0, 3).map((m) => m.substring(0, 200)));
			}
		}
	}

	// If still no learnings but output is substantial, take first paragraph
	if (learnings.length === 0 && output.length > 200) {
		const paragraphs = output.split("\n\n");
		for (const para of paragraphs) {
			if (para.length > 50 && !para.startsWith("#") && !para.startsWith("```")) {
				learnings.push(para.substring(0, 400));
				break;
			}
		}
	}

	// Deduplicate and join
	const unique = [...new Set(learnings)];
	return unique.join("\n\n").substring(0, 1500); // Limit total length
}

/**
 * LEARN Phase: Update expertise file with new learnings
 * Only updates if task was successful and learnings are meaningful
 */
export function updateExpertise(
	mode: string,
	learnings: string,
	task: string,
	success: boolean,
	config: Partial<ExpertiseConfig> = {},
): LearningResult {
	const { maxInsights = 5, minLearningLength = 50 } = config;

	const result: LearningResult = {
		learned: false,
		insight: "",
		expertiseFile: getExpertisePath(mode),
	};

	// Only learn from successful tasks with meaningful output
	if (!success || !learnings || learnings.length < minLearningLength) {
		return result;
	}

	ensureExpertiseDir();
	const path = getExpertisePath(mode);
	const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC";

	try {
		let current = "";
		if (existsSync(path)) {
			current = readFileSync(path, "utf-8");
		} else {
			// Create new expertise file from template
			current = createExpertiseTemplate(mode);
		}

		const sessionMarker = "## Session Insights";
		const newInsight = `\n### Session: ${timestamp}\n**Task:** ${task.substring(0, 100)}...\n\n${learnings}\n`;

		let updated: string;
		if (current.includes(sessionMarker)) {
			// Append to existing session insights
			const parts = current.split(sessionMarker);
			const header = parts[0];
			const insights = parts[1] || "";

			// Parse existing insights and keep only recent ones
			const existingInsights = insights.split("\n### Session:").filter((i) => i.trim() && !i.includes("<!--"));

			// Keep only last N insights to prevent unbounded growth
			const recentInsights = existingInsights.slice(-maxInsights);
			recentInsights.push(newInsight);

			updated = header + sessionMarker + recentInsights.join("\n### Session:");
		} else {
			// Add session insights section
			updated = current + `\n\n${sessionMarker}${newInsight}`;
		}

		// Update metadata
		const lines = updated.split("\n");
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].startsWith("*Last updated:")) {
				lines[i] = `*Last updated: ${timestamp}*`;
			}
		}

		writeFileSync(path, lines.join("\n"));

		result.learned = true;
		result.insight = learnings.substring(0, 200);
		return result;
	} catch (error) {
		// Don't fail the main task if learning fails
		console.error(`Warning: Could not update expertise: ${error}`);
		return result;
	}
}

/**
 * Create expertise file template for a mode
 */
function createExpertiseTemplate(mode: string): string {
	const modeTitle = mode.charAt(0).toUpperCase() + mode.slice(1).replace(/_/g, " ");

	return `# ${modeTitle} Expert

## Mental Model
Accumulated expertise for ${mode.replace(/_/g, " ")} tasks.

*Last updated: Never*
*Total sessions: 0*

## Patterns Learned
<!-- Agent updates this section with successful patterns -->

## Common Pitfalls
<!-- Agent updates this section with mistakes to avoid -->

## Effective Approaches
<!-- Agent updates this section with approaches that worked well -->

## Session Insights
<!-- Recent learning sessions are stored here -->
`;
}

/**
 * Get all available expertise modes
 */
export function getExpertiseModes(): string[] {
	ensureExpertiseDir();

	try {
		const files = readdirSync(EXPERTISE_DIR);
		return files.filter((f) => f.endsWith(".md")).map((f) => f.replace(".md", ""));
	} catch {
		return [];
	}
}

/**
 * Create a self-improving agent prompt
 * Injects expertise + self-improve prompt into the task
 */
export function createLearningPrompt(task: string, mode: string = "general"): string {
	const expertise = loadExpertise(mode);
	const selfImprove = SELF_IMPROVE_PROMPTS[mode] || SELF_IMPROVE_PROMPTS.general;

	return `${task}

${expertise}

---
${selfImprove}`;
}

/**
 * Complete Act-Learn-Reuse cycle for an agent task
 */
export async function actLearnReuse<T>(
	mode: string,
	task: string,
	executor: (enhancedTask: string) => Promise<{ success: boolean; output: string; result?: T }>,
): Promise<{ success: boolean; output: string; learned: LearningResult; result?: T }> {
	// REUSE: Create enhanced prompt with accumulated expertise
	const enhancedTask = createLearningPrompt(task, mode);

	// ACT: Execute the task
	const { success, output, result } = await executor(enhancedTask);

	// LEARN: Extract and store learnings
	const learnings = extractLearnings(output);
	const learned = updateExpertise(mode, learnings, task, success);

	return { success, output, learned, result };
}
