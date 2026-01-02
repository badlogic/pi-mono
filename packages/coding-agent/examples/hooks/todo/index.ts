/**
 * Todo Hook - Companion to the todo custom tool
 *
 * Registers a /todos command that displays all todos on the current branch
 * with a nice custom UI.
 */

import type { HookAPI } from "@mariozechner/pi-coding-agent";
import { isCtrlC, isEscape, truncateToWidth } from "@mariozechner/pi-tui";

interface Todo {
	id: number;
	text: string;
	done: boolean;
}

interface TodoDetails {
	action: "list" | "add" | "toggle" | "clear";
	todos: Todo[];
	nextId: number;
	error?: string;
}

class TodoListComponent {
	private todos: Todo[];
	private theme: { fg: (color: string, text: string) => string };
	private onClose: () => void;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(todos: Todo[], theme: { fg: (color: string, text: string) => string }, onClose: () => void) {
		this.todos = todos;
		this.theme = theme;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (isEscape(data) || isCtrlC(data)) {
			this.onClose();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		const th = this.theme;

		// Header
		lines.push("");
		const title = th.fg("accent", " Todos ");
		const headerLine =
			th.fg("borderMuted", "─".repeat(3)) + title + th.fg("borderMuted", "─".repeat(Math.max(0, width - 10)));
		lines.push(truncateToWidth(headerLine, width));
		lines.push("");

		if (this.todos.length === 0) {
			lines.push(truncateToWidth(`  ${th.fg("dim", "No todos yet. Ask the agent to add some!")}`, width));
		} else {
			// Stats
			const done = this.todos.filter((t) => t.done).length;
			const total = this.todos.length;
			const statsText = `  ${th.fg("muted", `${done}/${total} completed`)}`;
			lines.push(truncateToWidth(statsText, width));
			lines.push("");

			// Todo items
			for (const todo of this.todos) {
				const check = todo.done ? th.fg("success", "✓") : th.fg("dim", "○");
				const id = th.fg("accent", `#${todo.id}`);
				const text = todo.done ? th.fg("dim", todo.text) : th.fg("text", todo.text);
				const line = `  ${check} ${id} ${text}`;
				lines.push(truncateToWidth(line, width));
			}
		}

		lines.push("");
		lines.push(truncateToWidth(`  ${th.fg("dim", "Press Escape to close")}`, width));
		lines.push("");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

export default function (pi: HookAPI) {
	/**
	 * Reconstruct todos from session entries on the current branch.
	 */
	function getTodos(ctx: {
		sessionManager: {
			getBranch: () => Array<{ type: string; message?: { role?: string; toolName?: string; details?: unknown } }>;
		};
	}): Todo[] {
		let todos: Todo[] = [];

		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (!msg || msg.role !== "toolResult" || msg.toolName !== "todo") continue;

			const details = msg.details as TodoDetails | undefined;
			if (details) {
				todos = details.todos;
			}
		}

		return todos;
	}

	pi.registerCommand("todos", {
		description: "Show all todos on the current branch",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/todos requires interactive mode", "error");
				return;
			}

			const todos = getTodos(ctx);

			await ctx.ui.custom<void>((_tui, theme, done) => {
				return new TodoListComponent(todos, theme, () => done());
			});
		},
	});
}
