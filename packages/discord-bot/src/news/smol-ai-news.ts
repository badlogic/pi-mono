/**
 * Smol AI News Integration
 * Auto-fetch daily AI news digest from news.smol.ai
 * Part of the Observe pillar - keeping the stack informed
 */

interface SmolNewsItem {
	title: string;
	summary: string;
	category: string;
	source?: string;
}

interface SmolNewsDigest {
	date: string;
	headlines: SmolNewsItem[];
	modelReleases: SmolNewsItem[];
	tools: SmolNewsItem[];
	research: SmolNewsItem[];
	rawContent?: string;
	fetchedAt: number;
}

const SMOL_AI_NEWS_URL = "https://news.smol.ai";
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

export class SmolAINews {
	private cache: SmolNewsDigest | null = null;

	/**
	 * Fetch latest Smol AI News digest
	 */
	async fetchLatest(): Promise<SmolNewsDigest> {
		// Check cache
		if (this.cache && Date.now() - this.cache.fetchedAt < CACHE_TTL) {
			return this.cache;
		}

		try {
			// Try to fetch the main page
			const response = await fetch(SMOL_AI_NEWS_URL, {
				headers: {
					"User-Agent": "Pi-Discord-Bot/1.0 (AI News Aggregator)",
					Accept: "text/html,application/xhtml+xml",
				},
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch: ${response.status}`);
			}

			const html = await response.text();
			const digest = this.parseNewsPage(html);

			this.cache = digest;
			return digest;
		} catch (error) {
			// Return cached or empty digest on error
			if (this.cache) return this.cache;

			return {
				date: new Date().toISOString().split("T")[0],
				headlines: [],
				modelReleases: [],
				tools: [],
				research: [],
				fetchedAt: Date.now(),
			};
		}
	}

	/**
	 * Parse the news page HTML
	 */
	private parseNewsPage(html: string): SmolNewsDigest {
		const digest: SmolNewsDigest = {
			date: new Date().toISOString().split("T")[0],
			headlines: [],
			modelReleases: [],
			tools: [],
			research: [],
			rawContent: html.substring(0, 10000),
			fetchedAt: Date.now(),
		};

		// Extract title/date
		const dateMatch = html.match(/(\w+ \d+,? \d{4})|(\d{4}-\d{2}-\d{2})/);
		if (dateMatch) {
			digest.date = dateMatch[0];
		}

		// Extract headlines (look for h2, h3 with key terms)
		const headlinePatterns = [
			/GPT-[\d.]+[^<]*/gi,
			/Claude[^<]*/gi,
			/Gemini[^<]*/gi,
			/Llama[^<]*/gi,
			/Qwen[^<]*/gi,
			/Mistral[^<]*/gi,
			/OpenAI[^<]*/gi,
			/Anthropic[^<]*/gi,
			/Google AI[^<]*/gi,
		];

		for (const pattern of headlinePatterns) {
			const matches = html.match(pattern);
			if (matches) {
				for (const match of matches.slice(0, 3)) {
					const cleaned = this.cleanText(match);
					if (cleaned.length > 10 && cleaned.length < 200) {
						digest.headlines.push({
							title: cleaned,
							summary: "",
							category: "headline",
						});
					}
				}
			}
		}

		// Extract model releases
		const modelPatterns = [/(\w+-[\d.]+[bB])[^<]*/g, /(released|launched|announced)[^<]{10,100}/gi];

		for (const pattern of modelPatterns) {
			const matches = html.match(pattern);
			if (matches) {
				for (const match of matches.slice(0, 5)) {
					const cleaned = this.cleanText(match);
					if (cleaned.length > 15) {
						digest.modelReleases.push({
							title: cleaned.substring(0, 100),
							summary: "",
							category: "model",
						});
					}
				}
			}
		}

		// Extract tool mentions
		const toolPatterns = [
			/llama\.cpp[^<]*/gi,
			/vLLM[^<]*/gi,
			/Ollama[^<]*/gi,
			/LangChain[^<]*/gi,
			/transformers[^<]*/gi,
		];

		for (const pattern of toolPatterns) {
			const matches = html.match(pattern);
			if (matches) {
				digest.tools.push({
					title: this.cleanText(matches[0]).substring(0, 100),
					summary: "",
					category: "tool",
				});
			}
		}

		// Deduplicate
		digest.headlines = this.dedupe(digest.headlines);
		digest.modelReleases = this.dedupe(digest.modelReleases);
		digest.tools = this.dedupe(digest.tools);

		return digest;
	}

	private cleanText(text: string): string {
		return text
			.replace(/<[^>]*>/g, "")
			.replace(/&[^;]+;/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	private dedupe(items: SmolNewsItem[]): SmolNewsItem[] {
		const seen = new Set<string>();
		return items.filter((item) => {
			const key = item.title.toLowerCase().substring(0, 50);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	/**
	 * Format digest for Discord
	 */
	formatForDiscord(digest: SmolNewsDigest): string {
		const sections: string[] = [];

		sections.push(`**Smol AI News** - ${digest.date}\n`);

		if (digest.headlines.length > 0) {
			sections.push("**Headlines**");
			for (const h of digest.headlines.slice(0, 5)) {
				sections.push(`• ${h.title}`);
			}
			sections.push("");
		}

		if (digest.modelReleases.length > 0) {
			sections.push("**Model Releases**");
			for (const m of digest.modelReleases.slice(0, 5)) {
				sections.push(`• ${m.title}`);
			}
			sections.push("");
		}

		if (digest.tools.length > 0) {
			sections.push("**Tools & Infra**");
			for (const t of digest.tools.slice(0, 3)) {
				sections.push(`• ${t.title}`);
			}
			sections.push("");
		}

		sections.push(`*Source: ${SMOL_AI_NEWS_URL}*`);

		return sections.join("\n");
	}

	/**
	 * Get quick summary for notifications
	 */
	async getQuickSummary(): Promise<string> {
		const digest = await this.fetchLatest();

		const topItems = [...digest.headlines.slice(0, 2), ...digest.modelReleases.slice(0, 2)];

		if (topItems.length === 0) {
			return "No AI news available today.";
		}

		return topItems.map((i) => `• ${i.title}`).join("\n");
	}

	/**
	 * Clear cache
	 */
	clearCache(): void {
		this.cache = null;
	}
}

// Singleton
let newsInstance: SmolAINews | null = null;

export function getSmolAINews(): SmolAINews {
	if (!newsInstance) {
		newsInstance = new SmolAINews();
	}
	return newsInstance;
}
