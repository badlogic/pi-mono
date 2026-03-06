/**
 * Task Board Extension
 *
 * A persistent, branch-aware task board for the pi coding agent.
 * State is stored in tool result details and taskboard snapshots so it correctly
 * follows session branching, including auto-tracked subagent dispatches.
 *
 * LLM tool: `task` — add, set_status, set_priority, list, remove, clear_done
 * Slash commands: /tasks (interactive board), /task-add, /task-done, /task-clear
 * Widget: live board below editor showing active tasks
 * Footer: "N tasks · M in progress"
 *
 * Usage:
 *   pi -e addons-extensions/taskboard.ts
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// ── Types ─────────────────────────────────────────────────────────────────────

type TaskStatus = "todo" | "in-progress" | "done" | "blocked";
type TaskPriority = "low" | "medium" | "high" | "critical";

interface Task {
	id: number;
	text: string;
	status: TaskStatus;
	priority: TaskPriority;
	category?: string;
	createdAt: number;
	updatedAt: number;
}

interface TaskDetails {
	action: string;
	tasks: Task[];
	nextId: number;
	error?: string;
}

interface TaskboardSnapshot {
	version: 1;
	tasks: Task[];
	nextId: number;
}

// ── In-memory state ───────────────────────────────────────────────────────────

let tasks: Task[] = [];
let nextId = 1;
const autoToolTaskByCallId = new Map<string, number>();

// ── Helpers ───────────────────────────────────────────────────────────────────

const TASKBOARD_SNAPSHOT_TYPE = "taskboard-state";
const SUBAGENT_CREATE_TOOL = "subagent_create";
const NON_COMPLEX_TOOLS = new Set(["task", "read", "grep", "find", "ls"]);
const VALID_STATUSES: TaskStatus[] = ["todo", "in-progress", "done", "blocked"];
const VALID_PRIORITIES: TaskPriority[] = ["low", "medium", "high", "critical"];

const STATUS_ICONS: Record<TaskStatus, string> = {
	"todo": "○",
	"in-progress": "●",
	"done": "✓",
	"blocked": "✗",
};

const PRIORITY_ORDER: Record<TaskPriority, number> = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
};

function sortedTasks(ts: Task[]): Task[] {
	return [...ts].sort((a, b) => {
		const aDone = a.status === "done" ? 1 : 0;
		const bDone = b.status === "done" ? 1 : 0;
		if (aDone !== bDone) return aDone - bDone;
		return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
	});
}

function cloneTasks(ts: Task[]): Task[] {
	return ts.map((task) => ({ ...task }));
}

function isTaskStatus(value: unknown): value is TaskStatus {
	return typeof value === "string" && (VALID_STATUSES as string[]).includes(value);
}

function isTaskPriority(value: unknown): value is TaskPriority {
	return typeof value === "string" && (VALID_PRIORITIES as string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTask(value: unknown): value is Task {
	if (!isRecord(value)) return false;
	const category = value.category;
	return (
		typeof value.id === "number" &&
		typeof value.text === "string" &&
		isTaskStatus(value.status) &&
		isTaskPriority(value.priority) &&
		(category === undefined || typeof category === "string") &&
		typeof value.createdAt === "number" &&
		typeof value.updatedAt === "number"
	);
}

function isTaskSnapshot(value: unknown): value is TaskboardSnapshot {
	if (!isRecord(value)) return false;
	return (
		value.version === 1 &&
		Array.isArray(value.tasks) &&
		value.tasks.every((task) => isTask(task)) &&
		typeof value.nextId === "number"
	);
}

function summarizeSubagentBrief(raw: string): string {
	const compact = raw.replace(/\s+/g, " ").trim();
	if (!compact) return "Subagent task";
	if (compact.length <= 140) return compact;
	return `${compact.slice(0, 137)}...`;
}

function summarizeToolCall(toolName: string, input: unknown): string {
	if (toolName === "bash") {
		if (isRecord(input) && typeof input.command === "string") {
			const compact = input.command.replace(/\s+/g, " ").trim();
			if (compact.length === 0) return "Bash task";
			return compact.length <= 140 ? compact : `${compact.slice(0, 137)}...`;
		}
		return "Bash task";
	}

	if (isRecord(input) && typeof input.path === "string" && input.path.trim().length > 0) {
		const verb = toolName === "edit" ? "Edit" : toolName === "write" ? "Write" : "Update";
		return `${verb} ${input.path.trim()}`;
	}

	return `Complex ${toolName} task`;
}

function getActiveTask(): Task | undefined {
	return tasks.find((task) => task.status === "in-progress");
}

function addSubagentDispatchTask(brief: string): void {
	const now = Date.now();
	tasks.push({
		id: nextId++,
		text: summarizeSubagentBrief(brief),
		status: "in-progress",
		priority: "high",
		category: "subagent",
		createdAt: now,
		updatedAt: now,
	});
}

function ensureActiveTaskForToolCall(toolName: string, input: unknown): number | undefined {
	const now = Date.now();
	if (getActiveTask()) return undefined;

	const pending = sortedTasks(tasks.filter((task) => task.status !== "done"));
	if (pending.length > 0) {
		pending[0].status = "in-progress";
		pending[0].updatedAt = now;
		return undefined;
	}

	const task: Task = {
		id: nextId++,
		text: summarizeToolCall(toolName, input),
		status: "in-progress",
		priority: "medium",
		category: "auto",
		createdAt: now,
		updatedAt: now,
	};
	tasks.push(task);
	return task.id;
}

function statusColor(status: TaskStatus, theme: Theme): string {
	switch (status) {
		case "todo": return theme.fg("dim", STATUS_ICONS[status]);
		case "in-progress": return theme.fg("accent", STATUS_ICONS[status]);
		case "done": return theme.fg("success", STATUS_ICONS[status]);
		case "blocked": return theme.fg("error", STATUS_ICONS[status]);
	}
}

function priorityLabel(priority: TaskPriority, theme: Theme): string {
	switch (priority) {
		case "critical": return theme.fg("error", "[critical]");
		case "high": return theme.fg("warning", "[high]");
		case "medium": return "";
		case "low": return theme.fg("dim", "[low]");
	}
}

// ── Rebuild state from session entries ───────────────────────────────────────

function reconstructState(ctx: ExtensionContext): void {
	tasks = [];
	nextId = 1;
	autoToolTaskByCallId.clear();
	const entries = ctx.sessionManager.getBranch();
	if (!Array.isArray(entries)) return;
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === TASKBOARD_SNAPSHOT_TYPE) {
			const snapshot = entry.data;
			if (isTaskSnapshot(snapshot)) {
				tasks = cloneTasks(snapshot.tasks);
				nextId = snapshot.nextId;
			}
			continue;
		}
		if (entry.type === "message") {
			const msg = entry.message;
			if (msg.role !== "toolResult" || msg.toolName !== "task") continue;
			const details = msg.details as TaskDetails | undefined;
			if (details && !details.error && Array.isArray(details.tasks) && typeof details.nextId === "number") {
				tasks = cloneTasks(details.tasks);
				nextId = details.nextId;
			}
		}
	}
}

// ── Widget ────────────────────────────────────────────────────────────────────

function updateWidget(ctx: ExtensionContext): void {
	const active = sortedTasks(tasks.filter((t) => t.status !== "done"));
	const total = tasks.length;
	const done = tasks.filter((t) => t.status === "done").length;
	const inProgress = tasks.filter((t) => t.status === "in-progress").length;
	const blocked = tasks.filter((t) => t.status === "blocked").length;

	if (active.length === 0) {
		ctx.ui.setWidget("taskboard", undefined);
		ctx.ui.setStatus("tasks", total > 0 ? `${total}/${total} done` : undefined);
		return;
	}

	// Footer
	const parts = [`${total} task${total !== 1 ? "s" : ""}`];
	if (inProgress > 0) parts.push(`${inProgress} in progress`);
	if (blocked > 0) parts.push(`${blocked} blocked`);
	if (done > 0) parts.push(`${done} done`);
	ctx.ui.setStatus("tasks", parts.join(" · "));

	// Widget as string[] (simple, reliable)
	const lines: string[] = [];
	// lines are built at render time via factory form
	ctx.ui.setWidget("taskboard", (_tui, theme) => {
		return {
			render(width: number): string[] {
				const out: string[] = [];
				out.push(theme.fg("borderMuted", "─".repeat(width)));

				const display = active.slice(0, 6);
				for (const task of display) {
					const icon = statusColor(task.status, theme);
					const id = theme.fg("dim", `#${task.id}`);
					const pri = priorityLabel(task.priority, theme);
					const cat = task.category ? theme.fg("dim", ` [${task.category}]`) : "";
					const maxTxt = width - 16;
					const txt = task.status === "done"
						? theme.fg("dim", truncateToWidth(task.text, maxTxt))
						: theme.fg("text", truncateToWidth(task.text, maxTxt));
					out.push(truncateToWidth(` ${icon} ${id}${pri ? " " + pri : ""}${cat} ${txt}`, width));
				}

				if (active.length > 6) {
					out.push(theme.fg("dim", ` ... ${active.length - 6} more — /tasks to view all`));
				}

				out.push(theme.fg("borderMuted", "─".repeat(width)));
				return out;
			},
			invalidate() {},
		};
	}, { placement: "belowEditor" });

	// suppress unused warning
	void lines;
}

// ── Interactive board ─────────────────────────────────────────────────────────

class TaskBoardComponent {
	private items: Task[];
	private theme: Theme;
	private onClose: () => void;
	private selectedIdx = 0;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(items: Task[], theme: Theme, onClose: () => void) {
		this.items = sortedTasks(items);
		this.theme = theme;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") {
			this.onClose();
			return;
		}
		const len = this.items.length;
		if (len === 0) return;
		if (matchesKey(data, "up") || data === "k") {
			this.selectedIdx = Math.max(0, this.selectedIdx - 1);
			this.cachedLines = undefined;
		}
		if (matchesKey(data, "down") || data === "j") {
			this.selectedIdx = Math.min(len - 1, this.selectedIdx + 1);
			this.cachedLines = undefined;
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const th = this.theme;
		const lines: string[] = [];

		lines.push("");
		const title = " Task Board ";
		const sides = Math.max(0, Math.floor((width - title.length) / 2));
		lines.push(
			th.fg("borderMuted", "─".repeat(sides)) +
			th.fg("accent", title) +
			th.fg("borderMuted", "─".repeat(Math.max(0, width - sides - title.length)))
		);
		lines.push("");

		const done = this.items.filter((t) => t.status === "done").length;
		const total = this.items.length;
		const pct = total > 0 ? Math.round((done / total) * 100) : 0;
		const barW = Math.min(28, width - 18);
		const filled = Math.round((pct / 100) * barW);
		const bar = th.fg("success", "█".repeat(filled)) + th.fg("dim", "░".repeat(barW - filled));
		lines.push(truncateToWidth(`  ${bar}  ${th.fg("muted", `${done}/${total} done (${pct}%)`)}`, width));
		lines.push("");

		if (this.items.length === 0) {
			lines.push(truncateToWidth(`  ${th.fg("dim", "No tasks yet.")}`, width));
		}

		const groups: { label: string; statuses: TaskStatus[] }[] = [
			{ label: "In Progress", statuses: ["in-progress"] },
			{ label: "Blocked", statuses: ["blocked"] },
			{ label: "Todo", statuses: ["todo"] },
			{ label: "Done", statuses: ["done"] },
		];

		let globalIdx = 0;
		for (const group of groups) {
			const groupItems = this.items.filter((t) => group.statuses.includes(t.status));
			if (groupItems.length === 0) continue;

			lines.push(truncateToWidth(`  ${th.fg("muted", group.label.toUpperCase())}`, width));
			for (const task of groupItems) {
				const isSelected = globalIdx === this.selectedIdx;
				const icon = statusColor(task.status, th);
				const id = th.fg("dim", `#${task.id}`);
				const pri = priorityLabel(task.priority, th);
				const cat = task.category ? th.fg("dim", ` [${task.category}]`) : "";
				const maxTxt = width - 16;
				const txt = task.status === "done"
					? th.fg("dim", truncateToWidth(task.text, maxTxt))
					: isSelected
						? th.fg("text", truncateToWidth(task.text, maxTxt))
						: th.fg("muted", truncateToWidth(task.text, maxTxt));
				const prefix = isSelected ? th.fg("accent", "▶") : " ";
				lines.push(truncateToWidth(`  ${prefix} ${icon} ${id}${pri ? " " + pri : ""}${cat} ${txt}`, width));
				globalIdx++;
			}
			lines.push("");
		}

		lines.push(th.fg("borderMuted", "─".repeat(width)));
		lines.push(truncateToWidth(`  ${th.fg("dim", "↑/↓  navigate    Esc  close")}`, width));
		lines.push("");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedLines = undefined;
	}
}

// ── Extension ─────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const persistSnapshot = (): void => {
		pi.appendEntry(TASKBOARD_SNAPSHOT_TYPE, {
			version: 1,
			tasks: cloneTasks(tasks),
			nextId,
		} satisfies TaskboardSnapshot);
	};

	// Rebuild state on all session events that can change branch context
	pi.on("session_start", async (_event, ctx) => {
		reconstructState(ctx);
		updateWidget(ctx);
	});
	pi.on("session_switch", async (_event, ctx) => {
		reconstructState(ctx);
		updateWidget(ctx);
	});
	pi.on("session_fork", async (_event, ctx) => {
		reconstructState(ctx);
		updateWidget(ctx);
	});
	pi.on("session_tree", async (_event, ctx) => {
		reconstructState(ctx);
		updateWidget(ctx);
	});

	// Enforce task discipline for complex work and auto-track subagent dispatches.
	pi.on("tool_call", async (event, ctx) => {
		const toolName = event.toolName;
		if (NON_COMPLEX_TOOLS.has(toolName)) {
			return { block: false };
		}

		const hasActive = getActiveTask() !== undefined;
		const hasPending = tasks.some((task) => task.status !== "done");

		if (toolName === SUBAGENT_CREATE_TOOL) {
			const input = event.input as Record<string, unknown> | undefined;
			const subagentTask = input?.task;
			const brief = typeof subagentTask === "string" ? subagentTask : "Subagent task";
			addSubagentDispatchTask(brief);
			persistSnapshot();
			updateWidget(ctx);
			return { block: false };
		}

		if (tasks.length === 0 || !hasPending || !hasActive) {
			const createdAutoTaskId = ensureActiveTaskForToolCall(toolName, event.input);
			if (createdAutoTaskId !== undefined) {
				autoToolTaskByCallId.set(event.toolCallId, createdAutoTaskId);
			}
			persistSnapshot();
			updateWidget(ctx);
		}

		return { block: false };
	});

	pi.on("tool_result", async (event, ctx) => {
		const taskId = autoToolTaskByCallId.get(event.toolCallId);
		if (taskId === undefined) return;
		autoToolTaskByCallId.delete(event.toolCallId);

		const idx = tasks.findIndex((task) => task.id === taskId && task.category === "auto");
		if (idx === -1) return;

		if (event.isError) {
			tasks[idx].status = "blocked";
			tasks[idx].updatedAt = Date.now();
		} else {
			tasks.splice(idx, 1);
		}

		persistSnapshot();
		updateWidget(ctx);
	});

	// ── Tool ───────────────────────────────────────────────────────────────────

	pi.registerTool({
		name: "task",
		label: "Task",
		description: "Manage the task board. Track work with statuses and priorities.",
		promptGuidelines: [
			"If tasks drift out of sync after a failed run, use `clear_all` to reset the board and start fresh.",
			"Before subagent dispatch or other complex tool use, ensure there is an active `in-progress` task.",
			"Use 'add' at the START of complex work to break it into trackable steps.",
			"Use 'set_status in-progress' when you BEGIN a task.",
			"Use 'set_status done' IMMEDIATELY when a task is completed.",
			"Use 'set_status blocked' when a task cannot proceed.",
			"Use 'list' to check state before starting a multi-step plan.",
			"Set priority 'critical' or 'high' for tasks the user explicitly emphasised.",
		],
		parameters: Type.Object({
			action: StringEnum(["add", "set_status", "set_priority", "list", "remove", "clear_done", "clear_all"] as const),
			text: Type.Optional(Type.String({ description: "Task text (for add)" })),
			id: Type.Optional(Type.Number({ description: "Task ID (for set_status, set_priority, remove)" })),
			status: Type.Optional(StringEnum(["todo", "in-progress", "done", "blocked"] as const)),
			priority: Type.Optional(StringEnum(["low", "medium", "high", "critical"] as const)),
			category: Type.Optional(Type.String({ description: "Category tag (e.g. 'refactor', 'tests')" })),
		}),

		execute: async (_callId, args, _signal, _onUpdate, ctx) => {
			const now = Date.now();

			const ok = (action: string, text: string): { content: [{ type: "text"; text: string }]; details: TaskDetails } => {
				const details: TaskDetails = { action, tasks: [...tasks], nextId };
				persistSnapshot();
				updateWidget(ctx);
				return { content: [{ type: "text" as const, text }], details };
			};

			const err = (msg: string): { content: [{ type: "text"; text: string }]; details: TaskDetails } => ({
				content: [{ type: "text" as const, text: `Error: ${msg}` }],
				details: { action: args.action, tasks: [...tasks], nextId, error: msg },
			});

			switch (args.action) {
				case "add": {
					if (!args.text?.trim()) return err("text is required for add");
					const task: Task = {
						id: nextId++,
						text: args.text.trim(),
						status: "todo",
						priority: args.priority ?? "medium",
						category: args.category,
						createdAt: now,
						updatedAt: now,
					};
					tasks.push(task);
					return ok("add", `Added #${task.id}: ${task.text}`);
				}

				case "set_status": {
					if (args.id === undefined || !args.status) return err("id and status required");
					const t = tasks.find((t) => t.id === args.id);
					if (!t) return err(`task #${args.id} not found`);
					t.status = args.status;
					t.updatedAt = now;
					return ok("set_status", `#${t.id} → ${args.status}`);
				}

				case "set_priority": {
					if (args.id === undefined || !args.priority) return err("id and priority required");
					const t = tasks.find((t) => t.id === args.id);
					if (!t) return err(`task #${args.id} not found`);
					t.priority = args.priority;
					t.updatedAt = now;
					return ok("set_priority", `#${t.id} priority → ${args.priority}`);
				}

				case "list": {
					if (tasks.length === 0) return ok("list", "No tasks.");
					const lines = sortedTasks(tasks).map(
						(t) => `#${t.id} [${t.status}] [${t.priority}]${t.category ? ` [${t.category}]` : ""} ${t.text}`
					);
					return ok("list", lines.join("\n"));
				}

				case "remove": {
					if (args.id === undefined) return err("id required for remove");
					const idx = tasks.findIndex((t) => t.id === args.id);
					if (idx === -1) return err(`task #${args.id} not found`);
					const [removed] = tasks.splice(idx, 1);
					return ok("remove", `Removed #${removed.id}: ${removed.text}`);
				}

				case "clear_done": {
					const count = tasks.filter((t) => t.status === "done").length;
					tasks = tasks.filter((t) => t.status !== "done");
					return ok("clear_done", `Cleared ${count} done task${count !== 1 ? "s" : ""}`);
				}

				case "clear_all": {
					const count = tasks.length;
					tasks = [];
					nextId = 1;
					return ok("clear_all", `Cleared all ${count} task${count !== 1 ? "s" : ""}`);
				}

				default:
					return err(`unknown action: ${String(args.action)}`);
			}
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("task ")) + theme.fg("accent", args.action);
			if (args.id !== undefined) text += " " + theme.fg("dim", `#${args.id}`);
			if (args.status) text += " → " + theme.fg("muted", args.status);
			if (args.priority && args.action !== "set_status") text += " " + theme.fg("warning", args.priority);
			if (args.text) text += " " + theme.fg("dim", `"${truncateToWidth(args.text, 55)}"`);
			if (args.category) text += theme.fg("dim", ` [${args.category}]`);
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as TaskDetails | undefined;
			if (!details) {
				const t = result.content[0];
				return new Text(t?.type === "text" ? t.text : "", 0, 0);
			}
			if (details.error) {
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			switch (details.action) {
				case "add": {
					const added = details.tasks[details.tasks.length - 1];
					return new Text(
						theme.fg("success", "+ ") +
						theme.fg("accent", `#${added?.id}`) + " " +
						theme.fg("muted", added?.text ?? ""),
						0, 0,
					);
				}
				case "set_status": {
					const t = result.content[0];
					const msg = t?.type === "text" ? t.text : "";
					const icon = msg.includes("done")
						? theme.fg("success", "✓ ")
						: msg.includes("blocked")
							? theme.fg("error", "✗ ")
							: msg.includes("in-progress")
								? theme.fg("accent", "● ")
								: theme.fg("dim", "○ ");
					return new Text(icon + theme.fg("muted", msg), 0, 0);
				}
				case "list": {
					if (details.tasks.length === 0) return new Text(theme.fg("dim", "No tasks"), 0, 0);
					const display = expanded ? sortedTasks(details.tasks) : sortedTasks(details.tasks).slice(0, 5);
					let text = theme.fg("muted", `${details.tasks.length} task(s):`);
					for (const t of display) {
						const icon = statusColor(t.status, theme);
						const txt = t.status === "done" ? theme.fg("dim", t.text) : theme.fg("muted", t.text);
						text += `\n${icon} ${theme.fg("dim", `#${t.id}`)} ${txt}`;
					}
					if (!expanded && details.tasks.length > 5) {
						text += `\n${theme.fg("dim", `... ${details.tasks.length - 5} more`)}`;
					}
					return new Text(text, 0, 0);
				}
				default: {
					const t = result.content[0];
					return new Text(theme.fg("success", "✓ ") + theme.fg("muted", t?.type === "text" ? t.text : ""), 0, 0);
				}
			}
		},
	});

	// ── Slash commands ─────────────────────────────────────────────────────────

	pi.registerCommand("tasks", {
		description: "Open the interactive task board",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/tasks requires interactive mode", "error");
				return;
			}
			await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
				return new TaskBoardComponent(tasks, theme, () => done());
			});
		},
	});

	pi.registerCommand("task-add", {
		description: "Quickly add a task: /task-add <text>",
		handler: async (args, ctx) => {
			const text = args.trim();
			if (!text) { ctx.ui.notify("Usage: /task-add <text>", "warning"); return; }
			const task: Task = {
				id: nextId++,
				text,
				status: "todo",
				priority: "medium",
				createdAt: Date.now(),
				updatedAt: Date.now(),
			};
			tasks.push(task);
			persistSnapshot();
			updateWidget(ctx);
			ctx.ui.notify(`Added #${task.id}: ${text}`, "info");
		},
	});

	pi.registerCommand("task-done", {
		description: "Mark a task done: /task-done <id>",
		handler: async (args, ctx) => {
			const id = parseInt(args.trim(), 10);
			if (isNaN(id)) { ctx.ui.notify("Usage: /task-done <id>", "warning"); return; }
			const task = tasks.find((t) => t.id === id);
			if (!task) { ctx.ui.notify(`Task #${id} not found`, "error"); return; }
			task.status = "done";
			task.updatedAt = Date.now();
			persistSnapshot();
			updateWidget(ctx);
			ctx.ui.notify(`✓ #${id}: ${task.text}`, "info");
		},
	});

	pi.registerCommand("task-clear", {
		description: "Clear all done tasks",
		handler: async (_args, ctx) => {
			const count = tasks.filter((t) => t.status === "done").length;
			tasks = tasks.filter((t) => t.status !== "done");
			persistSnapshot();
			updateWidget(ctx);
			ctx.ui.notify(
				count > 0 ? `Cleared ${count} done task${count !== 1 ? "s" : ""}` : "No done tasks to clear",
				"info",
			);
		},
	});

	pi.registerCommand("task-reset", {
		description: "Clear all tasks and reset IDs",
		handler: async (_args, ctx) => {
			const count = tasks.length;
			tasks = [];
			nextId = 1;
			persistSnapshot();
			updateWidget(ctx);
			ctx.ui.notify(
				count > 0 ? `Cleared all ${count} task${count !== 1 ? "s" : ""}` : "Task board already empty",
				"info",
			);
		},
	});
}
