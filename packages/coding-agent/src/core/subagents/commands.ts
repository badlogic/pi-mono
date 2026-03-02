/**
 * Slash command registrations for subagents.
 *
 * @module subagents/commands
 */

import type { ExtensionAPI } from "../extensions/types.js";
import type { SubagentManager } from "./manager.js";

/**
 * Register all subagent slash commands with the extension API.
 */
export function registerSubagentCommands(pi: ExtensionAPI, manager: SubagentManager): void {
	// /agents - List all alive subagents
	pi.registerCommand("agents", {
		description: "List all alive subagents with status",

		getArgumentCompletions: (prefix: string) => {
			const agents = manager.listSubagents();
			const filtered = agents.filter((a) => a.id.startsWith(prefix) || a.name.startsWith(prefix));
			return filtered.map((a) => ({ value: a.id, label: `${a.id}: ${a.name}` }));
		},

		handler: async (args, ctx) => {
			const agents = manager.listSubagents();

			if (agents.length === 0) {
				ctx.ui.notify("No alive subagents. Start one with subagent_start tool.", "info");
				return;
			}

			// If argument provided, switch to that agent
			if (args.trim()) {
				const id = args.trim();
				const subagent = manager.getSubagent(id);
				if (subagent) {
					manager.setActiveSubagent(id);
					ctx.ui.notify(`Switched to subagent: ${subagent.name} (${id})`, "info");
					return;
				}
				ctx.ui.notify(`Subagent ${id} not found`, "error");
				return;
			}

			// Show selection dialog
			const options = agents.map((a) => `${a.id}: ${a.name} (${a.status})`);

			const selected = await ctx.ui.select("Alive Subagents:", options);

			if (selected) {
				// Extract the ID from the selected string (format: "id: name (status)")
				const id = selected.split(":")[0].trim();
				manager.setActiveSubagent(id);
				const subagent = manager.getSubagent(id);
				ctx.ui.notify(`Switched to subagent: ${subagent?.name ?? id}`, "info");
			}
		},
	});

	// /agent - Switch to subagent context or show current
	pi.registerCommand("agent", {
		description: "Switch to subagent for direct interaction",

		getArgumentCompletions: (prefix: string) => {
			const agents = manager.listSubagents();
			const filtered = agents.filter((a) => a.id.startsWith(prefix) || a.name.startsWith(prefix));
			return filtered.map((a) => ({ value: a.id, label: `${a.id}: ${a.name}` }));
		},

		handler: async (args, ctx) => {
			const id = args.trim();

			if (!id) {
				// Show current active subagent
				const activeId = manager.getActiveSubagent();
				if (activeId) {
					const subagent = manager.getSubagent(activeId);
					if (subagent) {
						ctx.ui.notify(`Active subagent: ${subagent.name} (${activeId}) - ${subagent.status}`, "info");
						return;
					}
				}

				// No active, show list
				const agents = manager.listSubagents();
				if (agents.length === 0) {
					ctx.ui.notify("No alive subagents. Start one with subagent_start tool.", "info");
				} else {
					ctx.ui.notify(`Alive agents: ${agents.map((a) => `${a.id}:${a.name}`).join(", ")}`, "info");
				}
				return;
			}

			const subagent = manager.getSubagent(id);
			if (!subagent) {
				ctx.ui.notify(`Subagent ${id} not found. Use /agents to list alive subagents.`, "error");
				return;
			}

			manager.setActiveSubagent(id);
			ctx.ui.notify(`Switched to subagent: ${subagent.name} (${id}) - ${subagent.status}`, "info");
		},
	});

	// /agent-send - Send message to active subagent
	pi.registerCommand("agent-send", {
		description: "Send message to the active subagent",

		handler: async (args, ctx) => {
			const activeId = manager.getActiveSubagent();

			if (!activeId) {
				ctx.ui.notify("No active subagent. Use /agent <id> to switch to a subagent.", "warning");
				return;
			}

			const message = args.trim();
			if (!message) {
				ctx.ui.notify("Usage: /agent-send <message>", "warning");
				return;
			}

			const subagent = manager.getSubagent(activeId);
			if (!subagent) {
				ctx.ui.notify(`Subagent ${activeId} no longer exists`, "error");
				manager.setActiveSubagent(undefined);
				return;
			}

			if (subagent.status === "done" || subagent.status === "stopped") {
				ctx.ui.notify(`Subagent ${activeId} is ${subagent.status}. Start a new one to send messages.`, "warning");
				return;
			}

			try {
				await manager.sendToSubagent(activeId, message);
				ctx.ui.notify(`Message sent to subagent ${activeId}`, "info");
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to send: ${msg}`, "error");
			}
		},
	});

	// /agent-output - View subagent output
	pi.registerCommand("agent-output", {
		description: "View the output from the active subagent",

		handler: async (args, ctx) => {
			const id = args.trim() || manager.getActiveSubagent();

			if (!id) {
				ctx.ui.notify("No active subagent. Use /agent <id> first.", "warning");
				return;
			}

			const subagent = manager.getSubagent(id);
			if (!subagent) {
				ctx.ui.notify(`Subagent ${id} not found`, "error");
				return;
			}

			const output = await manager.getSubagentOutput(id);

			// Show in editor for viewing
			const text = [
				`Subagent: ${subagent.name} (${id})`,
				`Status: ${output.status}`,
				`Turns: ${output.turnCount}`,
				`Tokens: ↑${output.usage.inputTokens} ↓${output.usage.outputTokens}`,
				"",
				"=".repeat(40),
				"OUTPUT",
				"=".repeat(40),
				"",
				output.output || "(no output)",
			].join("\n");

			const _viewed = await ctx.ui.editor("Subagent Output", text);
			// User closed the editor
		},
	});

	// /agent-kill - Kill a subagent
	pi.registerCommand("agent-kill", {
		description: "Stop an alive subagent",

		getArgumentCompletions: (prefix: string) => {
			const agents = manager.listSubagents();
			const filtered = agents.filter((a) => a.id.startsWith(prefix));
			return filtered.map((a) => ({ value: a.id, label: `${a.id}: ${a.name}` }));
		},

		handler: async (args, ctx) => {
			const id = args.trim() || manager.getActiveSubagent();

			if (!id) {
				ctx.ui.notify("Usage: /agent-kill <id>", "warning");
				return;
			}

			const subagent = manager.getSubagent(id);
			if (!subagent) {
				ctx.ui.notify(`Subagent ${id} not found`, "error");
				return;
			}

			const confirm = await ctx.ui.confirm(
				"Kill Subagent?",
				`Stop subagent ${id} (${subagent.name})? This cannot be undone.`,
			);

			if (confirm) {
				await manager.stopSubagent(id);
				if (manager.getActiveSubagent() === id) {
					manager.setActiveSubagent(undefined);
				}
				ctx.ui.notify(`Stopped subagent ${id}`, "info");
			}
		},
	});

	// /agent-list-configs - List available agent configurations
	pi.registerCommand("agent-list-configs", {
		description: "List available agent configurations (scout, planner, worker, etc.)",

		handler: async (_args, ctx) => {
			const configs = manager.getAvailableAgents();

			if (configs.length === 0) {
				ctx.ui.notify("No agent configurations found", "info");
				return;
			}

			const items = configs.map((c) => `${c.name}: ${c.description}`);

			const selected = await ctx.ui.select("Available Agents:", items);
			if (selected) {
				// Extract the name from the selected string (format: "name: description")
				const name = selected.split(":")[0].trim();
				const config = manager.getAgentConfig(name);
				if (config) {
					const info = [
						`Name: ${config.name}`,
						`Source: ${config.source}`,
						`Description: ${config.description}`,
						`Model: ${config.model ?? "default"}`,
						`Tools: ${config.tools?.join(", ") ?? "all"}`,
						`Memory: ${config.memory}`,
						"",
						"System Prompt:",
						"-".repeat(40),
						config.systemPrompt,
					].join("\n");

					await ctx.ui.editor(`Agent: ${config.name}`, info);
				}
			}
		},
	});
}
