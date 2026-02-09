/**
 * Run LSP diagnostics after a file modification.
 */

import type { TextContent } from "@mariozechner/pi-ai";
import { formatDiagnostics } from "./formatter.js";
import type { LspManager } from "./manager.js";

/**
 * Run LSP diagnostics after a file modification and return additional
 * content to append to the tool result.
 */
export async function getLspDiagnosticsForToolResult(
	lspManager: LspManager,
	absolutePath: string,
): Promise<TextContent | undefined> {
	try {
		const result = await lspManager.touchFile(absolutePath);
		if (!result) return undefined;

		const formatted = formatDiagnostics(result);
		if (!formatted) return undefined;

		return { type: "text", text: `\n\n${formatted}` };
	} catch {
		// LSP errors should never break tool execution
		return undefined;
	}
}
