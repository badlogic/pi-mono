/**
 * Fabric Patterns Sync
 * Syncs patterns from danielmiessler/fabric repository
 * Provides local caching and pattern retrieval
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

// Priority patterns to sync first
export const PRIORITY_PATTERNS = [
	"extract_wisdom",
	"summarize",
	"analyze_claims",
	"create_coding_project",
	"improve_prompt",
	"write_essay",
	"explain_code",
	"review_code",
	"create_summary",
	"extract_article_wisdom",
	"extract_insights",
	"create_micro_summary",
	"analyze_prose",
	"analyze_paper",
	"explain_project",
	"create_quiz",
	"create_threat_model",
	"create_security_update",
] as const;

const GITHUB_API_BASE = "https://api.github.com";
const FABRIC_REPO = "danielmiessler/fabric";
const PATTERNS_PATH = "patterns";

// Cache directory
const CACHE_DIR = path.join(process.cwd(), "src/agents/patterns/cache");

// Rate limiting for GitHub API
const RATE_LIMIT_DELAY = 100; // ms between requests
let lastRequestTime = 0;

interface GitHubContent {
	name: string;
	path: string;
	sha: string;
	size: number;
	url: string;
	html_url: string;
	git_url: string;
	download_url: string | null;
	type: "file" | "dir";
}

export interface PatternInfo {
	name: string;
	path: string;
	systemPrompt: string;
	cached: boolean;
	lastSync?: Date;
}

/**
 * Apply rate limiting delay
 */
async function rateLimitDelay(): Promise<void> {
	const now = Date.now();
	const timeSinceLastRequest = now - lastRequestTime;
	if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
		await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY - timeSinceLastRequest));
	}
	lastRequestTime = Date.now();
}

/**
 * Get GitHub API headers with optional token
 */
function getGitHubHeaders(): HeadersInit {
	const headers: HeadersInit = {
		Accept: "application/vnd.github.v3+json",
		"User-Agent": "pi-mono-discord-bot",
	};

	const token = process.env.GITHUB_TOKEN;
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}

	return headers;
}

/**
 * Fetch pattern list from GitHub API
 */
export async function fetchPatternList(): Promise<GitHubContent[]> {
	await rateLimitDelay();

	const url = `${GITHUB_API_BASE}/repos/${FABRIC_REPO}/contents/${PATTERNS_PATH}`;
	const response = await fetch(url, {
		headers: getGitHubHeaders(),
	});

	if (!response.ok) {
		throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
	}

	const contents: GitHubContent[] = await response.json();
	return contents.filter((item) => item.type === "dir");
}

/**
 * Download a single pattern's system.md file
 */
export async function downloadPattern(patternName: string): Promise<string> {
	await rateLimitDelay();

	const url = `${GITHUB_API_BASE}/repos/${FABRIC_REPO}/contents/${PATTERNS_PATH}/${patternName}/system.md`;
	const response = await fetch(url, {
		headers: getGitHubHeaders(),
	});

	if (!response.ok) {
		throw new Error(`Failed to download pattern ${patternName}: ${response.status} ${response.statusText}`);
	}

	const content: GitHubContent = await response.json();

	if (!content.download_url) {
		throw new Error(`No download URL for pattern ${patternName}`);
	}

	await rateLimitDelay();

	// Download the actual content
	const fileResponse = await fetch(content.download_url);
	if (!fileResponse.ok) {
		throw new Error(`Failed to download file: ${fileResponse.status}`);
	}

	return await fileResponse.text();
}

/**
 * Save pattern to local cache
 */
async function savePatternToCache(patternName: string, content: string): Promise<void> {
	// Ensure cache directory exists
	await fs.mkdir(CACHE_DIR, { recursive: true });

	const filePath = path.join(CACHE_DIR, `${patternName}.md`);
	await fs.writeFile(filePath, content, "utf-8");

	// Save metadata
	const metaPath = path.join(CACHE_DIR, `${patternName}.meta.json`);
	await fs.writeFile(
		metaPath,
		JSON.stringify(
			{
				name: patternName,
				lastSync: new Date().toISOString(),
			},
			null,
			2,
		),
		"utf-8",
	);
}

/**
 * Load pattern from local cache
 */
async function loadPatternFromCache(patternName: string): Promise<string | null> {
	try {
		const filePath = path.join(CACHE_DIR, `${patternName}.md`);
		return await fs.readFile(filePath, "utf-8");
	} catch (error) {
		return null;
	}
}

/**
 * Get pattern metadata
 */
async function getPatternMetadata(patternName: string): Promise<{ lastSync?: Date } | null> {
	try {
		const metaPath = path.join(CACHE_DIR, `${patternName}.meta.json`);
		const content = await fs.readFile(metaPath, "utf-8");
		const meta = JSON.parse(content);
		return {
			lastSync: meta.lastSync ? new Date(meta.lastSync) : undefined,
		};
	} catch (error) {
		return null;
	}
}

/**
 * Sync all patterns from fabric repository
 * @param forceRefresh - Force re-download even if cached
 * @param priorityOnly - Only sync priority patterns
 */
export async function syncFabricPatterns(
	forceRefresh = false,
	priorityOnly = false,
): Promise<{ synced: number; errors: string[] }> {
	console.log("Fetching fabric patterns list from GitHub...");

	const patterns = await fetchPatternList();
	const errors: string[] = [];
	let synced = 0;

	// Filter to priority patterns if requested
	const patternsToSync = priorityOnly ? patterns.filter((p) => PRIORITY_PATTERNS.includes(p.name as any)) : patterns;

	console.log(`Found ${patternsToSync.length} patterns to sync`);

	// Sync priority patterns first
	const priorityFirst = [...patternsToSync].sort((a, b) => {
		const aPriority = PRIORITY_PATTERNS.indexOf(a.name as any);
		const bPriority = PRIORITY_PATTERNS.indexOf(b.name as any);
		if (aPriority === -1 && bPriority === -1) return 0;
		if (aPriority === -1) return 1;
		if (bPriority === -1) return -1;
		return aPriority - bPriority;
	});

	for (const pattern of priorityFirst) {
		try {
			// Skip if cached and not forcing refresh
			if (!forceRefresh) {
				const cached = await loadPatternFromCache(pattern.name);
				if (cached) {
					console.log(`✓ ${pattern.name} (cached)`);
					synced++;
					continue;
				}
			}

			console.log(`Downloading ${pattern.name}...`);
			const content = await downloadPattern(pattern.name);
			await savePatternToCache(pattern.name, content);
			console.log(`✓ ${pattern.name}`);
			synced++;
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			console.error(`✗ ${pattern.name}: ${errorMsg}`);
			errors.push(`${pattern.name}: ${errorMsg}`);
		}
	}

	return { synced, errors };
}

/**
 * Get a pattern by name
 * Tries cache first, downloads if not cached
 */
export async function getPattern(name: string): Promise<PatternInfo | null> {
	// Try cache first
	let content = await loadPatternFromCache(name);
	const metadata = await getPatternMetadata(name);

	// Download if not cached
	if (!content) {
		try {
			console.log(`Pattern ${name} not cached, downloading...`);
			content = await downloadPattern(name);
			await savePatternToCache(name, content);
		} catch (error) {
			console.error(`Failed to get pattern ${name}:`, error);
			return null;
		}
	}

	return {
		name,
		path: path.join(CACHE_DIR, `${name}.md`),
		systemPrompt: content,
		cached: !!metadata,
		lastSync: metadata?.lastSync,
	};
}

/**
 * List all cached patterns
 */
export async function listPatterns(): Promise<string[]> {
	try {
		await fs.mkdir(CACHE_DIR, { recursive: true });
		const files = await fs.readdir(CACHE_DIR);
		return files.filter((f) => f.endsWith(".md")).map((f) => f.replace(".md", ""));
	} catch (error) {
		return [];
	}
}

/**
 * Search patterns by name or content
 */
export async function searchPatterns(query: string): Promise<PatternInfo[]> {
	const patterns = await listPatterns();
	const results: PatternInfo[] = [];
	const lowerQuery = query.toLowerCase();

	for (const name of patterns) {
		// Check name match
		if (name.toLowerCase().includes(lowerQuery)) {
			const pattern = await getPattern(name);
			if (pattern) {
				results.push(pattern);
				continue;
			}
		}

		// Check content match (optional, more expensive)
		const content = await loadPatternFromCache(name);
		if (content?.toLowerCase().includes(lowerQuery)) {
			const pattern = await getPattern(name);
			if (pattern) {
				results.push(pattern);
			}
		}
	}

	return results;
}

/**
 * Get pattern statistics
 */
export async function getPatternStats(): Promise<{
	total: number;
	priorityCached: number;
	totalCached: number;
	cachePath: string;
}> {
	const allPatterns = await listPatterns();
	const priorityCached = allPatterns.filter((p) => PRIORITY_PATTERNS.includes(p as any)).length;

	return {
		total: allPatterns.length,
		priorityCached,
		totalCached: allPatterns.length,
		cachePath: CACHE_DIR,
	};
}

/**
 * Check if pattern exists in cache
 */
export async function hasPattern(name: string): Promise<boolean> {
	const content = await loadPatternFromCache(name);
	return !!content;
}

/**
 * Clear pattern cache
 */
export async function clearPatternCache(): Promise<void> {
	try {
		const files = await fs.readdir(CACHE_DIR);
		for (const file of files) {
			await fs.unlink(path.join(CACHE_DIR, file));
		}
	} catch (error) {
		// Ignore errors if directory doesn't exist
	}
}
