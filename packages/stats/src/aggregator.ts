import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import {
	closeDb,
	getRecentErrors as dbGetRecentErrors,
	getRecentRequests as dbGetRecentRequests,
	getFileOffset,
	getMessageById,
	getMessageCount,
	getModelPerformanceSeries,
	getModelTimeSeries,
	getOverallStats,
	getStatsByFolder,
	getStatsByModel,
	getTimeSeries,
	initDb,
	insertMessageStats,
	setFileOffset,
} from "./db.js";
import { getSessionEntry, listAllSessionFiles, parseSessionFile } from "./parser.js";
import type { DashboardStats, MessageStats, RequestDetails, SessionMessageEntry } from "./types.js";

function isSessionMessageEntry(entry: unknown): entry is SessionMessageEntry {
	return (
		typeof entry === "object" && entry !== null && "type" in entry && entry.type === "message" && "message" in entry
	);
}

async function syncSessionFile(sessionFile: string): Promise<number> {
	let fileInfo: Stats;
	try {
		fileInfo = await stat(sessionFile);
	} catch {
		return 0;
	}

	const lastModified = fileInfo.mtimeMs;
	const stored = getFileOffset(sessionFile);
	if (stored && stored.lastModified >= lastModified && stored.offset <= fileInfo.size) {
		return 0;
	}

	const fromOffset = stored && stored.offset <= fileInfo.size ? stored.offset : 0;
	const { stats, newOffset } = await parseSessionFile(sessionFile, fromOffset);
	if (stats.length > 0) {
		insertMessageStats(stats);
	}
	setFileOffset(sessionFile, newOffset, lastModified);
	return stats.length;
}

export async function syncAllSessions(): Promise<{ processed: number; files: number }> {
	initDb();
	const files = await listAllSessionFiles();
	let processed = 0;
	let filesWithChanges = 0;
	for (const file of files) {
		const count = await syncSessionFile(file);
		if (count > 0) {
			processed += count;
			filesWithChanges += 1;
		}
	}
	return { processed, files: filesWithChanges };
}

export async function getDashboardStats(): Promise<DashboardStats> {
	initDb();
	return {
		overall: getOverallStats(),
		byModel: getStatsByModel(),
		byFolder: getStatsByFolder(),
		timeSeries: getTimeSeries(24),
		modelSeries: getModelTimeSeries(14),
		modelPerformanceSeries: getModelPerformanceSeries(14),
	};
}

export async function getRecentRequests(limit?: number): Promise<MessageStats[]> {
	initDb();
	return dbGetRecentRequests(limit);
}

export async function getRecentErrors(limit?: number): Promise<MessageStats[]> {
	initDb();
	return dbGetRecentErrors(limit);
}

export async function getRequestDetails(id: number): Promise<RequestDetails | null> {
	initDb();
	const message = getMessageById(id);
	if (!message) return null;
	const entry = await getSessionEntry(message.sessionFile, message.entryId);
	if (!isSessionMessageEntry(entry)) return null;
	return {
		...message,
		messages: [entry],
		output: entry.message,
	};
}

export async function getTotalMessageCount(): Promise<number> {
	initDb();
	return getMessageCount();
}

export { closeDb };
