import type { AgentTool, TextContent } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

/**
 * GitHub Search Schema
 */
const githubSearchSchema = Type.Object({
	label: Type.String({ description: "Brief description of what you're searching for (shown to user)" }),
	query: Type.String({ description: "Search query (e.g., 'language:typescript react hooks')" }),
	numResults: Type.Optional(Type.Number({ description: "Number of results (1-10, default 5)" })),
});

/**
 * GitHub File Schema
 */
const githubFileSchema = Type.Object({
	label: Type.String({ description: "Brief description of what you're fetching (shown to user)" }),
	owner: Type.String({ description: "Repository owner/organization" }),
	repo: Type.String({ description: "Repository name" }),
	path: Type.String({ description: "File path in repository" }),
	ref: Type.Optional(Type.String({ description: "Branch, tag, or commit SHA (default: main branch)" })),
});

/**
 * GitHub Issues Schema
 */
const githubIssuesSchema = Type.Object({
	label: Type.String({ description: "Brief description of what you're looking for (shown to user)" }),
	owner: Type.String({ description: "Repository owner/organization" }),
	repo: Type.String({ description: "Repository name" }),
	state: Type.Optional(
		Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")], {
			description: "Issue state filter (default: open)",
		}),
	),
	numResults: Type.Optional(Type.Number({ description: "Number of results (1-30, default 10)" })),
});

/**
 * GitHub Search Tool - Search repositories
 */
export function createGithubSearchTool(): AgentTool<typeof githubSearchSchema> {
	return {
		name: "github_search",
		label: "github_search",
		description:
			"Search GitHub repositories. Returns repos with name, description, stars, and URL. Requires GITHUB_TOKEN environment variable for higher rate limits.",
		parameters: githubSearchSchema,
		execute: async (
			_toolCallId: string,
			{ query, numResults = 5 }: { label: string; query: string; numResults?: number },
			signal?: AbortSignal,
		): Promise<{ content: TextContent[]; details: undefined }> => {
			const apiKey = process.env.GITHUB_TOKEN;
			const headers: Record<string, string> = {
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": "Mom-Bot/1.0",
			};

			if (apiKey) {
				headers.Authorization = `Bearer ${apiKey}`;
			}

			try {
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), 30000);
				if (signal) {
					signal.addEventListener("abort", () => controller.abort());
				}

				const perPage = Math.min(Math.max(numResults, 1), 10);
				const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${perPage}&sort=stars&order=desc`;

				const response = await fetch(url, {
					headers,
					signal: controller.signal,
				});

				clearTimeout(timeout);

				if (!response.ok) {
					if (response.status === 403) {
						throw new Error("GitHub API rate limit exceeded. Set GITHUB_TOKEN for higher limits.");
					}
					throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
				}

				const data = (await response.json()) as {
					total_count?: number;
					items?: Array<{
						name: string;
						full_name: string;
						description?: string;
						html_url: string;
						stargazers_count: number;
						language?: string;
					}>;
				};

				if (!data.items || data.items.length === 0) {
					return {
						content: [{ type: "text", text: `No repositories found for: ${query}` }],
						details: undefined,
					};
				}

				const results = data.items
					.map((repo, i: number) => {
						const desc = repo.description || "(no description)";
						const lang = repo.language || "Unknown";
						return `${i + 1}. *${repo.full_name}* (${lang}, ⭐${repo.stargazers_count})\n   ${repo.html_url}\n   ${desc}`;
					})
					.join("\n\n");

				const totalInfo = data.total_count ? ` (${data.total_count} total)` : "";
				return {
					content: [{ type: "text", text: `GitHub search results for "${query}"${totalInfo}:\n\n${results}` }],
					details: undefined,
				};
			} catch (error) {
				const errMsg = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `GitHub search failed: ${errMsg}` }],
					details: undefined,
				};
			}
		},
	};
}

/**
 * GitHub File Tool - Get file contents from a repository
 */
export function createGithubFileTool(): AgentTool<typeof githubFileSchema> {
	return {
		name: "github_file",
		label: "github_file",
		description:
			"Get file contents from a GitHub repository. Returns raw file content. Requires GITHUB_TOKEN environment variable for private repos and higher rate limits.",
		parameters: githubFileSchema,
		execute: async (
			_toolCallId: string,
			{ owner, repo, path, ref }: { label: string; owner: string; repo: string; path: string; ref?: string },
			signal?: AbortSignal,
		): Promise<{ content: TextContent[]; details: undefined }> => {
			const apiKey = process.env.GITHUB_TOKEN;
			const headers: Record<string, string> = {
				Accept: "application/vnd.github.raw+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": "Mom-Bot/1.0",
			};

			if (apiKey) {
				headers.Authorization = `Bearer ${apiKey}`;
			}

			try {
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), 30000);
				if (signal) {
					signal.addEventListener("abort", () => controller.abort());
				}

				const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : "";
				const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}${refParam}`;

				const response = await fetch(url, {
					headers,
					signal: controller.signal,
				});

				clearTimeout(timeout);

				if (!response.ok) {
					if (response.status === 404) {
						throw new Error(`File not found: ${owner}/${repo}/${path}`);
					}
					if (response.status === 403) {
						throw new Error("GitHub API rate limit exceeded or private repo. Set GITHUB_TOKEN.");
					}
					throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
				}

				const content = await response.text();
				const maxLength = 10000;
				const truncated = content.length > maxLength;
				const displayContent = truncated ? content.substring(0, maxLength) : content;
				const suffix = truncated ? `\n\n[Truncated from ${content.length} to ${maxLength} chars]` : "";

				const refInfo = ref ? ` (ref: ${ref})` : "";
				return {
					content: [
						{ type: "text", text: `File: ${owner}/${repo}/${path}${refInfo}\n\n${displayContent}${suffix}` },
					],
					details: undefined,
				};
			} catch (error) {
				const errMsg = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `GitHub file fetch failed: ${errMsg}` }],
					details: undefined,
				};
			}
		},
	};
}

/**
 * GitHub Issues Tool - List issues from a repository
 */
export function createGithubIssuesTool(): AgentTool<typeof githubIssuesSchema> {
	return {
		name: "github_issues",
		label: "github_issues",
		description:
			"List issues from a GitHub repository. Returns issue titles, numbers, states, and URLs. Requires GITHUB_TOKEN environment variable for higher rate limits.",
		parameters: githubIssuesSchema,
		execute: async (
			_toolCallId: string,
			{
				owner,
				repo,
				state = "open",
				numResults = 10,
			}: { label: string; owner: string; repo: string; state?: "open" | "closed" | "all"; numResults?: number },
			signal?: AbortSignal,
		): Promise<{ content: TextContent[]; details: undefined }> => {
			const apiKey = process.env.GITHUB_TOKEN;
			const headers: Record<string, string> = {
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
				"User-Agent": "Mom-Bot/1.0",
			};

			if (apiKey) {
				headers.Authorization = `Bearer ${apiKey}`;
			}

			try {
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), 30000);
				if (signal) {
					signal.addEventListener("abort", () => controller.abort());
				}

				const perPage = Math.min(Math.max(numResults, 1), 30);
				const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=${state}&per_page=${perPage}&sort=updated&direction=desc`;

				const response = await fetch(url, {
					headers,
					signal: controller.signal,
				});

				clearTimeout(timeout);

				if (!response.ok) {
					if (response.status === 404) {
						throw new Error(`Repository not found: ${owner}/${repo}`);
					}
					if (response.status === 403) {
						throw new Error("GitHub API rate limit exceeded. Set GITHUB_TOKEN for higher limits.");
					}
					throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
				}

				const issues = (await response.json()) as Array<{
					number: number;
					title: string;
					state: string;
					html_url: string;
					user?: { login: string };
					created_at: string;
					comments: number;
					pull_request?: unknown;
				}>;

				// Filter out pull requests (they show up in issues API)
				const actualIssues = issues.filter((issue) => !issue.pull_request);

				if (actualIssues.length === 0) {
					return {
						content: [{ type: "text", text: `No ${state} issues found in ${owner}/${repo}` }],
						details: undefined,
					};
				}

				const results = actualIssues
					.map((issue, i: number) => {
						const author = issue.user?.login || "unknown";
						const date = new Date(issue.created_at).toISOString().split("T")[0];
						const stateIcon = issue.state === "open" ? "🟢" : "🔴";
						return `${i + 1}. ${stateIcon} #${issue.number}: *${issue.title}*\n   ${issue.html_url}\n   ${author} · ${date} · ${issue.comments} comments`;
					})
					.join("\n\n");

				return {
					content: [{ type: "text", text: `Issues from ${owner}/${repo} (${state}):\n\n${results}` }],
					details: undefined,
				};
			} catch (error) {
				const errMsg = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `GitHub issues fetch failed: ${errMsg}` }],
					details: undefined,
				};
			}
		},
	};
}
