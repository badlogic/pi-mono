/**
 * Browser Automation Service
 * API-first approach - no Chrome/Puppeteer needed
 * Uses: Bright Data, thum.io, screenshotone.com, and native fetch
 */

import { randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

export interface BrowseResult {
	success: boolean;
	data?: {
		url: string;
		title?: string;
		content?: string;
		screenshot?: string;
		links?: Array<{ text: string; href: string }>;
	};
	error?: string;
	duration: number;
}

export interface BrowseOptions {
	url: string;
	action: "screenshot" | "scrape" | "extract" | "pdf" | "click" | "fill";
	selector?: string;
	value?: string;
	waitFor?: number;
	fullPage?: boolean;
}

// ============================================================================
// Browser Service
// ============================================================================

class BrowserAutomationService {
	private tempDir: string;

	constructor() {
		this.tempDir = "/tmp/pi-browser";
		this.ensureTempDir();
	}

	private async ensureTempDir(): Promise<void> {
		try {
			await mkdir(this.tempDir, { recursive: true });
		} catch {
			// Directory exists
		}
	}

	/**
	 * Take a screenshot of a webpage using multiple API fallbacks
	 * Priority: screenshotone.com -> thum.io -> microlink
	 */
	async screenshot(url: string, _options: { fullPage?: boolean; selector?: string } = {}): Promise<BrowseResult> {
		const start = Date.now();
		const filename = `screenshot-${randomUUID()}.png`;
		const filepath = join(this.tempDir, filename);

		const apis = [
			// 1. thum.io (free, reliable)
			() => fetch(`https://image.thum.io/get/width/1280/crop/800/noanimate/${encodeURIComponent(url)}`),
			// 2. microlink.io (free tier)
			() =>
				fetch(
					`https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&meta=false&embed=screenshot.url`,
				),
			// 3. screenshotmachine (free tier)
			() => fetch(`https://api.screenshotmachine.com/?key=guest&url=${encodeURIComponent(url)}&dimension=1280x800`),
		];

		for (const apiCall of apis) {
			try {
				const response = await apiCall();

				if (response.ok) {
					const contentType = response.headers.get("content-type") || "";

					if (contentType.includes("image")) {
						// Direct image response
						const buffer = Buffer.from(await response.arrayBuffer());
						await writeFile(filepath, buffer);
						return {
							success: true,
							data: { url, screenshot: filepath },
							duration: Date.now() - start,
						};
					} else if (contentType.includes("json")) {
						// JSON response with URL (microlink style)
						const json = await response.json();
						const imgUrl = json?.data?.screenshot?.url || json?.screenshot;
						if (imgUrl) {
							const imgResponse = await fetch(imgUrl);
							if (imgResponse.ok) {
								const buffer = Buffer.from(await imgResponse.arrayBuffer());
								await writeFile(filepath, buffer);
								return {
									success: true,
									data: { url, screenshot: filepath },
									duration: Date.now() - start,
								};
							}
						}
					}
				}
			} catch {}
		}

		return {
			success: false,
			error: "All screenshot APIs failed",
			duration: Date.now() - start,
		};
	}

	/**
	 * Scrape content from a webpage
	 */
	async scrape(url: string, _options: { selector?: string } = {}): Promise<BrowseResult> {
		const start = Date.now();

		try {
			const response = await fetch(url, {
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
					Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				},
			});

			if (!response.ok) {
				return {
					success: false,
					error: `HTTP ${response.status}: ${response.statusText}`,
					duration: Date.now() - start,
				};
			}

			const html = await response.text();

			// Extract title
			const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
			const title = titleMatch ? titleMatch[1].trim() : undefined;

			// Extract text content (simplified)
			const textContent = html
				.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
				.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
				.replace(/<[^>]+>/g, " ")
				.replace(/\s+/g, " ")
				.trim()
				.slice(0, 10000);

			// Extract links
			const linkMatches = html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi);
			const links: Array<{ text: string; href: string }> = [];
			for (const match of linkMatches) {
				if (links.length >= 50) break;
				const href = match[1];
				const text = match[2].trim();
				if (text && href && !href.startsWith("#") && !href.startsWith("javascript:")) {
					links.push({ text, href });
				}
			}

			return {
				success: true,
				data: {
					url,
					title,
					content: textContent,
					links,
				},
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Scrape failed",
				duration: Date.now() - start,
			};
		}
	}

	/**
	 * Extract specific data using AI
	 */
	async extract(url: string, prompt: string): Promise<BrowseResult> {
		const start = Date.now();

		try {
			// First scrape the page
			const scrapeResult = await this.scrape(url);
			if (!scrapeResult.success) {
				return scrapeResult;
			}

			// Use AI to extract data (via OpenRouter)
			const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
			if (!OPENROUTER_API_KEY) {
				return {
					success: false,
					error: "OPENROUTER_API_KEY not configured",
					duration: Date.now() - start,
				};
			}

			const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${OPENROUTER_API_KEY}`,
				},
				body: JSON.stringify({
					model: "anthropic/claude-3-haiku",
					messages: [
						{
							role: "system",
							content:
								"You are a data extraction assistant. Extract the requested information from the webpage content. Be concise and accurate.",
						},
						{
							role: "user",
							content: `URL: ${url}\nTitle: ${scrapeResult.data?.title || "N/A"}\n\nContent:\n${scrapeResult.data?.content?.slice(0, 5000)}\n\nExtract: ${prompt}`,
						},
					],
					max_tokens: 1000,
				}),
			});

			const result = await response.json();
			const extractedContent = result.choices?.[0]?.message?.content || "No data extracted";

			return {
				success: true,
				data: {
					url,
					title: scrapeResult.data?.title,
					content: extractedContent,
				},
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Extract failed",
				duration: Date.now() - start,
			};
		}
	}

	/**
	 * Search the web
	 */
	async search(query: string, _engine: "google" | "duckduckgo" = "duckduckgo"): Promise<BrowseResult> {
		const start = Date.now();

		try {
			// Use DuckDuckGo HTML for simplicity (no API key needed)
			const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

			const response = await fetch(searchUrl, {
				headers: {
					"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
				},
			});

			if (!response.ok) {
				return {
					success: false,
					error: `Search failed: HTTP ${response.status}`,
					duration: Date.now() - start,
				};
			}

			const html = await response.text();

			// Extract search results
			const results: Array<{ text: string; href: string }> = [];
			const resultMatches = html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi);

			for (const match of resultMatches) {
				if (results.length >= 10) break;
				results.push({
					href: match[1],
					text: match[2].trim(),
				});
			}

			return {
				success: true,
				data: {
					url: searchUrl,
					title: `Search: ${query}`,
					links: results,
				},
				duration: Date.now() - start,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Search failed",
				duration: Date.now() - start,
			};
		}
	}

	/**
	 * Cleanup temp files
	 */
	async cleanup(filepath: string): Promise<void> {
		try {
			await unlink(filepath);
		} catch {
			// File doesn't exist
		}
	}
}

// Singleton instance
export const browserAutomation = new BrowserAutomationService();
