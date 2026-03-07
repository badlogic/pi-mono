/**
 * Human-readable formatting for tool call previews.
 *
 * Produces compact bracket expressions like:
 *   [read: ~/file.py:10-29]
 *   [bash: git status && git diff]
 *   [grep: /TODO/ in src/]
 */

/** Shorten an absolute path by replacing the home directory prefix with ~. */
function shortenPath(path: string): string {
	const home = process.env.HOME || process.env.USERPROFILE || "";
	if (home && path.startsWith(home)) return `~${path.slice(home.length)}`;
	return path;
}

/** Format a tool call as a compact, human-readable bracket expression. */
export function formatToolCall(name: string, args: Record<string, unknown>): string {
	switch (name) {
		case "read": {
			const path = shortenPath(String(args.path || args.file_path || ""));
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
			const path = shortenPath(String(args.path || args.file_path || ""));
			return `[write: ${path}]`;
		}
		case "edit": {
			const path = shortenPath(String(args.path || args.file_path || ""));
			return `[edit: ${path}]`;
		}
		case "bash": {
			const normalized = String(args.command || "")
				.replace(/[\n\t]/g, " ")
				.trim();
			const truncated = normalized.slice(0, 50);
			return `[bash: ${truncated}${normalized.length > 50 ? "..." : ""}]`;
		}
		case "grep": {
			const pattern = String(args.pattern || "");
			const path = shortenPath(String(args.path || "."));
			return `[grep: /${pattern}/ in ${path}]`;
		}
		case "find": {
			const pattern = String(args.pattern || "");
			const path = shortenPath(String(args.path || "."));
			return `[find: ${pattern} in ${path}]`;
		}
		case "ls": {
			const path = shortenPath(String(args.path || "."));
			return `[ls: ${path}]`;
		}
		default: {
			const json = JSON.stringify(args);
			const truncated = json.slice(0, 40);
			return `[${name}: ${truncated}${json.length > 40 ? "..." : ""}]`;
		}
	}
}
