/** Session file deletion with trash fallback. */

import { spawn } from "node:child_process";
import { unlink } from "node:fs/promises";

const TRASH_ERROR_HINT_LIMIT = 200;

/** Result of running the trash CLI. */
interface TrashResult {
	status: number | null;
	stderr: string;
	error?: string;
}

/** Result of a session file deletion attempt. */
export interface DeleteSessionResult {
	ok: boolean;
	method: "trash" | "unlink";
	error?: string;
}

/** Build a diagnostic hint from a failed trash attempt. */
function getTrashErrorHint(trashResult: TrashResult): string | undefined {
	const parts: string[] = [];
	if (trashResult.error) {
		parts.push(trashResult.error);
	}
	const stderr = trashResult.stderr?.trim();
	if (stderr) {
		parts.push(stderr.split("\n")[0] ?? stderr);
	}
	if (parts.length === 0) return undefined;
	return `trash: ${parts.join(" · ").slice(0, TRASH_ERROR_HINT_LIMIT)}`;
}

/** Delete a session file, trying the `trash` CLI first, then falling back to unlink. */
export async function deleteSessionFile(sessionPath: string): Promise<DeleteSessionResult> {
	if (!sessionPath) throw new Error("sessionPath must be non-empty");

	const trashArgs = sessionPath.startsWith("-") ? ["--", sessionPath] : [sessionPath];

	// Try `trash` first (if installed)
	const trashResult = await runTrash(trashArgs);

	if (trashResult.status === 0) {
		return { ok: true, method: "trash" };
	}

	// Fallback to permanent deletion
	try {
		await unlink(sessionPath);
		return { ok: true, method: "unlink" };
	} catch (err) {
		// File already gone (trash may have worked, or file never existed) — treat as success
		if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
			return { ok: true, method: "trash" };
		}
		const unlinkError = err instanceof Error ? err.message : String(err);
		const trashErrorHint = getTrashErrorHint(trashResult);
		const error = trashErrorHint ? `${unlinkError} (${trashErrorHint})` : unlinkError;
		return { ok: false, method: "unlink", error };
	}
}

/** Run `trash` as an async child process and collect its result. */
function runTrash(args: string[]): Promise<TrashResult> {
	return new Promise((resolve) => {
		let stderr = "";
		try {
			const child = spawn("trash", args, { stdio: ["ignore", "ignore", "pipe"] });
			child.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});
			child.on("error", (err) => {
				resolve({ status: null, stderr, error: err.message });
			});
			child.on("close", (code) => {
				resolve({ status: code, stderr });
			});
		} catch (err) {
			resolve({ status: null, stderr, error: err instanceof Error ? err.message : String(err) });
		}
	});
}
