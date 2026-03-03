/**
 * Subagent Extension for pi coding agent.
 *
 * This extension provides subagent functionality:
 * - Tools: subagent_start, subagent_send, subagent_list, subagent_stop, subagent_wait
 * - Commands: /agents, /agent, /agent-send, /agent-output, /agent-kill, /agent-list-configs
 * - Background subagent execution with completion notifications
 * - Footer/widget showing running subagents
 *
 * Usage:
 *   pi -e addons-extensions/subagent.ts
 *
 * Or add to settings.json:
 *   { "extensions": ["./addons-extensions/subagent.ts"] }
 *
 * @module extensions/subagent
 */

import type { ExtensionAPI, ExtensionContext, AgentTool } from "@mariozechner/pi-coding-agent";
import {
	SubagentManager,
	registerSubagentCommands,
	registerSubagentTools,
	type SubagentManagerConfig,
	type ToolFactory,
	type SubagentManagerEvent,
} from "@mariozechner/pi-coding-agent";
import { createAllTools } from "@mariozechner/pi-coding-agent";

/**
 * ToolFactory implementation that creates tools for a specific cwd.
 */
class ExtensionToolFactory implements ToolFactory {
	createSubset(toolNames: string[], cwd: string): AgentTool[] {
		const all = this.createAll(cwd);
		return all.filter((tool) => toolNames.includes(tool.name));
	}

	createAll(cwd: string): AgentTool[] {
		const tools = createAllTools(cwd);
		return Object.values(tools);
	}
}

// Manager instance (singleton per session)
let manager: SubagentManager | null = null;
let unsubscribeManager: (() => void) | null = null;

/**
 * Update the footer and widget to show running subagents.
 */
function updateSubagentDisplay(pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (!manager) return;

	const agents = manager.listSubagents();
	const running = agents.filter((a) => a.status === "running" || a.status === "starting");

	if (running.length === 0) {
		// Clear status when no subagents running
		ctx.ui.setStatus("subagents", undefined);
		ctx.ui.setWidget("subagents", undefined);
		return;
	}

	// Update footer status
	const statusText = running.map((a) => `${a.name} (${a.status.slice(0, 4)})`).join(", ");
	ctx.ui.setStatus("subagents", `Subagents: ${statusText}`);

	// Update widget above editor
	const widgetLines = [
		`▶ ${running.length} subagent${running.length > 1 ? "s" : ""} running:`,
		...running.map((a) => {
			const taskPreview = a.task.length > 50 ? `${a.task.slice(0, 50)}...` : a.task;
			return `  ${a.id}: ${a.name} - ${taskPreview}`;
		}),
	];
	ctx.ui.setWidget("subagents", widgetLines);
}

/**
 * Clear subagent display.
 */
function clearSubagentDisplay(ctx: ExtensionContext): void {
	ctx.ui.setStatus("subagents", undefined);
	ctx.ui.setWidget("subagents", undefined);
}

/**
 * Send subagent completion result to main window.
 */
function notifySubagentComplete(pi: ExtensionAPI, event: SubagentManagerEvent): void {
	if (event.type !== "stopped") return;

	const subagent = manager?.getSubagent(event.subagentId);
	if (!subagent) return;

	// Get the output
	const output = subagent.messageHistory
		.filter((m) => m.role === "assistant")
		.map((m) => m.content)
		.join("\n\n");

	// Send notification to main window
	pi.sendMessage(
		{
			customType: "subagent_complete",
			content: `Subagent '${subagent.name}' (${event.subagentId}) completed with status: ${event.reason}\n\n${output || "(no output)"}`,
			display: true,
			details: {
				subagentId: event.subagentId,
				name: subagent.name,
				reason: event.reason,
				output,
				usage: subagent.usage,
			},
		},
		{ triggerTurn: true },
	);
}

/**
 * Subagent extension entry point.
 */
export default function (pi: ExtensionAPI) {
	// Create SubagentManager on session start
	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		// Create ToolFactory
		const toolFactory = new ExtensionToolFactory();

		// Create SubagentManager config
		const config: SubagentManagerConfig = {
			cwd: ctx.cwd,
			modelRegistry: ctx.modelRegistry,
			toolFactory,
			maxConcurrent: 4,
			defaultMode: "in-memory",
			defaultTimeout: 300000, // 5 minutes
		};

		// Create manager
		manager = new SubagentManager(config);

		// Subscribe to manager events
		unsubscribeManager = manager.on((event) => {
			// Update display on status changes
			if (event.type === "started" || event.type === "status") {
				updateSubagentDisplay(pi, ctx);
			}

			// Send completion notification to main window
			if (event.type === "stopped") {
				notifySubagentComplete(pi, event);
				updateSubagentDisplay(pi, ctx);
			}
		});

		// Register tools and commands
		registerSubagentTools(pi, manager);
		registerSubagentCommands(pi, manager);
	});

	// Cleanup on session shutdown
	pi.on("session_shutdown", async () => {
		if (unsubscribeManager) {
			unsubscribeManager();
			unsubscribeManager = null;
		}
		if (manager) {
			await manager.dispose();
			manager = null;
		}
	});
}
