import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import lockfile from "proper-lockfile";
import { canonicalizePath, resolvePath } from "../utils/paths.ts";

const MAX_HISTORY_ENTRIES = 100;
const MAX_PROMPT_BYTES = 16 * 1024;

type PromptHistoryEntry = {
	cwd: string;
	text: string;
	updatedAt: number;
};

type PromptHistoryFile = {
	version: 1;
	entries: PromptHistoryEntry[];
};

function canonicalizeCwd(cwd: string): string {
	return canonicalizePath(resolvePath(cwd));
}

function isWithinWorkspace(cwd: string, workspace: string): boolean {
	const path = relative(workspace, cwd);
	return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function limitEntries(entries: PromptHistoryEntry[]): PromptHistoryEntry[] {
	return entries.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_HISTORY_ENTRIES);
}

function parseHistory(content: string): PromptHistoryFile {
	const parsed: unknown = JSON.parse(content);
	if (typeof parsed !== "object" || parsed === null || !("entries" in parsed) || !Array.isArray(parsed.entries)) {
		return { version: 1, entries: [] };
	}

	const entries = parsed.entries.flatMap((entry): PromptHistoryEntry[] => {
		if (typeof entry !== "object" || entry === null) return [];
		const { cwd, text, updatedAt } = entry as Record<string, unknown>;
		if (typeof cwd !== "string" || typeof text !== "string" || typeof updatedAt !== "number") return [];
		if (!Number.isFinite(updatedAt)) return [];
		const trimmed = text.trim();
		if (!trimmed || Buffer.byteLength(trimmed, "utf8") > MAX_PROMPT_BYTES) return [];
		return [{ cwd: canonicalizeCwd(cwd), text: trimmed, updatedAt }];
	});
	return { version: 1, entries };
}

export class PromptHistoryStore {
	private readonly path: string;

	constructor(agentDir: string) {
		this.path = join(agentDir, "prompt-history.json");
	}

	load(cwd: string): string[] {
		try {
			if (!existsSync(this.path)) return [];
			const workspace = canonicalizeCwd(cwd);
			const entries = parseHistory(readFileSync(this.path, "utf8"))
				.entries.filter((entry) => isWithinWorkspace(entry.cwd, workspace))
				.sort((a, b) => b.updatedAt - a.updatedAt);
			const seen = new Set<string>();
			const history: string[] = [];
			for (const entry of entries) {
				if (seen.has(entry.text)) continue;
				seen.add(entry.text);
				history.push(entry.text);
				if (history.length === MAX_HISTORY_ENTRIES) break;
			}
			return history;
		} catch {
			return [];
		}
	}

	record(cwd: string, text: string): void {
		const normalized = text.trim();
		if (!normalized || Buffer.byteLength(normalized, "utf8") > MAX_PROMPT_BYTES) return;

		try {
			mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
			if (!existsSync(this.path)) {
				writeFileSync(this.path, JSON.stringify({ version: 1, entries: [] }), { encoding: "utf8", mode: 0o600 });
			}
			const release = lockfile.lockSync(this.path, { realpath: false });
			try {
				const history = parseHistory(readFileSync(this.path, "utf8"));
				const canonicalCwd = canonicalizeCwd(cwd);
				const latestUpdatedAt = Math.max(Date.now(), ...history.entries.map((entry) => entry.updatedAt + 1));
				const entries = limitEntries([
					{ cwd: canonicalCwd, text: normalized, updatedAt: latestUpdatedAt },
					...history.entries.filter((entry) => entry.cwd !== canonicalCwd || entry.text !== normalized),
				]);
				const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
				try {
					writeFileSync(temporaryPath, JSON.stringify({ version: 1, entries }), { encoding: "utf8", mode: 0o600 });
					renameSync(temporaryPath, this.path);
				} finally {
					if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
				}
			} finally {
				release();
			}
		} catch {
			// History persistence must not interfere with prompt submission.
		}
	}
}
