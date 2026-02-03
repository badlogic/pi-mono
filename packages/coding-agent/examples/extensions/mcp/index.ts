/**
 * MCP Extension for Pi
 *
 * Adds Model Context Protocol support with:
 * - Stdio and SSE server connections
 * - Dynamic tool registration from MCP servers
 * - /mcp command for server management TUI
 * - Footer status showing connection state
 *
 * Configuration in settings.json:
 * {
 *   "mcp": {
 *     "servers": {
 *       "filesystem": {
 *         "type": "stdio",
 *         "command": "npx",
 *         "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
 *         "enabled": true
 *       },
 *       "remote": {
 *         "type": "sse",
 *         "url": "https://api.example.com/mcp",
 *         "headers": { "Authorization": "Bearer ${API_KEY}" },
 *         "enabled": true
 *       }
 *     }
 *   }
 * }
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Spacer, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { McpManager } from "./client.js";
import type { McpServerConfig, McpServerState, McpSettings } from "./types.js";

// Tool name prefix to avoid conflicts
const TOOL_PREFIX = "mcp";

export default function mcpExtension(pi: ExtensionAPI) {
	const manager = new McpManager();
	const registeredTools: string[] = [];

	// Load settings and initialize servers
	function loadSettings(ctx: ExtensionContext): McpSettings {
		// Settings would come from ctx or a settings file
		// For now, return empty - users configure via /mcp command
		const settings = (ctx as unknown as { settings?: { mcp?: McpSettings } }).settings;
		return settings?.mcp ?? { servers: {} };
	}

	// Register MCP tools with pi
	function registerMcpTools(): void {
		// Unregister old tools first
		// (pi doesn't have unregisterTool, so we track and skip re-registration)

		const allTools = manager.getAllTools();
		for (const { server, tool } of allTools) {
			const toolName = `${TOOL_PREFIX}_${server}_${tool.name}`;

			if (registeredTools.includes(toolName)) {
				continue; // Already registered
			}

			pi.registerTool({
				name: toolName,
				label: `MCP: ${server}/${tool.name}`,
				description: tool.description ?? `MCP tool from ${server}`,
				parameters: Type.Object(convertJsonSchemaToTypebox(tool.inputSchema)),

				async execute(_toolCallId, params, signal, onUpdate, _ctx) {
					if (signal?.aborted) {
						return {
							content: [{ type: "text", text: "Cancelled" }],
							details: { server, tool: tool.name, cancelled: true },
						};
					}

					onUpdate?.({
						content: [{ type: "text", text: `Calling ${server}/${tool.name}...` }],
						details: { server, tool: tool.name, status: "executing" },
					});

					try {
						const result = await manager.callTool(server, tool.name, params as Record<string, unknown>);
						const text = formatToolResult(result);
						return {
							content: [{ type: "text", text }],
							details: { server, tool: tool.name, result },
						};
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						return {
							content: [{ type: "text", text: `Error: ${message}` }],
							details: { server, tool: tool.name, error: message },
							isError: true,
						};
					}
				},

				renderCall(args, theme) {
					const text = `${theme.fg("toolTitle", theme.bold(`${server}/${tool.name}`))} ${theme.fg("dim", JSON.stringify(args))}`;
					return new Text(text, 0, 0);
				},
			});

			registeredTools.push(toolName);
		}
	}

	// Update footer status
	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;

		const states = manager.getServerStates();
		const connected = states.filter((s) => s.status === "connected").length;
		const total = states.length;

		if (total === 0) {
			ctx.ui.setStatus("mcp", undefined);
			return;
		}

		const color = connected === total ? "success" : connected > 0 ? "warning" : "error";
		const icon = connected === total ? "●" : connected > 0 ? "◐" : "○";
		const text = `MCP ${connected}/${total}`;

		ctx.ui.setStatus("mcp", ctx.ui.theme.fg(color, icon) + ctx.ui.theme.fg("dim", ` ${text}`));
	}

	// Initialize on session start
	pi.on("session_start", async (_event, ctx) => {
		const settings = loadSettings(ctx);

		// Add configured servers
		for (const [name, config] of Object.entries(settings.servers)) {
			manager.addServer(name, config);
		}

		// Connect to enabled servers
		await manager.connectAll();

		// Register tools from connected servers
		registerMcpTools();

		// Update status
		updateStatus(ctx);
	});

	// Cleanup on shutdown
	pi.on("session_shutdown", async () => {
		await manager.disconnectAll();
	});

	// Register /mcp command
	pi.registerCommand("mcp", {
		description: "Manage MCP servers",
		handler: async (_args, ctx) => {
			await showMcpManager(ctx);
		},
	});

	// MCP Manager TUI
	async function showMcpManager(ctx: ExtensionContext): Promise<void> {
		const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
			const states = manager.getServerStates();

			const container = new Container();
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
			container.addChild(new Text(theme.fg("accent", theme.bold("MCP Servers")), 1, 0));
			container.addChild(new Spacer(1));

			if (states.length === 0) {
				container.addChild(new Text(theme.fg("muted", "No servers configured."), 1, 0));
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("dim", "Use 'add' to add a new server."), 1, 0));
			}

			const items: SelectItem[] = [
				...states.map((s) => {
					const icon = getStatusIcon(s.status);
					const styledIcon =
						s.status === "connected"
							? theme.fg("success", icon)
							: s.status === "error"
								? theme.fg("error", icon)
								: s.status === "connecting"
									? theme.fg("warning", icon)
									: theme.fg("dim", icon);
					return {
						value: `server:${s.name}`,
						label: `${styledIcon} ${s.name}`,
						description: getServerDescription(s),
					};
				}),
				{ value: "add", label: theme.fg("accent", "+ Add server"), description: "Configure a new MCP server" },
			];

			const selectList = new SelectList(items, Math.min(items.length + 2, 15), {
				selectedPrefix: (t) => theme.fg("accent", t),
				selectedText: (t) => theme.fg("accent", t),
				description: (t) => theme.fg("muted", t),
				scrollInfo: (t) => theme.fg("dim", t),
				noMatch: (t) => theme.fg("warning", t),
			});

			selectList.onSelect = (item) => done(item.value);
			selectList.onCancel = () => done(null);

			container.addChild(selectList);
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc close"), 1, 0));
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

			return {
				render: (w) => container.render(w),
				invalidate: () => container.invalidate(),
				handleInput: (data) => {
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		});

		if (!result) return;

		if (result === "add") {
			await showAddServer(ctx);
		} else if (result.startsWith("server:")) {
			const serverName = result.slice(7);
			await showServerActions(ctx, serverName);
		}

		// Refresh the manager view
		await showMcpManager(ctx);
	}

	// Add Server Dialog
	async function showAddServer(ctx: ExtensionContext): Promise<void> {
		// Get server type
		const serverType = await ctx.ui.select("Server type:", ["stdio (local command)", "sse (remote URL)"]);
		if (!serverType) return;

		const type = serverType.startsWith("stdio") ? "stdio" : "sse";

		// Get server name
		const name = await ctx.ui.input("Server name:", "my-server");
		if (!name) return;

		if (type === "stdio") {
			const command = await ctx.ui.input("Command:", "npx");
			if (!command) return;

			const argsStr = await ctx.ui.input(
				"Arguments (space-separated):",
				"-y @modelcontextprotocol/server-filesystem /tmp",
			);
			const args = argsStr?.split(/\s+/).filter(Boolean) ?? [];

			const config: McpServerConfig = {
				type: "stdio",
				command,
				args,
				enabled: true,
			};

			manager.addServer(name, config);
			ctx.ui.notify(`Added server: ${name}`, "info");

			// Try to connect
			try {
				await manager.connect(name);
				registerMcpTools();
				updateStatus(ctx);
				ctx.ui.notify(`Connected to ${name}`, "info");
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to connect: ${msg}`, "error");
			}
		} else {
			const url = await ctx.ui.input("Server URL:", "https://");
			if (!url) return;

			const config: McpServerConfig = {
				type: "sse",
				url,
				enabled: true,
			};

			manager.addServer(name, config);
			ctx.ui.notify(`Added server: ${name}`, "info");

			// Try to connect
			try {
				await manager.connect(name);
				registerMcpTools();
				updateStatus(ctx);
				ctx.ui.notify(`Connected to ${name}`, "info");
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to connect: ${msg}`, "error");
			}
		}
	}

	// Server Actions Dialog
	async function showServerActions(ctx: ExtensionContext, serverName: string): Promise<void> {
		const conn = manager.getServer(serverName);
		if (!conn) return;

		const state = conn.state;
		const isConnected = state.status === "connected";

		const actions = [isConnected ? "Disconnect" : "Connect", "View tools", "Test connection", "Remove"];

		const action = await ctx.ui.select(`${serverName}:`, actions);
		if (!action) return;

		switch (action) {
			case "Connect":
				try {
					await manager.connect(serverName);
					registerMcpTools();
					updateStatus(ctx);
					ctx.ui.notify(`Connected to ${serverName}`, "info");
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`Failed: ${msg}`, "error");
				}
				break;

			case "Disconnect":
				await manager.disconnect(serverName);
				updateStatus(ctx);
				ctx.ui.notify(`Disconnected from ${serverName}`, "info");
				break;

			case "View tools":
				await showServerTools(ctx, serverName);
				break;

			case "Test connection":
				ctx.ui.notify(`Testing ${serverName}...`, "info");
				try {
					await manager.disconnect(serverName);
					await manager.connect(serverName);
					registerMcpTools();
					updateStatus(ctx);
					ctx.ui.notify(`${serverName}: OK (${state.tools.length} tools)`, "info");
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`${serverName}: Failed - ${msg}`, "error");
				}
				break;

			case "Remove": {
				const confirm = await ctx.ui.confirm("Remove server?", `Remove ${serverName}?`);
				if (confirm) {
					await manager.removeServer(serverName);
					updateStatus(ctx);
					ctx.ui.notify(`Removed ${serverName}`, "info");
				}
				break;
			}
		}
	}

	// View Server Tools
	async function showServerTools(ctx: ExtensionContext, serverName: string): Promise<void> {
		const conn = manager.getServer(serverName);
		if (!conn) return;

		const tools = conn.state.tools;
		if (tools.length === 0) {
			ctx.ui.notify(`${serverName} has no tools`, "info");
			return;
		}

		const items: SelectItem[] = tools.map((t) => ({
			value: t.name,
			label: t.name,
			description: t.description ?? "(no description)",
		}));

		await ctx.ui.custom<void>((tui, theme, _kb, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
			container.addChild(new Text(theme.fg("accent", theme.bold(`Tools: ${serverName}`)), 1, 0));
			container.addChild(new Spacer(1));

			const selectList = new SelectList(items, Math.min(items.length + 2, 15), {
				selectedPrefix: (t) => theme.fg("accent", t),
				selectedText: (t) => theme.fg("accent", t),
				description: (t) => theme.fg("muted", t),
				scrollInfo: (t) => theme.fg("dim", t),
				noMatch: (t) => theme.fg("warning", t),
			});

			selectList.onSelect = () => done();
			selectList.onCancel = () => done();

			container.addChild(selectList);
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

			return {
				render: (w) => container.render(w),
				invalidate: () => container.invalidate(),
				handleInput: (data) => {
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		});
	}
}

// Helper functions

function getStatusIcon(status: McpServerState["status"]): string {
	switch (status) {
		case "connected":
			return "●";
		case "connecting":
			return "◐";
		case "error":
			return "✗";
		default:
			return "○";
	}
}

function getServerDescription(state: McpServerState): string {
	if (state.status === "error") {
		return state.error ?? "Connection error";
	}
	if (state.status === "connected") {
		return `${state.tools.length} tools`;
	}
	return state.config.type;
}

function formatToolResult(result: unknown): string {
	if (typeof result === "string") return result;
	if (result && typeof result === "object") {
		// MCP tool results have a content array
		const r = result as { content?: Array<{ type: string; text?: string }> };
		if (r.content) {
			return r.content
				.map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
				.filter(Boolean)
				.join("\n");
		}
	}
	return JSON.stringify(result, null, 2);
}

function convertJsonSchemaToTypebox(schema: Record<string, unknown>): Record<string, ReturnType<typeof Type.Any>> {
	// Simple conversion - for complex schemas, would need more work
	const result: Record<string, ReturnType<typeof Type.Any>> = {};

	const properties = schema.properties as Record<string, { type?: string; description?: string }> | undefined;
	if (properties) {
		for (const [key, prop] of Object.entries(properties)) {
			// Use Type.Any for simplicity - MCP tools accept JSON
			result[key] = Type.Any({ description: prop.description });
		}
	}

	return result;
}
