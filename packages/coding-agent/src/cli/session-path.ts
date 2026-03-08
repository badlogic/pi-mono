/**
 * Session argument resolution helpers.
 */

import { existsSync, statSync } from "fs";
import { APP_NAME } from "../config.js";
import { SessionManager } from "../core/session-manager.js";

/** Result from resolving a session argument */
export type ResolvedSession =
	| { type: "path"; path: string } // Direct file path
	| { type: "local"; path: string } // Found in current project
	| { type: "global"; path: string; cwd: string } // Found in different project
	| { type: "not_found"; arg: string; pathLike: boolean; hint?: string }; // Not found anywhere

const LIKELY_ESCAPED_WINDOWS_PATH = /^[a-zA-Z]:[^\\/].*\.jsonl$/;

export function isPathLikeSessionArg(sessionArg: string): boolean {
	return sessionArg.includes("/") || sessionArg.includes("\\") || sessionArg.endsWith(".jsonl");
}

function isExistingFile(filePath: string): boolean {
	if (!existsSync(filePath)) {
		return false;
	}

	try {
		return statSync(filePath).isFile();
	} catch {
		return false;
	}
}

/**
 * Detect likely Git Bash/MSYS escaping of unquoted Windows paths.
 * Example broken input: C:UsersAdmin.piagentsessions--C--...jsonl
 */
export function getSessionPathNotFoundHint(sessionArg: string): string | undefined {
	if (!LIKELY_ESCAPED_WINDOWS_PATH.test(sessionArg)) {
		return undefined;
	}

	return [
		"Hint: this looks like an unquoted Windows path parsed by bash.",
		"If you're using Git Bash/MSYS, quote the path or use forward slashes:",
		`  ${APP_NAME} --session 'C:\\Users\\Admin\\.pi\\agent\\sessions\\...jsonl'`,
		`  ${APP_NAME} --session C:/Users/Admin/.pi/agent/sessions/...jsonl`,
	].join("\n");
}

/**
 * Resolve a session argument to a file path.
 * If it looks like a path, it must point to an existing file.
 * Otherwise, treat it as a session ID prefix.
 */
export async function resolveSessionPath(
	sessionArg: string,
	cwd: string,
	sessionDir?: string,
): Promise<ResolvedSession> {
	const pathLike = isPathLikeSessionArg(sessionArg);

	if (pathLike) {
		if (isExistingFile(sessionArg)) {
			return { type: "path", path: sessionArg };
		}
		return {
			type: "not_found",
			arg: sessionArg,
			pathLike: true,
			hint: getSessionPathNotFoundHint(sessionArg),
		};
	}

	const localSessions = await SessionManager.list(cwd, sessionDir);
	const localMatches = localSessions.filter((s) => s.id.startsWith(sessionArg));
	if (localMatches.length >= 1) {
		return { type: "local", path: localMatches[0].path };
	}

	const allSessions = await SessionManager.listAll();
	const globalMatches = allSessions.filter((s) => s.id.startsWith(sessionArg));
	if (globalMatches.length >= 1) {
		const match = globalMatches[0];
		return { type: "global", path: match.path, cwd: match.cwd };
	}

	return { type: "not_found", arg: sessionArg, pathLike: false };
}
