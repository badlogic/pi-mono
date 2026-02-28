import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFileSync, readdirSync, existsSync } from "fs";

/**
 * Skill Selector Extension — Hybrid skill filtering prehook.
 *
 * Design insight: Skills are lightweight metadata (~60 tokens each) in the
 * system prompt, NOT full SKILL.md bodies. At 233 skills that's ~12K tokens
 * (6% of context). This scales to ~1000 skills before filtering is critical.
 *
 * Strategy (Approach C — hybrid):
 *   1. Explicit: Parse /skill-name references from user prompt (83% of messages)
 *   2. Implicit: When no slash refs, score prompt against trigger index
 *      built from each skill's triggers + description keywords
 *   3. Fallback: If trigger matching yields < 3 results, pass all skills
 *      through (at current scale, 12K tokens is a rounding error)
 *
 * The trigger index is built once at first use from the parsed <available_skills>
 * XML — zero external dependencies, no /memory calls, sub-millisecond matching.
 *
 * Logs decisions to ~/.pi/assistant/skill_selector.jsonl for trend analysis.
 */

// ─── Configuration ───────────────────────────────────────────────────────────

/** Always include these core skills (visible even without explicit references) */
const CORE_SKILLS = [
	"memory",       // memory-first contract
	"assess",       // frequent workflow entry point
	"plan",         // task planning
	"orchestrate",  // task execution
	"handoff",      // session continuity
];

/** Maximum skills to include in filtered prompt */
const MAX_SKILLS = 50;

/** Minimum trigger-match score to include a skill (0-1) */
const MIN_TRIGGER_SCORE = 0.15;

/** Below this skill count, don't bother filtering at all (~30K tokens) */
const FILTER_THRESHOLD = 500;

/** Minimum prompt length to bother filtering */
const MIN_PROMPT_LENGTH = 8;

/** Log file for training data */
const LOG_DIR = "~/.pi/assistant";
const LOG_FILE = `${LOG_DIR}/skill_selector.jsonl`;

// ─── Slash Reference Parser ──────────────────────────────────────────────────

/**
 * Extract /skill-name references from user prompt.
 * Matches: /memory, /create-figure, /ops-workstation, etc.
 * Does NOT match: /home/path, /dev/null, /tmp (filesystem paths)
 */
function parseSlashReferences(prompt: string): string[] {
	const matches: string[] = [];
	// Match /word-word patterns that look like skill names (not file paths)
	const regex = /\/([a-z][a-z0-9-]{1,63})(?:\s|$|[.,;:!?)])/gi;
	let match;
	while ((match = regex.exec(prompt)) !== null) {
		const name = match[1].toLowerCase();
		// Skip common non-skill paths
		if (isFilePath(name)) continue;
		matches.push(name);
	}
	// Also catch /skill-name at end of string (no trailing char)
	const endRegex = /\/([a-z][a-z0-9-]{1,63})$/gi;
	while ((match = endRegex.exec(prompt)) !== null) {
		const name = match[1].toLowerCase();
		if (!isFilePath(name) && !matches.includes(name)) {
			matches.push(name);
		}
	}
	return matches;
}

/** Filter out things that look like filesystem paths, not skill names */
function isFilePath(name: string): boolean {
	const pathPrefixes = ["home", "tmp", "dev", "etc", "usr", "var", "mnt", "opt", "proc", "sys"];
	return pathPrefixes.includes(name);
}

// ─── Composes Dependencies ───────────────────────────────────────────────────

interface SkillEntry {
	name: string;
	description: string;
	triggers: string[];
	location: string;
	// Custom Embry OS frontmatter (parsed by extension, not Pi core)
	composes?: string[];
	provides?: string[];
	model?: string;
	tags?: string[];
	taxonomy?: string[];
}

/** Full frontmatter parsed from SKILL.md files, keyed by skill name */
type SkillFrontmatterMap = Record<string, Record<string, unknown>>;

/**
 * Composes map: skill → [dependency skills].
 * Built dynamically by parsing frontmatter from each SKILL.md.
 * Lazy-initialized once per session.
 */
let composesMap: Record<string, string[]> | null = null;

/** Cached full frontmatter for all skills — exposed via pi.state for other extensions */
let frontmatterMap: SkillFrontmatterMap | null = null;

/**
 * Parse all frontmatter fields from a SKILL.md file.
 * Handles both YAML list styles: block (`- item`) and inline (`[item1, item2]`).
 * Reads synchronously (only at index-build time, once per session).
 */
function parseFrontmatterFromFile(filePath: string): Record<string, unknown> {
	try {
		const content = readFileSync(filePath, "utf8") as string;
		const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
		if (!fmMatch) return {};
		const fm = fmMatch[1];
		const result: Record<string, unknown> = {};

		// Parse each top-level key in the frontmatter
		const lines = fm.split("\n");
		let i = 0;
		while (i < lines.length) {
			const keyMatch = lines[i].match(/^([a-z][a-z0-9_-]*):\s*(.*)/i);
			if (!keyMatch) { i++; continue; }

			const key = keyMatch[1];
			const inlineValue = keyMatch[2].trim();

			// Inline list: `composes: [memory, assess, plan]`
			if (inlineValue.startsWith("[")) {
				const listStr = inlineValue.replace(/^\[/, "").replace(/\]$/, "");
				result[key] = listStr.split(",").map((s) => s.trim()).filter(Boolean);
				i++;
				continue;
			}

			// Scalar value on the same line
			if (inlineValue && !inlineValue.startsWith(">") && !inlineValue.startsWith("|")) {
				result[key] = inlineValue;
				i++;
				continue;
			}

			// Block list or folded scalar: check next lines for `- item` or continuation
			const items: string[] = [];
			const textLines: string[] = [];
			i++;
			while (i < lines.length && (lines[i].startsWith("  ") || lines[i].startsWith("\t") || lines[i].match(/^\s+-\s/))) {
				const listItemMatch = lines[i].match(/^\s+-\s+(.+)/);
				if (listItemMatch) {
					items.push(listItemMatch[1].trim());
				} else {
					textLines.push(lines[i].trim());
				}
				i++;
			}

			if (items.length > 0) {
				result[key] = items;
			} else if (textLines.length > 0) {
				result[key] = textLines.join(" ").trim();
			} else if (inlineValue) {
				result[key] = inlineValue;
			}
		}

		return result;
	} catch {
		return {};
	}
}

/**
 * Build frontmatter map + composes map from all skill SKILL.md files.
 * Called once lazily, then cached for the session.
 */
function buildFrontmatterMaps(skills: SkillEntry[]): {
	composes: Record<string, string[]>;
	frontmatter: SkillFrontmatterMap;
} {
	const composes: Record<string, string[]> = {};
	const frontmatter: SkillFrontmatterMap = {};

	for (const skill of skills) {
		const fm = parseFrontmatterFromFile(skill.location);
		frontmatter[skill.name] = fm;

		// Extract typed fields into the SkillEntry for other code to use
		if (Array.isArray(fm.composes)) {
			composes[skill.name] = fm.composes as string[];
			skill.composes = fm.composes as string[];
		}
		if (Array.isArray(fm.provides)) skill.provides = fm.provides as string[];
		if (typeof fm.model === "string") skill.model = fm.model;
		if (Array.isArray(fm.tags)) skill.tags = fm.tags as string[];
		if (Array.isArray(fm.taxonomy)) skill.taxonomy = fm.taxonomy as string[];
	}

	return { composes, frontmatter };
}

/**
 * Expand selected skills with their composes dependencies (1 level deep).
 */
function expandComposes(selected: string[], skills: SkillEntry[], pi?: ExtensionAPI): string[] {
	if (!composesMap) {
		const maps = buildFrontmatterMaps(skills);
		composesMap = maps.composes;
		frontmatterMap = maps.frontmatter;
		// Expose to other extensions via shared state
		if (pi) {
			(pi as any).state = (pi as any).state || {};
			(pi as any).state.skillFrontmatter = frontmatterMap;
		}
	}
	const expanded = new Set(selected);
	for (const name of selected) {
		const deps = composesMap[name];
		if (deps) {
			for (const dep of deps) {
				expanded.add(dep);
			}
		}
	}
	return Array.from(expanded);
}

// ─── Trigger Index (Implicit Skill Matching) ────────────────────────────────

/** Stopwords to exclude from description tokenization */
const STOPWORDS = new Set([
	"a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
	"of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
	"has", "have", "had", "do", "does", "did", "will", "would", "could",
	"should", "may", "might", "can", "this", "that", "these", "those",
	"it", "its", "not", "no", "all", "any", "each", "every", "use", "using",
]);

type TriggerIndex = Map<string, Map<string, number>>;

/**
 * Build an inverted index: token → { skillName → weight }.
 * Triggers get weight 1.0, description keywords get 0.3.
 * Built once per session from the parsed skill entries.
 */
function buildTriggerIndex(skills: SkillEntry[]): TriggerIndex {
	const index: TriggerIndex = new Map();

	function addToken(token: string, skillName: string, weight: number) {
		if (token.length < 2 || STOPWORDS.has(token)) return;
		if (!index.has(token)) index.set(token, new Map());
		const existing = index.get(token)!.get(skillName) || 0;
		index.get(token)!.set(skillName, Math.max(existing, weight));
	}

	for (const skill of skills) {
		// Trigger words → weight 1.0
		for (const trigger of skill.triggers) {
			for (const word of trigger.split(/\s+/)) {
				addToken(word.toLowerCase(), skill.name, 1.0);
			}
			// Also index the full trigger phrase as a single token
			const phrase = trigger.replace(/\s+/g, "-");
			if (phrase.includes("-")) addToken(phrase, skill.name, 1.0);
		}
		// Skill name parts → weight 0.8 (e.g. "create-movie" → "create", "movie")
		for (const part of skill.name.split("-")) {
			addToken(part, skill.name, 0.8);
		}
		// Description keywords → weight 0.3
		const descWords = skill.description.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/\s+/);
		for (const word of descWords) {
			addToken(word, skill.name, 0.3);
		}
	}

	return index;
}

/**
 * Score skills against prompt using the trigger index.
 * Returns skills sorted by score descending.
 */
function matchByTriggers(
	prompt: string,
	index: TriggerIndex,
	availableNames: Set<string>,
): Array<{ name: string; score: number }> {
	const promptTokens = prompt.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/\s+/)
		.filter((t) => t.length >= 2 && !STOPWORDS.has(t));

	const scores = new Map<string, number>();

	for (const token of promptTokens) {
		const skillWeights = index.get(token);
		if (!skillWeights) continue;
		for (const [skillName, weight] of skillWeights) {
			if (!availableNames.has(skillName)) continue;
			scores.set(skillName, (scores.get(skillName) || 0) + weight);
		}
	}

	return Array.from(scores.entries())
		.map(([name, score]) => ({ name, score }))
		.sort((a, b) => b.score - a.score);
}

// ─── System Prompt XML Parsing & Rebuilding ──────────────────────────────────

function parseSkillsXml(systemPrompt: string): {
	before: string;
	skills: SkillEntry[];
	after: string;
} {
	const startTag = "<available_skills>";
	const endTag = "</available_skills>";
	const startIdx = systemPrompt.indexOf(startTag);
	const endIdx = systemPrompt.indexOf(endTag);

	if (startIdx === -1 || endIdx === -1) {
		return { before: systemPrompt, skills: [], after: "" };
	}

	// Find the preamble text before <available_skills> (includes the intro lines)
	const preambleStart = systemPrompt.lastIndexOf("\n\nThe following skills", startIdx);
	const before = preambleStart !== -1
		? systemPrompt.substring(0, preambleStart)
		: systemPrompt.substring(0, startIdx);
	const after = systemPrompt.substring(endIdx + endTag.length);
	const xmlBlock = systemPrompt.substring(startIdx + startTag.length, endIdx);

	const skills: SkillEntry[] = [];
	const skillRegex = /<skill>([\s\S]*?)<\/skill>/g;
	let match;
	while ((match = skillRegex.exec(xmlBlock)) !== null) {
		const block = match[1];
		const name = extractTag(block, "name");
		const description = extractTag(block, "description");
		const triggersRaw = extractTag(block, "triggers");
		const location = extractTag(block, "location");

		if (name) {
			skills.push({
				name,
				description: description || "",
				triggers: triggersRaw ? triggersRaw.split(",").map((t) => t.trim().toLowerCase()) : [],
				location: location || "",
			});
		}
	}

	return { before, skills, after };
}

function extractTag(xml: string, tag: string): string | null {
	const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, "s");
	const match = regex.exec(xml);
	return match ? unescapeXml(match[1].trim()) : null;
}

function unescapeXml(str: string): string {
	return str
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function rebuildSkillsXml(allSkills: SkillEntry[], selectedNames: Set<string>): string {
	const filtered = allSkills.filter((s) => selectedNames.has(s.name));

	if (filtered.length === 0) return "";

	const lines = [
		"\n\nThe following skills provide specialized instructions for specific tasks.",
		"Use the read tool to load a skill's file when the task matches its description.",
		"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
		"",
		"<available_skills>",
	];

	for (const skill of filtered) {
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(skill.name)}</name>`);
		lines.push(`    <description>${escapeXml(skill.description)}</description>`);
		if (skill.triggers.length > 0) {
			lines.push(`    <triggers>${escapeXml(skill.triggers.join(", "))}</triggers>`);
		}
		if (skill.composes && skill.composes.length > 0) {
			lines.push(`    <composes>${escapeXml(skill.composes.join(", "))}</composes>`);
		}
		if (skill.model) {
			lines.push(`    <model>${escapeXml(skill.model)}</model>`);
		}
		if (skill.provides && skill.provides.length > 0) {
			lines.push(`    <provides>${escapeXml(skill.provides.join(", "))}</provides>`);
		}
		lines.push(`    <location>${escapeXml(skill.location)}</location>`);
		lines.push("  </skill>");
	}

	lines.push("</available_skills>");
	return lines.join("\n");
}

// ─── Extension Entry Point ───────────────────────────────────────────────────

export default function skillSelector(pi: ExtensionAPI) {
	// Lazy-initialized trigger index (built once from first system prompt parse)
	let triggerIndex: TriggerIndex | null = null;

	pi.on("before_agent_start", async (event, ctx) => {
		const prompt = event.prompt?.trim();
		if (!prompt || prompt.length < MIN_PROMPT_LENGTH) return;

		try {
			const { before, skills, after } = parseSkillsXml(event.systemPrompt);

			// Nothing to filter, or already small enough
			if (skills.length === 0 || skills.length <= MAX_SKILLS) return;

			// Below threshold, the token cost is negligible — don't filter
			if (skills.length < FILTER_THRESHOLD) {
				// Still filter if explicit slash refs (user intent is clear)
				const quickRefs = parseSlashReferences(prompt)
					.filter((name) => skills.some((s) => s.name === name));
				if (quickRefs.length === 0) return;
			}

			// Build skill name set from available skills (for validation)
			const availableNames = new Set(skills.map((s) => s.name));

			// ── Parse explicit /skill-name references from prompt ──
			const slashRefs = parseSlashReferences(prompt)
				.filter((name) => availableNames.has(name));

			// ── Combine: explicit refs + core + composes deps ──
			const requested = [...slashRefs, ...CORE_SKILLS];
			const withDeps = expandComposes(requested, skills, pi);

			// ── Implicit matching: when no slash refs, use trigger index ──
			let triggerMatches: string[] = [];
			let matchMode: "explicit" | "trigger" | "passthrough" = "explicit";

			if (slashRefs.length === 0) {
				// Build index lazily on first implicit query
				if (!triggerIndex) {
					triggerIndex = buildTriggerIndex(skills);
				}
				const scored = matchByTriggers(prompt, triggerIndex, availableNames);
				triggerMatches = scored
					.filter((s) => s.score >= MIN_TRIGGER_SCORE)
					.slice(0, MAX_SKILLS)
					.map((s) => s.name);

				if (triggerMatches.length < 3) {
					// Too few matches — pass everything through, not worth filtering
					matchMode = "passthrough";
				} else {
					matchMode = "trigger";
				}
			}

			if (matchMode === "passthrough") return;

			// ── Build final set ──
			const finalNames = new Set<string>();

			// Priority 1: explicit slash refs + core + composes
			for (const name of withDeps) {
				if (availableNames.has(name)) finalNames.add(name);
			}

			// Priority 2: trigger matches (implicit case)
			if (matchMode === "trigger") {
				const triggerWithDeps = expandComposes(triggerMatches, skills);
				for (const name of triggerWithDeps) {
					if (availableNames.has(name)) finalNames.add(name);
				}
			}

			// Priority 3: Memory-backed chain recall (future-proofing for 500+ skills)
			// Only activates when skill count >= FILTER_THRESHOLD — at current scale this never fires
			if (matchMode === "trigger" && skills.length >= FILTER_THRESHOLD) {
				try {
					const memoryRun = `${process.env.HOME}/workspace/experiments/pi-mono/.pi/skills/memory/run.sh`;
					// Pass prompt as a direct argument (no shell interpolation)
					const safeQuery = prompt.substring(0, 200);
					const result = await pi.exec(memoryRun, [
						"chain-recall", safeQuery, "--limit", "3", "--json",
					], { timeout: 2000 });
					if (result.stdout) {
						const chains = JSON.parse(result.stdout);
						for (const chain of chains) {
							if (Array.isArray(chain.skills)) {
								for (const skill of chain.skills) {
									if (availableNames.has(skill)) finalNames.add(skill);
								}
							}
						}
					}
				} catch {
					// Memory unavailable — trigger index is sufficient fallback
				}
			}

			// Cap at MAX_SKILLS
			if (finalNames.size > MAX_SKILLS) {
				const arr = Array.from(finalNames);
				finalNames.clear();
				for (let i = 0; i < MAX_SKILLS && i < arr.length; i++) {
					finalNames.add(arr[i]);
				}
			}

			// ── Log for future analysis ──
			try {
				const logEntry = JSON.stringify({
					ts: new Date().toISOString(),
					prompt: prompt.substring(0, 200),
					mode: matchMode,
					slash_refs: slashRefs,
					trigger_matches: triggerMatches.slice(0, 10),
					selected: Array.from(finalNames),
					total_available: skills.length,
					filtered_to: finalNames.size,
				});
				await pi.exec("bash", [
					"-c",
					`mkdir -p ${LOG_DIR} && echo '${logEntry.replace(/'/g, "'\\''")}' >> ${LOG_FILE}`,
				], { timeout: 1000 });
			} catch {
				// Logging should never block
			}

			// ── Rebuild system prompt with filtered skills ──
			const filteredXml = rebuildSkillsXml(skills, finalNames);
			return {
				systemPrompt: before + filteredXml + after,
			};
		} catch {
			// Skill Selector should NEVER block. Fail silently → full prompt used.
		}
	});
}
