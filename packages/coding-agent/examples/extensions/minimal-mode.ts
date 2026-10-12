/**
 * Minimal Mode Example - Demonstrates a "minimal" tool display mode
 *
 * Overrides how built-in tools are drawn with `registerToolRenderer`, without
 * re-registering the tools. Re-registering a tool replaces its whole definition,
 * including `execute`, which clobbers extensions that reroute a built-in tool
 * elsewhere. A tool renderer only changes how calls and results are drawn.
 *
 * - Collapsed mode: only the tool call (command/path), no output
 * - Expanded mode: full output like the built-in renderers
 *
 * Usage:
 *   pi -e ./minimal-mode.ts
 *
 * Then use ctrl+o to toggle between minimal (collapsed) and full (expanded) views.
 */

import type { ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { homedir } from "os";

// A renderer resolver sees any tool, so `args` arrives as `unknown`. Each entry
// narrows it to that tool's shape.
type ReadArgs = { path?: string; offset?: number; limit?: number };
type BashArgs = { command?: string; timeout?: number };
type WriteArgs = { path?: string; content?: string };
type EditArgs = { path?: string };
type FindArgs = { pattern?: string; path?: string; limit?: number };
type GrepArgs = { pattern?: string; path?: string; glob?: string; limit?: number };
type LsArgs = { path?: string; limit?: number };

/** Shorten a path by replacing the home directory with ~. */
function shortenPath(path: string): string {
	const home = homedir();
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/** First text block of a tool result, if any. */
function firstText(result: { content: Array<{ type: string; text?: string }> }): string | undefined {
	const block = result.content.find((c) => c.type === "text");
	return block?.type === "text" ? block.text : undefined;
}

/** Render a text body indented under the call, preserving blank lines. */
function body(text: string, theme: Theme): Text {
	const output = text
		.trim()
		.split("\n")
		.map((line) => theme.fg("toolOutput", line))
		.join("\n");
	return new Text(`\n${output}`, 0, 0);
}

const renderers: Record<string, ToolRenderers> = {
	read: {
		renderCall(rawArgs, theme) {
			const args = rawArgs as ReadArgs;
			const path = shortenPath(args.path || "");
			let pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");

			if (args.offset !== undefined || args.limit !== undefined) {
				const startLine = args.offset ?? 1;
				const endLine = args.limit !== undefined ? startLine + args.limit - 1 : "";
				pathDisplay += theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}

			return new Text(`${theme.fg("toolTitle", theme.bold("read"))} ${pathDisplay}`, 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			if (!expanded) return new Text("", 0, 0);
			const text = firstText(result);
			return text ? body(text, theme) : new Text("", 0, 0);
		},
	},

	bash: {
		renderCall(rawArgs, theme) {
			const args = rawArgs as BashArgs;
			const command = args.command || "...";
			const timeoutSuffix = args.timeout ? theme.fg("muted", ` (timeout ${args.timeout}s)`) : "";
			return new Text(theme.fg("toolTitle", theme.bold(`$ ${command}`)) + timeoutSuffix, 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			if (!expanded) return new Text("", 0, 0);
			const text = firstText(result);
			return text ? body(text, theme) : new Text("", 0, 0);
		},
	},

	write: {
		renderCall(rawArgs, theme) {
			const args = rawArgs as WriteArgs;
			const path = shortenPath(args.path || "");
			const pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
			const lineCount = args.content ? args.content.split("\n").length : 0;
			const lineInfo = lineCount > 0 ? theme.fg("muted", ` (${lineCount} lines)`) : "";
			return new Text(`${theme.fg("toolTitle", theme.bold("write"))} ${pathDisplay}${lineInfo}`, 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			if (!expanded) return new Text("", 0, 0);
			const text = firstText(result);
			return text ? new Text(`\n${theme.fg("error", text)}`, 0, 0) : new Text("", 0, 0);
		},
	},

	edit: {
		// The built-in edit tool draws its own shell, so replacing its renderers
		// must opt back into the default boxed shell.
		renderShell: "default",
		renderCall(rawArgs, theme) {
			const args = rawArgs as EditArgs;
			const path = shortenPath(args.path || "");
			const pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
			return new Text(`${theme.fg("toolTitle", theme.bold("edit"))} ${pathDisplay}`, 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			if (!expanded) return new Text("", 0, 0);
			const text = firstText(result);
			if (!text) return new Text("", 0, 0);
			const color = text.includes("Error") || text.includes("error") ? "error" : "toolOutput";
			return new Text(`\n${theme.fg(color, text)}`, 0, 0);
		},
	},

	find: {
		renderCall(rawArgs, theme) {
			const args = rawArgs as FindArgs;
			const path = shortenPath(args.path || ".");
			let text = `${theme.fg("toolTitle", theme.bold("find"))} ${theme.fg("accent", args.pattern || "")}`;
			text += theme.fg("toolOutput", ` in ${path}`);
			if (args.limit !== undefined) text += theme.fg("toolOutput", ` (limit ${args.limit})`);
			return new Text(text, 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			const text = firstText(result);
			if (!expanded) {
				const count = text?.trim().split("\n").filter(Boolean).length ?? 0;
				return count > 0 ? new Text(theme.fg("muted", ` → ${count} files`), 0, 0) : new Text("", 0, 0);
			}
			return text ? body(text, theme) : new Text("", 0, 0);
		},
	},

	grep: {
		renderCall(rawArgs, theme) {
			const args = rawArgs as GrepArgs;
			const path = shortenPath(args.path || ".");
			let text = `${theme.fg("toolTitle", theme.bold("grep"))} ${theme.fg("accent", `/${args.pattern || ""}/`)}`;
			text += theme.fg("toolOutput", ` in ${path}`);
			if (args.glob) text += theme.fg("toolOutput", ` (${args.glob})`);
			if (args.limit !== undefined) text += theme.fg("toolOutput", ` limit ${args.limit}`);
			return new Text(text, 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			const text = firstText(result);
			if (!expanded) {
				const count = text?.trim().split("\n").filter(Boolean).length ?? 0;
				return count > 0 ? new Text(theme.fg("muted", ` → ${count} matches`), 0, 0) : new Text("", 0, 0);
			}
			return text ? body(text, theme) : new Text("", 0, 0);
		},
	},

	ls: {
		renderCall(rawArgs, theme) {
			const args = rawArgs as LsArgs;
			const path = shortenPath(args.path || ".");
			let text = `${theme.fg("toolTitle", theme.bold("ls"))} ${theme.fg("accent", path)}`;
			if (args.limit !== undefined) text += theme.fg("toolOutput", ` (limit ${args.limit})`);
			return new Text(text, 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			const text = firstText(result);
			if (!expanded) {
				const count = text?.trim().split("\n").filter(Boolean).length ?? 0;
				return count > 0 ? new Text(theme.fg("muted", ` → ${count} entries`), 0, 0) : new Text("", 0, 0);
			}
			return text ? body(text, theme) : new Text("", 0, 0);
		},
	},
};

export default function (pi: ExtensionAPI) {
	pi.registerToolRenderer((toolName, next) => renderers[toolName] ?? next());
}
