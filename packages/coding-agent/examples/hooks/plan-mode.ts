/**
 * Plan Mode Hook
 *
 * Provides a Claude Code-style "plan mode" for safe code exploration.
 * When enabled, the agent can only use read-only tools and cannot modify files.
 *
 * Features:
 * - /plan command to toggle plan mode
 * - In plan mode: only read, bash (read-only), grep, find, ls are available
 * - Injects system context telling the agent about the restrictions
 * - After each agent response, prompts to execute the plan or continue planning
 *
 * Usage:
 * 1. Copy this file to ~/.pi/agent/hooks/ or your project's .pi/hooks/
 * 2. Use /plan to toggle plan mode on/off
 */

import type { HookAPI } from "@mariozechner/pi-coding-agent/hooks";

// Read-only tools for plan mode
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls"];

// Full set of tools for normal mode
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];

export default function planModeHook(pi: HookAPI) {
	// Track plan mode state
	let planModeEnabled = false;

	// Register /plan command
	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => {
			planModeEnabled = !planModeEnabled;

			if (planModeEnabled) {
				// Switch to read-only tools
				pi.setTools(PLAN_MODE_TOOLS);
				ctx.ui.notify(`Plan mode enabled. Tools: ${PLAN_MODE_TOOLS.join(", ")}`);
			} else {
				// Switch back to normal tools
				pi.setTools(NORMAL_MODE_TOOLS);
				ctx.ui.notify("Plan mode disabled. Full access restored.");
			}
		},
	});

	// Inject plan mode context at the start of each turn via before_agent_start
	pi.on("before_agent_start", async () => {
		if (!planModeEnabled) return;

		// Return a message to inject into context
		return {
			message: {
				customType: "plan-mode-context",
				content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
- You can only use: read, bash (read-only commands), grep, find, ls
- You CANNOT use: edit, write (file modifications are disabled)
- Focus on analysis, planning, and understanding the codebase

Your task is to explore, analyze, and create a detailed plan.
Do NOT attempt to make changes - just describe what you would do.
When you have a complete plan, I will switch to normal mode to execute it.`,
				display: false, // Don't show in TUI, just inject into context
			},
		};
	});

	// After agent finishes, offer to execute the plan
	pi.on("agent_end", async (_event, ctx) => {
		if (!planModeEnabled) return;
		if (!ctx.hasUI) return;

		const choice = await ctx.ui.select("Plan mode - what next?", [
			"Execute the plan",
			"Stay in plan mode",
			"Refine the plan",
		]);

		if (choice === "Execute the plan") {
			// Switch to normal mode
			planModeEnabled = false;
			pi.setTools(NORMAL_MODE_TOOLS);
			ctx.ui.notify("Switched to normal mode. Full access restored.");

			// Set editor text to prompt execution
			ctx.ui.setEditorText("Execute the plan you just created. Proceed step by step.");
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.input("What should be refined?");
			if (refinement) {
				ctx.ui.setEditorText(refinement);
			}
		}
		// "Stay in plan mode" - do nothing, just continue
	});

	// Persist plan mode state across sessions
	pi.on("session_start", async (_event, ctx) => {
		// Check if there's persisted plan mode state
		const entries = ctx.sessionManager.getEntries();
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: { enabled: boolean } } | undefined;

		if (planModeEntry?.data?.enabled) {
			planModeEnabled = true;
			pi.setTools(PLAN_MODE_TOOLS);
		}
	});

	// Save state when plan mode changes (via tool_call or other events)
	pi.on("turn_start", async () => {
		// Persist current state
		pi.appendEntry("plan-mode", { enabled: planModeEnabled });
	});
}
