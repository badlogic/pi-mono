/**
 * Parser for agent definition files.
 *
 * Parses markdown files with YAML frontmatter.
 *
 * @module subagents/parser
 */

import type { AgentFrontmatter, SubagentConfig, SubagentSource } from "./types.js";

/**
 * Parse YAML frontmatter from markdown content.
 * Returns { frontmatter, body } where body is the content after frontmatter.
 */
export function parseFrontmatter<T extends object>(content: string): { frontmatter: T; body: string } {
	// Match YAML frontmatter: ---\n<yaml>\n---\n<body>
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

	if (!match) {
		return { frontmatter: {} as T, body: content };
	}

	const yamlContent = match[1];
	const body = match[2];

	// Parse YAML (simple parser for our limited needs)
	const frontmatter = parseSimpleYaml(yamlContent) as T;

	return { frontmatter, body };
}

/**
 * Simple YAML parser for frontmatter.
 * Handles:
 * - key: value
 * - key: value1, value2 (arrays)
 * - quoted strings
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	for (const line of yaml.split(/\r?\n/)) {
		// Skip empty lines and comments
		if (!line.trim() || line.trim().startsWith("#")) continue;

		const colonIndex = line.indexOf(":");
		if (colonIndex === -1) continue;

		const key = line.slice(0, colonIndex).trim();
		let value: unknown = line.slice(colonIndex + 1).trim();

		// Handle quoted strings
		if (typeof value === "string") {
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			// Handle arrays (comma-separated)
			else if (value.includes(",")) {
				value = value
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean);
			}
		}

		result[key] = value;
	}

	return result;
}

/**
 * Strip YAML frontmatter from content, returning only the body.
 */
export function stripFrontmatter(content: string): string {
	const { body } = parseFrontmatter(content);
	return body;
}

/**
 * Parse an agent definition file.
 *
 * @param content - The file content
 * @param filePath - The file path (for error reporting and config)
 * @param source - Where the definition came from
 * @returns Parsed SubagentConfig or null if invalid
 */
export function parseAgentFile(content: string, filePath: string, source: SubagentSource): SubagentConfig | null {
	const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);

	// Required fields
	if (!frontmatter.name || !frontmatter.description) {
		return null;
	}

	// Parse tools (comma-separated string to array, or array from YAML)
	let tools: string[] | undefined;
	if (frontmatter.tools) {
		if (typeof frontmatter.tools === "string") {
			tools = frontmatter.tools
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
		} else if (Array.isArray(frontmatter.tools)) {
			// parseSimpleYaml may return array for comma-separated values
			tools = (frontmatter.tools as unknown[]).map((s) => String(s).trim()).filter((s): s is string => Boolean(s));
		}
		// Empty array = undefined (use all tools)
		if (tools && tools.length === 0) {
			tools = undefined;
		}
	}

	return {
		name: frontmatter.name,
		description: frontmatter.description,
		systemPrompt: body.trim(),
		tools,
		model: frontmatter.model,
		memory: frontmatter.memory ?? "none",
		source,
		filePath,
	};
}
