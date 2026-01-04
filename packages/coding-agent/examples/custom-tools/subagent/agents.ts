/**
 * Agent discovery and configuration
 *
 * Discovers agent definitions from:
 *   - ~/.pi/agent/agents/*.md (user-level, primary)
 *   - ~/.claude/agents/*.md (user-level, fallback for backwards compat)
 *   - .pi/agents/*.md (project-level, primary)
 *   - .claude/agents/*.md (project-level, fallback)
 *
 * Agent files use markdown with YAML frontmatter:
 *
 *   ---
 *   name: explore
 *   description: Fast codebase recon
 *   tools: read, grep, find, ls, bash
 *   model: claude-haiku-4-5, haiku, flash
 *   spawns: plan, review
 *   ---
 *
 *   You are a scout. Quickly investigate and return findings.
 *
 * Frontmatter fields:
 *   - name: Agent identifier (required)
 *   - description: What the agent does (required)
 *   - tools: Comma-separated tool list
 *   - model: Model pattern with optional fallbacks
 *   - spawns: Which agents this one can spawn ("*" for all, comma-separated list, or omit to deny all)
 *   - recursive: (deprecated) Use spawns instead. If true, equivalent to spawns: "*"
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ============================================================================
// Types
// ============================================================================

export type AgentScope = "user" | "project" | "both";
export type AgentSource = "user" | "project";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	/** Model pattern (supports fuzzy matching and fallbacks like "sonnet, haiku") */
	model?: string;
	/** Which agents this one can spawn. "*" = all, string[] = specific list, undefined = none */
	spawns?: string[] | "*";
	/** @deprecated Use spawns instead */
	recursive?: boolean;
	systemPrompt: string;
	source: AgentSource;
	filePath?: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

// ============================================================================
// Parsing
// ============================================================================

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
	const frontmatter: Record<string, string> = {};
	const normalized = content.replace(/\r\n/g, "\n");

	if (!normalized.startsWith("---")) {
		return { frontmatter, body: normalized };
	}

	const endIndex = normalized.indexOf("\n---", 3);
	if (endIndex === -1) {
		return { frontmatter, body: normalized };
	}

	const frontmatterBlock = normalized.slice(4, endIndex);
	const body = normalized.slice(endIndex + 4).trim();

	for (const line of frontmatterBlock.split("\n")) {
		const match = line.match(/^([\w-]+):\s*(.*)$/);
		if (match) {
			let value = match[2].trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			frontmatter[match[1]] = value;
		}
	}

	return { frontmatter, body };
}

function parseBooleanFrontmatter(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined;
	return value === "true" || value === "1";
}

/**
 * Parse the spawns field from frontmatter.
 * Returns "*" for wildcard, string[] for specific agents, undefined for none.
 */
function parseSpawnsFrontmatter(value: string | undefined): string[] | "*" | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	if (trimmed === "*") return "*";
	if (!trimmed) return undefined;
	const agents = trimmed
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return agents.length > 0 ? agents : undefined;
}

/**
 * Parse agent content (frontmatter + body) into AgentConfig.
 */
function parseAgentContent(content: string, source: AgentSource, filePath?: string): AgentConfig | null {
	const { frontmatter, body } = parseFrontmatter(content);

	if (!frontmatter.name || !frontmatter.description) {
		return null;
	}

	const tools = frontmatter.tools
		?.split(",")
		.map((t) => t.trim())
		.filter(Boolean);

	// Parse spawns field
	let spawns = parseSpawnsFrontmatter(frontmatter.spawns);

	// Backwards compat: recursive: true → spawns: "*"
	const recursive = parseBooleanFrontmatter(frontmatter.recursive);
	if (spawns === undefined && recursive === true) {
		spawns = "*";
	}

	// Backwards compat: if tools includes "subagent" or "task", infer spawns: "*"
	if (spawns === undefined && tools?.some((t) => t === "subagent" || t === "task")) {
		spawns = "*";
	}

	return {
		name: frontmatter.name,
		description: frontmatter.description,
		tools: tools && tools.length > 0 ? tools : undefined,
		model: frontmatter.model,
		spawns,
		recursive,
		systemPrompt: body,
		source,
		filePath,
	};
}

// ============================================================================
// Discovery
// ============================================================================

function loadAgentsFromDir(dir: string, source: "user" | "project"): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;

		const filePath = path.join(dir, entry.name);

		// Handle both regular files and symlinks (statSync follows symlinks)
		try {
			if (!fs.statSync(filePath).isFile()) continue;
		} catch {
			continue;
		}

		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const agent = parseAgentContent(content, source, filePath);
		if (agent) {
			agents.push(agent);
		}
	}

	return agents;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function findNearestDir(cwd: string, relPath: string): string | null {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, relPath);
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

/**
 * Discover agents from filesystem.
 *
 * Precedence (highest wins): project .pi > project .claude > user .pi > user .claude
 */
export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	// Primary directories (.pi)
	const userPiDir = path.join(os.homedir(), ".pi", "agent", "agents");
	const projectPiDir = findNearestDir(cwd, ".pi/agents");

	// Fallback directories (.claude) - for backwards compatibility
	const userClaudeDir = path.join(os.homedir(), ".claude", "agents");
	const projectClaudeDir = findNearestDir(cwd, ".claude/agents");

	const agentMap = new Map<string, AgentConfig>();

	// Load from .claude directories (fallback, lower priority than .pi)
	const userClaudeAgents = scope === "project" ? [] : loadAgentsFromDir(userClaudeDir, "user");
	const projectClaudeAgents =
		scope === "user" || !projectClaudeDir ? [] : loadAgentsFromDir(projectClaudeDir, "project");

	// Load from .pi directories (primary, higher priority)
	const userPiAgents = scope === "project" ? [] : loadAgentsFromDir(userPiDir, "user");
	const projectPiAgents = scope === "user" || !projectPiDir ? [] : loadAgentsFromDir(projectPiDir, "project");

	if (scope === "both") {
		// Order: user .claude → user .pi → project .claude → project .pi
		// Later entries override earlier ones
		for (const agent of userClaudeAgents) agentMap.set(agent.name, agent);
		for (const agent of userPiAgents) agentMap.set(agent.name, agent);
		for (const agent of projectClaudeAgents) agentMap.set(agent.name, agent);
		for (const agent of projectPiAgents) agentMap.set(agent.name, agent);
	} else if (scope === "user") {
		// user .claude → user .pi
		for (const agent of userClaudeAgents) agentMap.set(agent.name, agent);
		for (const agent of userPiAgents) agentMap.set(agent.name, agent);
	} else {
		// project scope only - no user agents
		for (const agent of projectClaudeAgents) agentMap.set(agent.name, agent);
		for (const agent of projectPiAgents) agentMap.set(agent.name, agent);
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir: projectPiDir };
}

/**
 * Get an agent by name from discovered agents.
 */
export function getAgent(agents: AgentConfig[], name: string): AgentConfig | undefined {
	return agents.find((a) => a.name === name);
}

/**
 * Check if an agent is allowed to spawn another agent.
 */
export function canSpawn(agent: AgentConfig, targetAgentName: string): boolean {
	if (agent.spawns === undefined) return false;
	if (agent.spawns === "*") return true;
	return agent.spawns.includes(targetAgentName);
}

/**
 * Format agent list for display.
 */
export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}
