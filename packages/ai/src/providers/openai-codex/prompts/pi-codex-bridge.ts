/**
 * Codex-Pi bridge prompt
 * Aligns Codex CLI expectations with Pi's toolset.
 */

export interface CodexToolInfo {
	name: string;
	description?: string;
}

const DEFAULT_TOOL_INFOS: CodexToolInfo[] = [
	{ name: "read", description: "Read file contents" },
	{ name: "bash", description: "Execute bash commands" },
	{ name: "edit", description: "Modify files with exact find/replace (requires prior read)" },
	{ name: "write", description: "Create or overwrite files" },
	{ name: "grep", description: "Search file contents (read-only)" },
	{ name: "find", description: "Find files by glob pattern (read-only)" },
	{ name: "ls", description: "List directory contents (read-only)" },
];

function normalizeToolInfos(tools?: CodexToolInfo[]): CodexToolInfo[] {
	if (tools === undefined) {
		return DEFAULT_TOOL_INFOS;
	}
	if (tools.length === 0) {
		return [];
	}

	const normalized: CodexToolInfo[] = [];
	for (const tool of tools) {
		const name = tool.name.trim();
		if (!name) continue;
		const description = tool.description?.trim() || "Custom tool";
		normalized.push({ name, description });
	}

	return normalized;
}

function formatToolList(tools: CodexToolInfo[]): string {
	if (tools.length === 0) {
		return "- (none)";
	}

	const maxNameLength = tools.reduce((max, tool) => Math.max(max, tool.name.length), 0);
	const padWidth = Math.max(6, maxNameLength + 1);

	return tools
		.map((tool) => {
			const paddedName = tool.name.padEnd(padWidth);
			// Collapse newlines to keep list formatting intact
			const desc = (tool.description ?? "Custom tool").replace(/\s*\n\s*/g, " ").trim();
			return `- ${paddedName}- ${desc}`;
		})
		.join("\n");
}

export function buildCodexPiBridge(tools?: CodexToolInfo[]): string {
	const normalizedTools = normalizeToolInfos(tools);
	const toolsList = formatToolList(normalizedTools);

	return `# Codex Running in Pi

You are running Codex through pi, a terminal coding assistant. The tools and rules differ from Codex CLI.

## CRITICAL: Tool Replacements

<critical_rule priority="0">
❌ APPLY_PATCH DOES NOT EXIST → ✅ USE "edit" INSTEAD
- NEVER use: apply_patch, applyPatch
- ALWAYS use: edit for ALL file modifications
</critical_rule>

<critical_rule priority="0">
❌ UPDATE_PLAN DOES NOT EXIST
- NEVER use: update_plan, updatePlan, read_plan, readPlan, todowrite, todoread
- There is no plan tool in this environment
</critical_rule>

## Available Tools (pi)

${toolsList}

## Usage Rules

- Read before edit; use read instead of cat/sed for file contents
- Use edit for surgical changes; write only for new files or complete rewrites
- Prefer grep/find/ls over bash for discovery
- Be concise and show file paths clearly when working with files

## Verification Checklist

1. Using edit, not apply_patch
2. No plan tools used
3. Only the tools listed above are called

Below are additional system instruction you MUST follow when responding:
`;
}
