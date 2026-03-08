/**
 * Task Board / Todo Extension
 *
 * Uses oh-my-pi-style todo state semantics instead of extension-owned snapshots.
 * State is reconstructed from tool result details in session history.
 *
 * Tools:
 * - `todo_write` - primary todo API
 * - `task` - compatibility alias over the same state model
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { type Static, Type } from "@sinclair/typebox";

export type TodoStatus = "pending" | "in_progress" | "completed" | "abandoned";

export interface TodoItem {
	id: string;
	content: string;
	status: TodoStatus;
	notes?: string;
}

export interface TodoPhase {
	id: string;
	name: string;
	tasks: TodoItem[];
}

interface TodoWriteToolDetails {
	phases: TodoPhase[];
	storage: "session" | "memory";
}

type LegacyTaskStatus = "todo" | "in-progress" | "done" | "blocked";
type LegacyTaskPriority = "low" | "medium" | "high" | "critical";

interface LegacyTaskToolDetails extends TodoWriteToolDetails {
	action: string;
}

const StatusEnum = StringEnum(["pending", "in_progress", "completed", "abandoned"] as const, {
	description: "Task status",
});

const InputTask = Type.Object({
	content: Type.String({ description: "Task description" }),
	status: Type.Optional(StatusEnum),
	notes: Type.Optional(Type.String({ description: "Additional context or notes" })),
});

const InputPhase = Type.Object({
	name: Type.String({ description: "Phase name" }),
	tasks: Type.Optional(Type.Array(InputTask)),
});

const todoWriteSchema = Type.Object({
	ops: Type.Array(
		Type.Union([
			Type.Object({
				op: Type.Literal("replace"),
				phases: Type.Array(InputPhase),
			}),
			Type.Object({
				op: Type.Literal("add_phase"),
				name: Type.String({ description: "Phase name" }),
				tasks: Type.Optional(Type.Array(InputTask)),
			}),
			Type.Object({
				op: Type.Literal("add_task"),
				phase: Type.String({ description: "Phase ID, e.g. phase-1" }),
				content: Type.String({ description: "Task description" }),
				notes: Type.Optional(Type.String({ description: "Additional context or notes" })),
			}),
			Type.Object({
				op: Type.Literal("update"),
				id: Type.String({ description: "Task ID, e.g. task-3" }),
				status: Type.Optional(StatusEnum),
				content: Type.Optional(Type.String({ description: "Updated task description" })),
				notes: Type.Optional(Type.String({ description: "Additional context or notes" })),
			}),
			Type.Object({
				op: Type.Literal("remove_task"),
				id: Type.String({ description: "Task ID, e.g. task-3" }),
			}),
		]),
	),
});

type TodoWriteParams = Static<typeof todoWriteSchema>;

const legacyTaskSchema = Type.Object({
	action: StringEnum(["add", "set_status", "set_priority", "list", "remove", "clear_done", "clear_all"] as const),
	text: Type.Optional(Type.String({ description: "Task text (for add)" })),
	id: Type.Optional(Type.Number({ description: "Task ID (for set_status, set_priority, remove)" })),
	status: Type.Optional(StringEnum(["todo", "in-progress", "done", "blocked"] as const)),
	priority: Type.Optional(StringEnum(["low", "medium", "high", "critical"] as const)),
	category: Type.Optional(Type.String({ description: "Category tag (e.g. 'refactor', 'tests')" })),
});

type LegacyTaskParams = Static<typeof legacyTaskSchema>;

interface TodoFile {
	phases: TodoPhase[];
	nextTaskId: number;
	nextPhaseId: number;
}

let phases: TodoPhase[] = [];

function clonePhases(items: TodoPhase[]): TodoPhase[] {
	return items.map((phase) => ({
		...phase,
		tasks: phase.tasks.map((task) => ({ ...task })),
	}));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTodoStatus(value: unknown): value is TodoStatus {
	return value === "pending" || value === "in_progress" || value === "completed" || value === "abandoned";
}

function isTodoItem(value: unknown): value is TodoItem {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		typeof value.content === "string" &&
		isTodoStatus(value.status) &&
		(value.notes === undefined || typeof value.notes === "string")
	);
}

function isTodoPhase(value: unknown): value is TodoPhase {
	if (!isRecord(value)) return false;
	return typeof value.id === "string" && typeof value.name === "string" && Array.isArray(value.tasks) && value.tasks.every(isTodoItem);
}

function extractPhasesFromToolResult(message: unknown): TodoPhase[] | undefined {
	if (!isRecord(message)) return undefined;
	if (message.role !== "toolResult" || message.isError === true) return undefined;
	if (message.toolName !== "todo_write" && message.toolName !== "task") return undefined;
	const details = isRecord(message.details) ? message.details : undefined;
	const detailsPhases = details?.phases;
	if (!Array.isArray(detailsPhases) || !detailsPhases.every(isTodoPhase)) return undefined;
	return clonePhases(detailsPhases);
}

function getLatestTodoPhasesFromEntries(entries: unknown[]): TodoPhase[] {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (!isRecord(entry) || entry.type !== "message") continue;
		const extracted = extractPhasesFromToolResult(entry.message);
		if (extracted) return extracted;
	}
	return [];
}

function reconstructState(ctx: ExtensionContext): void {
	const entries = ctx.sessionManager.getBranch();
	phases = Array.isArray(entries) ? getLatestTodoPhasesFromEntries(entries) : [];
}

function makeEmptyFile(): TodoFile {
	return { phases: [], nextTaskId: 1, nextPhaseId: 1 };
}

function findTask(items: TodoPhase[], id: string): TodoItem | undefined {
	for (const phase of items) {
		const task = phase.tasks.find((entry) => entry.id === id);
		if (task) return task;
	}
	return undefined;
}

function getNextIds(items: TodoPhase[]): { nextTaskId: number; nextPhaseId: number } {
	let maxTaskId = 0;
	let maxPhaseId = 0;
	for (const phase of items) {
		const phaseMatch = /^phase-(\d+)$/u.exec(phase.id);
		if (phaseMatch) {
			const value = Number.parseInt(phaseMatch[1], 10);
			if (Number.isFinite(value) && value > maxPhaseId) maxPhaseId = value;
		}
		for (const task of phase.tasks) {
			const taskMatch = /^task-(\d+)$/u.exec(task.id);
			if (!taskMatch) continue;
			const value = Number.parseInt(taskMatch[1], 10);
			if (Number.isFinite(value) && value > maxTaskId) maxTaskId = value;
		}
	}
	return { nextTaskId: maxTaskId + 1, nextPhaseId: maxPhaseId + 1 };
}

function fileFromPhases(items: TodoPhase[]): TodoFile {
	const { nextTaskId, nextPhaseId } = getNextIds(items);
	return { phases: clonePhases(items), nextTaskId, nextPhaseId };
}

function buildPhaseFromInput(
	input: { name: string; tasks?: Array<{ content: string; status?: TodoStatus; notes?: string }> },
	phaseId: string,
	nextTaskId: number,
): { phase: TodoPhase; nextTaskId: number } {
	const tasks: TodoItem[] = [];
	let taskId = nextTaskId;
	for (const task of input.tasks ?? []) {
		tasks.push({
			id: `task-${taskId++}`,
			content: task.content,
			status: task.status ?? "pending",
			notes: task.notes,
		});
	}
	return { phase: { id: phaseId, name: input.name, tasks }, nextTaskId: taskId };
}

function normalizeInProgressTask(items: TodoPhase[]): void {
	const orderedTasks = items.flatMap((phase) => phase.tasks);
	if (orderedTasks.length === 0) return;
	const inProgressTasks = orderedTasks.filter((task) => task.status === "in_progress");
	if (inProgressTasks.length > 1) {
		for (const task of inProgressTasks.slice(1)) {
			task.status = "pending";
		}
	}
	if (inProgressTasks.length > 0) return;
	const firstPendingTask = orderedTasks.find((task) => task.status === "pending");
	if (firstPendingTask) {
		firstPendingTask.status = "in_progress";
	}
}

function applyOps(file: TodoFile, ops: TodoWriteParams["ops"]): { file: TodoFile; errors: string[] } {
	const errors: string[] = [];
	for (const op of ops) {
		switch (op.op) {
			case "replace": {
				const next = makeEmptyFile();
				for (const inputPhase of op.phases) {
					const phaseId = `phase-${next.nextPhaseId++}`;
					const { phase, nextTaskId } = buildPhaseFromInput(inputPhase, phaseId, next.nextTaskId);
					next.phases.push(phase);
					next.nextTaskId = nextTaskId;
				}
				file = next;
				break;
			}
			case "add_phase": {
				const phaseId = `phase-${file.nextPhaseId++}`;
				const { phase, nextTaskId } = buildPhaseFromInput(op, phaseId, file.nextTaskId);
				file.phases.push(phase);
				file.nextTaskId = nextTaskId;
				break;
			}
			case "add_task": {
				const phase = file.phases.find((entry) => entry.id === op.phase);
				if (!phase) {
					errors.push(`phase ${op.phase} not found`);
					break;
				}
				phase.tasks.push({
					id: `task-${file.nextTaskId++}`,
					content: op.content,
					status: "pending",
					notes: op.notes,
				});
				break;
			}
			case "update": {
				const task = findTask(file.phases, op.id);
				if (!task) {
					errors.push(`task ${op.id} not found`);
					break;
				}
				if (op.status !== undefined) task.status = op.status;
				if (op.content !== undefined) task.content = op.content;
				if (op.notes !== undefined) task.notes = op.notes;
				break;
			}
			case "remove_task": {
				let removed = false;
				for (const phase of file.phases) {
					const before = phase.tasks.length;
					phase.tasks = phase.tasks.filter((task) => task.id !== op.id);
					if (phase.tasks.length !== before) {
						removed = true;
						break;
					}
				}
				if (!removed) {
					errors.push(`task ${op.id} not found`);
				}
				break;
			}
		}
	}
	file.phases = file.phases.filter((phase) => phase.tasks.length > 0);
	normalizeInProgressTask(file.phases);
	return { file, errors };
}

function formatSummary(items: TodoPhase[], errors: string[]): string {
	const incomplete = items.flatMap((phase) =>
		phase.tasks
			.filter((task) => task.status === "pending" || task.status === "in_progress")
			.map((task) => ({ phase: phase.name, task })),
	);
	const lines: string[] = [];
	if (errors.length > 0) {
		lines.push(`Errors (${errors.length}):`);
		for (const error of errors) lines.push(`- ${error}`);
		lines.push("");
	}
	if (incomplete.length === 0) {
		lines.push("Remaining items: none.");
		return lines.join("\n");
	}
	lines.push(`Remaining items (${incomplete.length}):`);
	for (const { phase, task } of incomplete) {
		lines.push(`- ${task.id} ${task.content} [${task.status}] (${phase})`);
	}
	return lines.join("\n");
}

function getPhaseLabel(phase: TodoPhase): string {
	return phase.name || "Execution";
}

function statusColor(status: TodoStatus, theme: Theme): string {
	switch (status) {
		case "completed":
			return theme.fg("success", "✓");
		case "in_progress":
			return theme.fg("accent", "●");
		case "abandoned":
			return theme.fg("error", "✗");
		default:
			return theme.fg("dim", "○");
	}
}

function flattenTodos(items: TodoPhase[]): Array<{ phase: string; todo: TodoItem }> {
	return items.flatMap((phase) => phase.tasks.map((todo) => ({ phase: getPhaseLabel(phase), todo })));
}

function updateWidget(ctx: ExtensionContext): void {
	const todos = flattenTodos(phases);
	if (todos.length === 0) {
		ctx.ui.setWidget("taskboard", undefined);
		ctx.ui.setStatus("tasks", undefined);
		return;
	}

	const incomplete = todos.filter(({ todo }) => todo.status === "pending" || todo.status === "in_progress");
	const inProgress = todos.filter(({ todo }) => todo.status === "in_progress").length;
	const completed = todos.filter(({ todo }) => todo.status === "completed").length;
	ctx.ui.setStatus(
		"tasks",
		`${todos.length} task${todos.length === 1 ? "" : "s"} · ${inProgress} in progress${completed > 0 ? ` · ${completed} done` : ""}`,
	);

	ctx.ui.setWidget(
		"taskboard",
		(_tui, theme) => ({
			render(width: number): string[] {
				const lines: string[] = [theme.fg("borderMuted", "─".repeat(width))];
				const display = incomplete.length > 0 ? incomplete.slice(0, 6) : todos.slice(0, 6);
				for (const { phase, todo } of display) {
					const icon = statusColor(todo.status, theme);
					const phaseLabel = theme.fg("dim", `[${phase}]`);
					const maxTxt = Math.max(10, width - 24);
					const text = todo.status === "completed"
						? theme.fg("dim", truncateToWidth(todo.content, maxTxt))
						: theme.fg("text", truncateToWidth(todo.content, maxTxt));
					lines.push(truncateToWidth(` ${icon} ${theme.fg("dim", todo.id)} ${phaseLabel} ${text}`, width));
				}
				if (todos.length > 6) {
					lines.push(theme.fg("dim", ` ... ${todos.length - 6} more — /tasks to view all`));
				}
				lines.push(theme.fg("borderMuted", "─".repeat(width)));
				return lines;
			},
			invalidate() {},
		}),
		{ placement: "aboveEditor" },
	);
}

function mapLegacyStatus(status: LegacyTaskStatus | undefined): TodoStatus | undefined {
	switch (status) {
		case "todo":
			return "pending";
		case "in-progress":
			return "in_progress";
		case "done":
			return "completed";
		case "blocked":
			return "abandoned";
		default:
			return undefined;
	}
}

function getOrCreateExecutionPhase(file: TodoFile): TodoPhase {
	let phase = file.phases[0];
	if (!phase) {
		phase = { id: `phase-${file.nextPhaseId++}`, name: "Execution", tasks: [] };
		file.phases.push(phase);
	}
	return phase;
}

function legacyActionToOps(file: TodoFile, args: LegacyTaskParams): TodoWriteParams["ops"] | { error: string } {
	switch (args.action) {
		case "add": {
			if (!args.text?.trim()) return { error: "text is required for add" };
			const phase = getOrCreateExecutionPhase(file);
			const notes: string[] = [];
			if (args.priority && args.priority !== "medium") notes.push(`priority:${args.priority}`);
			if (args.category) notes.push(`category:${args.category}`);
			return [{ op: "add_task", phase: phase.id, content: args.text.trim(), notes: notes.join(" ") || undefined }];
		}
		case "set_status": {
			if (args.id === undefined || !args.status) return { error: "id and status required" };
			const status = mapLegacyStatus(args.status);
			if (!status) return { error: `unsupported status: ${String(args.status)}` };
			return [{ op: "update", id: `task-${args.id}`, status }];
		}
		case "set_priority": {
			if (args.id === undefined || !args.priority) return { error: "id and priority required" };
			const task = findTask(file.phases, `task-${args.id}`);
			if (!task) return { error: `task #${args.id} not found` };
			const notes = task.notes ? `${task.notes} priority:${args.priority}` : `priority:${args.priority}`;
			return [{ op: "update", id: task.id, notes }];
		}
		case "remove": {
			if (args.id === undefined) return { error: "id required for remove" };
			return [{ op: "remove_task", id: `task-${args.id}` }];
		}
		case "clear_done": {
			const doneTasks = file.phases.flatMap((phase) => phase.tasks.filter((task) => task.status === "completed"));
			return doneTasks.map((task) => ({ op: "remove_task" as const, id: task.id }));
		}
		case "clear_all":
			return [{ op: "replace", phases: [] }];
		case "list":
			return [];
		default:
			return { error: `unknown action: ${String(args.action)}` };
	}
}

class TaskBoardComponent {
	private items: Array<{ phase: string; todo: TodoItem }>;
	private theme: Theme;
	private onClose: () => void;
	private selectedIdx = 0;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(items: TodoPhase[], theme: Theme, onClose: () => void) {
		this.items = flattenTodos(items);
		this.theme = theme;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") {
			this.onClose();
			return;
		}
		if (this.items.length === 0) return;
		if (matchesKey(data, "up") || data === "k") {
			this.selectedIdx = Math.max(0, this.selectedIdx - 1);
			this.cachedLines = undefined;
		}
		if (matchesKey(data, "down") || data === "j") {
			this.selectedIdx = Math.min(this.items.length - 1, this.selectedIdx + 1);
			this.cachedLines = undefined;
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const lines: string[] = [];
		lines.push("");
		const title = " Todo Board ";
		const sides = Math.max(0, Math.floor((width - title.length) / 2));
		lines.push(
			this.theme.fg("borderMuted", "─".repeat(sides)) +
			this.theme.fg("accent", title) +
			this.theme.fg("borderMuted", "─".repeat(Math.max(0, width - sides - title.length))),
		);
		lines.push("");
		if (this.items.length === 0) {
			lines.push(this.theme.fg("dim", "  No todos yet."));
		} else {
			this.items.forEach(({ phase, todo }, index) => {
				const selected = index === this.selectedIdx;
				const prefix = selected ? this.theme.fg("accent", "▶") : " ";
				const icon = statusColor(todo.status, this.theme);
				const text = todo.status === "completed"
					? this.theme.fg("dim", todo.content)
					: this.theme.fg("text", todo.content);
				lines.push(truncateToWidth(`  ${prefix} ${icon} ${this.theme.fg("dim", todo.id)} ${this.theme.fg("dim", `[${phase}]`)} ${text}`, width));
			});
		}
		lines.push("");
		lines.push(this.theme.fg("borderMuted", "─".repeat(width)));
		lines.push(truncateToWidth(`  ${this.theme.fg("dim", "↑/↓ navigate    Esc close")}`, width));
		lines.push("");
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedLines = undefined;
	}
}

export default function (pi: ExtensionAPI) {
	const syncUi = (ctx: ExtensionContext): void => {
		reconstructState(ctx);
		updateWidget(ctx);
	};

	pi.on("session_start", async (_event, ctx) => syncUi(ctx));
	pi.on("session_switch", async (_event, ctx) => syncUi(ctx));
	pi.on("session_fork", async (_event, ctx) => syncUi(ctx));
	pi.on("session_tree", async (_event, ctx) => syncUi(ctx));
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName === "todo_write" || event.toolName === "task") {
			syncUi(ctx);
		}
	});

	pi.registerTool({
		name: "todo_write",
		label: "Todo Write",
		description: "Create and manage structured todo/task lists during a session.",
		promptGuidelines: [
			"Use todo_write to initialize and keep progress visible during multi-step work.",
			"Update todo_write immediately after a step completes so the visible board stays accurate.",
			"Keep only one in_progress task at a time.",
		],
		parameters: todoWriteSchema,
		execute: async (_callId, args, _signal, _onUpdate, ctx) => {
			const previous = fileFromPhases(phases);
			const { file: updated, errors } = applyOps(previous, args.ops);
			phases = clonePhases(updated.phases);
			updateWidget(ctx);
			return {
				content: [{ type: "text" as const, text: formatSummary(phases, errors) }],
				details: {
					phases: clonePhases(phases),
					storage: "session",
				} satisfies TodoWriteToolDetails,
			};
		},
		renderCall(args, theme) {
			const count = Array.isArray(args.ops) ? args.ops.length : 0;
			const label = count === 1 && isRecord(args.ops?.[0]) && typeof args.ops[0].op === "string"
				? args.ops[0].op
				: `${count} ops`;
			return new Text(`${theme.fg("toolTitle", theme.bold("todo_write"))} ${theme.fg("accent", label)}`, 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			const details = result.details as TodoWriteToolDetails | undefined;
			const allTasks = details?.phases.flatMap((phase) => phase.tasks) ?? [];
			if (allTasks.length === 0) {
				const fallback = result.content.find((part) => part.type === "text")?.text ?? "No todos";
				return new Text(`${theme.fg("success", "✓ Todo Write")}\n${theme.fg("dim", fallback)}`, 0, 0);
			}
			const lines = [`${theme.fg("success", "✓ Todo Write")} ${theme.fg("dim", `${allTasks.length} tasks`)}`];
			for (const phase of details?.phases ?? []) {
				if ((details?.phases.length ?? 0) > 1) {
					lines.push(theme.fg("accent", `  ${phase.name}`));
				}
				const display = expanded ? phase.tasks : phase.tasks.slice(0, 5);
				for (const task of display) {
					lines.push(`  ${statusColor(task.status, theme)} ${theme.fg("dim", task.id)} ${task.content}`);
				}
				if (!expanded && phase.tasks.length > 5) {
					lines.push(theme.fg("dim", `  ... ${phase.tasks.length - 5} more`));
				}
			}
			return new Text(lines.join("\n"), 0, 0);
		},
	});

	pi.registerTool({
		name: "task",
		label: "Task",
		description: "Compatibility alias over the todo board. Prefer todo_write for structured task tracking.",
		promptGuidelines: [
			"This is a compatibility alias over the todo board.",
			"Prefer todo_write when you need structured multi-step planning.",
		],
		parameters: legacyTaskSchema,
		execute: async (_callId, args, _signal, _onUpdate, ctx) => {
			const file = fileFromPhases(phases);
			if (args.action === "list") {
				const todos = flattenTodos(phases);
				const text = todos.length === 0
					? "No tasks."
					: todos
						.map(({ phase, todo }) => `#${todo.id.replace(/^task-/u, "")} [${todo.status}] [${phase}] ${todo.content}`)
						.join("\n");
				updateWidget(ctx);
				return {
					content: [{ type: "text" as const, text }],
					details: { action: "list", phases: clonePhases(phases), storage: "session" } satisfies LegacyTaskToolDetails,
				};
			}

			const ops = legacyActionToOps(file, args);
			if ("error" in ops) {
				return {
					content: [{ type: "text" as const, text: `Error: ${ops.error}` }],
					details: { action: args.action, phases: clonePhases(phases), storage: "session" } satisfies LegacyTaskToolDetails,
				};
			}

			const { file: updated } = applyOps(file, ops);
			phases = clonePhases(updated.phases);
			updateWidget(ctx);
			const summary = args.action === "clear_done"
				? `Cleared completed tasks. ${formatSummary(phases, [])}`
				: formatSummary(phases, []);
			return {
				content: [{ type: "text" as const, text: summary }],
				details: { action: args.action, phases: clonePhases(phases), storage: "session" } satisfies LegacyTaskToolDetails,
			};
		},
		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("task")) + " " + theme.fg("accent", args.action);
			if (args.id !== undefined) text += " " + theme.fg("dim", `#${args.id}`);
			if (args.status) text += " → " + theme.fg("muted", args.status);
			if (args.text) text += " " + theme.fg("dim", `\"${truncateToWidth(args.text, 55)}\"`);
			return new Text(text, 0, 0);
		},
		renderResult(result, _options, theme) {
			const text = result.content.find((part) => part.type === "text")?.text ?? "";
			return new Text(theme.fg("muted", text), 0, 0);
		},
	});

	pi.registerCommand("tasks", {
		description: "Open the interactive todo board",
		handler: async (_args, ctx) => {
			syncUi(ctx);
			if (!ctx.hasUI) {
				ctx.ui.notify("/tasks requires interactive mode", "error");
				return;
			}
			await ctx.ui.custom<void>((_tui, theme, _kb, done) => new TaskBoardComponent(phases, theme, () => done()));
		},
	});

	pi.registerCommand("task-add", {
		description: "Quickly add a task: /task-add <text>",
		handler: async (args, ctx) => {
			const text = args.trim();
			if (!text) {
				ctx.ui.notify("Usage: /task-add <text>", "warning");
				return;
			}
			const file = fileFromPhases(phases);
			const phase = getOrCreateExecutionPhase(file);
			const { file: updated } = applyOps(file, [{ op: "add_task", phase: phase.id, content: text }]);
			phases = clonePhases(updated.phases);
			updateWidget(ctx);
			ctx.ui.notify(`Added: ${text}`, "info");
		},
	});

	pi.registerCommand("task-done", {
		description: "Mark a task done: /task-done <id>",
		handler: async (args, ctx) => {
			const id = Number.parseInt(args.trim(), 10);
			if (!Number.isFinite(id)) {
				ctx.ui.notify("Usage: /task-done <id>", "warning");
				return;
			}
			const file = fileFromPhases(phases);
			const { file: updated, errors } = applyOps(file, [{ op: "update", id: `task-${id}`, status: "completed" }]);
			if (errors.length > 0) {
				ctx.ui.notify(errors[0], "error");
				return;
			}
			phases = clonePhases(updated.phases);
			updateWidget(ctx);
			ctx.ui.notify(`✓ task-${id}`, "info");
		},
	});

	pi.registerCommand("task-clear", {
		description: "Clear all completed tasks",
		handler: async (_args, ctx) => {
			const file = fileFromPhases(phases);
			const completed = file.phases.flatMap((phase) => phase.tasks.filter((task) => task.status === "completed"));
			const ops = completed.map((task) => ({ op: "remove_task" as const, id: task.id }));
			const { file: updated } = applyOps(file, ops);
			phases = clonePhases(updated.phases);
			updateWidget(ctx);
			ctx.ui.notify(completed.length > 0 ? `Cleared ${completed.length} completed task${completed.length === 1 ? "" : "s"}` : "No completed tasks to clear", "info");
		},
	});

	pi.registerCommand("task-reset", {
		description: "Clear all tasks",
		handler: async (_args, ctx) => {
			phases = [];
			updateWidget(ctx);
			ctx.ui.notify("Cleared all tasks", "info");
		},
	});
}
