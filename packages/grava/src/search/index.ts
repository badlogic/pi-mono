/**
 * Layer 3: AI Search 前置滤网 — 护城河 ①（Input 端）
 *
 * "先搜索、再推理 · 让 LLM 基于事实而非幻觉回答"
 *
 * Responsibilities:
 * - Search Router: decide whether to search, route to appropriate sources
 * - Multi-source concurrent search (Perplexity, Exa, Tavily, Google/Bing, custom)
 * - Fact Injection: search results → structured context → inject into prompt
 * - Relevance ranking, deduplication, source attribution, token budgeting
 */

import type {
	EnrichedContext,
	InjectedFact,
	NormalizedMessage,
	SearchConfig,
	SearchProvider,
	SearchProviderName,
	SearchResult,
	SearchResultItem,
} from "../types.js";

// ─── Search Source Interface ───

export interface SearchSource {
	readonly name: SearchProviderName;
	search(query: string, maxResults: number): Promise<SearchResultItem[]>;
}

// ─── Search Router ───

export interface SearchDecision {
	shouldSearch: boolean;
	queries: string[];
	providers: SearchProviderName[];
}

/**
 * Decides whether a message needs search and extracts queries.
 * In production, this would use an LLM for intent classification.
 */
export function makeSearchDecision(
	message: NormalizedMessage,
	availableProviders: SearchProviderName[],
): SearchDecision {
	const content = message.content.toLowerCase();

	// Simple heuristic — in production, use LLM-based intent classification
	const searchIndicators = [
		"what is",
		"who is",
		"how to",
		"explain",
		"latest",
		"news",
		"current",
		"compare",
		"difference between",
		"是什么",
		"怎么",
		"如何",
		"最新",
		"新闻",
		"对比",
		"区别",
	];

	const shouldSearch = searchIndicators.some((indicator) => content.includes(indicator));

	return {
		shouldSearch,
		queries: shouldSearch ? [message.content] : [],
		providers: shouldSearch ? availableProviders : [],
	};
}

// ─── Search Executor ───

export class SearchExecutor {
	private sources = new Map<SearchProviderName, SearchSource>();

	constructor(private config: SearchConfig) {}

	registerSource(source: SearchSource): void {
		this.sources.set(source.name, source);
	}

	/** Execute search across multiple providers concurrently */
	async search(queries: string[], providers: SearchProviderName[]): Promise<SearchResult[]> {
		const maxResults = this.config.maxResultsPerProvider ?? 5;

		const tasks = queries.flatMap((query) =>
			providers
				.filter((p) => this.sources.has(p))
				.map(async (provider): Promise<SearchResult> => {
					const source = this.sources.get(provider)!;
					const results = await source.search(query, maxResults);
					return {
						provider,
						query,
						results,
						timestamp: Date.now(),
					};
				}),
		);

		return Promise.all(tasks);
	}
}

// ─── Fact Injector ───

/**
 * Processes search results into structured facts for prompt injection.
 * Handles relevance ranking, deduplication, and token budget management.
 */
export class FactInjector {
	constructor(private tokenBudget: number = 2000) {}

	/** Extract and rank facts from search results */
	inject(searchResults: SearchResult[]): InjectedFact[] {
		// Flatten all results
		const allItems = searchResults.flatMap((r) =>
			r.results.map((item) => ({
				...item,
				provider: r.provider,
			})),
		);

		// Sort by relevance
		allItems.sort((a, b) => b.relevanceScore - a.relevanceScore);

		// Deduplicate by similarity
		const seen = new Set<string>();
		const unique = allItems.filter((item) => {
			const key = item.title.toLowerCase().slice(0, 50);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});

		// Convert to facts within token budget
		const facts: InjectedFact[] = [];
		let estimatedTokens = 0;

		for (const item of unique) {
			const factTokens = Math.ceil(item.snippet.length / 4); // rough estimate
			if (estimatedTokens + factTokens > this.tokenBudget) break;

			facts.push({
				claim: item.snippet,
				sources: [item.url],
				confidence: item.relevanceScore,
			});
			estimatedTokens += factTokens;
		}

		return facts;
	}
}

// ─── Search Layer ───

export class SearchLayer {
	private executor: SearchExecutor;
	private injector: FactInjector;
	private availableProviders: SearchProviderName[];

	constructor(private config: SearchConfig) {
		this.executor = new SearchExecutor(config);
		this.injector = new FactInjector(config.tokenBudget);
		this.availableProviders = config.providers.filter((p) => p.enabled).map((p) => p.name);
	}

	/** Register a search source implementation */
	registerSource(source: SearchSource): void {
		this.executor.registerSource(source);
	}

	/** Process a message through the search layer */
	async process(message: NormalizedMessage): Promise<EnrichedContext> {
		const decision = this.config.autoDecision !== false
			? makeSearchDecision(message, this.availableProviders)
			: { shouldSearch: false, queries: [], providers: [] };

		let searchResults: SearchResult[] = [];
		let injectedFacts: InjectedFact[] = [];

		if (decision.shouldSearch) {
			searchResults = await this.executor.search(decision.queries, decision.providers);
			injectedFacts = this.injector.inject(searchResults);
		}

		return {
			originalMessage: message,
			searchResults,
			injectedFacts,
			tokenUsage: injectedFacts.reduce((sum, f) => sum + Math.ceil(f.claim.length / 4), 0),
		};
	}
}
