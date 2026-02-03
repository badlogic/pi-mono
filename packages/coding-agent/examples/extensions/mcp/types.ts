/**
 * MCP Extension Types
 */

/** Configuration for a stdio-based MCP server */
export interface McpStdioServer {
	type: "stdio";
	command: string;
	args?: string[];
	env?: Record<string, string>;
	enabled?: boolean;
}

/** Configuration for an SSE-based MCP server */
export interface McpSseServer {
	type: "sse";
	url: string;
	headers?: Record<string, string>;
	enabled?: boolean;
}

/** MCP server configuration (either stdio or SSE) */
export type McpServerConfig = McpStdioServer | McpSseServer;

/** MCP settings stored in pi settings */
export interface McpSettings {
	servers: Record<string, McpServerConfig>;
}

/** Runtime state for a connected MCP server */
export interface McpServerState {
	name: string;
	config: McpServerConfig;
	status: "connecting" | "connected" | "disconnected" | "error";
	error?: string;
	tools: McpToolInfo[];
	resources: McpResourceInfo[];
}

/** Tool information from MCP server */
export interface McpToolInfo {
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
}

/** Resource information from MCP server */
export interface McpResourceInfo {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
}

/** Expanded environment variable value */
export function expandEnvVars(value: string): string {
	return value.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? "");
}
