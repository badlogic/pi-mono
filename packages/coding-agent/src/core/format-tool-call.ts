/** Format a tool call for display (`[read: ~/path:1-20]`, `[bash: cmd...]`). */

import { homedir } from "node:os";

const BASH_CMD_DISPLAY_LIMIT = 50;
const DEFAULT_ARGS_DISPLAY_LIMIT = 40;

/** Shorten absolute paths by replacing $HOME with ~ */
export function shortenPath(path: string): string {
	const home = homedir();
	if (path.startsWith(home)) return `~${path.slice(home.length)}`;
	return path;
}

/** Extract and shorten the path argument from tool args. */
function pathArg(args: Record<string, unknown>, fallback = ""): string {
	return shortenPath(String(args.path ?? fallback));
}

/** Format a tool call into a bracketed display string. */
export function formatToolCall(name: string, args: Record<string, unknown>): string {
	switch (name) {
		case "read": {
			const path = pathArg(args);
			const offset = args.offset as number | undefined;
			const limit = args.limit as number | undefined;
			let display = path;
			if (offset !== undefined || limit !== undefined) {
				const start = offset ?? 1;
				const end = limit !== undefined ? start + limit - 1 : "";
				display += `:${start}${end ? `-${end}` : ""}`;
			}
			return `[read: ${display}]`;
		}
		case "write": {
			return `[write: ${pathArg(args)}]`;
		}
		case "edit": {
			return `[edit: ${pathArg(args)}]`;
		}
		case "bash": {
			const rawCmd = String(args.command ?? "");
			const normalized = rawCmd.replace(/[\n\t]/g, " ").trim();
			const cmd = normalized.slice(0, BASH_CMD_DISPLAY_LIMIT);
			return `[bash: ${cmd}${normalized.length > BASH_CMD_DISPLAY_LIMIT ? "..." : ""}]`;
		}
		case "grep": {
			const pattern = String(args.pattern ?? "");
			const path = pathArg(args, ".");
			return `[grep: /${pattern}/ in ${path}]`;
		}
		case "find": {
			const pattern = String(args.pattern ?? "");
			const path = pathArg(args, ".");
			return `[find: ${pattern} in ${path}]`;
		}
		case "ls": {
			return `[ls: ${pathArg(args, ".")}]`;
		}
		default: {
			const serialized = JSON.stringify(args);
			const argsStr = serialized.slice(0, DEFAULT_ARGS_DISPLAY_LIMIT);
			return `[${name}: ${argsStr}${serialized.length > DEFAULT_ARGS_DISPLAY_LIMIT ? "..." : ""}]`;
		}
	}
}
