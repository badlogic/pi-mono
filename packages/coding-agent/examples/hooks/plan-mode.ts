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
 * - Extracts todo list from plan and tracks progress during execution
 * - Uses smart matching to track progress (no ugly IDs shown to user)
 *
 * Usage:
 * 1. Copy this file to ~/.pi/agent/hooks/ or your project's .pi/hooks/
 * 2. Use /plan to toggle plan mode on/off
 * 3. Or start in plan mode with --plan flag
 */

import type { HookAPI, HookContext } from "@mariozechner/pi-coding-agent/hooks";

// Read-only tools for plan mode
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls"];

// Full set of tools for normal mode
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];

// Patterns for destructive bash commands that should be blocked in plan mode
const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/[^<]>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout\s+-b|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
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
	/^\s*curl\s/i,
	/^\s*wget\s+-O\s*-/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*bat\b/,
	/^\s*exa\b/,
];

function isSafeCommand(command: string): boolean {
	if (SAFE_COMMANDS.some((pattern) => pattern.test(command))) {
		if (!DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command))) {
			return true;
		}
	}
	if (DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command))) {
		return false;
	}
	return true;
}

// Todo item
interface TodoItem {
	text: string;
	completed: boolean;
	// Keywords extracted for matching
	keywords: string[];
}

/**
 * Extract significant keywords from text for matching.
 */
function extractKeywords(text: string): string[] {
	// Remove common words and extract significant terms
	const stopWords = new Set([
		"the",
		"a",
		"an",
		"to",
		"for",
		"of",
		"in",
		"on",
		"at",
		"by",
		"with",
		"using",
		"and",
		"or",
		"use",
		"run",
		"execute",
		"create",
		"make",
		"do",
		"then",
		"next",
		"step",
		"first",
		"second",
		"third",
		"finally",
		"it",
		"its",
		"this",
		"that",
		"from",
		"into",
	]);

	return text
		.toLowerCase()
		.replace(/[^a-z0-9/._-]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 2 && !stopWords.has(w));
}

/**
 * Extract todo items from assistant message.
 */
function extractTodoItems(message: string): TodoItem[] {
	const items: TodoItem[] = [];

	// Match numbered lists: "1. Task" or "1) Task"
	const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;
	for (const match of message.matchAll(numberedPattern)) {
		let text = match[2].trim();
		text = text.replace(/\*{1,2}$/, "").trim();
		if (text.length > 5 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
			items.push({
				text,
				completed: false,
				keywords: extractKeywords(text),
			});
		}
	}

	// If no numbered items, try bullet points
	if (items.length === 0) {
		const stepPattern = /^\s*[-*]\s*(?:Step\s*\d+[:.])?\s*\*{0,2}([^*\n]+)/gim;
		for (const match of message.matchAll(stepPattern)) {
			let text = match[1].trim();
			text = text.replace(/\*{1,2}$/, "").trim();
			if (text.length > 10 && !text.startsWith("`")) {
				items.push({
					text,
					completed: false,
					keywords: extractKeywords(text),
				});
			}
		}
	}

	return items;
}

/**
 * Calculate similarity between tool action and todo item.
 * Returns a score from 0 to 1.
 */
function matchScore(todoKeywords: string[], actionText: string): number {
	if (todoKeywords.length === 0) return 0;

	const actionLower = actionText.toLowerCase();
	let matches = 0;

	for (const keyword of todoKeywords) {
		if (actionLower.includes(keyword)) {
			matches++;
		}
	}

	return matches / todoKeywords.length;
}

/**
 * Find the best matching uncompleted todo for a tool action.
 * Uses keyword matching with a preference for sequential order.
 */
function findBestMatch(todos: TodoItem[], toolName: string, input: Record<string, unknown>): number {
	// Build action text from tool name and input
	let actionText = toolName;
	if (input.path) actionText += ` ${input.path}`;
	if (input.command) actionText += ` ${input.command}`;
	if (input.content) actionText += ` ${String(input.content).slice(0, 100)}`;

	let bestIdx = -1;
	let bestScore = 0.3; // Minimum threshold

	for (let i = 0; i < todos.length; i++) {
		if (todos[i].completed) continue;

		const score = matchScore(todos[i].keywords, actionText);

		// Bonus for being the first uncompleted item (sequential preference)
		const isFirstUncompleted = !todos.slice(0, i).some((t) => !t.completed);
		const adjustedScore = isFirstUncompleted ? score + 0.1 : score;

		if (adjustedScore > bestScore) {
			bestScore = adjustedScore;
			bestIdx = i;
		}
	}

	return bestIdx;
}

export default function planModeHook(pi: HookAPI) {
	let planModeEnabled = false;
	let executionMode = false;
	let todoItems: TodoItem[] = [];

	// Register --plan CLI flag
	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	// Helper to update status displays
	function updateStatus(ctx: HookContext) {
		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		// Show widget during execution
		if (executionMode && todoItems.length > 0) {
			const lines: string[] = [];
			for (const item of todoItems) {
				if (item.completed) {
					lines.push(
						ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text)),
					);
				} else {
					lines.push(ctx.ui.theme.fg("muted", "☐ ") + item.text);
				}
			}
			ctx.ui.setWidget("plan-todos", lines);
		} else {
			ctx.ui.setWidget("plan-todos", undefined);
		}
	}

	function togglePlanMode(ctx: HookContext) {
		planModeEnabled = !planModeEnabled;
		executionMode = false;
		todoItems = [];

		if (planModeEnabled) {
			pi.setActiveTools(PLAN_MODE_TOOLS);
			ctx.ui.notify(`Plan mode enabled. Tools: ${PLAN_MODE_TOOLS.join(", ")}`);
		} else {
			pi.setActiveTools(NORMAL_MODE_TOOLS);
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

	// Register /todos command
	pi.registerCommand("todos", {
		description: "Show current plan todo list",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No todos. Create a plan first with /plan", "info");
				return;
			}

			const todoList = todoItems
				.map((item, i) => {
					const checkbox = item.completed ? "✓" : "○";
					return `${i + 1}. ${checkbox} ${item.text}`;
				})
				.join("\n");

			ctx.ui.notify(`Plan Progress:\n${todoList}`, "info");
		},
	});

	// Register Shift+P shortcut
	pi.registerShortcut("shift+p", {
		description: "Toggle plan mode",
		handler: async (ctx) => {
			togglePlanMode(ctx);
		},
	});

	// Block destructive bash in plan mode
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

	// Track progress via tool results
	pi.on("tool_result", async (event, ctx) => {
		if (!executionMode || todoItems.length === 0) return;
		if (event.isError) return;

		// Find best matching todo item
		const matchIdx = findBestMatch(todoItems, event.toolName, event.input);
		if (matchIdx >= 0 && !todoItems[matchIdx].completed) {
			todoItems[matchIdx].completed = true;
			updateStatus(ctx);
		}
	});

	// Inject plan mode context
	pi.on("before_agent_start", async () => {
		if (!planModeEnabled && !executionMode) return;

		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
- You can only use: read, bash, grep, find, ls
- You CANNOT use: edit, write (file modifications are disabled)
- Bash is restricted to READ-ONLY commands
- Focus on analysis, planning, and understanding the codebase

Create a detailed numbered plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes - just describe what you would do.`,
					display: false,
				},
			};
		}

		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN - ${completed}/${todoItems.length} complete]
Continue executing the plan step by step.`,
					display: false,
				},
			};
		}
	});

	// After agent finishes
	pi.on("agent_end", async (event, ctx) => {
		// Check if all complete
		if (executionMode && todoItems.length > 0) {
			const allComplete = todoItems.every((t) => t.completed);
			if (allComplete) {
				// Show final completed list in chat
				const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
				pi.sendMessage(
					{
						customType: "plan-complete",
						content: `**Plan Complete!** ✓\n\n${completedList}`,
						display: true,
					},
					{ triggerTurn: false },
				);

				executionMode = false;
				todoItems = [];
				pi.setActiveTools(NORMAL_MODE_TOOLS);
				updateStatus(ctx);
			}
			return;
		}

		if (!planModeEnabled) return;
		if (!ctx.hasUI) return;

		// Extract todos from last message
		const messages = event.messages;
		const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
		if (lastAssistant && Array.isArray(lastAssistant.content)) {
			const textContent = lastAssistant.content
				.filter((block): block is { type: "text"; text: string } => block.type === "text")
				.map((block) => block.text)
				.join("\n");

			if (textContent) {
				const extracted = extractTodoItems(textContent);
				if (extracted.length > 0) {
					todoItems = extracted;
				}
			}
		}

		const hasTodos = todoItems.length > 0;

		// Show todo list in chat (no IDs, just numbered)
		if (hasTodos) {
			const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
			pi.sendMessage(
				{
					customType: "plan-todo-list",
					content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
					display: true,
				},
				{ triggerTurn: false },
			);
		}

		const choice = await ctx.ui.select("Plan mode - what next?", [
			hasTodos ? "Execute the plan (track progress)" : "Execute the plan",
			"Stay in plan mode",
			"Refine the plan",
		]);

		if (choice?.startsWith("Execute")) {
			planModeEnabled = false;
			executionMode = hasTodos;
			pi.setActiveTools(NORMAL_MODE_TOOLS);
			updateStatus(ctx);

			const execMessage = hasTodos
				? `Execute the plan step by step. Start with: ${todoItems[0].text}`
				: "Execute the plan you just created. Proceed step by step.";

			pi.sendMessage(
				{
					customType: "plan-mode-execute",
					content: execMessage,
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
	});

	// Initialize state on session start
	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: { enabled: boolean; todos?: TodoItem[]; executing?: boolean } } | undefined;

		if (planModeEntry?.data) {
			if (planModeEntry.data.enabled !== undefined) {
				planModeEnabled = planModeEntry.data.enabled;
			}
			if (planModeEntry.data.todos) {
				todoItems = planModeEntry.data.todos;
			}
			if (planModeEntry.data.executing) {
				executionMode = planModeEntry.data.executing;
			}
		}

		if (planModeEnabled) {
			pi.setActiveTools(PLAN_MODE_TOOLS);
		}
		updateStatus(ctx);
	});

	// Persist state
	pi.on("turn_start", async () => {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			todos: todoItems,
			executing: executionMode,
		});
	});
}
