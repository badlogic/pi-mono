import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getSessionsDir } from "./config.js";
import type {
	AssistantMessageWithMetrics,
	MessageStats,
	SessionEntry,
	SessionHeader,
	SessionMessageEntry,
	UsageStats,
} from "./types.js";

function isSessionHeader(entry: SessionEntry): entry is SessionHeader {
	return entry.type === "session" && typeof (entry as SessionHeader).cwd === "string";
}

function isAssistantMessageEntry(entry: SessionEntry): entry is SessionMessageEntry {
	if (entry.type !== "message") return false;
	const message = (entry as SessionMessageEntry).message;
	return message?.role === "assistant";
}

function toUsageStats(usage: AssistantMessageWithMetrics["usage"] | UsageStats): UsageStats {
	return {
		input: usage.input,
		output: usage.output,
		cacheRead: usage.cacheRead,
		cacheWrite: usage.cacheWrite,
		totalTokens: usage.totalTokens,
		premiumRequests: "premiumRequests" in usage ? usage.premiumRequests : undefined,
		cost: {
			input: usage.cost.input,
			output: usage.cost.output,
			cacheRead: usage.cost.cacheRead,
			cacheWrite: usage.cost.cacheWrite,
			total: usage.cost.total,
		},
	};
}

function extractStats(sessionFile: string, folder: string, entry: SessionMessageEntry): MessageStats | null {
	const message = entry.message as AssistantMessageWithMetrics;
	if (message.role !== "assistant") return null;
	return {
		sessionFile,
		entryId: entry.id,
		folder,
		model: message.model,
		provider: message.provider,
		api: message.api,
		timestamp: message.timestamp,
		duration: message.duration ?? null,
		ttft: message.ttft ?? null,
		stopReason: message.stopReason,
		errorMessage: message.errorMessage ?? null,
		usage: toUsageStats(message.usage),
	};
}

function parseLine(line: string): SessionEntry | null {
	if (!line.trim()) return null;
	try {
		return JSON.parse(line) as SessionEntry;
	} catch {
		return null;
	}
}

export async function parseSessionFile(
	sessionPath: string,
	fromOffset = 0,
): Promise<{ stats: MessageStats[]; newOffset: number }> {
	let raw: Buffer;
	try {
		raw = await readFile(sessionPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { stats: [], newOffset: fromOffset };
		}
		throw error;
	}

	const start = Math.max(0, Math.min(fromOffset, raw.length));
	const stats: MessageStats[] = [];
	let cursor = start;
	let folder = dirname(sessionPath);

	while (cursor < raw.length) {
		const newlineIndex = raw.indexOf(0x0a, cursor);
		if (newlineIndex === -1) {
			break;
		}

		const line = raw.toString("utf8", cursor, newlineIndex);
		const entry = parseLine(line);
		if (entry) {
			if (isSessionHeader(entry)) {
				folder = entry.cwd;
			} else if (isAssistantMessageEntry(entry)) {
				const extracted = extractStats(sessionPath, folder, entry);
				if (extracted) stats.push(extracted);
			}
		}

		cursor = newlineIndex + 1;
	}

	return { stats, newOffset: cursor };
}

async function walkSessionFiles(dir: string): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const files: string[] = [];
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walkSessionFiles(fullPath)));
		} else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
			files.push(fullPath);
		}
	}

	return files;
}

export async function listAllSessionFiles(): Promise<string[]> {
	return walkSessionFiles(getSessionsDir());
}

export async function getSessionEntry(sessionPath: string, entryId: string): Promise<SessionEntry | null> {
	let raw: string;
	try {
		raw = await readFile(sessionPath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return null;
		}
		throw error;
	}

	for (const line of raw.split("\n")) {
		const entry = parseLine(line);
		if (entry && "id" in entry && entry.id === entryId) {
			return entry;
		}
	}

	return null;
}
