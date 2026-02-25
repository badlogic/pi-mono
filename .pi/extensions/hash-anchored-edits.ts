import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Hash-Anchored Edits Extension (inspired by oh-my-pi hashline.ts).
 *
 * Detects concurrent edit conflicts by caching content hashes after writes.
 * When the agent edits a file that was modified since its last read/edit,
 * the extension blocks the edit and instructs re-read.
 *
 * Pi's built-in edit already validates old_string presence. This extension
 * adds: (1) cross-turn staleness detection via cached hashes, and
 * (2) fuzzy whitespace-normalized fallback matching.
 */

// FNV-1a 32-bit hash — zero dependencies, fast for line-level validation
function fnv1a(str: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = (hash * 0x01000193) >>> 0;
	}
	return hash;
}

function normalizeLine(line: string): string {
	return line.replace(/\s+/g, " ").trim();
}

function hashContent(text: string): string {
	const normalized = text
		.split("\n")
		.map(normalizeLine)
		.filter((l) => l.length > 0)
		.join("\n");
	return (fnv1a(normalized) >>> 0).toString(16).padStart(8, "0");
}

// Per-file cache: hash of content at last known-good state
const fileHashes = new Map<string, { hash: string; ts: number }>();

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function evictStale() {
	const cutoff = Date.now() - CACHE_TTL_MS;
	for (const [path, entry] of fileHashes) {
		if (entry.ts < cutoff) fileHashes.delete(path);
	}
}

async function readFile(pi: ExtensionAPI, filePath: string): Promise<string | null> {
	try {
		// Safe: no shell interpolation, filePath passed as argument not in shell string
		const result = await pi.exec("cat", [filePath]);
		return result.stdout || null;
	} catch {
		return null;
	}
}

export default function hashAnchoredEdits(pi: ExtensionAPI) {
	// Cache file hash on every successful read
	pi.on("tool_result", async (event) => {
		evictStale();

		if (event.isError) return;
		const input = event.input as Record<string, unknown>;
		const filePath = (input.file_path ?? input.path) as string | undefined;
		if (!filePath) return;

		if (event.toolName === "read" || event.toolName === "edit" || event.toolName === "write") {
			const content = await readFile(pi, filePath);
			if (content) {
				fileHashes.set(filePath, { hash: hashContent(content), ts: Date.now() });
			}
		}
	});

	// Before edit: check if cached hash still matches current file
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "edit") return;

		const input = event.input as { file_path?: string; old_string?: string };
		if (!input.file_path || !input.old_string) return;

		const cached = fileHashes.get(input.file_path);
		if (!cached) return; // No cached state — let Pi's built-in check handle it

		const content = await readFile(pi, input.file_path);
		if (!content) return; // File gone — let Pi handle it

		const currentHash = hashContent(content);

		// Hash match: file unchanged since last read/edit — safe to proceed
		if (currentHash === cached.hash) return;

		// Hash mismatch: file changed. Check if old_string is still present.
		if (content.includes(input.old_string)) {
			// old_string still there despite hash change — safe, update cache
			fileHashes.set(input.file_path, { hash: currentHash, ts: Date.now() });
			return;
		}

		// Try fuzzy whitespace-normalized match
		const normalizedContent = content.split("\n").map(normalizeLine).join("\n");
		const normalizedOld = input.old_string.split("\n").map(normalizeLine).join("\n");

		if (normalizedContent.includes(normalizedOld)) {
			// Whitespace-only diff — Pi's edit handles this
			return;
		}

		return {
			block: true,
			reason: [
				`[hash-anchored-edits] File changed since last read (was: ${cached.hash}, now: ${currentHash}).`,
				`old_string not found in current ${input.file_path}.`,
				`Re-read the file to get current content before editing.`,
			].join("\n"),
		};
	});
}
