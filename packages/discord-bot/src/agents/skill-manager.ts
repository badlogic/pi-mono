/**
 * Skill Manager - Hybrid Letta + Pi-Mono Implementation
 *
 * Combines:
 * - Letta Code's skill bundle structure (SKILL.md + resources)
 * - Pi-mono's Act-Learn-Reuse automatic learning pattern
 *
 * Features:
 * - Progressive disclosure (metadata → body → full)
 * - YAML frontmatter for rich metadata
 * - Bundled resources (scripts, references, assets)
 * - Automatic learning extraction and persistence
 * - Backward compatibility with legacy expertise files
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

// Directory setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..", "..");
const SKILLS_DIR = join(packageRoot, "src", "agents", "skills");
const LEGACY_EXPERTISE_DIR = join(packageRoot, "src", "agents", "expertise");

// Types
export type LoadDepth = "metadata" | "body" | "full";
export type ResourceType = "scripts" | "references" | "assets";
export type Priority = "low" | "medium" | "high" | "critical";

export interface SkillMetadata {
	id: string;
	name: string;
	description: string;
	category?: string;
	tags?: string[];
	version?: string;
	priority?: Priority;
	path?: string;
}

export interface SkillBody extends SkillMetadata {
	body: string; // SKILL.md content (without frontmatter)
	expertise?: string; // Accumulated learnings from expertise.md
}

export interface SkillResources {
	scripts: string[]; // Paths to executable scripts
	references: Map<string, string>; // name → content of reference docs
	assets: string[]; // Paths to asset files
}

export interface Skill extends SkillBody {
	resources: SkillResources;
}

export interface LearningResult {
	learned: boolean;
	insight: string;
	skillId: string;
	expertiseFile: string;
}

export interface ALRResult<T = unknown> {
	success: boolean;
	output: string;
	learned: LearningResult;
	result?: T;
}

// Learning configuration
const MAX_INSIGHTS = 5;
const MIN_LEARNING_LENGTH = 50;

// Learning markers (from expertise-manager.ts)
const LEARNING_MARKERS = [
	"## Learnings",
	"## What I Learned",
	"## Insights",
	"### Patterns",
	"### Observations",
	"### Notes",
	"## Key Insight",
	"## Recommendation",
	"## Anti-Patterns",
	"## Best Practices",
	"## Summary",
	"## Conclusion",
];

const INSIGHT_PATTERNS = [
	/(?:discovered|found|noticed|identified)[:\s]+(.+?)(?:\n|$)/gi,
	/(?:pattern|approach|technique)[:\s]+(.+?)(?:\n|$)/gi,
	/(?:important|notable|key)[:\s]+(.+?)(?:\n|$)/gi,
	/(?:recommend|suggestion|should)[:\s]+(.+?)(?:\n|$)/gi,
];

// Self-improvement prompts per category
const SELF_IMPROVE_PROMPTS: Record<string, string> = {
	default: `After completing this task, reflect on what you learned:
1. What patterns did you discover?
2. What approaches worked well?
3. What would you do differently next time?

Format your learnings as markdown that can improve future executions.`,

	financial: `After this financial/trading task, document your learnings:
1. What market patterns did you identify?
2. What indicators were most useful?
3. What risk factors should be watched?

Format as markdown for strategy improvement.`,

	security: `After this security task, note your findings:
1. What vulnerabilities were found?
2. What patterns indicate security issues?
3. What best practices should be enforced?

Format as markdown for security improvement.`,

	development: `After this coding task, document your learnings:
1. What code patterns were effective?
2. What edge cases did you handle?
3. What best practices should be remembered?

Format as markdown for expertise accumulation.`,
};

/**
 * Parse YAML frontmatter from SKILL.md content
 */
function parseFrontmatter(content: string): { metadata: Partial<SkillMetadata>; body: string } {
	const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
	const match = content.match(frontmatterRegex);

	if (!match) {
		return { metadata: {}, body: content };
	}

	const yamlContent = match[1];
	const body = match[2];
	const metadata: Partial<SkillMetadata> = {};

	// Simple YAML parsing (handles common cases)
	for (const line of yamlContent.split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;

		const key = line.substring(0, colonIdx).trim();
		let value = line.substring(colonIdx + 1).trim();

		// Handle arrays like [tag1, tag2]
		if (value.startsWith("[") && value.endsWith("]")) {
			const arrayContent = value.slice(1, -1);
			(metadata as Record<string, unknown>)[key] = arrayContent.split(",").map((s) => s.trim().replace(/['"]/g, ""));
		} else {
			// Remove quotes if present
			value = value.replace(/^['"]|['"]$/g, "");
			(metadata as Record<string, unknown>)[key] = value;
		}
	}

	return { metadata, body };
}

/**
 * Ensure skills directory exists
 */
function ensureSkillsDir(): void {
	if (!existsSync(SKILLS_DIR)) {
		mkdirSync(SKILLS_DIR, { recursive: true });
	}
}

/**
 * Get skill directory path
 */
function getSkillPath(skillId: string): string {
	return join(SKILLS_DIR, skillId);
}

/**
 * Get expertise file path within a skill bundle
 */
function getExpertisePath(skillId: string): string {
	return join(getSkillPath(skillId), "expertise.md");
}

/**
 * Check if a skill exists (either new bundle or legacy)
 */
export function skillExists(skillId: string): boolean {
	const skillPath = getSkillPath(skillId);
	const legacyPath = join(LEGACY_EXPERTISE_DIR, `${skillId}.md`);
	return existsSync(join(skillPath, "SKILL.md")) || existsSync(legacyPath);
}

/**
 * Discover all available skills (both bundled and legacy)
 */
export async function discoverSkills(): Promise<SkillMetadata[]> {
	const skills: SkillMetadata[] = [];

	// Discover bundled skills
	if (existsSync(SKILLS_DIR)) {
		const entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isDirectory()) {
				const skillMdPath = join(SKILLS_DIR, entry.name, "SKILL.md");
				if (existsSync(skillMdPath)) {
					try {
						const content = readFileSync(skillMdPath, "utf-8");
						const { metadata } = parseFrontmatter(content);
						skills.push({
							id: metadata.id || entry.name,
							name: metadata.name || entry.name,
							description: metadata.description || "",
							category: metadata.category,
							tags: metadata.tags,
							version: metadata.version,
							priority: metadata.priority,
							path: join(SKILLS_DIR, entry.name),
						});
					} catch {
						// Skip invalid skill files
					}
				}
			}
		}
	}

	// Discover legacy expertise files
	if (existsSync(LEGACY_EXPERTISE_DIR)) {
		const files = readdirSync(LEGACY_EXPERTISE_DIR);
		for (const file of files) {
			if (file.endsWith(".md")) {
				const id = file.replace(".md", "");
				// Don't duplicate if already found as bundled skill
				if (!skills.some((s) => s.id === id)) {
					skills.push({
						id,
						name: id.charAt(0).toUpperCase() + id.slice(1).replace(/_/g, " "),
						description: `Legacy expertise for ${id}`,
						path: join(LEGACY_EXPERTISE_DIR, file),
					});
				}
			}
		}
	}

	return skills;
}

/**
 * Search skills by query (matches name, description, tags)
 */
export async function searchSkills(query: string): Promise<SkillMetadata[]> {
	const allSkills = await discoverSkills();
	const lowerQuery = query.toLowerCase();

	return allSkills.filter((skill) => {
		const searchText = [skill.id, skill.name, skill.description, ...(skill.tags || [])].join(" ").toLowerCase();
		return searchText.includes(lowerQuery);
	});
}

/**
 * Load a skill with specified depth (progressive disclosure)
 */
export async function loadSkill(
	skillId: string,
	depth: LoadDepth = "body",
): Promise<Skill | SkillBody | SkillMetadata | null> {
	const skillPath = getSkillPath(skillId);
	const skillMdPath = join(skillPath, "SKILL.md");
	const legacyPath = join(LEGACY_EXPERTISE_DIR, `${skillId}.md`);

	// Check for bundled skill first
	if (existsSync(skillMdPath)) {
		const content = readFileSync(skillMdPath, "utf-8");
		const { metadata, body } = parseFrontmatter(content);

		const baseMetadata: SkillMetadata = {
			id: metadata.id || skillId,
			name: metadata.name || skillId,
			description: metadata.description || "",
			category: metadata.category,
			tags: metadata.tags,
			version: metadata.version,
			priority: metadata.priority,
			path: skillPath,
		};

		if (depth === "metadata") {
			return baseMetadata;
		}

		// Load expertise if exists
		const expertisePath = getExpertisePath(skillId);
		let expertise = "";
		if (existsSync(expertisePath)) {
			expertise = readFileSync(expertisePath, "utf-8");
		}

		const skillBody: SkillBody = {
			...baseMetadata,
			body,
			expertise,
		};

		if (depth === "body") {
			return skillBody;
		}

		// Load full resources
		const resources: SkillResources = {
			scripts: [],
			references: new Map(),
			assets: [],
		};

		// Load scripts
		const scriptsDir = join(skillPath, "scripts");
		if (existsSync(scriptsDir)) {
			const scripts = readdirSync(scriptsDir);
			resources.scripts = scripts.map((s) => join(scriptsDir, s));
		}

		// Load references
		const refsDir = join(skillPath, "references");
		if (existsSync(refsDir)) {
			const refs = readdirSync(refsDir);
			for (const ref of refs) {
				const refPath = join(refsDir, ref);
				if (statSync(refPath).isFile()) {
					resources.references.set(ref, readFileSync(refPath, "utf-8"));
				}
			}
		}

		// Load assets paths
		const assetsDir = join(skillPath, "assets");
		if (existsSync(assetsDir)) {
			const assets = readdirSync(assetsDir);
			resources.assets = assets.map((a) => join(assetsDir, a));
		}

		return {
			...skillBody,
			resources,
		};
	}

	// Fall back to legacy expertise file
	if (existsSync(legacyPath)) {
		const content = readFileSync(legacyPath, "utf-8");

		return {
			id: skillId,
			name: skillId.charAt(0).toUpperCase() + skillId.slice(1).replace(/_/g, " "),
			description: `Legacy expertise for ${skillId}`,
			path: legacyPath,
			body: content,
			expertise: content,
			resources: {
				scripts: [],
				references: new Map(),
				assets: [],
			},
		};
	}

	return null;
}

/**
 * Get expertise content for a skill (for prompt injection)
 */
export function getExpertise(skillId: string): string {
	const expertisePath = getExpertisePath(skillId);
	const legacyPath = join(LEGACY_EXPERTISE_DIR, `${skillId}.md`);

	let content = "";

	// Try bundled skill first
	if (existsSync(expertisePath)) {
		content = readFileSync(expertisePath, "utf-8");
	} else if (existsSync(legacyPath)) {
		content = readFileSync(legacyPath, "utf-8");
	}

	if (!content) return "";

	// Extract meaningful sections
	const sections: string[] = [];
	let currentSection: string[] = [];

	for (const line of content.split("\n")) {
		if (line.startsWith("## ") && currentSection.length > 0) {
			const sectionText = currentSection.join("\n").trim();
			if (sectionText && !sectionText.includes("<!-- Agent updates")) {
				sections.push(sectionText);
			}
			currentSection = [line];
		} else {
			currentSection.push(line);
		}
	}

	if (currentSection.length > 0) {
		const sectionText = currentSection.join("\n").trim();
		if (sectionText && !sectionText.includes("<!-- Agent updates")) {
			sections.push(sectionText);
		}
	}

	const expertise = sections.join("\n\n");
	if (expertise && expertise.length > 100) {
		return `\n\n## Accumulated Expertise\n${expertise}`;
	}

	return "";
}

/**
 * Extract learnings from agent output
 */
export function extractLearnings(output: string): string {
	const learnings: string[] = [];

	// Look for explicit learning sections
	for (const marker of LEARNING_MARKERS) {
		if (output.includes(marker)) {
			const idx = output.indexOf(marker);
			let section = output.substring(idx);
			const endIdx = section.indexOf("\n## ", marker.length);
			if (endIdx > 0) {
				section = section.substring(0, endIdx);
			}
			learnings.push(section.trim().substring(0, 500));
		}
	}

	// Extract from patterns if no explicit learnings
	if (learnings.length === 0 && output) {
		for (const pattern of INSIGHT_PATTERNS) {
			const matches = output.match(pattern);
			if (matches) {
				learnings.push(...matches.slice(0, 3).map((m) => m.substring(0, 200)));
			}
		}
	}

	// Take first substantive paragraph as fallback
	if (learnings.length === 0 && output.length > 200) {
		const paragraphs = output.split("\n\n");
		for (const para of paragraphs) {
			if (para.length > 50 && !para.startsWith("#") && !para.startsWith("```")) {
				learnings.push(para.substring(0, 400));
				break;
			}
		}
	}

	const unique = [...new Set(learnings)];
	return unique.join("\n\n").substring(0, 1500);
}

/**
 * Record learning to skill expertise file
 */
export async function recordLearning(
	skillId: string,
	learnings: string,
	task: string,
	success: boolean,
): Promise<LearningResult> {
	const result: LearningResult = {
		learned: false,
		insight: "",
		skillId,
		expertiseFile: "",
	};

	if (!success || !learnings || learnings.length < MIN_LEARNING_LENGTH) {
		return result;
	}

	ensureSkillsDir();

	// Determine expertise file path
	const skillPath = getSkillPath(skillId);
	let expertisePath: string;

	if (existsSync(join(skillPath, "SKILL.md"))) {
		// Bundled skill
		expertisePath = getExpertisePath(skillId);
	} else {
		// Legacy or new skill - use legacy directory for now
		expertisePath = join(LEGACY_EXPERTISE_DIR, `${skillId}.md`);
		if (!existsSync(LEGACY_EXPERTISE_DIR)) {
			mkdirSync(LEGACY_EXPERTISE_DIR, { recursive: true });
		}
	}

	result.expertiseFile = expertisePath;
	const timestamp = new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC";

	try {
		let current = "";
		if (existsSync(expertisePath)) {
			current = readFileSync(expertisePath, "utf-8");
		} else {
			current = createExpertiseTemplate(skillId);
		}

		const sessionMarker = "## Session Insights";
		const newInsight = `\n### Session: ${timestamp}\n**Task:** ${task.substring(0, 100)}...\n\n${learnings}\n`;

		let updated: string;
		if (current.includes(sessionMarker)) {
			const parts = current.split(sessionMarker);
			const header = parts[0];
			const insights = parts[1] || "";

			const existingInsights = insights.split("\n### Session:").filter((i) => i.trim() && !i.includes("<!--"));
			const recentInsights = existingInsights.slice(-MAX_INSIGHTS);
			recentInsights.push(newInsight);

			updated = header + sessionMarker + recentInsights.join("\n### Session:");
		} else {
			updated = current + `\n\n${sessionMarker}${newInsight}`;
		}

		// Update timestamp
		const lines = updated.split("\n");
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].startsWith("*Last updated:")) {
				lines[i] = `*Last updated: ${timestamp}*`;
			}
		}

		writeFileSync(expertisePath, lines.join("\n"));

		result.learned = true;
		result.insight = learnings.substring(0, 200);
		return result;
	} catch (error) {
		console.error(`Warning: Could not update expertise: ${error}`);
		return result;
	}
}

/**
 * Create expertise file template
 */
function createExpertiseTemplate(skillId: string): string {
	const title = skillId.charAt(0).toUpperCase() + skillId.slice(1).replace(/_/g, " ");

	return `# ${title} Expert

## Mental Model
Accumulated expertise for ${skillId.replace(/_/g, " ")} tasks.

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
 * Get self-improvement prompt for a skill category
 */
function getSelfImprovePrompt(category?: string): string {
	if (category && SELF_IMPROVE_PROMPTS[category]) {
		return SELF_IMPROVE_PROMPTS[category];
	}
	return SELF_IMPROVE_PROMPTS.default;
}

/**
 * Create learning-enhanced prompt
 */
export function createLearningPrompt(skillId: string, task: string, category?: string): string {
	const expertise = getExpertise(skillId);
	const selfImprove = getSelfImprovePrompt(category);

	return `${task}
${expertise}

---
${selfImprove}`;
}

/**
 * Complete Act-Learn-Reuse cycle
 */
export async function actLearnReuse<T>(
	skillId: string,
	task: string,
	executor: (enhancedTask: string) => Promise<{ success: boolean; output: string; result?: T }>,
	category?: string,
): Promise<ALRResult<T>> {
	// REUSE: Create enhanced prompt with accumulated expertise
	const enhancedTask = createLearningPrompt(skillId, task, category);

	// ACT: Execute the task
	const { success, output, result } = await executor(enhancedTask);

	// LEARN: Extract and store learnings
	const learnings = extractLearnings(output);
	const learned = await recordLearning(skillId, learnings, task, success);

	return { success, output, learned, result };
}

/**
 * Create a new skill bundle
 */
export async function createSkillBundle(
	metadata: SkillMetadata,
	body: string,
	options: { scripts?: boolean; references?: boolean; assets?: boolean } = {},
): Promise<string> {
	ensureSkillsDir();

	const skillPath = getSkillPath(metadata.id);
	mkdirSync(skillPath, { recursive: true });

	// Create SKILL.md with frontmatter
	const frontmatter = `---
id: ${metadata.id}
name: ${metadata.name}
description: ${metadata.description}
${metadata.category ? `category: ${metadata.category}` : ""}
${metadata.tags?.length ? `tags: [${metadata.tags.join(", ")}]` : ""}
${metadata.version ? `version: ${metadata.version}` : "version: 1.0.0"}
${metadata.priority ? `priority: ${metadata.priority}` : ""}
---

`;

	writeFileSync(join(skillPath, "SKILL.md"), frontmatter + body);

	// Create expertise.md
	writeFileSync(join(skillPath, "expertise.md"), createExpertiseTemplate(metadata.id));

	// Create resource directories if requested
	if (options.scripts) {
		mkdirSync(join(skillPath, "scripts"), { recursive: true });
	}
	if (options.references) {
		mkdirSync(join(skillPath, "references"), { recursive: true });
	}
	if (options.assets) {
		mkdirSync(join(skillPath, "assets"), { recursive: true });
	}

	return skillPath;
}

/**
 * Migrate legacy expertise file to skill bundle
 */
export async function migrateToBundle(skillId: string): Promise<string | null> {
	const legacyPath = join(LEGACY_EXPERTISE_DIR, `${skillId}.md`);

	if (!existsSync(legacyPath)) {
		return null;
	}

	const legacyContent = readFileSync(legacyPath, "utf-8");

	// Extract title from first line
	const titleMatch = legacyContent.match(/^# (.+)/);
	const name = titleMatch ? titleMatch[1] : skillId;

	// Create skill bundle
	const skillPath = await createSkillBundle(
		{
			id: skillId,
			name,
			description: `Migrated from legacy expertise: ${skillId}`,
		},
		`# ${name}\n\nThis skill was migrated from the legacy expertise system.`,
		{ references: true },
	);

	// Copy legacy content to expertise.md
	writeFileSync(join(skillPath, "expertise.md"), legacyContent);

	return skillPath;
}

// Export singleton-style functions for convenience
export const SkillManager = {
	discoverSkills,
	searchSkills,
	loadSkill,
	getExpertise,
	extractLearnings,
	recordLearning,
	createLearningPrompt,
	actLearnReuse,
	createSkillBundle,
	migrateToBundle,
	skillExists,
};

export default SkillManager;
