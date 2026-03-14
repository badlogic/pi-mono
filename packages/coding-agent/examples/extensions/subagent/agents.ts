/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@apholdings/jensen-code";

export type AgentScope = "user" | "project" | "both";
export type AgentSource = "user" | "project";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: AgentSource;
	filePath: string;
}

export type AgentDiscoveryErrorCode = "read_error" | "parse_error" | "validation_error";

export interface AgentDiscoveryError {
	code: AgentDiscoveryErrorCode;
	path: string;
	source: AgentSource;
	reason: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	projectAgentsDir: string | null;
	errors: AgentDiscoveryError[];
}

function normalizeFsPath(filePath: string): string {
	return path.normalize(path.resolve(filePath));
}

function normalizeAgentName(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeAgentDescription(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeAgentTools(value: unknown): string[] | undefined {
	if (typeof value === "string") {
		const tools = value
			.split(",")
			.map((tool) => tool.trim())
			.filter((tool) => tool.length > 0);
		return tools.length > 0 ? tools : undefined;
	}

	if (Array.isArray(value)) {
		const tools = value
			.filter((tool): tool is string => typeof tool === "string")
			.map((tool) => tool.trim())
			.filter((tool) => tool.length > 0);
		return tools.length > 0 ? tools : undefined;
	}

	return undefined;
}

function normalizeAgentModel(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function formatYamlError(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message.trim();
	}
	return String(error);
}

function loadAgentsFromDir(dir: string, source: AgentSource): { agents: AgentConfig[]; errors: AgentDiscoveryError[] } {
	const agents: AgentConfig[] = [];
	const errors: AgentDiscoveryError[] = [];
	const normalizedDir = normalizeFsPath(dir);

	if (!fs.existsSync(normalizedDir)) {
		return { agents, errors };
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(normalizedDir, { withFileTypes: true });
	} catch (error) {
		errors.push({
			code: "read_error",
			path: normalizedDir,
			source,
			reason: error instanceof Error ? error.message : String(error),
		});
		return { agents, errors };
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = normalizeFsPath(path.join(normalizedDir, entry.name));
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch (error) {
			errors.push({
				code: "read_error",
				path: filePath,
				source,
				reason: error instanceof Error ? error.message : String(error),
			});
			continue;
		}

		let frontmatter: Record<string, unknown>;
		let body: string;
		try {
			const parsed = parseFrontmatter<Record<string, unknown>>(content);
			frontmatter = parsed.frontmatter;
			body = parsed.body;
		} catch (error) {
			errors.push({
				code: "parse_error",
				path: filePath,
				source,
				reason: formatYamlError(error),
			});
			continue;
		}

		const name = normalizeAgentName(frontmatter.name);
		const description = normalizeAgentDescription(frontmatter.description);
		if (!name || !description) {
			const missingFields = [!name ? "name" : null, !description ? "description" : null].filter(
				(field): field is string => field !== null,
			);
			errors.push({
				code: "validation_error",
				path: filePath,
				source,
				reason: `Missing required frontmatter field${missingFields.length > 1 ? "s" : ""}: ${missingFields.join(", ")}`,
			});
			continue;
		}

		agents.push({
			name,
			description,
			tools: normalizeAgentTools(frontmatter.tools),
			model: normalizeAgentModel(frontmatter.model),
			systemPrompt: body,
			source,
			filePath,
		});
	}

	agents.sort((left, right) => left.name.localeCompare(right.name));
	errors.sort((left, right) => left.path.localeCompare(right.path));

	return { agents, errors };
}

function isDirectory(candidatePath: string): boolean {
	try {
		return fs.statSync(candidatePath).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = normalizeFsPath(cwd);

	while (true) {
		const candidate = normalizeFsPath(path.join(currentDir, CONFIG_DIR_NAME, "agents"));
		if (isDirectory(candidate)) {
			return candidate;
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			return null;
		}
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userDir = normalizeFsPath(path.join(getAgentDir(), "agents"));
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const userDiscovery = scope === "project" ? { agents: [], errors: [] } : loadAgentsFromDir(userDir, "user");
	const projectDiscovery =
		scope === "user" || !projectAgentsDir
			? { agents: [], errors: [] }
			: loadAgentsFromDir(projectAgentsDir, "project");

	const agentMap = new Map<string, AgentConfig>();

	if (scope === "both") {
		for (const agent of userDiscovery.agents) agentMap.set(agent.name, agent);
		for (const agent of projectDiscovery.agents) agentMap.set(agent.name, agent);
	} else if (scope === "user") {
		for (const agent of userDiscovery.agents) agentMap.set(agent.name, agent);
	} else {
		for (const agent of projectDiscovery.agents) agentMap.set(agent.name, agent);
	}

	return {
		agents: Array.from(agentMap.values()).sort((left, right) => left.name.localeCompare(right.name)),
		projectAgentsDir,
		errors: [...userDiscovery.errors, ...projectDiscovery.errors].sort((left, right) =>
			left.path.localeCompare(right.path),
		),
	};
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((agent) => `${agent.name} (${agent.source}): ${agent.description}`).join("; "),
		remaining,
	};
}

export function findDiscoveryErrorForAgent(
	errors: AgentDiscoveryError[],
	agentName: string,
): AgentDiscoveryError | undefined {
	const expectedFileName = `${agentName}.md`.toLowerCase();
	return errors.find((error) => path.basename(error.path).toLowerCase() === expectedFileName);
}
