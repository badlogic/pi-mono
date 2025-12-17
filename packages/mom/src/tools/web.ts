import type { AgentTool, TextContent } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

/**
 * Web Search Schema
 */
const webSearchSchema = Type.Object({
	label: Type.String({ description: "Brief description of what you're searching for (shown to user)" }),
	query: Type.String({ description: "Search query" }),
	numResults: Type.Optional(Type.Number({ description: "Number of results (1-10, default 5)" })),
});

/**
 * Web Fetch Schema
 */
const webFetchSchema = Type.Object({
	label: Type.String({ description: "Brief description of what you're fetching (shown to user)" }),
	url: Type.String({ description: "URL to fetch" }),
	maxLength: Type.Optional(Type.Number({ description: "Maximum content length (default 8000 chars)" })),
});

/**
 * Web Search Tool - Search using Exa AI
 */
export function createWebSearchTool(): AgentTool<typeof webSearchSchema> {
	return {
		name: "web_search",
		label: "web_search",
		description:
			"Search the web using Exa AI. Returns relevant web pages with titles, URLs, and content snippets. Requires EXA_API_KEY environment variable.",
		parameters: webSearchSchema,
		execute: async (
			_toolCallId: string,
			{ query, numResults = 5 }: { label: string; query: string; numResults?: number },
			_signal?: AbortSignal,
		): Promise<{ content: TextContent[]; details: undefined }> => {
			const apiKey = process.env.EXA_API_KEY;
			if (!apiKey) {
				return {
					content: [
						{
							type: "text",
							text: "Error: EXA_API_KEY not configured. Use bash with curl instead:\ncurl -s 'https://html.duckduckgo.com/html/?q=YOUR+QUERY' | grep -oP '(?<=<a rel=\"nofollow\" class=\"result__a\" href=\")[^\"]*'",
						},
					],
					details: undefined,
				};
			}

			try {
				const response = await fetch("https://api.exa.ai/search", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-api-key": apiKey,
					},
					body: JSON.stringify({
						query,
						numResults: Math.min(Math.max(numResults, 1), 10),
						type: "auto",
						contents: { text: { maxCharacters: 1500 } },
					}),
				});

				if (!response.ok) {
					throw new Error(`Exa API error: ${response.status} ${response.statusText}`);
				}

				const data = (await response.json()) as { results?: Array<{ title?: string; url: string; text?: string }> };

				if (!data.results || data.results.length === 0) {
					return {
						content: [{ type: "text", text: `No results found for: ${query}` }],
						details: undefined,
					};
				}

				const results = data.results
					.map((r, i: number) => {
						const snippet = r.text ? r.text.substring(0, 300) + "..." : "(no snippet)";
						return `${i + 1}. *${r.title || "Untitled"}*\n   ${r.url}\n   ${snippet}`;
					})
					.join("\n\n");

				return {
					content: [{ type: "text", text: `Search results for "${query}":\n\n${results}` }],
					details: undefined,
				};
			} catch (error) {
				const errMsg = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Search failed: ${errMsg}` }],
					details: undefined,
				};
			}
		},
	};
}

/**
 * Web Fetch Tool - Fetch content from URL
 */
export function createWebFetchTool(): AgentTool<typeof webFetchSchema> {
	return {
		name: "web_fetch",
		label: "web_fetch",
		description:
			"Fetch content from a URL. Returns text content (HTML stripped when possible). Use for reading articles, documentation, or API responses.",
		parameters: webFetchSchema,
		execute: async (
			_toolCallId: string,
			{ url, maxLength = 8000 }: { label: string; url: string; maxLength?: number },
			signal?: AbortSignal,
		): Promise<{ content: TextContent[]; details: undefined }> => {
			try {
				const controller = new AbortController();

				// Combine external signal with timeout
				const timeout = setTimeout(() => controller.abort(), 30000);
				if (signal) {
					signal.addEventListener("abort", () => controller.abort());
				}

				const response = await fetch(url, {
					headers: {
						"User-Agent": "Mozilla/5.0 (compatible; Mom-Bot/1.0)",
						Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
					},
					signal: controller.signal,
				});

				clearTimeout(timeout);

				if (!response.ok) {
					throw new Error(`HTTP ${response.status}: ${response.statusText}`);
				}

				const contentType = response.headers.get("content-type") || "";
				let text = await response.text();

				// Basic HTML to text conversion (for HTML content)
				if (contentType.includes("text/html")) {
					text = htmlToText(text);
				}

				// Truncate if needed
				const truncated = text.length > maxLength;
				const content = truncated ? text.substring(0, maxLength) : text;

				const suffix = truncated ? `\n\n[Truncated from ${text.length} to ${maxLength} chars]` : "";

				return {
					content: [{ type: "text", text: `Content from ${url}:\n\n${content}${suffix}` }],
					details: undefined,
				};
			} catch (error) {
				const errMsg = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Fetch failed: ${errMsg}` }],
					details: undefined,
				};
			}
		},
	};
}

/**
 * Simple HTML to text conversion
 * Strips tags and normalizes whitespace
 */
function htmlToText(html: string): string {
	return (
		html
			// Remove script and style content
			.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
			.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
			// Remove HTML comments
			.replace(/<!--[\s\S]*?-->/g, "")
			// Replace common block elements with newlines
			.replace(/<\/(p|div|h[1-6]|li|tr|br|hr)[^>]*>/gi, "\n")
			.replace(/<(br|hr)[^>]*\/?>/gi, "\n")
			// Remove all remaining tags
			.replace(/<[^>]+>/g, " ")
			// Decode common HTML entities
			.replace(/&nbsp;/g, " ")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")
			// Normalize whitespace
			.replace(/[ \t]+/g, " ")
			.replace(/\n\s*\n/g, "\n\n")
			.trim()
	);
}
