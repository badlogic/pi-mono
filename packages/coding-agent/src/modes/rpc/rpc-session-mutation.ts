/**
 * Session mutation operations for RPC commands.
 *
 * Handles rename_session and delete_session on arbitrary session paths.
 * Functions throw on validation errors - the RPC handler catches and
 * converts to error responses.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { deleteSessionFile } from "../../core/session-file-ops.js";
import { SessionManager } from "../../core/session-manager.js";

/**
 * Rename a session by path.
 *
 * Opens the session file, appends a session_info entry with the new name.
 * Throws if path doesn't exist or name is empty.
 */
export function renameSessionByPath(sessionPath: string, name: string): void {
	const trimmed = name.trim();
	if (!trimmed) {
		throw new Error("Session name cannot be empty");
	}

	const resolved = resolve(sessionPath);
	if (!existsSync(resolved)) {
		throw new Error(`Session file not found: ${sessionPath}`);
	}

	const mgr = SessionManager.open(resolved);
	mgr.appendSessionInfo(trimmed);
}

/**
 * Delete a session by path.
 *
 * Throws if path doesn't exist, path is the active session, or deletion fails.
 */
export async function deleteSessionByPath(sessionPath: string, activeSessionPath: string | undefined): Promise<void> {
	const resolved = resolve(sessionPath);

	if (!existsSync(resolved)) {
		throw new Error(`Session file not found: ${sessionPath}`);
	}

	// Compare resolved paths to avoid false negatives from relative vs absolute
	if (activeSessionPath && resolved === resolve(activeSessionPath)) {
		throw new Error("Cannot delete the currently active session");
	}

	const result = await deleteSessionFile(resolved);

	if (!result.ok) {
		throw new Error(result.error || "Failed to delete session file");
	}
}
