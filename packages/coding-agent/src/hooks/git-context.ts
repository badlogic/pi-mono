import { execSync } from "child_process";
import type { HookGitContext } from "./types.js";

/**
 * Check if the current directory is a git repository.
 */
function isGitRepo(cwd: string): boolean {
	try {
		execSync("git rev-parse --git-dir", { cwd, stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

/**
 * Create a git context for hooks.
 * Returns undefined if not in a git repository.
 */
export function createGitContext(cwd: string): HookGitContext | undefined {
	if (!isGitRepo(cwd)) {
		return undefined;
	}

	return {
		isRepo: true,

		async head(): Promise<string> {
			try {
				return execSync("git rev-parse HEAD", { cwd, encoding: "utf-8" }).trim();
			} catch {
				return "";
			}
		},

		async isDirty(): Promise<boolean> {
			try {
				const status = execSync("git status --porcelain", { cwd, encoding: "utf-8" });
				return status.trim().length > 0;
			} catch {
				return false;
			}
		},
	};
}
