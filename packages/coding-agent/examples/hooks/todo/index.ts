/**
 * Todo Hook - Companion to the todo custom tool
 *
 * Registers a /todos command that opens the todo list in an external editor.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { HookAPI } from "@mariozechner/pi-coding-agent";

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

	/**
	 * Format todos as markdown for display in editor.
	 */
	function formatTodos(todos: Todo[]): string {
		const lines: string[] = [];
		lines.push("# Todos");
		lines.push("");

		if (todos.length === 0) {
			lines.push("No todos yet. Ask the agent to add some!");
		} else {
			const done = todos.filter((t) => t.done).length;
			lines.push(`${done}/${todos.length} completed`);
			lines.push("");

			for (const todo of todos) {
				const check = todo.done ? "[x]" : "[ ]";
				lines.push(`- ${check} #${todo.id}: ${todo.text}`);
			}
		}

		lines.push("");
		return lines.join("\n");
	}

	pi.registerCommand("todos", {
		description: "Show all todos in external editor",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/todos requires interactive mode", "error");
				return;
			}

			const editorCmd = process.env.VISUAL || process.env.EDITOR;
			if (!editorCmd) {
				ctx.ui.notify("No $VISUAL or $EDITOR set", "error");
				return;
			}

			const todos = getTodos(ctx);
			const content = formatTodos(todos);
			const tmpFile = path.join(os.tmpdir(), `pi-todos-${Date.now()}.md`);

			try {
				fs.writeFileSync(tmpFile, content, "utf-8");

				// Use custom() to get access to tui for stop/start
				await ctx.ui.custom((tui, _theme, done) => {
					tui.stop();

					const [editor, ...editorArgs] = editorCmd.split(" ");
					spawnSync(editor, [...editorArgs, tmpFile], { stdio: "inherit" });

					tui.start();
					tui.requestRender();
					done(undefined);

					// Return a minimal component (never rendered since we call done immediately)
					return { render: () => [] };
				});
			} finally {
				try {
					fs.unlinkSync(tmpFile);
				} catch {
					// Ignore cleanup errors
				}
			}
		},
	});
}
