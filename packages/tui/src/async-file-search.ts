import { spawn } from "child_process";
import { AsyncFzf, type FzfResultItem } from "fzf";
import { basename } from "path";

export type FileSearchState = "idle" | "initializing" | "ready" | "searching" | "error";

export interface FileSearchEntry {
	path: string;
	isDirectory: boolean;
}

export interface FileSearchResult {
	entries: FileSearchEntry[];
	fromCache: boolean;
}

interface CacheEntry {
	entries: FileSearchEntry[];
	timestamp: number;
}

export interface AsyncFileSearchOptions {
	maxResults?: number;
	cacheTtl?: number; // in milliseconds, default 30000 (30s)
}

/**
 * Async file search with fzf integration, caching, and state machine.
 * Aligned with gemini-cli's FileSearch implementation.
 */
export class AsyncFileSearch {
	private state: FileSearchState = "idle";
	private basePath: string;
	private fdPath: string;
	private maxResults: number;
	private cacheTtl: number;

	// Result cache for search queries
	private cache: Map<string, CacheEntry> = new Map();

	// All files cache for fzf
	private allFiles: FileSearchEntry[] = [];

	// fzf instance for fuzzy search
	private fzf: AsyncFzf<string[]> | null = null;

	private currentAbortController: AbortController | null = null;
	private initAbortController: AbortController | null = null;
	private initPromise: Promise<void> | null = null;

	constructor(basePath: string, fdPath: string, options: AsyncFileSearchOptions = {}) {
		this.basePath = basePath;
		this.fdPath = fdPath;
		this.maxResults = options.maxResults ?? 100;
		this.cacheTtl = options.cacheTtl ?? 30000;
	}

	getState(): FileSearchState {
		return this.state;
	}

	/**
	 * Initialize by crawling all files and building fzf index.
	 * Must be called before searching for best performance.
	 */
	async initialize(signal?: AbortSignal): Promise<void> {
		if (this.state === "ready" || this.state === "initializing") {
			return this.initPromise ?? Promise.resolve();
		}

		this.state = "initializing";
		this.initAbortController = new AbortController();
		const internalSignal = this.initAbortController.signal;

		if (signal) {
			signal.addEventListener("abort", () => this.initAbortController?.abort());
		}

		this.initPromise = this.buildFileIndex(internalSignal);

		try {
			await this.initPromise;
			this.state = "ready";
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") {
				this.state = "idle";
			} else {
				this.state = "error";
			}
			throw err;
		} finally {
			this.initAbortController = null;
		}

		return this.initPromise;
	}

	/**
	 * Search files with the given query using fzf fuzzy matching.
	 * Returns cached results if available and fresh.
	 */
	async search(query: string, signal?: AbortSignal): Promise<FileSearchResult> {
		// Ensure initialization is complete before searching
		if (this.state === "idle" || this.state === "initializing") {
			await this.initialize();
		}

		// Check cache first
		const cacheKey = query.toLowerCase();
		const cached = this.cache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
			return { entries: cached.entries, fromCache: true };
		}

		// Abort any existing search
		this.abortCurrentSearch();

		// Create new abort controller, link with external signal
		this.currentAbortController = new AbortController();
		const internalSignal = this.currentAbortController.signal;

		if (signal) {
			signal.addEventListener("abort", () => this.currentAbortController?.abort());
		}

		const prevState = this.state;
		if (this.state === "ready") {
			this.state = "searching";
		}

		try {
			let entries: FileSearchEntry[];

			if (!query) {
				// Empty query: return top files
				entries = this.allFiles.slice(0, this.maxResults);
			} else if (this.fzf) {
				// Use fzf for fuzzy search (gemini-cli approach)
				entries = await this.searchWithFzf(query, internalSignal);
			} else {
				// Fallback to fd search if fzf not initialized
				entries = await this.searchWithFd(query, internalSignal);
			}

			// Cache the result
			this.cache.set(cacheKey, {
				entries,
				timestamp: Date.now(),
			});

			if (this.state === "searching") {
				this.state = "ready";
			}

			return { entries, fromCache: false };
		} catch (err) {
			if (this.state === "searching") {
				this.state = prevState === "ready" ? "ready" : "idle";
			}

			if (err instanceof Error && err.name === "AbortError") {
				throw err;
			}
			throw err;
		} finally {
			this.currentAbortController = null;
		}
	}

	/**
	 * Abort the current search operation.
	 */
	abortCurrentSearch(): void {
		if (this.currentAbortController) {
			this.currentAbortController.abort();
			this.currentAbortController = null;
		}
	}

	/**
	 * Abort initialization if in progress.
	 */
	abortInitialization(): void {
		if (this.initAbortController) {
			this.initAbortController.abort();
			this.initAbortController = null;
		}
	}

	/**
	 * Clear all caches and rebuild index.
	 */
	clearCache(): void {
		this.abortInitialization();
		this.abortCurrentSearch();
		this.cache.clear();
		this.allFiles = [];
		this.fzf = null;
		this.state = "idle";
		this.initPromise = null;
	}

	/**
	 * Check if cache is fresh for a query.
	 */
	isCacheFresh(query: string): boolean {
		const cached = this.cache.get(query.toLowerCase());
		return cached !== undefined && Date.now() - cached.timestamp < this.cacheTtl;
	}

	/**
	 * Build file index by crawling with fd and creating fzf instance.
	 * Aligned with gemini-cli's RecursiveFileSearch.buildResultCache()
	 */
	private async buildFileIndex(signal?: AbortSignal): Promise<void> {
		// Crawl all files using fd
		const entries = await this.runFd([], 50000, signal);
		this.allFiles = entries;

		// Build fzf index with algorithm selection based on file count
		// v1 for large codebases (>20k files), v2 for smaller ones
		const paths = entries.map((e) => e.path);
		this.fzf = new AsyncFzf(paths, {
			fuzzy: paths.length > 20000 ? "v1" : "v2",
		});
	}

	/**
	 * Search using fzf fuzzy matching (gemini-cli approach).
	 */
	private async searchWithFzf(query: string, signal: AbortSignal): Promise<FileSearchEntry[]> {
		if (!this.fzf) {
			return [];
		}

		if (signal.aborted) {
			const err = new Error("Aborted");
			err.name = "AbortError";
			throw err;
		}

		const results: FzfResultItem<string>[] = await this.fzf.find(query);

		// Convert fzf results back to FileSearchEntry
		const pathToEntry = new Map(this.allFiles.map((e) => [e.path, e]));
		const entries: FileSearchEntry[] = [];

		for (const result of results) {
			const entry = pathToEntry.get(result.item);
			if (entry) {
				entries.push(entry);
			}
			if (entries.length >= this.maxResults) {
				break;
			}
		}

		return entries;
	}

	/**
	 * Fallback search using fd (when fzf not available).
	 */
	private async searchWithFd(query: string, signal: AbortSignal): Promise<FileSearchEntry[]> {
		// First try direct fd search
		let entries = await this.runFd([query], this.maxResults * 2, signal);

		// If no results, try fuzzy glob pattern
		if (entries.length === 0 && query.length > 0) {
			const fuzzyPattern = `*${query.split("").join("*")}*`;
			entries = await this.runFd(["--glob", fuzzyPattern], this.maxResults * 2, signal);
		}

		// Score and sort entries
		return this.scoreEntries(entries, query).slice(0, this.maxResults);
	}

	private runFd(extraArgs: string[], maxResults: number, signal?: AbortSignal): Promise<FileSearchEntry[]> {
		return new Promise((resolve, reject) => {
			if (signal?.aborted) {
				const err = new Error("Aborted");
				err.name = "AbortError";
				reject(err);
				return;
			}

			const args = [
				"--base-directory",
				this.basePath,
				"--max-results",
				String(maxResults),
				"--type",
				"f",
				"--type",
				"d",
				...extraArgs,
			];

			const child = spawn(this.fdPath, args, {
				stdio: ["ignore", "pipe", "pipe"],
			});

			let stdout = "";
			let stderr = "";

			const onAbort = () => {
				child.kill("SIGTERM");
				const err = new Error("Aborted");
				err.name = "AbortError";
				reject(err);
			};

			signal?.addEventListener("abort", onAbort);

			child.stdout.on("data", (data) => {
				stdout += data.toString();
			});

			child.stderr.on("data", (data) => {
				stderr += data.toString();
			});

			child.on("error", (err) => {
				signal?.removeEventListener("abort", onAbort);
				reject(err);
			});

			child.on("close", (code) => {
				signal?.removeEventListener("abort", onAbort);

				if (signal?.aborted) {
					const err = new Error("Aborted");
					err.name = "AbortError";
					reject(err);
					return;
				}

				if (code !== 0 && stderr) {
					reject(new Error(`fd exited with code ${code}: ${stderr}`));
					return;
				}

				const lines = stdout.trim().split("\n").filter(Boolean);
				const entries: FileSearchEntry[] = lines.map((line) => ({
					path: line,
					isDirectory: line.endsWith("/"),
				}));

				resolve(entries);
			});
		});
	}

	/**
	 * Score entries for sorting (fallback when fzf not available).
	 */
	private scoreEntries(entries: FileSearchEntry[], query: string): FileSearchEntry[] {
		if (!query) {
			return entries.sort((a, b) => {
				if (a.isDirectory && !b.isDirectory) return -1;
				if (!a.isDirectory && b.isDirectory) return 1;
				return a.path.localeCompare(b.path);
			});
		}

		const lowerQuery = query.toLowerCase();

		const scored = entries.map((entry) => {
			const fileName = basename(entry.path.replace(/\/$/, ""));
			const lowerFileName = fileName.toLowerCase();
			const lowerPath = entry.path.toLowerCase();

			let score = 0;

			if (lowerFileName === lowerQuery) {
				score = 100;
			} else if (lowerFileName.startsWith(lowerQuery)) {
				score = 80;
			} else if (lowerFileName.includes(lowerQuery)) {
				score = 60;
			} else if (lowerPath.includes(lowerQuery)) {
				score = 40;
			} else if (this.fuzzyMatch(lowerPath, lowerQuery)) {
				score = 20;
			}

			if (entry.isDirectory && score > 0) {
				score += 5;
			}

			const depth = (entry.path.match(/\//g) || []).length;
			score -= depth * 0.5;

			return { entry, score };
		});

		return scored
			.filter((s) => s.score > 0)
			.sort((a, b) => b.score - a.score)
			.map((s) => s.entry);
	}

	/**
	 * Simple fuzzy matching: all query chars must appear in order.
	 */
	private fuzzyMatch(text: string, query: string): boolean {
		let queryIndex = 0;
		for (let i = 0; i < text.length && queryIndex < query.length; i++) {
			if (text[i] === query[queryIndex]) {
				queryIndex++;
			}
		}
		return queryIndex === query.length;
	}
}

/**
 * Helper to create a debounced async search with loading state management.
 */
export interface DebouncedSearchCallbacks {
	onSuggestions: (entries: FileSearchEntry[]) => void;
	onLoading: (isLoading: boolean) => void;
	onError?: (error: Error) => void;
}

/**
 * Debounced file search with 200ms loading delay optimization.
 * Aligned with gemini-cli's loading state management.
 */
export class DebouncedFileSearch {
	private search: AsyncFileSearch;
	private callbacks: DebouncedSearchCallbacks;
	private debounceMs: number;

	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private loadingTimer: ReturnType<typeof setTimeout> | null = null;
	private currentAbortController: AbortController | null = null;
	private lastQuery: string = "";

	constructor(search: AsyncFileSearch, callbacks: DebouncedSearchCallbacks, debounceMs: number = 150) {
		this.search = search;
		this.callbacks = callbacks;
		this.debounceMs = debounceMs;
	}

	/**
	 * Trigger a debounced search. Cancels any pending search.
	 */
	trigger(query: string): void {
		this.lastQuery = query;

		// Clear existing timers
		this.clearTimers();

		// Cancel existing search
		if (this.currentAbortController) {
			this.currentAbortController.abort();
		}

		// For empty query, return empty results immediately
		if (!query) {
			this.callbacks.onLoading(false);
			this.executeSearch(query);
			return;
		}

		// Start 200ms loading delay timer (gemini-cli optimization)
		this.loadingTimer = setTimeout(() => {
			this.callbacks.onLoading(true);
		}, 200);

		// Debounce the actual search
		this.debounceTimer = setTimeout(() => {
			this.executeSearch(query);
		}, this.debounceMs);
	}

	/**
	 * Abort current search and clear pending timers.
	 */
	abort(): void {
		this.clearTimers();
		if (this.currentAbortController) {
			this.currentAbortController.abort();
			this.currentAbortController = null;
		}
		this.callbacks.onLoading(false);
	}

	private clearTimers(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		if (this.loadingTimer) {
			clearTimeout(this.loadingTimer);
			this.loadingTimer = null;
		}
	}

	private async executeSearch(query: string): Promise<void> {
		this.currentAbortController = new AbortController();
		const signal = this.currentAbortController.signal;

		try {
			const result = await this.search.search(query, signal);

			// Only deliver results if this is still the latest query
			if (query === this.lastQuery && !signal.aborted) {
				this.clearTimers();
				this.callbacks.onLoading(false);
				this.callbacks.onSuggestions(result.entries);
			}
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") {
				// Aborted, ignore
				return;
			}

			this.clearTimers();
			this.callbacks.onLoading(false);
			this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
		} finally {
			this.currentAbortController = null;
		}
	}
}
