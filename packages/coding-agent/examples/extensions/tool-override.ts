/**
 * Tool Override Example - Demonstrates overriding built-in tools
 *
 * Extensions can register tools with the same name as built-in tools to replace them.
 * This is useful for:
 * - Adding logging or auditing to tool calls
 * - Implementing access control or sandboxing
 * - Routing tool calls to remote systems (e.g., pi-ssh-remote)
 * - Modifying tool behavior for specific workflows
 *
 * This example overrides the `read` tool to:
 * 1. Log all file access to a log file
 * 2. Block access to sensitive paths (e.g., .env files)
 * 3. Delegate to the original read implementation for allowed files
 *
 * Usage:
 *   pi --no-tools --tools bash,edit,write -e ./tool-override.ts
 *
 * The --no-tools flag disables all built-in tools, then --tools adds back the ones
 * we want (excluding read, which we're overriding). The extension provides our
 * custom read implementation.
 *
 * Alternatively, without --no-tools the extension's read tool will override the
 * built-in read tool automatically.
 */

import type { TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { appendFileSync, constants, readFileSync } from "fs";
import { access, readFile } from "fs/promises";
import { homedir } from "os";
import { join, resolve } from "path";

const LOG_FILE = join(homedir(), ".pi", "agent", "read-access.log");

// Paths that are blocked from reading
const BLOCKED_PATTERNS = [
	/\.env$/,
	/\.env\..+$/,
	/secrets?\.(json|yaml|yml|toml)$/i,
	/credentials?\.(json|yaml|yml|toml)$/i,
	/\/\.ssh\//,
	/\/\.aws\//,
	/\/\.gnupg\//,
];

function isBlockedPath(path: string): boolean {
	return BLOCKED_PATTERNS.some((pattern) => pattern.test(path));
}

function logAccess(path: string, allowed: boolean, reason?: string) {
	const timestamp = new Date().toISOString();
	const status = allowed ? "ALLOWED" : "BLOCKED";
	const msg = reason ? ` (${reason})` : "";
	const line = `[${timestamp}] ${status}: ${path}${msg}\n`;

	try {
		appendFileSync(LOG_FILE, line);
	} catch {
		// Ignore logging errors
	}
}

const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "read", // Same name as built-in - this will override it
		label: "read (audited)",
		description:
			"Read the contents of a file with access logging. Some sensitive paths (.env, secrets, credentials) are blocked.",
		parameters: readSchema,

		async execute(_toolCallId, params, _onUpdate, ctx) {
			const { path, offset, limit } = params;
			const absolutePath = resolve(ctx.cwd, path);

			// Check if path is blocked
			if (isBlockedPath(absolutePath)) {
				logAccess(absolutePath, false, "matches blocked pattern");
				return {
					content: [
						{
							type: "text",
							text: `Access denied: "${path}" matches a blocked pattern (sensitive file). This tool blocks access to .env files, secrets, credentials, and SSH/AWS/GPG directories.`,
						},
					],
					details: { blocked: true },
				};
			}

			// Log allowed access
			logAccess(absolutePath, true);

			// Perform the actual read (simplified implementation)
			try {
				await access(absolutePath, constants.R_OK);
				const content = await readFile(absolutePath, "utf-8");
				const lines = content.split("\n");

				// Apply offset and limit
				const startLine = offset ? Math.max(0, offset - 1) : 0;
				const endLine = limit ? startLine + limit : lines.length;
				const selectedLines = lines.slice(startLine, endLine);

				// Basic truncation (50KB limit)
				let text = selectedLines.join("\n");
				const maxBytes = 50 * 1024;
				if (Buffer.byteLength(text, "utf-8") > maxBytes) {
					text = `${text.slice(0, maxBytes)}\n\n[Output truncated at 50KB]`;
				}

				return {
					content: [{ type: "text", text }] as TextContent[],
					details: { lines: lines.length },
				};
			} catch (error: any) {
				return {
					content: [{ type: "text", text: `Error reading file: ${error.message}` }] as TextContent[],
					details: { error: true },
				};
			}
		},

		// Custom rendering to show it's the audited version
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("read ")) + theme.fg("accent", args.path), 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			const content = result.content[0];
			if (content?.type === "text" && content.text.startsWith("Access denied")) {
				return new Text(theme.fg("error", "Access denied (sensitive file)"), 0, 0);
			}
			if (content?.type === "text" && content.text.startsWith("Error")) {
				return new Text(theme.fg("error", content.text), 0, 0);
			}

			// Show preview of content
			if (content?.type === "text") {
				const lines = content.text.split("\n");
				const preview = lines.slice(0, expanded ? 10 : 3);
				let text = theme.fg("success", `Read ${lines.length} lines`);
				if (expanded) {
					for (const line of preview) {
						text += `\n${theme.fg("dim", line.slice(0, 100))}`;
					}
					if (lines.length > 10) {
						text += `\n${theme.fg("muted", `... ${lines.length - 10} more lines`)}`;
					}
				}
				return new Text(text, 0, 0);
			}

			return new Text(theme.fg("dim", "Read complete"), 0, 0);
		},
	});

	// Also register a command to view the access log
	pi.registerCommand("read-log", {
		description: "View the file access log",
		handler: async (_args, ctx) => {
			try {
				const log = readFileSync(LOG_FILE, "utf-8");
				const lines = log.trim().split("\n").slice(-20); // Last 20 entries
				ctx.ui.notify(`Recent file access:\n${lines.join("\n")}`, "info");
			} catch {
				ctx.ui.notify("No access log found", "info");
			}
		},
	});
}
