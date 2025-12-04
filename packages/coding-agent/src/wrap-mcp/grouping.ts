/**
 * Tool Grouping via Pi
 * Uses Pi's non-interactive mode to intelligently group MCP tools
 */

import { unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execAsync, type McpTool } from "./discovery.js";

export interface ToolGroup {
	filename: string;
	description: string;
	mcp_tools: string[];
	rationale: string;
}

/**
 * Generate the grouping prompt for Pi
 * @param serverName - MCP server name
 * @param tools - Array of tool objects with name, description, inputSchema
 * @returns Prompt for Pi
 */
function generateGroupingPrompt(serverName: string, tools: McpTool[]): string {
	const toolList = tools
		.map((t) => {
			const params = t.inputSchema?.properties
				? Object.entries(t.inputSchema.properties)
						.map(([name, schema]: [string, any]) => {
							const required = t.inputSchema?.required?.includes(name) ? " (required)" : "";
							return `      - ${name}: ${schema.type || "any"}${required} - ${schema.description || ""}`;
						})
						.join("\n")
				: "      (no parameters)";

			return `  - ${t.name}: ${t.description || "No description"}\n    Parameters:\n${params}`;
		})
		.join("\n\n");

	return `You are grouping MCP tools into CLI wrapper scripts for the Pi coding agent.

MCP Server: ${serverName}
Total Tools: ${tools.length}

MCP Tools:
${toolList}

Group these tools into logical CLI commands. Guidelines:
- Group related actions (e.g., all navigation under ${serverName}-navigate.js)
- Create dedicated tools for high-frequency operations (e.g., snapshot gets its own tool)
- Keep groups cohesive (max 5-6 MCP tools per wrapper, fewer for complex tools)
- Name wrappers: ${serverName}-<action>.js (lowercase, hyphenated)
- Maximum 20 wrapper scripts total
- Single-tool wrappers are fine for important/complex tools

Output ONLY valid JSON (no markdown, no explanation):
{
  "groups": [
    {
      "filename": "${serverName}-example.js",
      "description": "One-line description of what this wrapper does",
      "mcp_tools": ["tool_name_1", "tool_name_2"],
      "rationale": "Brief explanation of why these are grouped"
    }
  ]
}`;
}

/**
 * Parse Pi's response to extract JSON
 * @param output - Pi output
 * @returns Parsed JSON
 */
function parseGroupingResponse(output: string): { groups: ToolGroup[] } {
	// Try to find JSON in the output
	const jsonMatch = output.match(/\{[\s\S]*"groups"[\s\S]*\}/);
	if (!jsonMatch) {
		throw new Error("No valid JSON found in Pi response");
	}

	try {
		return JSON.parse(jsonMatch[0]);
	} catch (e: any) {
		throw new Error(`Failed to parse grouping JSON: ${e.message}`);
	}
}

/**
 * Validate the grouping response
 * @param response - Parsed response
 * @param tools - Original tools array
 * @param allowUnused - If true, allow tools to be excluded from groups (default: false)
 * @returns Validated response
 */
function validateGrouping(
	response: { groups: ToolGroup[] },
	tools: McpTool[],
	allowUnused = false,
): { groups: ToolGroup[] } {
	if (!response.groups || !Array.isArray(response.groups)) {
		throw new Error("Invalid grouping response: missing groups array");
	}

	if (response.groups.length > 20) {
		throw new Error(`Too many groups (${response.groups.length}), maximum is 20`);
	}

	const toolNames = new Set(tools.map((t) => t.name));
	const usedTools = new Set<string>();

	for (const group of response.groups) {
		if (!group.filename || !group.mcp_tools || !Array.isArray(group.mcp_tools)) {
			throw new Error(`Invalid group: ${JSON.stringify(group)}`);
		}

		// Verify all referenced tools exist
		for (const toolName of group.mcp_tools) {
			if (!toolNames.has(toolName)) {
				throw new Error(`Unknown tool referenced: ${toolName}`);
			}
			usedTools.add(toolName);
		}
	}

	// Check for unused tools - fail by default to prevent gaps
	const unusedTools = [...toolNames].filter((t) => !usedTools.has(t));
	if (unusedTools.length > 0) {
		if (allowUnused) {
			console.warn(`Warning: ${unusedTools.length} tools not assigned to any group: ${unusedTools.join(", ")}`);
		} else {
			throw new Error(
				`${unusedTools.length} MCP tools not assigned to any group: ${unusedTools.join(", ")}. ` +
					`All tools must be covered to prevent functionality gaps.`,
			);
		}
	}

	return response;
}

/**
 * Group tools using Pi's non-interactive mode
 * @param serverName - MCP server name
 * @param tools - Array of tool objects
 * @returns Array of group objects
 */
export async function groupTools(serverName: string, tools: McpTool[]): Promise<ToolGroup[]> {
	const prompt = generateGroupingPrompt(serverName, tools);
	const tempFile = join(tmpdir(), `pi-wrap-mcp-grouping-${Date.now()}.md`);

	try {
		writeFileSync(tempFile, prompt, "utf-8");

		const output = await execAsync(`pi -p --no-session --tools "" @"${tempFile}"`, 120000);

		const response = parseGroupingResponse(output);
		const validated = validateGrouping(response, tools);

		return validated.groups;
	} catch (error: any) {
		if (error.message === "Command timed out") {
			throw new Error("Grouping timed out after 2 minutes");
		}
		throw new Error(`Grouping failed: ${error.message}`);
	} finally {
		// Clean up temp file
		try {
			unlinkSync(tempFile);
		} catch {
			// Ignore cleanup errors
		}
	}
}

/**
 * Fallback grouping when Pi is not available or fails
 * Creates one wrapper per tool (simple but works)
 * @param serverName - MCP server name
 * @param tools - Array of tool objects
 * @returns Array of group objects
 */
export function fallbackGrouping(serverName: string, tools: McpTool[]): ToolGroup[] {
	return tools.map((tool) => ({
		filename: `${serverName}-${tool.name.replace(/_/g, "-")}.js`,
		description: tool.description || `Wrapper for ${tool.name}`,
		mcp_tools: [tool.name],
		rationale: "Direct 1:1 mapping (fallback mode)",
	}));
}
