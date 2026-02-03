/**
 * MCP Client - Manages connections to MCP servers
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
	McpResourceInfo,
	McpServerConfig,
	McpServerState,
	McpSseServer,
	McpStdioServer,
	McpToolInfo,
} from "./types.js";
import { expandEnvVars } from "./types.js";

/** Manages a single MCP server connection */
export class McpConnection {
	private client: Client | null = null;
	private transport: StdioClientTransport | SSEClientTransport | null = null;
	public state: McpServerState;

	constructor(
		public readonly name: string,
		public readonly config: McpServerConfig,
	) {
		this.state = {
			name,
			config,
			status: "disconnected",
			tools: [],
			resources: [],
		};
	}

	/** Connect to the MCP server */
	async connect(): Promise<void> {
		if (this.client) {
			await this.disconnect();
		}

		this.state.status = "connecting";
		this.state.error = undefined;

		try {
			this.client = new Client({ name: "pi-mcp-client", version: "1.0.0" }, { capabilities: {} });

			if (this.config.type === "stdio") {
				this.transport = await this.createStdioTransport(this.config);
			} else {
				this.transport = await this.createSseTransport(this.config);
			}

			await this.client.connect(this.transport);

			// Discover tools
			await this.discoverTools();

			// Discover resources
			await this.discoverResources();

			this.state.status = "connected";
		} catch (error) {
			this.state.status = "error";
			this.state.error = error instanceof Error ? error.message : String(error);
			throw error;
		}
	}

	/** Disconnect from the MCP server */
	async disconnect(): Promise<void> {
		if (this.client) {
			try {
				await this.client.close();
			} catch {
				// Ignore close errors
			}
			this.client = null;
		}
		if (this.transport) {
			try {
				await this.transport.close();
			} catch {
				// Ignore close errors
			}
			this.transport = null;
		}
		this.state.status = "disconnected";
		this.state.tools = [];
		this.state.resources = [];
	}

	/** Call a tool on this server */
	async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
		if (!this.client || this.state.status !== "connected") {
			throw new Error(`Server ${this.name} is not connected`);
		}

		const result = await this.client.callTool({ name: toolName, arguments: args });
		return result;
	}

	/** Read a resource from this server */
	async readResource(uri: string): Promise<{ contents: Array<{ uri: string; text?: string; blob?: string }> }> {
		if (!this.client || this.state.status !== "connected") {
			throw new Error(`Server ${this.name} is not connected`);
		}

		const result = await this.client.readResource({ uri });
		return result;
	}

	private async createStdioTransport(config: McpStdioServer): Promise<StdioClientTransport> {
		const env: Record<string, string> = { ...(process.env as Record<string, string>) };

		// Expand environment variables in config
		if (config.env) {
			for (const [key, value] of Object.entries(config.env)) {
				env[key] = expandEnvVars(value);
			}
		}

		const args = config.args?.map(expandEnvVars) ?? [];

		return new StdioClientTransport({
			command: expandEnvVars(config.command),
			args,
			env,
		});
	}

	private async createSseTransport(config: McpSseServer): Promise<SSEClientTransport> {
		const headers: Record<string, string> = {};

		if (config.headers) {
			for (const [key, value] of Object.entries(config.headers)) {
				headers[key] = expandEnvVars(value);
			}
		}

		return new SSEClientTransport(new URL(expandEnvVars(config.url)), {
			requestInit: { headers },
		});
	}

	private async discoverTools(): Promise<void> {
		if (!this.client) return;

		try {
			const result = await this.client.listTools();
			this.state.tools = result.tools.map(
				(tool): McpToolInfo => ({
					name: tool.name,
					description: tool.description,
					inputSchema: tool.inputSchema as Record<string, unknown>,
				}),
			);
		} catch {
			// Server may not support tools
			this.state.tools = [];
		}
	}

	private async discoverResources(): Promise<void> {
		if (!this.client) return;

		try {
			const result = await this.client.listResources();
			this.state.resources = result.resources.map(
				(resource): McpResourceInfo => ({
					uri: resource.uri,
					name: resource.name,
					description: resource.description,
					mimeType: resource.mimeType,
				}),
			);
		} catch {
			// Server may not support resources
			this.state.resources = [];
		}
	}
}

/** Manages multiple MCP server connections */
export class McpManager {
	private connections = new Map<string, McpConnection>();

	/** Add a server configuration */
	addServer(name: string, config: McpServerConfig): void {
		if (this.connections.has(name)) {
			throw new Error(`Server ${name} already exists`);
		}
		this.connections.set(name, new McpConnection(name, config));
	}

	/** Remove a server */
	async removeServer(name: string): Promise<void> {
		const conn = this.connections.get(name);
		if (conn) {
			await conn.disconnect();
			this.connections.delete(name);
		}
	}

	/** Get a server connection */
	getServer(name: string): McpConnection | undefined {
		return this.connections.get(name);
	}

	/** Get all server states */
	getServerStates(): McpServerState[] {
		return Array.from(this.connections.values()).map((c) => c.state);
	}

	/** Connect to a server */
	async connect(name: string): Promise<void> {
		const conn = this.connections.get(name);
		if (!conn) {
			throw new Error(`Server ${name} not found`);
		}
		await conn.connect();
	}

	/** Disconnect from a server */
	async disconnect(name: string): Promise<void> {
		const conn = this.connections.get(name);
		if (conn) {
			await conn.disconnect();
		}
	}

	/** Connect to all enabled servers */
	async connectAll(): Promise<void> {
		const promises: Promise<void>[] = [];
		for (const conn of this.connections.values()) {
			if (conn.config.enabled !== false) {
				promises.push(
					conn.connect().catch((err) => {
						// Log but don't fail
						console.error(`Failed to connect to MCP server ${conn.name}:`, err);
					}),
				);
			}
		}
		await Promise.all(promises);
	}

	/** Disconnect from all servers */
	async disconnectAll(): Promise<void> {
		const promises: Promise<void>[] = [];
		for (const conn of this.connections.values()) {
			promises.push(conn.disconnect());
		}
		await Promise.all(promises);
	}

	/** Get all tools from all connected servers */
	getAllTools(): Array<{ server: string; tool: McpToolInfo }> {
		const tools: Array<{ server: string; tool: McpToolInfo }> = [];
		for (const conn of this.connections.values()) {
			if (conn.state.status === "connected") {
				for (const tool of conn.state.tools) {
					tools.push({ server: conn.name, tool });
				}
			}
		}
		return tools;
	}

	/** Call a tool on a specific server */
	async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
		const conn = this.connections.get(serverName);
		if (!conn) {
			throw new Error(`Server ${serverName} not found`);
		}
		return conn.callTool(toolName, args);
	}
}
