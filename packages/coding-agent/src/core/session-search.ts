import type { Api, Model } from "@mariozechner/pi-ai";
import { completeSimple } from "@mariozechner/pi-ai";
import { fuzzyFilter } from "@mariozechner/pi-tui";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getAgentDir } from "../config.js";
import { type SessionInfo, SessionManager } from "./session-manager.js";
import { buildSessionTree, buildTreePrefix, flattenSessionTree } from "./session-tree.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SessionSearchScope = "cwd" | "all" | "recent";

export interface SessionSearchSettings {
	enabled?: boolean; // default: true
	scope?: SessionSearchScope; // default: "all"
	recentLimit?: number; // default: 25 (only for scope "recent")
}

export interface SessionSearchItem {
	sessionInfo: SessionInfo;
	label: string;
	description: string;
	cleanName: string; // Name without tree prefix or timestamp
}

interface SummaryCacheEntry {
	sessionPath: string;
	mtimeMs: number;
	summary: string;
	createdAt: number;
}

interface SummaryCache {
	version: 1;
	entries: Record<string, SummaryCacheEntry>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RESULTS = 25;

const SUMMARY_CACHE_DIR = join(getAgentDir(), "session-summaries");
const SUMMARY_CACHE_FILE = join(SUMMARY_CACHE_DIR, "cache.json");

const SUMMARIZATION_SYSTEM_PROMPT = `You are a session summarizer. Given a conversation transcript, produce a concise summary that captures the key topics discussed, decisions made, and any important context. The summary should be useful as reference material when injected into a new conversation. Be brief but thorough. Output plain text only, no markdown headers.`;

// ---------------------------------------------------------------------------
// Relative time formatting
// ---------------------------------------------------------------------------

function formatRelativeTime(date: Date): string {
	const now = Date.now();
	const diffMs = now - date.getTime();
	const diffMinutes = Math.floor(diffMs / 60_000);
	const diffHours = Math.floor(diffMs / 3_600_000);
	const diffDays = Math.floor(diffMs / 86_400_000);

	if (diffMinutes < 1) return "just now";
	if (diffMinutes < 60) return `${diffMinutes}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays < 30) return `${diffDays}d ago`;
	if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
	return `${Math.floor(diffDays / 365)}y ago`;
}

// ---------------------------------------------------------------------------

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max - 1)}…`;
}

// ---------------------------------------------------------------------------
// Session discovery
// ---------------------------------------------------------------------------

export async function discoverSessions(
	cwd: string,
	scope: SessionSearchScope,
	recentLimit: number,
): Promise<SessionInfo[]> {
	let sessions: SessionInfo[];

	switch (scope) {
		case "cwd":
			sessions = await SessionManager.list(cwd);
			break;
		case "all":
			sessions = await SessionManager.listAll();
			break;
		case "recent":
			sessions = await SessionManager.listAll();
			break;
		default:
			sessions = await SessionManager.listAll();
	}

	// Deduplicate by path (keep first occurrence)
	const seen = new Set<string>();
	sessions = sessions.filter((s) => {
		if (seen.has(s.path)) {
			return false;
		}
		seen.add(s.path);
		return true;
	});

	// Sort by modified descending (most recent first)
	sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());

	if (scope === "recent") {
		sessions = sessions.slice(0, recentLimit);
	}

	return sessions;
}

// ---------------------------------------------------------------------------
// Search and build items for autocomplete
// ---------------------------------------------------------------------------

export function buildSessionSearchItems(sessions: SessionInfo[]): SessionSearchItem[] {
	const tree = buildSessionTree(sessions);
	const flattened = flattenSessionTree(tree);

	return flattened.map((node) => {
		const rawName = node.info.name || truncate(node.info.firstMessage, 50);
		// Strip newlines and normalize whitespace in the title
		const name = rawName.replace(/[\r\n]+/g, " ").trim();
		const relTime = formatRelativeTime(node.info.modified);
		const prefix = buildTreePrefix(node);

		return {
			sessionInfo: node.info,
			label: `${prefix}${name} (${relTime})`,
			description: "", // Empty description for cleaner display
			cleanName: name, // Store clean name without prefix or timestamp
		};
	});
}

export function searchSessions(items: SessionSearchItem[], query: string): SessionSearchItem[] {
	if (!query.trim()) {
		return items.slice(0, MAX_RESULTS);
	}

	const filtered = fuzzyFilter(items, query, (item) => `${item.label} ${item.description}`);
	return filtered.slice(0, MAX_RESULTS);
}

// ---------------------------------------------------------------------------
// Summary cache
// ---------------------------------------------------------------------------

function loadSummaryCache(): SummaryCache {
	try {
		if (existsSync(SUMMARY_CACHE_FILE)) {
			const raw = readFileSync(SUMMARY_CACHE_FILE, "utf-8");
			const parsed = JSON.parse(raw) as SummaryCache;
			if (parsed.version === 1 && typeof parsed.entries === "object") {
				return parsed;
			}
		}
	} catch {
		// Corrupted cache, start fresh
	}
	return { version: 1, entries: {} };
}

function saveSummaryCache(cache: SummaryCache): void {
	if (!existsSync(SUMMARY_CACHE_DIR)) {
		mkdirSync(SUMMARY_CACHE_DIR, { recursive: true });
	}
	writeFileSync(SUMMARY_CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
}

export function getCachedSummary(sessionPath: string): string | null {
	const cache = loadSummaryCache();
	const entry = cache.entries[sessionPath];
	if (!entry) return null;

	try {
		const stats = statSync(sessionPath);
		if (stats.mtimeMs !== entry.mtimeMs) {
			return null; // File changed since cache was created
		}
		return entry.summary;
	} catch {
		return null;
	}
}

function cacheSummary(sessionPath: string, summary: string): void {
	const cache = loadSummaryCache();
	try {
		const stats = statSync(sessionPath);
		cache.entries[sessionPath] = {
			sessionPath,
			mtimeMs: stats.mtimeMs,
			summary,
			createdAt: Date.now(),
		};
		saveSummaryCache(cache);
	} catch {
		// Can't stat the file, don't cache
	}
}

// ---------------------------------------------------------------------------
// Session summarization
// ---------------------------------------------------------------------------

function buildTranscriptForSummarization(sessionPath: string): string {
	const sm = SessionManager.open(sessionPath);
	const context = sm.buildSessionContext();
	const lines: string[] = [];

	for (const msg of context.messages) {
		if (msg.role === "user" || msg.role === "assistant") {
			const content = msg.content;
			let text: string;
			if (typeof content === "string") {
				text = content;
			} else if (Array.isArray(content)) {
				text = content
					.filter((block): block is { type: "text"; text: string } => block.type === "text")
					.map((block) => block.text)
					.join("\n");
			} else {
				continue;
			}
			if (text.trim()) {
				const role = msg.role === "user" ? "User" : "Assistant";
				lines.push(`${role}: ${text.trim()}`);
			}
		}
	}

	return lines.join("\n\n");
}

export async function summarizeSession(
	sessionPath: string,
	model: Model<Api>,
	options?: { signal?: AbortSignal; apiKey?: string },
): Promise<string> {
	// Check cache first
	const cached = getCachedSummary(sessionPath);
	if (cached) return cached;

	const transcript = buildTranscriptForSummarization(sessionPath);
	if (!transcript.trim()) {
		return "(empty session)";
	}

	// Truncate very long transcripts to avoid excessive token usage
	const maxTranscriptChars = 50_000;
	const truncatedTranscript =
		transcript.length > maxTranscriptChars
			? `${transcript.slice(0, maxTranscriptChars)}\n\n[...transcript truncated...]`
			: transcript;

	const response = await completeSimple(
		model,
		{
			systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
			messages: [
				{
					role: "user" as const,
					content: [
						{
							type: "text" as const,
							text: `Summarize this conversation:\n\n${truncatedTranscript}`,
						},
					],
					timestamp: Date.now(),
				},
			],
		},
		{
			maxTokens: 1024,
			signal: options?.signal,
			apiKey: options?.apiKey,
		},
	);

	if (response.stopReason === "error") {
		throw new Error(`Session summarization failed: ${response.errorMessage || "Unknown error"}`);
	}

	const summary = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n")
		.trim();

	if (summary) {
		cacheSummary(sessionPath, summary);
	}

	return summary || "(no summary generated)";
}

/**
 * Extract conversation as markdown and write to a temp file.
 * Returns the path to the temp file.
 * @throws Error if session cannot be read or temp file cannot be written
 */
export function extractSessionAsMarkdown(sessionPath: string): string {
	try {
		const sm = SessionManager.open(sessionPath);
		const context = sm.buildSessionContext();

		const lines: string[] = [];

		// Add session metadata as frontmatter
		const sessionName = sm.getSessionName();
		if (sessionName) {
			lines.push(`# ${sessionName}`);
			lines.push("");
		}

		// Extract user and assistant messages only
		for (const msg of context.messages) {
			if (msg.role === "user" || msg.role === "assistant") {
				const content = msg.content;
				let text: string;

				if (typeof content === "string") {
					text = content;
				} else if (Array.isArray(content)) {
					text = content
						.filter((block): block is { type: "text"; text: string } => block.type === "text")
						.map((block) => block.text)
						.join("\n");
				} else {
					continue;
				}

				if (text.trim()) {
					const role = msg.role === "user" ? "**User**" : "**Assistant**";
					lines.push(`${role}:`);
					lines.push("");
					lines.push(text.trim());
					lines.push("");
					lines.push("---");
					lines.push("");
				}
			}
		}

		const markdown = lines.join("\n");

		// Write to temp file
		const tempDir = tmpdir();
		const basename = sessionPath.split("/").pop()?.replace(".jsonl", ".md") || "session.md";
		const tempPath = join(tempDir, `pi-session-${Date.now()}-${basename}`);
		writeFileSync(tempPath, markdown, "utf-8");

		return tempPath;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to extract session as markdown: ${message}`);
	}
}
