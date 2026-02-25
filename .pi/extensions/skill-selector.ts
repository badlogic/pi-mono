import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Skill Selector Extension — Human-driven skill filtering prehook.
 *
 * Insight from transcript analysis: The human explicitly names skills 83% of
 * the time using /skill-name syntax. The human IS the classifier.
 *
 * This extension simply:
 *   1. Parses /skill-name references from the user's prompt
 *   2. Includes those skills + core skills + composes dependencies
 *   3. Filters the system prompt to only show relevant skills
 *
 * No ML classifier needed. No heuristic matching on descriptions.
 * The human already knows which skills they need.
 *
 * For the ~15% of messages without explicit skill references,
 * a small set of core skills is always visible. The agent can
 * still read any skill by path — filtering only affects the
 * system prompt menu, not skill accessibility.
 *
 * Logs decisions to ~/.pi/assistant/skill_selector.jsonl for
 * future analysis and potential Shadow-LEGO classifier training
 * if the implicit case ever becomes worth optimizing.
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
const MAX_SKILLS = 35;

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
}

/**
 * Read composes from the skill entries' SKILL.md frontmatter.
 * Falls back to a static map for known high-value chains.
 * TODO: Parse composes from frontmatter at skill load time (Pi core change).
 */
const COMPOSES_MAP: Record<string, string[]> = {
	"assess": ["create-figure", "project-state", "memory"],
	"project-state": ["create-figure", "memory"],
	"orchestrate": ["plan", "memory"],
	"learn-datalake": ["extractor", "review-pdf", "memory"],
	"extractor": ["debug-pdf", "normalize", "memory"],
	"create-movie": ["create-story", "create-storyboard", "create-score", "create-cast"],
	"create-music": ["create-stems", "learn-voice"],
	"recommend-skill-chain": ["skill-lab", "assistant"],
	"review-pdf": ["create-figure", "memory"],
	"cmmc-assessor": ["create-figure", "ops-compliance", "extractor"],
	"lean4-prove": ["memory"],
	"dogpile": ["brave-search", "perplexity", "memory"],
	"skills-ci": ["create-figure", "best-practices-skills"],
	"monitor-skills": ["create-figure", "skills-ci"],
	"extractor-quality-check": ["create-figure", "memory"],
	"quality-audit": ["create-figure"],
	"classifier-lab": ["create-figure", "create-classifier"],
	"assistant-lab": ["assistant", "create-classifier", "create-gpt"],
	"battle": ["hack", "security-scan"],
	"review-conversation": ["create-figure", "memory"],
	"data-audit": ["create-figure", "memory"],
	"corpus-report": ["create-figure"],
	"batch-report": ["create-figure"],
	"analytics": ["create-figure"],
};

/**
 * Expand selected skills with their composes dependencies (1 level deep).
 */
function expandComposes(selected: string[]): string[] {
	const expanded = new Set(selected);
	for (const name of selected) {
		const deps = COMPOSES_MAP[name];
		if (deps) {
			for (const dep of deps) {
				expanded.add(dep);
			}
		}
	}
	return Array.from(expanded);
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
		lines.push(`    <location>${escapeXml(skill.location)}</location>`);
		lines.push("  </skill>");
	}

	lines.push("</available_skills>");
	return lines.join("\n");
}

// ─── Extension Entry Point ───────────────────────────────────────────────────

export default function skillSelector(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		const prompt = event.prompt?.trim();
		if (!prompt || prompt.length < MIN_PROMPT_LENGTH) return;

		try {
			const { before, skills, after } = parseSkillsXml(event.systemPrompt);

			// Nothing to filter, or already small enough
			if (skills.length === 0 || skills.length <= MAX_SKILLS) return;

			// Build skill name set from available skills (for validation)
			const availableNames = new Set(skills.map((s) => s.name));

			// ── Parse explicit /skill-name references from prompt ──
			const slashRefs = parseSlashReferences(prompt)
				.filter((name) => availableNames.has(name));

			// ── Combine: explicit refs + core + composes deps ──
			const requested = [...slashRefs, ...CORE_SKILLS];
			const withDeps = expandComposes(requested);

			// Cap at MAX_SKILLS, prioritizing explicit refs
			const finalNames = new Set<string>();
			for (const name of withDeps) {
				if (finalNames.size >= MAX_SKILLS) break;
				if (availableNames.has(name)) {
					finalNames.add(name);
				}
			}

			// If no explicit refs and we'd only show core skills,
			// don't filter — let the agent see everything
			if (slashRefs.length === 0) return;

			// ── Log for future analysis ──
			try {
				const logEntry = JSON.stringify({
					ts: new Date().toISOString(),
					prompt: prompt.substring(0, 200),
					slash_refs: slashRefs,
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
