/**
 * LSP Manager - orchestrates LSP servers and collects project-wide diagnostics.
 */

import { readFile } from "node:fs/promises";
import { LspClient } from "./client.js";
import {
	DiagnosticSeverity,
	findProjectRoot,
	findServerForExtension,
	getFileExtension,
	getLanguageId,
	type LspDiagnostic,
	type LspServerDefinition,
	pathToUri,
	uriToPath,
} from "./servers.js";

// ============================================================================
// Types
// ============================================================================

/** Diagnostics for a single file */
export interface FileDiagnostics {
	uri: string;
	filePath: string;
	diagnostics: LspDiagnostic[];
}

/** Result of touching a file: local + project-wide regressions */
export interface TouchFileResult {
	/** Errors in the modified file */
	localErrors: FileDiagnostics;
	/** Errors in other files (regressions), limited to top 5 */
	regressions: FileDiagnostics[];
	/** Total number of regression files (before limiting to 5) */
	totalRegressionFiles: number;
}

// ============================================================================
// LSP Manager
// ============================================================================

/** Active server instance */
interface ActiveServer {
	client: LspClient;
	rootUri: string;
	/** All diagnostics keyed by URI, updated via publishDiagnostics */
	diagnosticsByUri: Map<string, LspDiagnostic[]>;
	/** Files we've opened/touched */
	openFiles: Set<string>;
}

export class LspManager {
	/** Active servers keyed by server definition ID */
	private servers = new Map<string, ActiveServer>();
	private cwd: string;
	private _disposed = false;

	/** Maximum number of regression files to report */
	static readonly MAX_REGRESSION_FILES = 5;

	constructor(cwd: string) {
		this.cwd = cwd;
	}

	get disposed(): boolean {
		return this._disposed;
	}

	/**
	 * Touch a file after modification: sync with LSP, wait for diagnostics,
	 * and return local errors + project-wide regressions.
	 *
	 * This is the "Synchronous Blocking" pattern from the PRD (section 2.2).
	 */
	async touchFile(filePath: string, timeoutMs = 10_000): Promise<TouchFileResult | undefined> {
		if (this._disposed) return undefined;

		const ext = getFileExtension(filePath);
		const definition = findServerForExtension(ext);
		if (!definition) return undefined;

		let content: string;
		try {
			content = await readFile(filePath, "utf-8");
		} catch {
			return undefined;
		}

		const server = await this.getOrCreateServer(definition, filePath);
		if (!server) return undefined;

		const uri = pathToUri(filePath);
		const languageId = getLanguageId(ext);

		// Touch with blocking wait for diagnostics
		const localDiags = await server.client.touchFile(uri, languageId, content, true, timeoutMs);

		// Update our diagnostics cache
		server.diagnosticsByUri.set(uri, localDiags);
		server.openFiles.add(uri);

		// Filter to errors only (severity 1)
		const localErrors: FileDiagnostics = {
			uri,
			filePath,
			diagnostics: filterErrors(localDiags),
		};

		// Collect regressions from other files
		const allRegressions: FileDiagnostics[] = [];
		for (const [diagUri, diags] of server.diagnosticsByUri) {
			if (diagUri === uri) continue;
			const errors = filterErrors(diags);
			if (errors.length > 0) {
				allRegressions.push({
					uri: diagUri,
					filePath: uriToPath(diagUri),
					diagnostics: errors,
				});
			}
		}

		// Sort regressions by number of errors (most errors first)
		allRegressions.sort((a, b) => b.diagnostics.length - a.diagnostics.length);

		return {
			localErrors,
			regressions: allRegressions.slice(0, LspManager.MAX_REGRESSION_FILES),
			totalRegressionFiles: allRegressions.length,
		};
	}

	/**
	 * Dispose all active servers.
	 */
	async dispose(): Promise<void> {
		if (this._disposed) return;
		this._disposed = true;

		const disposePromises: Promise<void>[] = [];
		for (const server of this.servers.values()) {
			disposePromises.push(server.client.dispose());
		}
		await Promise.allSettled(disposePromises);
		this.servers.clear();
	}

	// ========================================================================
	// Private
	// ========================================================================

	/**
	 * Get an existing server or create a new one for the given definition.
	 */
	private async getOrCreateServer(
		definition: LspServerDefinition,
		filePath: string,
	): Promise<ActiveServer | undefined> {
		const existing = this.servers.get(definition.id);
		if (existing && !existing.client.disposed) return existing;

		// Find project root
		const projectRoot = findProjectRoot(filePath, definition.rootMarkers) ?? this.cwd;
		const rootUri = pathToUri(projectRoot);

		const client = new LspClient(definition);
		const activeServer: ActiveServer = {
			client,
			rootUri,
			diagnosticsByUri: new Map(),
			openFiles: new Set(),
		};

		// Listen for diagnostics from any file
		client.onDiagnostics((uri, diagnostics) => {
			activeServer.diagnosticsByUri.set(uri, diagnostics);
		});

		// Clean up on exit
		client.on("exit", () => {
			this.servers.delete(definition.id);
		});

		try {
			await client.start(rootUri, projectRoot);
			this.servers.set(definition.id, activeServer);
			return activeServer;
		} catch {
			return undefined;
		}
	}
}

/**
 * Filter diagnostics to only include errors (severity 1).
 */
function filterErrors(diagnostics: LspDiagnostic[]): LspDiagnostic[] {
	return diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
}
