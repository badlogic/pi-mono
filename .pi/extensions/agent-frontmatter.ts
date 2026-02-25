import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Agent Frontmatter Extension.
 *
 * Parses YAML frontmatter from .pi/agents/<name>/AGENTS.md files and exposes
 * structured agent metadata via an LLM-callable `agent_roster` tool.
 *
 * Frontmatter schema (mirrors SKILL.md pattern):
 *
 *   ---
 *   name: brandon-bailey
 *   scope: brandon_bailey
 *   provides: [sparta-quality-assessment, threat-modeling]
 *   composes: [memory, taxonomy, sparta-review]
 *   collaborators: [embry, margaret-chen]
 *   taxonomy: [precision, resilience, corruption]
 *   ---
 *
 * The tool enables skills like /argue, /review-paper, and /ask to discover
 * agents by capability (provides), skill composition (composes), or taxonomy
 * bridge tags — without hardcoding agent names.
 */

interface AgentFrontmatter {
	name?: string;
	scope?: string;
	provides?: string[];
	composes?: string[];
	collaborators?: string[];
	taxonomy?: string[];
	[key: string]: unknown;
}

interface ParsedAgent {
	name: string;
	scope: string;
	provides: string[];
	composes: string[];
	collaborators: string[];
	taxonomy: string[];
	path: string;
}

/**
 * Minimal frontmatter parser — avoids importing from pi internals at runtime.
 * Same logic as packages/coding-agent/src/utils/frontmatter.ts but self-contained
 * to keep the extension dependency-free (only needs @sinclair/typebox for tool schema).
 */
function parseFrontmatter(content: string): { frontmatter: AgentFrontmatter; body: string } {
	const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!normalized.startsWith("---")) {
		return { frontmatter: {}, body: normalized };
	}
	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) {
		return { frontmatter: {}, body: normalized };
	}
	const yamlString = normalized.slice(4, endIndex);
	const body = normalized.slice(endIndex + 4).trim();

	// Parse YAML manually — simple key: value and key: [list] support.
	// Avoids requiring the 'yaml' package at extension load time.
	const fm: AgentFrontmatter = {};
	let currentKey: string | null = null;
	let currentList: string[] | null = null;

	for (const line of yamlString.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		// Detect list item under current key
		if (trimmed.startsWith("- ") && currentKey && currentList !== null) {
			const value = trimmed.slice(2).trim().replace(/^['"]|['"]$/g, "");
			// Strip inline comments from collaborator entries
			const cleaned = value.split("#")[0].trim();
			if (cleaned) currentList.push(cleaned);
			continue;
		}

		// Key: value line
		const colonIdx = trimmed.indexOf(":");
		if (colonIdx === -1) continue;

		// Flush previous list
		if (currentKey && currentList !== null) {
			fm[currentKey] = currentList;
		}

		const key = trimmed.slice(0, colonIdx).trim();
		const rawValue = trimmed.slice(colonIdx + 1).trim();

		if (!rawValue) {
			// Start of a list block
			currentKey = key;
			currentList = [];
		} else if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
			// Inline list: key: [a, b, c]
			fm[key] = rawValue
				.slice(1, -1)
				.split(",")
				.map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
				.filter(Boolean);
			currentKey = null;
			currentList = null;
		} else {
			fm[key] = rawValue.replace(/^['"]|['"]$/g, "");
			currentKey = null;
			currentList = null;
		}
	}

	// Flush final list
	if (currentKey && currentList !== null) {
		fm[currentKey] = currentList;
	}

	return { frontmatter: fm, body };
}

function discoverAgents(cwd: string): ParsedAgent[] {
	const agents: ParsedAgent[] = [];
	const agentsDir = join(cwd, ".pi", "agents");

	if (!existsSync(agentsDir)) return agents;

	let entries: string[];
	try {
		entries = readdirSync(agentsDir);
	} catch {
		return agents;
	}

	for (const entry of entries) {
		const dirPath = join(agentsDir, entry);
		try {
			if (!statSync(dirPath).isDirectory()) continue;
		} catch {
			continue;
		}

		const agentFile = join(dirPath, "AGENTS.md");
		if (!existsSync(agentFile)) continue;

		try {
			const content = readFileSync(agentFile, "utf-8");
			const { frontmatter } = parseFrontmatter(content);

			if (!frontmatter.name && !frontmatter.scope) continue; // No frontmatter

			const asStringArray = (val: unknown): string[] => {
				if (Array.isArray(val)) return val.map(String);
				return [];
			};

			agents.push({
				name: String(frontmatter.name || entry),
				scope: String(frontmatter.scope || ""),
				provides: asStringArray(frontmatter.provides),
				composes: asStringArray(frontmatter.composes),
				collaborators: asStringArray(frontmatter.collaborators),
				taxonomy: asStringArray(frontmatter.taxonomy),
				path: agentFile,
			});
		} catch {
			// Skip malformed files
		}
	}

	return agents;
}

export default function agentFrontmatter(pi: ExtensionAPI) {
	let cachedAgents: ParsedAgent[] | null = null;

	// Register the agent_roster tool
	pi.registerTool({
		name: "agent_roster",
		label: "Agent Roster",
		description:
			"Query the agent roster to discover persona agents by capability, skill composition, " +
			"taxonomy bridge tags, or collaborator relationships. Returns structured metadata " +
			"parsed from AGENTS.md frontmatter. Use this to find which agent provides a specific " +
			"capability (e.g., 'formal-verification') or composes a specific skill (e.g., 'lean4-prove').",
		parameters: Type.Object({
			query: Type.Optional(
				Type.String({
					description:
						"Filter agents. Matches against name, provides, composes, collaborators, " +
						"taxonomy, and scope. Case-insensitive substring match. Omit to list all agents.",
				}),
			),
			field: Type.Optional(
				Type.Union(
					[
						Type.Literal("provides"),
						Type.Literal("composes"),
						Type.Literal("collaborators"),
						Type.Literal("taxonomy"),
						Type.Literal("scope"),
						Type.Literal("name"),
					],
					{
						description: "Restrict search to a specific field. Omit to search all fields.",
					},
				),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			// Discover agents (cached per session)
			if (!cachedAgents) {
				cachedAgents = discoverAgents(ctx.cwd);
			}

			if (cachedAgents.length === 0) {
				return {
					type: "text" as const,
					text: JSON.stringify({ agents: [], message: "No agents found in .pi/agents/" }),
				};
			}

			const query = params.query?.toLowerCase();
			const field = params.field;

			let results = cachedAgents;

			if (query) {
				results = cachedAgents.filter((agent) => {
					const searchIn = (vals: string[]): boolean => vals.some((v) => v.toLowerCase().includes(query));

					if (field) {
						const fieldVal = agent[field as keyof ParsedAgent];
						if (Array.isArray(fieldVal)) return searchIn(fieldVal);
						return String(fieldVal).toLowerCase().includes(query);
					}

					// Search all fields
					return (
						agent.name.toLowerCase().includes(query) ||
						agent.scope.toLowerCase().includes(query) ||
						searchIn(agent.provides) ||
						searchIn(agent.composes) ||
						searchIn(agent.collaborators) ||
						searchIn(agent.taxonomy)
					);
				});
			}

			const output = results.map(({ path: _path, ...rest }) => rest);

			return {
				type: "text" as const,
				text: JSON.stringify({ agents: output, total: cachedAgents.length, matched: output.length }, null, 2),
			};
		},
	});

	// Invalidate cache on session switch (agents may have changed)
	pi.on("session_switch", () => {
		cachedAgents = null;
	});
}
