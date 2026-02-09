/**
 * Diagnostic formatter for LLM consumption.
 */

import type { FileDiagnostics, TouchFileResult } from "./manager.js";
import type { LspDiagnostic } from "./servers.js";

/**
 * Format a TouchFileResult into a string suitable for appending to tool output.
 * Returns undefined if there are no errors to report.
 */
export function formatDiagnostics(result: TouchFileResult): string | undefined {
	const localErrorCount = result.localErrors.diagnostics.length;
	const hasRegressions = result.regressions.length > 0;

	if (localErrorCount === 0 && !hasRegressions) {
		return undefined;
	}

	const parts: string[] = [];

	// Local errors (modified file)
	if (localErrorCount > 0) {
		parts.push("LSP errors detected in this file, please fix:");
		parts.push(formatFileDiagnostics(result.localErrors));
	}

	// Regression errors (other files)
	if (hasRegressions) {
		parts.push("LSP errors detected in other files:");
		for (const regression of result.regressions) {
			parts.push(formatFileDiagnostics(regression));
		}

		if (result.totalRegressionFiles > result.regressions.length) {
			parts.push(`(${result.totalRegressionFiles - result.regressions.length} more files with errors not shown)`);
		}
	}

	return parts.join("\n");
}

/**
 * Format diagnostics for a single file into XML block.
 */
function formatFileDiagnostics(file: FileDiagnostics): string {
	const lines = file.diagnostics.map((d) => formatSingleDiagnostic(d));
	return `<diagnostics file="${file.filePath}">\n${lines.join("\n")}\n</diagnostics>`;
}

/**
 * Format a single diagnostic into a one-line string.
 * Uses 1-based line/col to match editor conventions.
 */
function formatSingleDiagnostic(diagnostic: LspDiagnostic): string {
	const line = diagnostic.range.start.line + 1;
	const col = diagnostic.range.start.character + 1;
	const source = diagnostic.source ? ` (${diagnostic.source})` : "";
	const code = diagnostic.code !== undefined ? ` [${diagnostic.code}]` : "";
	return `ERROR [${line}:${col}]${code}${source} ${diagnostic.message}`;
}
