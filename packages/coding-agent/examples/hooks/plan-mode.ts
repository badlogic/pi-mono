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
 * - Shows "plan" indicator in footer when active
 *
 * Usage:
 * 1. Copy this file to ~/.pi/agent/hooks/ or your project's .pi/hooks/
 * 2. Use /plan to toggle plan mode on/off
 * 3. Or start in plan mode: PI_PLAN_MODE=1 pi
 */

import type { HookAPI, HookContext } from "@mariozechner/pi-coding-agent/hooks";

// Read-only tools for plan mode
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls"];

// Full set of tools for normal mode
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];

// Patterns for destructive bash commands that should be blocked in plan mode
const DESTRUCTIVE_PATTERNS = [
	// File/directory modification
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i, // cp can overwrite files
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i, // symlinks
	// File content modification
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	// Redirects that write to files
	/[^<]>(?!>)/, // > but not >> or <>
	/>>/, // append
	// Package managers / installers
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	// Git write operations
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout\s+-b|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	// Other dangerous commands
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	// Editors (interactive, could modify files)
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

// Read-only commands that are always safe
const SAFE_COMMANDS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+--version/i,
	/^\s*python\s+--version/i,
	/^\s*curl\s/i, // curl without -o is usually safe (reading)
	/^\s*wget\s+-O\s*-/i, // wget to stdout only
	/^\s*jq\b/,
	/^\s*sed\s+-n/i, // sed with -n (no auto-print) for reading only
	/^\s*awk\b/,
	/^\s*rg\b/, // ripgrep
	/^\s*fd\b/, // fd-find
	/^\s*bat\b/, // bat (cat clone)
	/^\s*exa\b/, // exa (ls clone)
];

/**
 * Check if a bash command is safe (read-only) for plan mode.
 */
function isSafeCommand(command: string): boolean {
	// Check if it's an explicitly safe command
	if (SAFE_COMMANDS.some((pattern) => pattern.test(command))) {
		// But still check for destructive patterns (e.g., cat > file)
		if (!DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command))) {
			return true;
		}
	}

	// Check for destructive patterns
	if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command))) {
		return false;
	}

	// Allow commands that don't match any destructive pattern
	// This is permissive - unknown commands are allowed
	return true;
}

export default function planModeHook(pi: HookAPI) {
	// Track plan mode state
	let planModeEnabled = false;

	// Register --plan CLI flag
	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	// Helper to update footer status
	function updateStatus(ctx: HookContext) {
		if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}
	}

	// Helper to toggle plan mode
	function togglePlanMode(ctx: HookContext) {
		planModeEnabled = !planModeEnabled;

		if (planModeEnabled) {
			pi.setTools(PLAN_MODE_TOOLS);
			ctx.ui.notify(`Plan mode enabled. Tools: ${PLAN_MODE_TOOLS.join(", ")}`);
		} else {
			pi.setTools(NORMAL_MODE_TOOLS);
			ctx.ui.notify("Plan mode disabled. Full access restored.");
		}
		updateStatus(ctx);
	}

	// Register /plan command
	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => {
			togglePlanMode(ctx);
		},
	});

	// Register Shift+P shortcut
	pi.registerShortcut("shift+p", {
		description: "Toggle plan mode",
		handler: async (ctx) => {
			togglePlanMode(ctx);
		},
	});

	// Block destructive bash commands in plan mode
	pi.on("tool_call", async (event) => {
		if (!planModeEnabled) return;
		if (event.toolName !== "bash") return;

		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Plan mode: destructive command blocked. Use /plan to disable plan mode first.\nCommand: ${command}`,
			};
		}
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
- You can only use: read, bash, grep, find, ls
- You CANNOT use: edit, write (file modifications are disabled)
- Bash is restricted to READ-ONLY commands (cat, ls, grep, git status, etc.)
- Destructive bash commands are BLOCKED (rm, mv, cp, git commit, npm install, etc.)
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
			updateStatus(ctx);

			// Send message to trigger execution immediately
			pi.sendMessage(
				{
					customType: "plan-mode-execute",
					content: "Execute the plan you just created. Proceed step by step.",
					display: true,
				},
				{ triggerTurn: true },
			);
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.input("What should be refined?");
			if (refinement) {
				ctx.ui.setEditorText(refinement);
			}
		}
		// "Stay in plan mode" - do nothing, just continue
	});

	// Initialize plan mode state on session start
	pi.on("session_start", async (_event, ctx) => {
		// Check --plan flag first
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		// Check if there's persisted plan mode state (from previous session)
		const entries = ctx.sessionManager.getEntries();
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: { enabled: boolean } } | undefined;

		// Restore from session (overrides flag if session has state)
		if (planModeEntry?.data?.enabled !== undefined) {
			planModeEnabled = planModeEntry.data.enabled;
		}

		// Apply initial state if plan mode is enabled
		if (planModeEnabled) {
			pi.setTools(PLAN_MODE_TOOLS);
			updateStatus(ctx);
		}
	});

	// Save state when plan mode changes (via tool_call or other events)
	pi.on("turn_start", async () => {
		// Persist current state
		pi.appendEntry("plan-mode", { enabled: planModeEnabled });
	});
}
