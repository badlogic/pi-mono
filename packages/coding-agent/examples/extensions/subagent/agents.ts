/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseFrontmatter } from "@mariozechner/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: "user" | "project";
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
}

/**
 * Parse frontmatter with fallback for malformed YAML.
 * Some agent files (e.g., from Claude Code) have complex description fields
 * that cause YAML parse errors. We try the standard parser first, then fall
 * back to a regex-based extractor for simple key: value pairs.
 */
function parseAgentFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
	try {
		return parseFrontmatter<Record<string, string>>(content);
	} catch {
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

		const frontmatter: Record<string, string> = {};
		const lines = yamlString.split("\n");
		for (const line of lines) {
			const match = line.match(/^(\w+):\s*(.*)$/);
			if (match) {
				const [, key, rawValue] = match;
				const value =
					key === "description"
						? rawValue
								.replace(/\\n/g, " ")
								.replace(/<[^>]+>/g, "")
								.trim()
								.slice(0, 200)
						: rawValue;
				frontmatter[key] = value;
			}
		}

		return { frontmatter, body };
	}
}

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
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseAgentFrontmatter(content);

		if (!frontmatter.name || !frontmatter.description) {
			continue;
		}

		const tools = frontmatter.tools
			?.split(",")
			.map((t: string) => t.trim())
			.filter(Boolean);

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: tools && tools.length > 0 ? tools : undefined,
			model: frontmatter.model,
			systemPrompt: body,
			source,
			filePath,
		});
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

function resolvePath(p: string): string {
	if (p.startsWith("~/")) {
		return path.join(os.homedir(), p.slice(2));
	}
	if (p === "~") {
		return os.homedir();
	}
	return path.resolve(p);
}

function findNearestProjectAgentsDir(cwd: string, extraDirs: string[] = []): string | null {
	let currentDir = cwd;
	while (true) {
		// Check .pi/agents first
		const piCandidate = path.join(currentDir, ".pi", "agents");
		if (isDirectory(piCandidate)) return piCandidate;

		// Check extra directory patterns (e.g., "~/.claude" -> check ".claude/agents")
		for (const dir of extraDirs) {
			if (dir.startsWith("~/.")) {
				const subdirName = dir.slice(2); // e.g., ".claude" from "~/.claude"
				const candidate = path.join(currentDir, subdirName, "agents");
				if (isDirectory(candidate)) return candidate;
			}
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export interface DiscoverAgentsOptions {
	extraAgentDirs?: string[];
}

export function discoverAgents(
	cwd: string,
	scope: AgentScope,
	options: DiscoverAgentsOptions = {},
): AgentDiscoveryResult {
	const extraDirs = options.extraAgentDirs ?? [];
	const piAgentsDir = path.join(os.homedir(), ".pi", "agent", "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd, extraDirs);

	const agentMap = new Map<string, AgentConfig>();

	if (scope !== "project") {
		// Load from extra directories first (lowest precedence)
		for (const dir of extraDirs) {
			const resolved = resolvePath(dir);
			const agentsSubdir = path.join(resolved, "agents");
			const dirToLoad = isDirectory(agentsSubdir) ? agentsSubdir : resolved;
			for (const agent of loadAgentsFromDir(dirToLoad, "user")) {
				agentMap.set(agent.name, agent);
			}
		}

		// Pi agents override extra dirs
		for (const agent of loadAgentsFromDir(piAgentsDir, "user")) {
			agentMap.set(agent.name, agent);
		}
	}

	if (scope !== "user" && projectAgentsDir) {
		// Project agents override all
		for (const agent of loadAgentsFromDir(projectAgentsDir, "project")) {
			agentMap.set(agent.name, agent);
		}
	}

	return { agents: Array.from(agentMap.values()), projectAgentsDir };
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((a) => `${a.name} (${a.source}): ${a.description}`).join("; "),
		remaining,
	};
}
