/**
 * LSP diagnostic feedback loop.
 *
 * Provides automatic LSP error detection after file modifications (edit, write,
 * and any extension tool that declares getModifiedFilePath).
 *
 * Errors are appended to the tool result so the agent gets immediate feedback.
 */

export type { DiagnosticsListener } from "./client.js";
export { LspClient } from "./client.js";
export { formatDiagnostics } from "./formatter.js";
export { getLspDiagnosticsForToolResult } from "./hook.js";
export type { FileDiagnostics, TouchFileResult } from "./manager.js";
export { LspManager } from "./manager.js";
export {
	DiagnosticSeverity,
	type DiagnosticSeverityValue,
	findProjectRoot,
	findServerForExtension,
	getFileExtension,
	getLanguageId,
	type LspDiagnostic,
	type LspPosition,
	type LspRange,
	type LspServerDefinition,
	pathToUri,
	uriToPath,
} from "./servers.js";
