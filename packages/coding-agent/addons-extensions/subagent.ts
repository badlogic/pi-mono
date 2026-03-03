/**
 * Subagent Extension for pi coding agent.
 *
 * This extension provides subagent functionality:
 * - Tools: subagent_start, subagent_send, subagent_list, subagent_stop
 * - Commands: /agents, /agent, /agent-send, /agent-output, /agent-kill, /agent-list-configs
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
} from "@mariozechner/pi-coding-agent";
import { createAllTools } from "@mariozechner/pi-coding-agent";

/**
 * ToolFactory implementation that creates tools for a specific cwd.
 *
 * This factory uses createAllTools(cwd) to create fresh tool instances
 * for each subagent, ensuring correct path resolution.
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
			// Optional settings
			maxConcurrent: 4,
			defaultMode: "in-memory",
			defaultTimeout: 300000, // 5 minutes
		};

		// Create manager
		manager = new SubagentManager(config);

		// Register tools and commands (passing manager via closure)
		registerSubagentTools(pi, manager);
		registerSubagentCommands(pi, manager);
	});

	// Cleanup on session shutdown
	pi.on("session_shutdown", async () => {
		if (manager) {
			await manager.dispose();
			manager = null;
		}
	});
}
