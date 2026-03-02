/**
 * Agent discovery - finds and loads agent definitions from disk.
 *
 * @module subagents/discovery
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "../../config.js";
import { parseAgentFile } from "./parser.js";
import type { DiscoveryResult, SubagentConfig } from "./types.js";

// Get directory of current module for built-in agents
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_AGENTS_DIR = path.join(currentDir, "builtins");

/**
 * Find the nearest .pi/agents directory starting from cwd.
 * Walks up the directory tree until it finds .pi/agents or reaches the root.
 */
function findProjectAgentsDir(cwd: string): string | null {
	let current = cwd;

	while (true) {
		const candidate = path.join(current, ".pi", "agents");
		try {
			if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
				return candidate;
			}
		} catch {
			// Ignore errors (permission, etc.)
		}

		const parent = path.dirname(current);
		if (parent === current) return null; // Reached root
		current = parent;
	}
}

/**
 * Check if a path is a directory.
 */
function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Load agents from a directory.
 *
 * @param dir - Directory to load from
 * @param source - Source label for the agents
 * @returns Array of parsed agent configs
 */
function loadAgentsFromDir(dir: string, source: "user" | "project" | "builtin"): SubagentConfig[] {
	if (!isDirectory(dir)) return [];

	const agents: SubagentConfig[] = [];

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		// Only process .md files
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);

		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const agent = parseAgentFile(content, filePath, source);
		if (agent) {
			agents.push(agent);
		}
	}

	return agents;
}

/**
 * Discover all available agents from all sources.
 *
 * Agents are loaded in this order (later sources override earlier):
 * 1. Built-in agents
 * 2. User agents (~/.pi/agent/agents/)
 * 3. Project agents (.pi/agents/)
 *
 * @param cwd - Current working directory to search from
 * @returns Discovery result with all agents and directory paths
 */
export function discoverAgents(cwd: string): DiscoveryResult {
	// Built-in agents (shipped with pi)
	const builtinAgents = loadAgentsFromDir(BUILTIN_AGENTS_DIR, "builtin");

	// User agents: ~/.pi/agent/agents/
	const userAgentsDir = path.join(getAgentDir(), "agents");
	const userAgents = loadAgentsFromDir(userAgentsDir, "user");

	// Project agents: .pi/agents/ (nearest to cwd)
	const projectAgentsDir = findProjectAgentsDir(cwd);
	const projectAgents = projectAgentsDir ? loadAgentsFromDir(projectAgentsDir, "project") : [];

	// Merge agents (project > user > builtin)
	const agentMap = new Map<string, SubagentConfig>();

	// Load in priority order (later overwrites earlier)
	for (const agent of builtinAgents) {
		agentMap.set(agent.name, agent);
	}
	for (const agent of userAgents) {
		agentMap.set(agent.name, agent);
	}
	for (const agent of projectAgents) {
		agentMap.set(agent.name, agent);
	}

	return {
		agents: Array.from(agentMap.values()),
		userAgentsDir: isDirectory(userAgentsDir) ? userAgentsDir : null,
		projectAgentsDir,
		builtinAgentsDir: BUILTIN_AGENTS_DIR,
	};
}

/**
 * Get the list of available agent names.
 */
export function getAvailableAgentNames(cwd: string): string[] {
	const discovery = discoverAgents(cwd);
	return discovery.agents.map((a) => a.name);
}

/**
 * Get a specific agent by name.
 */
export function getAgentByName(cwd: string, name: string): SubagentConfig | undefined {
	const discovery = discoverAgents(cwd);
	return discovery.agents.find((a) => a.name === name);
}

/**
 * Format agent list for display.
 */
export function formatAgentList(agents: SubagentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };

	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;

	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}
