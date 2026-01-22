/**
 * ACP tool formatting utilities.
 *
 * Provides formatting and mapping functions for tool calls in ACP sessions.
 */

import type * as acp from "@agentclientprotocol/sdk";

/**
 * Format a descriptive title for tool calls.
 */
export function formatToolTitle(toolName: string, args: Record<string, unknown>): string {
	switch (toolName) {
		case "bash": {
			const command = args.command as string | undefined;
			if (command) {
				// Truncate long commands
				const truncated = command.length > 80 ? `${command.slice(0, 77)}...` : command;
				return `Run \`${truncated}\``;
			}
			return "bash";
		}
		case "read": {
			const path = args.path as string | undefined;
			return path ? `Read ${path}` : "read";
		}
		case "write": {
			const path = args.path as string | undefined;
			return path ? `Write ${path}` : "write";
		}
		case "edit": {
			const path = args.path as string | undefined;
			return path ? `Edit ${path}` : "edit";
		}
		case "glob": {
			const pattern = args.pattern as string | undefined;
			return pattern ? `Glob ${pattern}` : "glob";
		}
		case "grep": {
			const pattern = args.pattern as string | undefined;
			return pattern ? `Grep "${pattern}"` : "grep";
		}
		default:
			return toolName;
	}
}

/**
 * Map pi tool names to ACP ToolKind.
 */
export function mapToolKind(toolName: string): acp.ToolKind {
	switch (toolName) {
		case "read":
			return "read";
		case "write":
		case "edit":
			return "edit";
		case "bash":
			return "execute";
		case "grep":
		case "glob":
			return "search";
		default:
			return "other";
	}
}

/**
 * Format tool result as ACP ToolCallContent.
 */
export function formatToolResultContent(result: unknown): acp.ToolCallContent[] | undefined {
	if (result === undefined || result === null) {
		return undefined;
	}

	// Convert result to string representation
	let text: string;
	if (typeof result === "string") {
		text = result;
	} else if (typeof result === "object" && "content" in result) {
		// MCP-style result with content field
		const content = (result as { content: unknown }).content;
		if (Array.isArray(content)) {
			// Extract text from content array
			text = content
				.map((item) => {
					if (typeof item === "object" && item && "text" in item) {
						return (item as { text: string }).text;
					}
					return JSON.stringify(item);
				})
				.join("\n");
		} else {
			text = JSON.stringify(content);
		}
	} else {
		text = JSON.stringify(result, null, 2);
	}

	return [
		{
			type: "content",
			content: {
				type: "text",
				text,
			},
		},
	];
}
