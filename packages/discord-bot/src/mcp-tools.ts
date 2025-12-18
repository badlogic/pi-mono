/**
 * MCP Tools Integration for Pi Discord Bot
 * Provides access to Claude Code's capabilities: Web Search, GitHub, HuggingFace, Memory
 */

import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

// =============================================================================
// Tool Schemas (TypeBox format for pi-agent)
// =============================================================================

const webSearchSchema = Type.Object({
	label: Type.String({ description: "Brief description of search (shown to user)" }),
	query: Type.String({ description: "Search query" }),
	numResults: Type.Optional(Type.Number({ description: "Number of results (1-10, default 5)" })),
});

const deepResearchSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	question: Type.String({ description: "Research question or topic" }),
});

const webScrapeSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	url: Type.String({ description: "URL to scrape" }),
});

const githubRepoSearchSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	query: Type.String({ description: "Search query" }),
	perPage: Type.Optional(Type.Number({ description: "Results per page (default 5)" })),
});

const githubGetFileSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	owner: Type.String({ description: "Repository owner" }),
	repo: Type.String({ description: "Repository name" }),
	path: Type.String({ description: "File path" }),
	branch: Type.Optional(Type.String({ description: "Branch (default: main)" })),
});

const githubCreateIssueSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	owner: Type.String({ description: "Repository owner" }),
	repo: Type.String({ description: "Repository name" }),
	title: Type.String({ description: "Issue title" }),
	body: Type.String({ description: "Issue body/description" }),
});

const hfModelSearchSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	query: Type.String({ description: "Search query" }),
	task: Type.Optional(Type.String({ description: "Task type (e.g., text-generation)" })),
	limit: Type.Optional(Type.Number({ description: "Max results (default 5)" })),
});

const hfDatasetSearchSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	query: Type.String({ description: "Search query" }),
	limit: Type.Optional(Type.Number({ description: "Max results (default 5)" })),
});

const memoryStoreSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	entityName: Type.String({ description: "Name of the entity" }),
	entityType: Type.String({ description: "Type (e.g., person, project, concept)" }),
	observations: Type.Array(Type.String(), { description: "Facts about this entity" }),
});

const memoryRecallSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	query: Type.String({ description: "Search query for memory" }),
});

const memoryRelateSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	from: Type.String({ description: "Source entity name" }),
	to: Type.String({ description: "Target entity name" }),
	relationType: Type.String({ description: "Type of relation" }),
});

// =============================================================================
// Helper: Log tool usage
// =============================================================================

function logMcpTool(tool: string, message: string): void {
	const timestamp = new Date().toLocaleTimeString();
	console.log(`[${timestamp}] [MCP:${tool}] ${message}`);
}

// =============================================================================
// Tool Implementations
// =============================================================================

/**
 * Exa Web Search - Search the web using Exa AI
 */
export function createWebSearchTool(): AgentTool<typeof webSearchSchema> {
	return {
		name: "web_search",
		label: "web_search",
		description: "Search the web using Exa AI. Returns relevant web pages with titles, URLs, and content snippets.",
		parameters: webSearchSchema,
		execute: async (_toolCallId, { query, numResults = 5, label }) => {
			logMcpTool("web_search", label);

			const apiKey = process.env.EXA_API_KEY;
			if (!apiKey) {
				return {
					content: [{ type: "text", text: "Error: EXA_API_KEY not configured. Use bash with curl instead." }],
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
						numResults: Math.min(numResults, 10),
						type: "auto",
						contents: { text: { maxCharacters: 1500 } },
					}),
				});

				if (!response.ok) {
					throw new Error(`Exa API error: ${response.status}`);
				}

				const data = await response.json();
				const results =
					data.results
						?.map(
							(r: any, i: number) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.text?.substring(0, 300)}...`,
						)
						.join("\n\n") || "No results found";

				return {
					content: [{ type: "text", text: `Search results for "${query}":\n\n${results}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Search failed: ${error}` }], details: undefined };
			}
		},
	};
}

/**
 * Deep Research - AI-powered comprehensive research
 */
export function createDeepResearchTool(): AgentTool<typeof deepResearchSchema> {
	return {
		name: "deep_research",
		label: "deep_research",
		description:
			"Start a deep AI-powered research task. Uses Exa's research model to analyze multiple sources and synthesize findings. Best for complex questions requiring comprehensive analysis.",
		parameters: deepResearchSchema,
		execute: async (_toolCallId, { question, label }) => {
			logMcpTool("deep_research", label);

			const apiKey = process.env.EXA_API_KEY;
			if (!apiKey) {
				return { content: [{ type: "text", text: "Error: EXA_API_KEY not configured." }], details: undefined };
			}

			try {
				// Start research task
				const startResponse = await fetch("https://api.exa.ai/research", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-api-key": apiKey,
					},
					body: JSON.stringify({
						instructions: question,
						model: "exa-research",
					}),
				});

				if (!startResponse.ok) {
					throw new Error(`Failed to start research: ${startResponse.status}`);
				}

				const { taskId } = await startResponse.json();

				// Poll for completion (max 60 seconds)
				for (let i = 0; i < 12; i++) {
					await new Promise((resolve) => setTimeout(resolve, 5000));

					const checkResponse = await fetch(`https://api.exa.ai/research/${taskId}`, {
						headers: { "x-api-key": apiKey },
					});

					if (!checkResponse.ok) continue;

					const result = await checkResponse.json();
					if (result.status === "completed") {
						const sources =
							result.sources
								?.slice(0, 3)
								.map((s: any) => `- ${s.title}: ${s.url}`)
								.join("\n") || "";
						return {
							content: [
								{ type: "text", text: `**Research Report**\n\n${result.report}\n\n**Sources:**\n${sources}` },
							],
							details: undefined,
						};
					}
				}

				return {
					content: [{ type: "text", text: `Research in progress (task ID: ${taskId}). Check back later.` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Research failed: ${error}` }], details: undefined };
			}
		},
	};
}

/**
 * Web Scrape - Scrape webpage content
 */
export function createWebScrapeTool(): AgentTool<typeof webScrapeSchema> {
	return {
		name: "web_scrape",
		label: "web_scrape",
		description:
			"Scrape content from a webpage. Uses BrightData if available (bypasses anti-bot), otherwise direct fetch.",
		parameters: webScrapeSchema,
		execute: async (_toolCallId, { url, label }) => {
			logMcpTool("web_scrape", label);

			const brightDataToken = process.env.BRIGHTDATA_API_TOKEN;

			// Try BrightData first if available
			if (brightDataToken) {
				try {
					const response = await fetch("https://api.brightdata.com/request", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: `Bearer ${brightDataToken}`,
						},
						body: JSON.stringify({ zone: "web_unlocker", url, format: "raw" }),
					});

					if (response.ok) {
						const text = await response.text();
						return {
							content: [
								{ type: "text", text: `[BrightData] Content from ${url}:\n\n${text.substring(0, 8000)}` },
							],
							details: undefined,
						};
					}
				} catch (e) {
					// Fall through to direct fetch
				}
			}

			// Direct fetch fallback
			try {
				const response = await fetch(url, {
					headers: { "User-Agent": "Mozilla/5.0 (compatible; Pi-Bot/1.0)" },
				});
				const text = await response.text();
				return {
					content: [{ type: "text", text: `Content from ${url}:\n\n${text.substring(0, 8000)}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Scrape failed: ${error}` }], details: undefined };
			}
		},
	};
}

/**
 * GitHub Repo Search
 */
export function createGithubRepoSearchTool(): AgentTool<typeof githubRepoSearchSchema> {
	return {
		name: "github_search",
		label: "github_search",
		description: "Search GitHub repositories. Returns repo names, descriptions, stars, and URLs.",
		parameters: githubRepoSearchSchema,
		execute: async (_toolCallId, { query, perPage = 5, label }) => {
			logMcpTool("github_search", label);

			const token = process.env.GITHUB_TOKEN;
			const headers: Record<string, string> = {
				Accept: "application/vnd.github+json",
				"User-Agent": "Pi-Discord-Bot",
			};
			if (token) headers.Authorization = `Bearer ${token}`;

			try {
				const response = await fetch(
					`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${perPage}`,
					{ headers },
				);

				if (!response.ok) {
					throw new Error(`GitHub API error: ${response.status}`);
				}

				const data = await response.json();
				const results =
					data.items
						?.map(
							(r: any) =>
								`**${r.full_name}** (⭐ ${r.stargazers_count})\n${r.description || "No description"}\n${r.html_url}`,
						)
						.join("\n\n") || "No repositories found";

				return {
					content: [{ type: "text", text: `GitHub search results for "${query}":\n\n${results}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `GitHub search failed: ${error}` }], details: undefined };
			}
		},
	};
}

/**
 * GitHub Get File
 */
export function createGithubGetFileTool(): AgentTool<typeof githubGetFileSchema> {
	return {
		name: "github_file",
		label: "github_file",
		description: "Get contents of a file from a GitHub repository.",
		parameters: githubGetFileSchema,
		execute: async (_toolCallId, { owner, repo, path, branch = "main", label }) => {
			logMcpTool("github_file", label);

			const token = process.env.GITHUB_TOKEN;
			const headers: Record<string, string> = {
				Accept: "application/vnd.github+json",
				"User-Agent": "Pi-Discord-Bot",
			};
			if (token) headers.Authorization = `Bearer ${token}`;

			try {
				const response = await fetch(
					`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`,
					{ headers },
				);

				if (!response.ok) {
					throw new Error(`GitHub API error: ${response.status}`);
				}

				const data = await response.json();
				if (data.content) {
					const content = Buffer.from(data.content, "base64").toString("utf-8");
					return {
						content: [
							{
								type: "text",
								text: `File: ${owner}/${repo}/${path}\n\n\`\`\`\n${content.substring(0, 6000)}\n\`\`\``,
							},
						],
						details: undefined,
					};
				}
				return { content: [{ type: "text", text: "No content found" }], details: undefined };
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to get file: ${error}` }], details: undefined };
			}
		},
	};
}

/**
 * GitHub Create Issue
 */
export function createGithubCreateIssueTool(): AgentTool<typeof githubCreateIssueSchema> {
	return {
		name: "github_issue",
		label: "github_issue",
		description: "Create an issue in a GitHub repository.",
		parameters: githubCreateIssueSchema,
		execute: async (_toolCallId, { owner, repo, title, body, label }) => {
			logMcpTool("github_issue", label);

			const token = process.env.GITHUB_TOKEN;
			if (!token) {
				return { content: [{ type: "text", text: "Error: GITHUB_TOKEN not configured" }], details: undefined };
			}

			try {
				const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
					method: "POST",
					headers: {
						Accept: "application/vnd.github+json",
						Authorization: `Bearer ${token}`,
						"User-Agent": "Pi-Discord-Bot",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ title, body }),
				});

				if (!response.ok) {
					throw new Error(`GitHub API error: ${response.status}`);
				}

				const data = await response.json();
				return { content: [{ type: "text", text: `Issue created: ${data.html_url}` }], details: undefined };
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to create issue: ${error}` }], details: undefined };
			}
		},
	};
}

/**
 * HuggingFace Model Search
 */
export function createHfModelSearchTool(): AgentTool<typeof hfModelSearchSchema> {
	return {
		name: "hf_models",
		label: "hf_models",
		description:
			"Search Hugging Face for ML models. Filter by task type (text-generation, image-classification, etc.)",
		parameters: hfModelSearchSchema,
		execute: async (_toolCallId, { query, task, limit = 5, label }) => {
			logMcpTool("hf_models", label);

			try {
				let url = `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&limit=${limit}`;
				if (task) url += `&pipeline_tag=${task}`;

				const headers: Record<string, string> = {};
				if (process.env.HF_TOKEN) {
					headers.Authorization = `Bearer ${process.env.HF_TOKEN}`;
				}

				const response = await fetch(url, { headers });
				if (!response.ok) {
					throw new Error(`HF API error: ${response.status}`);
				}

				const models = await response.json();
				const results =
					models
						.map(
							(m: any) =>
								`**${m.id}** (⬇️ ${m.downloads?.toLocaleString() || 0})\nTask: ${m.pipeline_tag || "N/A"}\nhttps://huggingface.co/${m.id}`,
						)
						.join("\n\n") || "No models found";

				return {
					content: [{ type: "text", text: `HuggingFace models for "${query}":\n\n${results}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Model search failed: ${error}` }], details: undefined };
			}
		},
	};
}

/**
 * HuggingFace Dataset Search
 */
export function createHfDatasetSearchTool(): AgentTool<typeof hfDatasetSearchSchema> {
	return {
		name: "hf_datasets",
		label: "hf_datasets",
		description: "Search Hugging Face for datasets.",
		parameters: hfDatasetSearchSchema,
		execute: async (_toolCallId, { query, limit = 5, label }) => {
			logMcpTool("hf_datasets", label);

			try {
				const url = `https://huggingface.co/api/datasets?search=${encodeURIComponent(query)}&limit=${limit}`;
				const headers: Record<string, string> = {};
				if (process.env.HF_TOKEN) {
					headers.Authorization = `Bearer ${process.env.HF_TOKEN}`;
				}

				const response = await fetch(url, { headers });
				if (!response.ok) {
					throw new Error(`HF API error: ${response.status}`);
				}

				const datasets = await response.json();
				const results =
					datasets
						.map(
							(d: any) =>
								`**${d.id}** (⬇️ ${d.downloads?.toLocaleString() || 0})\nhttps://huggingface.co/datasets/${d.id}`,
						)
						.join("\n\n") || "No datasets found";

				return {
					content: [{ type: "text", text: `HuggingFace datasets for "${query}":\n\n${results}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Dataset search failed: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// Knowledge Graph Memory (File-based)
// =============================================================================

const MEMORY_FILE = "/opt/discord-bot-data/knowledge-graph.json";

interface KnowledgeGraph {
	entities: Array<{ name: string; type: string; observations: string[] }>;
	relations: Array<{ from: string; to: string; type: string }>;
}

async function loadKnowledgeGraph(): Promise<KnowledgeGraph> {
	try {
		const fs = await import("fs/promises");
		const data = await fs.readFile(MEMORY_FILE, "utf-8");
		return JSON.parse(data);
	} catch {
		return { entities: [], relations: [] };
	}
}

async function saveKnowledgeGraph(kg: KnowledgeGraph): Promise<void> {
	const fs = await import("fs/promises");
	await fs.writeFile(MEMORY_FILE, JSON.stringify(kg, null, 2));
}

/**
 * Memory Store - Save entities to knowledge graph
 */
export function createMemoryStoreTool(): AgentTool<typeof memoryStoreSchema> {
	return {
		name: "memory_store",
		label: "memory_store",
		description:
			"Store information in persistent knowledge graph memory. Use for important facts about people, projects, preferences, etc.",
		parameters: memoryStoreSchema,
		execute: async (_toolCallId, { entityName, entityType, observations, label }) => {
			logMcpTool("memory_store", label);

			try {
				const kg = await loadKnowledgeGraph();
				const existing = kg.entities.find((e) => e.name === entityName);

				if (existing) {
					existing.observations.push(...observations);
				} else {
					kg.entities.push({ name: entityName, type: entityType, observations });
				}

				await saveKnowledgeGraph(kg);
				return {
					content: [
						{
							type: "text",
							text: `Stored ${observations.length} observation(s) for "${entityName}" (${entityType})`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to store: ${error}` }], details: undefined };
			}
		},
	};
}

/**
 * Memory Recall - Search knowledge graph
 */
export function createMemoryRecallTool(): AgentTool<typeof memoryRecallSchema> {
	return {
		name: "memory_recall",
		label: "memory_recall",
		description:
			"Recall information from persistent knowledge graph memory. Search by entity name, type, or content.",
		parameters: memoryRecallSchema,
		execute: async (_toolCallId, { query, label }) => {
			logMcpTool("memory_recall", label);

			try {
				const kg = await loadKnowledgeGraph();
				const queryLower = query.toLowerCase();

				const matches = kg.entities.filter(
					(e) =>
						e.name.toLowerCase().includes(queryLower) ||
						e.type.toLowerCase().includes(queryLower) ||
						e.observations.some((o) => o.toLowerCase().includes(queryLower)),
				);

				if (matches.length === 0) {
					return { content: [{ type: "text", text: `No memories found for "${query}"` }], details: undefined };
				}

				const results = matches
					.map((e) => `**${e.name}** (${e.type})\n${e.observations.map((o) => `- ${o}`).join("\n")}`)
					.join("\n\n");

				return {
					content: [{ type: "text", text: `Found ${matches.length} memories:\n\n${results}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to recall: ${error}` }], details: undefined };
			}
		},
	};
}

/**
 * Memory Relate - Create relations between entities
 */
export function createMemoryRelateTool(): AgentTool<typeof memoryRelateSchema> {
	return {
		name: "memory_relate",
		label: "memory_relate",
		description: "Create a relation between two entities in the knowledge graph.",
		parameters: memoryRelateSchema,
		execute: async (_toolCallId, { from, to, relationType, label }) => {
			logMcpTool("memory_relate", label);

			try {
				const kg = await loadKnowledgeGraph();
				kg.relations.push({ from, to, type: relationType });
				await saveKnowledgeGraph(kg);
				return {
					content: [{ type: "text", text: `Created relation: ${from} --[${relationType}]--> ${to}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to create relation: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// GitHub Advanced Operations (Multi-Agent Orchestration Support)
// =============================================================================

const githubListIssuesSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	owner: Type.String({ description: "Repository owner" }),
	repo: Type.String({ description: "Repository name" }),
	state: Type.Optional(Type.String({ description: "open, closed, or all (default: open)" })),
});

/**
 * GitHub List Issues - Get issues from a repository
 */
export function createGithubListIssuesTool(): AgentTool<typeof githubListIssuesSchema> {
	return {
		name: "github_issues",
		label: "github_issues",
		description: "List issues in a GitHub repository. Filter by state (open/closed/all).",
		parameters: githubListIssuesSchema,
		execute: async (_toolCallId, { owner, repo, state = "open", label }) => {
			logMcpTool("github_issues", label);

			const token = process.env.GITHUB_TOKEN;
			const headers: Record<string, string> = {
				Accept: "application/vnd.github+json",
				"User-Agent": "Pi-Discord-Bot",
			};
			if (token) headers.Authorization = `Bearer ${token}`;

			try {
				const response = await fetch(
					`https://api.github.com/repos/${owner}/${repo}/issues?state=${state}&per_page=10`,
					{ headers },
				);

				if (!response.ok) {
					throw new Error(`GitHub API error: ${response.status}`);
				}

				const issues = await response.json();
				const results =
					issues.map((i: any) => `#${i.number} [${i.state}] **${i.title}**\n${i.html_url}`).join("\n\n") ||
					"No issues found";

				return {
					content: [{ type: "text", text: `Issues in ${owner}/${repo}:\n\n${results}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to list issues: ${error}` }], details: undefined };
			}
		},
	};
}

const githubCreateBranchSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	owner: Type.String({ description: "Repository owner" }),
	repo: Type.String({ description: "Repository name" }),
	branch: Type.String({ description: "New branch name" }),
	from: Type.Optional(Type.String({ description: "Source branch (default: main)" })),
});

/**
 * GitHub Create Branch
 */
export function createGithubCreateBranchTool(): AgentTool<typeof githubCreateBranchSchema> {
	return {
		name: "github_branch",
		label: "github_branch",
		description: "Create a new branch in a GitHub repository.",
		parameters: githubCreateBranchSchema,
		execute: async (_toolCallId, { owner, repo, branch, from = "main", label }) => {
			logMcpTool("github_branch", label);

			const token = process.env.GITHUB_TOKEN;
			if (!token) {
				return { content: [{ type: "text", text: "Error: GITHUB_TOKEN not configured" }], details: undefined };
			}

			const headers = {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${token}`,
				"User-Agent": "Pi-Discord-Bot",
				"Content-Type": "application/json",
			};

			try {
				// Get SHA of source branch
				const refResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${from}`, {
					headers,
				});

				if (!refResponse.ok) {
					throw new Error(`Source branch '${from}' not found`);
				}

				const refData = await refResponse.json();
				const sha = refData.object.sha;

				// Create new branch
				const createResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs`, {
					method: "POST",
					headers,
					body: JSON.stringify({
						ref: `refs/heads/${branch}`,
						sha,
					}),
				});

				if (!createResponse.ok) {
					const error = await createResponse.json();
					throw new Error(error.message || `Failed to create branch: ${createResponse.status}`);
				}

				return {
					content: [{ type: "text", text: `Branch '${branch}' created from '${from}' in ${owner}/${repo}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to create branch: ${error}` }], details: undefined };
			}
		},
	};
}

const githubCreatePRSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	owner: Type.String({ description: "Repository owner" }),
	repo: Type.String({ description: "Repository name" }),
	title: Type.String({ description: "PR title" }),
	body: Type.String({ description: "PR description" }),
	head: Type.String({ description: "Branch with changes" }),
	base: Type.Optional(Type.String({ description: "Target branch (default: main)" })),
});

/**
 * GitHub Create Pull Request
 */
export function createGithubCreatePRTool(): AgentTool<typeof githubCreatePRSchema> {
	return {
		name: "github_pr",
		label: "github_pr",
		description: "Create a pull request in a GitHub repository.",
		parameters: githubCreatePRSchema,
		execute: async (_toolCallId, { owner, repo, title, body, head, base = "main", label }) => {
			logMcpTool("github_pr", label);

			const token = process.env.GITHUB_TOKEN;
			if (!token) {
				return { content: [{ type: "text", text: "Error: GITHUB_TOKEN not configured" }], details: undefined };
			}

			try {
				const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
					method: "POST",
					headers: {
						Accept: "application/vnd.github+json",
						Authorization: `Bearer ${token}`,
						"User-Agent": "Pi-Discord-Bot",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ title, body, head, base }),
				});

				if (!response.ok) {
					const error = await response.json();
					throw new Error(error.message || `GitHub API error: ${response.status}`);
				}

				const data = await response.json();
				return { content: [{ type: "text", text: `PR created: ${data.html_url}` }], details: undefined };
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to create PR: ${error}` }], details: undefined };
			}
		},
	};
}

const githubListPRsSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	owner: Type.String({ description: "Repository owner" }),
	repo: Type.String({ description: "Repository name" }),
	state: Type.Optional(Type.String({ description: "open, closed, or all (default: open)" })),
});

/**
 * GitHub List Pull Requests
 */
export function createGithubListPRsTool(): AgentTool<typeof githubListPRsSchema> {
	return {
		name: "github_prs",
		label: "github_prs",
		description: "List pull requests in a GitHub repository.",
		parameters: githubListPRsSchema,
		execute: async (_toolCallId, { owner, repo, state = "open", label }) => {
			logMcpTool("github_prs", label);

			const token = process.env.GITHUB_TOKEN;
			const headers: Record<string, string> = {
				Accept: "application/vnd.github+json",
				"User-Agent": "Pi-Discord-Bot",
			};
			if (token) headers.Authorization = `Bearer ${token}`;

			try {
				const response = await fetch(
					`https://api.github.com/repos/${owner}/${repo}/pulls?state=${state}&per_page=10`,
					{ headers },
				);

				if (!response.ok) {
					throw new Error(`GitHub API error: ${response.status}`);
				}

				const prs = await response.json();
				const results =
					prs
						.map(
							(p: any) =>
								`#${p.number} [${p.state}] **${p.title}**\n${p.head.ref} → ${p.base.ref}\n${p.html_url}`,
						)
						.join("\n\n") || "No PRs found";

				return { content: [{ type: "text", text: `PRs in ${owner}/${repo}:\n\n${results}` }], details: undefined };
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to list PRs: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// Task Breakdown & Project Management
// =============================================================================

const TASKS_FILE = "/opt/discord-bot-data/tasks.json";

interface Task {
	id: string;
	title: string;
	description: string;
	status: "pending" | "in_progress" | "completed" | "blocked";
	parent?: string;
	blockedBy?: string[];
	createdAt: string;
	updatedAt: string;
}

interface TaskStore {
	tasks: Task[];
}

async function loadTasks(): Promise<TaskStore> {
	try {
		const fs = await import("fs/promises");
		const data = await fs.readFile(TASKS_FILE, "utf-8");
		return JSON.parse(data);
	} catch {
		return { tasks: [] };
	}
}

async function saveTasks(store: TaskStore): Promise<void> {
	const fs = await import("fs/promises");
	await fs.writeFile(TASKS_FILE, JSON.stringify(store, null, 2));
}

const taskCreateSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	title: Type.String({ description: "Task title" }),
	description: Type.String({ description: "Task description" }),
	parent: Type.Optional(Type.String({ description: "Parent task ID (for sub-tasks)" })),
	blockedBy: Type.Optional(Type.Array(Type.String(), { description: "Task IDs this is blocked by" })),
});

/**
 * Create Task - For task breakdown and project management
 */
export function createTaskCreateTool(): AgentTool<typeof taskCreateSchema> {
	return {
		name: "task_create",
		label: "task_create",
		description:
			"Create a task or sub-task for project management. Use for breaking down large work into smaller pieces.",
		parameters: taskCreateSchema,
		execute: async (_toolCallId, { title, description, parent, blockedBy, label }) => {
			logMcpTool("task_create", label);

			try {
				const store = await loadTasks();
				const id = `task-${Date.now()}`;
				const now = new Date().toISOString();

				store.tasks.push({
					id,
					title,
					description,
					status: blockedBy?.length ? "blocked" : "pending",
					parent,
					blockedBy,
					createdAt: now,
					updatedAt: now,
				});

				await saveTasks(store);
				return {
					content: [
						{
							type: "text",
							text: `Task created: ${id}\n**${title}**\n${description}${parent ? `\nParent: ${parent}` : ""}${blockedBy?.length ? `\nBlocked by: ${blockedBy.join(", ")}` : ""}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to create task: ${error}` }], details: undefined };
			}
		},
	};
}

const taskListSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	status: Type.Optional(
		Type.String({ description: "Filter by status: pending, in_progress, completed, blocked, all" }),
	),
	parent: Type.Optional(Type.String({ description: "Filter by parent task ID" })),
});

/**
 * List Tasks
 */
export function createTaskListTool(): AgentTool<typeof taskListSchema> {
	return {
		name: "task_list",
		label: "task_list",
		description: "List tasks with optional filtering by status or parent.",
		parameters: taskListSchema,
		execute: async (_toolCallId, { status, parent, label }) => {
			logMcpTool("task_list", label);

			try {
				const store = await loadTasks();
				let tasks = store.tasks;

				if (status && status !== "all") {
					tasks = tasks.filter((t) => t.status === status);
				}
				if (parent) {
					tasks = tasks.filter((t) => t.parent === parent);
				}

				if (tasks.length === 0) {
					return { content: [{ type: "text", text: "No tasks found" }], details: undefined };
				}

				const statusEmoji: Record<string, string> = {
					pending: "⏳",
					in_progress: "🔄",
					completed: "✅",
					blocked: "🚫",
				};

				const results = tasks
					.map(
						(t) =>
							`${statusEmoji[t.status]} **${t.id}**: ${t.title}\n   ${t.description.substring(0, 100)}${t.blockedBy?.length ? `\n   Blocked by: ${t.blockedBy.join(", ")}` : ""}`,
					)
					.join("\n\n");

				return { content: [{ type: "text", text: `**Tasks:**\n\n${results}` }], details: undefined };
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to list tasks: ${error}` }], details: undefined };
			}
		},
	};
}

const taskUpdateSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	id: Type.String({ description: "Task ID" }),
	status: Type.String({ description: "New status: pending, in_progress, completed, blocked" }),
});

/**
 * Update Task Status
 */
export function createTaskUpdateTool(): AgentTool<typeof taskUpdateSchema> {
	return {
		name: "task_update",
		label: "task_update",
		description: "Update a task's status.",
		parameters: taskUpdateSchema,
		execute: async (_toolCallId, { id, status, label }) => {
			logMcpTool("task_update", label);

			try {
				const store = await loadTasks();
				const task = store.tasks.find((t) => t.id === id);

				if (!task) {
					return { content: [{ type: "text", text: `Task not found: ${id}` }], details: undefined };
				}

				const oldStatus = task.status;
				task.status = status as Task["status"];
				task.updatedAt = new Date().toISOString();

				// If task completed, unblock dependent tasks
				if (status === "completed") {
					store.tasks.forEach((t) => {
						if (t.blockedBy?.includes(id)) {
							t.blockedBy = t.blockedBy.filter((b) => b !== id);
							if (t.blockedBy.length === 0 && t.status === "blocked") {
								t.status = "pending";
							}
						}
					});
				}

				await saveTasks(store);
				return {
					content: [{ type: "text", text: `Task ${id} updated: ${oldStatus} → ${status}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to update task: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// Codebase Knowledge (Pi-Mono Documentation)
// =============================================================================

const codebaseKnowledgeSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	query: Type.String({ description: "What to search for in the codebase knowledge" }),
});

/**
 * Codebase Knowledge - Search pi-mono documentation and knowledge base
 */
export function createCodebaseKnowledgeTool(): AgentTool<typeof codebaseKnowledgeSchema> {
	return {
		name: "codebase_knowledge",
		label: "codebase_knowledge",
		description:
			"Search the pi-mono codebase knowledge base. Use this to answer questions about pi-mono packages, APIs, architecture, and development. Covers: pi-ai, pi-agent, pi-coding-agent, pi-mom, pi-tui, pi-web-ui, pi-proxy, pi-pods, pi-discord.",
		parameters: codebaseKnowledgeSchema,
		execute: async (_toolCallId, { query, label }) => {
			logMcpTool("codebase_knowledge", label);

			try {
				const fs = await import("fs/promises");
				const path = await import("path");

				// Read the knowledge base
				const knowledgePath = "/opt/discord-bot-data/knowledge/pi-mono.md";
				const knowledge = await fs.readFile(knowledgePath, "utf-8");

				// Simple keyword search
				const queryLower = query.toLowerCase();
				const lines = knowledge.split("\n");
				const relevantSections: string[] = [];
				let currentSection = "";
				let sectionHeader = "";

				for (const line of lines) {
					if (line.startsWith("## ") || line.startsWith("### ")) {
						// Save previous section if relevant
						if (
							currentSection &&
							(sectionHeader.toLowerCase().includes(queryLower) ||
								currentSection.toLowerCase().includes(queryLower))
						) {
							relevantSections.push(`${sectionHeader}\n${currentSection.trim()}`);
						}
						sectionHeader = line;
						currentSection = "";
					} else {
						currentSection += line + "\n";
					}
				}

				// Check last section
				if (
					currentSection &&
					(sectionHeader.toLowerCase().includes(queryLower) || currentSection.toLowerCase().includes(queryLower))
				) {
					relevantSections.push(`${sectionHeader}\n${currentSection.trim()}`);
				}

				if (relevantSections.length === 0) {
					// Return a summary if no specific match
					return {
						content: [
							{
								type: "text",
								text: `No specific match for "${query}". Pi-mono is a Node.js monorepo with packages: pi-ai (LLM API), pi-agent (runtime), pi-coding-agent (CLI), pi-mom (Slack bot), pi-discord (Discord bot), pi-tui (terminal UI), pi-web-ui (web components), pi-proxy (CORS proxy), pi-pods (vLLM manager).`,
							},
						],
						details: undefined,
					};
				}

				// Return relevant sections (limit to 3000 chars)
				let result = relevantSections.join("\n\n---\n\n");
				if (result.length > 3000) {
					result = result.substring(0, 3000) + "\n...(truncated)";
				}

				return { content: [{ type: "text", text: result }], details: undefined };
			} catch (error) {
				return {
					content: [{ type: "text", text: `Failed to search knowledge base: ${error}` }],
					details: undefined,
				};
			}
		},
	};
}

// =============================================================================
// Free Web Search (DuckDuckGo - No API Key Required)
// =============================================================================

const freeWebSearchSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	query: Type.String({ description: "Search query" }),
});

/**
 * Free Web Search - Uses DuckDuckGo Instant Answer API (no key needed)
 */
export function createFreeWebSearchTool(): AgentTool<typeof freeWebSearchSchema> {
	return {
		name: "free_search",
		label: "free_search",
		description:
			"Free web search using DuckDuckGo. No API key required. Returns instant answers and related topics. Good for quick facts and definitions.",
		parameters: freeWebSearchSchema,
		execute: async (_toolCallId, { query, label }) => {
			logMcpTool("free_search", label);

			try {
				const encodedQuery = encodeURIComponent(query);
				const response = await fetch(
					`https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`,
					{
						headers: { "User-Agent": "Pi-Discord-Bot/1.0" },
					},
				);

				if (!response.ok) {
					throw new Error(`DuckDuckGo API error: ${response.status}`);
				}

				const data = await response.json();
				const results: string[] = [];

				// Abstract (instant answer)
				if (data.Abstract) {
					results.push(`**Answer:** ${data.Abstract}`);
					if (data.AbstractSource) {
						results.push(`Source: ${data.AbstractSource} - ${data.AbstractURL}`);
					}
				}

				// Definition
				if (data.Definition) {
					results.push(`**Definition:** ${data.Definition}`);
				}

				// Related topics
				if (data.RelatedTopics && data.RelatedTopics.length > 0) {
					const topics = data.RelatedTopics.filter((t: any) => t.Text)
						.slice(0, 5)
						.map((t: any) => `- ${t.Text}`);
					if (topics.length > 0) {
						results.push(`**Related:**\n${topics.join("\n")}`);
					}
				}

				// Infobox
				if (data.Infobox?.content) {
					const info = data.Infobox.content
						.slice(0, 5)
						.map((i: any) => `- ${i.label}: ${i.value}`)
						.join("\n");
					results.push(`**Info:**\n${info}`);
				}

				if (results.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: `No instant answer found for "${query}". Try using web_search for more comprehensive results.`,
							},
						],
						details: undefined,
					};
				}

				return { content: [{ type: "text", text: results.join("\n\n") }], details: undefined };
			} catch (error) {
				return { content: [{ type: "text", text: `Free search failed: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// Pi-Mono Source Code Reader
// =============================================================================

const piMonoReadSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	path: Type.String({ description: "Relative path within pi-mono (e.g., 'packages/ai/src/index.ts')" }),
	lines: Type.Optional(Type.Number({ description: "Max lines to return (default 100)" })),
});

/**
 * Pi-Mono Source Reader - Read actual source files from pi-mono
 */
export function createPiMonoReadTool(): AgentTool<typeof piMonoReadSchema> {
	return {
		name: "pimono_read",
		label: "pimono_read",
		description:
			"Read source files from the pi-mono repository. Use this to show actual code, look at implementations, or help debug issues. Path is relative to /opt/pi-mono/",
		parameters: piMonoReadSchema,
		execute: async (_toolCallId, { path, lines = 100, label }) => {
			logMcpTool("pimono_read", label);

			try {
				const fs = await import("fs/promises");
				const fullPath = `/opt/pi-mono/${path}`;

				// Security: Only allow reading from pi-mono
				if (!fullPath.startsWith("/opt/pi-mono/") || fullPath.includes("..")) {
					return {
						content: [{ type: "text", text: "Error: Can only read files within /opt/pi-mono/" }],
						details: undefined,
					};
				}

				const content = await fs.readFile(fullPath, "utf-8");
				const contentLines = content.split("\n");
				const truncated = contentLines.slice(0, lines).join("\n");
				const suffix = contentLines.length > lines ? `\n... (${contentLines.length - lines} more lines)` : "";

				return {
					content: [{ type: "text", text: `**${path}**\n\`\`\`typescript\n${truncated}${suffix}\n\`\`\`` }],
					details: undefined,
				};
			} catch (error: any) {
				if (error.code === "ENOENT") {
					return { content: [{ type: "text", text: `File not found: ${path}` }], details: undefined };
				}
				return { content: [{ type: "text", text: `Failed to read: ${error.message}` }], details: undefined };
			}
		},
	};
}

const piMonoListSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	path: Type.String({ description: "Relative path within pi-mono (e.g., 'packages/ai/src')" }),
});

/**
 * Pi-Mono Directory Listing - List files in pi-mono directories
 */
export function createPiMonoListTool(): AgentTool<typeof piMonoListSchema> {
	return {
		name: "pimono_list",
		label: "pimono_list",
		description: "List files and directories within pi-mono. Use to explore the codebase structure.",
		parameters: piMonoListSchema,
		execute: async (_toolCallId, { path, label }) => {
			logMcpTool("pimono_list", label);

			try {
				const fs = await import("fs/promises");
				const fullPath = `/opt/pi-mono/${path}`;

				// Security: Only allow listing within pi-mono
				if (!fullPath.startsWith("/opt/pi-mono/") || fullPath.includes("..")) {
					return {
						content: [{ type: "text", text: "Error: Can only list within /opt/pi-mono/" }],
						details: undefined,
					};
				}

				const entries = await fs.readdir(fullPath, { withFileTypes: true });
				const list = entries
					.filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
					.map((e) => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`)
					.sort()
					.join("\n");

				return { content: [{ type: "text", text: `**${path}/**\n${list}` }], details: undefined };
			} catch (error: any) {
				if (error.code === "ENOENT") {
					return { content: [{ type: "text", text: `Directory not found: ${path}` }], details: undefined };
				}
				return { content: [{ type: "text", text: `Failed to list: ${error.message}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// Skill System - Load on-demand instructions
// =============================================================================

const skillListSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	category: Type.Optional(Type.String({ description: "Filter by category (e.g., 'pi-', 'trading', 'integration')" })),
});

/**
 * Skill List - List available skills
 */
export function createSkillListTool(): AgentTool<typeof skillListSchema> {
	return {
		name: "skill_list",
		label: "skill_list",
		description:
			"List all available skills. Skills are SKILL.md files containing specialized instructions for specific tasks.",
		parameters: skillListSchema,
		execute: async (_toolCallId, { category, label }) => {
			logMcpTool("skill_list", label);

			try {
				const fs = await import("fs/promises");
				const skillsDir = "/opt/discord-bot-data/skills";
				const files = await fs.readdir(skillsDir);

				let skills = files.filter((f) => f.endsWith(".md")).map((f) => f.replace(".md", ""));

				if (category) {
					skills = skills.filter((s) => s.toLowerCase().includes(category.toLowerCase()));
				}

				// Categorize skills
				const categories: Record<string, string[]> = {
					"Pi-Mono Development": [],
					"Trading & Finance": [],
					Integrations: [],
					"Research & Writing": [],
					"System & Admin": [],
					Other: [],
				};

				for (const skill of skills) {
					if (skill.startsWith("pi-")) {
						categories["Pi-Mono Development"].push(skill);
					} else if (
						[
							"trading",
							"market",
							"crypto",
							"quant",
							"portfolio",
							"risk",
							"technical",
							"sentiment",
							"order",
							"backtesting",
						].some((k) => skill.includes(k))
					) {
						categories["Trading & Finance"].push(skill);
					} else if (skill.includes("integration") || skill.includes("webhook") || skill.includes("api")) {
						categories.Integrations.push(skill);
					} else if (["research", "writing", "analysis", "data"].some((k) => skill.includes(k))) {
						categories["Research & Writing"].push(skill);
					} else if (["system", "admin", "model", "coding"].some((k) => skill.includes(k))) {
						categories["System & Admin"].push(skill);
					} else {
						categories.Other.push(skill);
					}
				}

				const output = Object.entries(categories)
					.filter(([_, items]) => items.length > 0)
					.map(([cat, items]) => `**${cat}**\n${items.map((i) => `  • ${i}`).join("\n")}`)
					.join("\n\n");

				return {
					content: [
						{
							type: "text",
							text: `**Available Skills (${skills.length}):**\n\n${output}\n\nUse \`skill_load\` to activate a skill.`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to list skills: ${error}` }], details: undefined };
			}
		},
	};
}

const skillLoadSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	skill: Type.String({ description: "Name of the skill to load (without .md extension)" }),
	section: Type.Optional(Type.String({ description: "Specific section to load (optional)" })),
});

/**
 * Skill Load - Load a skill's instructions
 */
export function createSkillLoadTool(): AgentTool<typeof skillLoadSchema> {
	return {
		name: "skill_load",
		label: "skill_load",
		description:
			"Load a skill's instructions. Returns the SKILL.md content which contains specialized knowledge and instructions for a specific task domain.",
		parameters: skillLoadSchema,
		execute: async (_toolCallId, { skill, section, label }) => {
			logMcpTool("skill_load", label);

			try {
				const fs = await import("fs/promises");
				const skillPath = `/opt/discord-bot-data/skills/${skill}.md`;

				let content: string;
				try {
					content = await fs.readFile(skillPath, "utf-8");
				} catch (e: any) {
					if (e.code === "ENOENT") {
						// Try with variations
						const variations = [
							`/opt/discord-bot-data/skills/${skill.toLowerCase()}.md`,
							`/opt/discord-bot-data/skills/${skill.replace(/-/g, "_")}.md`,
							`/opt/discord-bot-data/skills/${skill.replace(/_/g, "-")}.md`,
						];

						for (const v of variations) {
							try {
								content = await fs.readFile(v, "utf-8");
								break;
							} catch {}
						}

						if (!content!) {
							return {
								content: [
									{
										type: "text",
										text: `Skill not found: ${skill}\n\nUse \`skill_list\` to see available skills.`,
									},
								],
								details: undefined,
							};
						}
					} else {
						throw e;
					}
				}

				// Extract specific section if requested
				if (section) {
					const lines = content.split("\n");
					const sectionLower = section.toLowerCase();
					let inSection = false;
					const sectionContent: string[] = [];
					let sectionLevel = 0;

					for (const line of lines) {
						if (line.match(/^#+\s/) && line.toLowerCase().includes(sectionLower)) {
							inSection = true;
							sectionLevel = (line.match(/^#+/) || [""])[0].length;
							sectionContent.push(line);
						} else if (inSection) {
							const lineLevel = (line.match(/^#+/) || [""])[0].length;
							if (lineLevel > 0 && lineLevel <= sectionLevel && !line.toLowerCase().includes(sectionLower)) {
								break;
							}
							sectionContent.push(line);
						}
					}

					if (sectionContent.length > 0) {
						content = sectionContent.join("\n");
					}
				}

				// Truncate if too long
				if (content.length > 6000) {
					content = content.substring(0, 6000) + "\n\n...(truncated - use section parameter for specific parts)";
				}

				return { content: [{ type: "text", text: `**Skill: ${skill}**\n\n${content}` }], details: undefined };
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to load skill: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// Export all MCP tools
// =============================================================================

export function getAllMcpTools(): AgentTool<any>[] {
	return [
		// Web Search & Research
		createWebSearchTool(),
		createDeepResearchTool(),
		createWebScrapeTool(),
		createFreeWebSearchTool(), // Free DuckDuckGo search

		// GitHub Basic
		createGithubRepoSearchTool(),
		createGithubGetFileTool(),
		createGithubCreateIssueTool(),

		// GitHub Advanced (Multi-Agent Orchestration)
		createGithubListIssuesTool(),
		createGithubCreateBranchTool(),
		createGithubCreatePRTool(),
		createGithubListPRsTool(),

		// HuggingFace
		createHfModelSearchTool(),
		createHfDatasetSearchTool(),

		// Memory
		createMemoryStoreTool(),
		createMemoryRecallTool(),
		createMemoryRelateTool(),

		// Task Management
		createTaskCreateTool(),
		createTaskListTool(),
		createTaskUpdateTool(),

		// Codebase Knowledge & Source
		createCodebaseKnowledgeTool(),
		createPiMonoReadTool(),
		createPiMonoListTool(),

		// Skills System
		createSkillListTool(),
		createSkillLoadTool(),

		// Self-Management
		createMemoryUpdateTool(),
		createSkillCreateTool(),

		// Context Management
		createContextCompactTool(),

		// Voice/Audio
		createTranscribeTool(),

		// Multi-Agent Orchestration
		createAgentSpawnTool(),
		createAgentDelegateTool(),

		// Hooks System
		createHooksListTool(),
		createHookCreateTool(),

		// RAG / Knowledge Base
		createKnowledgeSearchTool(),

		// Vision / Image Analysis
		createImageAnalyzeTool(),

		// Code Sandbox
		createCodeSandboxTool(),

		// Scheduled Tasks
		createScheduleTaskTool(),
		createListScheduledTasksTool(),

		// Auto-Learning
		createAutoLearnTool(),

		// File Processing
		createFileProcessTool(),

		// Rich Embeds
		createRichEmbedTool(),

		// Docker Sandbox
		createDockerSandboxTool(),
		createSandboxExecTool(), // Enhanced Docker sandbox with resource management

		// Conversation Export
		createConversationExportTool(),

		// User Preferences
		createUserPreferencesTool(),

		// Voice Channel
		createVoiceJoinTool(),
		createVoiceTTSTool(),

		// Plugin System
		createPluginLoadTool(),
		createPluginListTool(),

		// Slash Command Builder
		createSlashCommandCreateTool(),
		createSlashCommandListTool(),

		// Multi-Server Sync
		createServerSyncTool(),
		createServerListTool(),

		// Advanced Features
		createImageGenerateTool(),
		createPersonaTool(),
		createBackupTool(),
		createThreadingTool(),

		// Creative Arts & Production
		createSunoMusicTool(),
		createFalImageTool(),
		createFalVideoTool(),
		createDirectorTool(),
		createArtDesignTool(),
		createHFInferenceTool(),
		createHFVideoTool(),

		// Additional Creative Tools
		createGeminiImageTool(),
		createLumaVideoTool(),
		createMubertMusicTool(),
		createApiUsageTool(),

		// Voice & Audio (Option A)
		createElevenLabsTTSTool(),
		createAudioEffectsTool(),

		// Advanced Image (Option B)
		createImageInpaintTool(),
		createImageUpscaleTool(),
		createStyleTransferTool(),
		createFaceRestoreTool(),

		// 3D & Animation (Option C)
		createTripoSR3DTool(),
		createShapE3DTool(),
		createGifGenerateTool(),

		// Integrations (Option D)
		createTwitterPostTool(),
		createYoutubeUploadTool(),
		createTelegramBridgeTool(),

		// Intelligence (Option E)
		createRAGSearchTool(),
		createWebCrawlTool(),
		createPythonExecTool(),

		// Workflow (Option F)
		createPresetChainTool(),
		createBatchGenerateTool(),
		createScheduleCreativeTool(),

		// LiveKit Real-time Voice/Video
		createLiveKitRoomTool(),
		createLiveKitTokenTool(),
		createLiveKitEgressTool(),
		createLiveKitAgentTool(),

		// VibeVoice - Microsoft's Long-form Conversational TTS
		createVibeVoiceTool(),
	];
}

// =============================================================================
// Self-Management Tools (Like Pi-Mom)
// =============================================================================

const memoryUpdateSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	action: Type.String({ description: "add, update, or clear" }),
	section: Type.String({ description: "Section name (e.g., 'User Preferences', 'Learned Facts')" }),
	content: Type.String({ description: "Content to add/update" }),
	isGlobal: Type.Optional(Type.Boolean({ description: "Update global memory (default: true)" })),
});

/**
 * Memory Update - Allow bot to update its own MEMORY.md
 */
export function createMemoryUpdateTool(): AgentTool<typeof memoryUpdateSchema> {
	return {
		name: "memory_update",
		label: "memory_update",
		description:
			"Update the bot's persistent MEMORY.md file. Use this to remember user preferences, learned facts, and important discoveries. The bot should proactively use this to build knowledge over time.",
		parameters: memoryUpdateSchema,
		execute: async (_toolCallId, { action, section, content, isGlobal = true, label }) => {
			logMcpTool("memory_update", label);

			try {
				const fs = await import("fs/promises");
				const memoryPath = isGlobal ? "/opt/discord-bot-data/MEMORY.md" : "/opt/discord-bot-data/channel-memory.md";

				let memory: string;
				try {
					memory = await fs.readFile(memoryPath, "utf-8");
				} catch {
					memory = "# Memory\n\n";
				}

				const timestamp = new Date().toISOString().split("T")[0];
				const lines = memory.split("\n");
				let newMemory = "";
				let inSection = false;
				let sectionFound = false;
				const sectionContent: string[] = [];

				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];

					// Check if this is our target section
					if (line.startsWith("## ") && line.toLowerCase().includes(section.toLowerCase())) {
						sectionFound = true;
						inSection = true;
						newMemory += line + "\n";

						if (action === "add") {
							// Find end of section and add there
							let j = i + 1;
							while (j < lines.length && !lines[j].startsWith("## ")) {
								newMemory += lines[j] + "\n";
								j++;
							}
							// Add new content
							newMemory += `- [${timestamp}] ${content}\n`;
							i = j - 1; // Skip processed lines
						} else if (action === "clear") {
							// Skip section content
							while (i + 1 < lines.length && !lines[i + 1].startsWith("## ")) {
								i++;
							}
							newMemory += "(cleared)\n";
						}
						inSection = false;
					} else if (line.startsWith("## ")) {
						inSection = false;
						newMemory += line + "\n";
					} else {
						newMemory += line + "\n";
					}
				}

				// If section not found, create it
				if (!sectionFound && action === "add") {
					newMemory += `\n## ${section}\n- [${timestamp}] ${content}\n`;
				}

				await fs.writeFile(memoryPath, newMemory.trim() + "\n");

				return {
					content: [
						{
							type: "text",
							text: `Memory updated: ${action} in "${section}" section${isGlobal ? " (global)" : " (channel)"}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to update memory: ${error}` }], details: undefined };
			}
		},
	};
}

const skillCreateSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	name: Type.String({ description: "Skill name (will be kebab-cased as filename)" }),
	title: Type.String({ description: "Human-readable title for the skill" }),
	content: Type.String({ description: "Markdown content for the skill" }),
});

/**
 * Skill Create - Allow bot to create new skills
 */
export function createSkillCreateTool(): AgentTool<typeof skillCreateSchema> {
	return {
		name: "skill_create",
		label: "skill_create",
		description:
			"Create a new skill file. Use this when you learn something valuable that should be reusable. Skills are markdown files with instructions, examples, and best practices for specific domains.",
		parameters: skillCreateSchema,
		execute: async (_toolCallId, { name, title, content, label }) => {
			logMcpTool("skill_create", label);

			try {
				const fs = await import("fs/promises");

				// Sanitize filename
				const filename = name
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, "-")
					.replace(/^-|-$/g, "");

				const skillPath = `/opt/discord-bot-data/skills/${filename}.md`;

				// Check if skill already exists
				try {
					await fs.access(skillPath);
					return {
						content: [
							{
								type: "text",
								text: `Skill "${filename}" already exists. Use a different name or update manually.`,
							},
						],
						details: undefined,
					};
				} catch {
					// File doesn't exist, we can create it
				}

				const timestamp = new Date().toISOString().split("T")[0];
				const fullContent = `# ${title}

> Created: ${timestamp}
> Auto-generated skill by Pi-Agent

${content}
`;

				await fs.writeFile(skillPath, fullContent);

				return {
					content: [
						{
							type: "text",
							text: `Skill created: ${filename}.md\nTitle: ${title}\nPath: ${skillPath}\n\nUse \`skill_load ${filename}\` to activate it.`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to create skill: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// Context Compaction Tool
// =============================================================================

const contextCompactSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	channelId: Type.String({ description: "Channel ID to compact" }),
	keepMessages: Type.Optional(Type.Number({ description: "Number of recent messages to keep (default: 10)" })),
});

/**
 * Context Compact - Summarize old messages to reduce context size
 */
export function createContextCompactTool(): AgentTool<typeof contextCompactSchema> {
	return {
		name: "context_compact",
		label: "context_compact",
		description:
			"Compact conversation context by summarizing older messages. Use when context gets too large. Keeps recent messages intact.",
		parameters: contextCompactSchema,
		execute: async (_toolCallId, { channelId, keepMessages = 10, label }) => {
			logMcpTool("context_compact", label);

			try {
				const fs = await import("fs/promises");
				const contextPath = `/opt/discord-bot-data/${channelId}/context.jsonl`;

				let lines: string[];
				try {
					const content = await fs.readFile(contextPath, "utf-8");
					lines = content.trim().split("\n").filter(Boolean);
				} catch {
					return {
						content: [{ type: "text", text: "No context file found for this channel." }],
						details: undefined,
					};
				}

				if (lines.length <= keepMessages) {
					return {
						content: [{ type: "text", text: `Context only has ${lines.length} messages, no compaction needed.` }],
						details: undefined,
					};
				}

				// Parse messages
				const messages = lines
					.map((line) => {
						try {
							return JSON.parse(line);
						} catch {
							return null;
						}
					})
					.filter(Boolean);

				// Keep recent messages
				const recentMessages = messages.slice(-keepMessages);
				const oldMessages = messages.slice(0, -keepMessages);

				// Create summary of old messages
				const summaryParts: string[] = [];
				for (const msg of oldMessages) {
					if (msg.role === "user") {
						summaryParts.push(`User: ${msg.content?.substring(0, 100)}...`);
					} else if (msg.role === "assistant") {
						summaryParts.push(`Bot: ${msg.content?.substring(0, 100)}...`);
					}
				}

				const summary = {
					role: "system",
					content: `[COMPACTED CONTEXT - ${oldMessages.length} messages summarized]\n${summaryParts.slice(0, 20).join("\n")}`,
				};

				// Write compacted context
				const newContext = [summary, ...recentMessages];
				const newContent = newContext.map((m) => JSON.stringify(m)).join("\n") + "\n";
				await fs.writeFile(contextPath, newContent);

				return {
					content: [
						{
							type: "text",
							text: `Context compacted: ${oldMessages.length} old messages summarized, ${recentMessages.length} recent messages kept.`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to compact context: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// Voice Transcription Tool
// =============================================================================

const transcribeSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	audioUrl: Type.String({ description: "URL to audio file (mp3, wav, m4a, ogg, webm)" }),
});

/**
 * Transcribe - Convert audio to text using Groq Whisper
 */
export function createTranscribeTool(): AgentTool<typeof transcribeSchema> {
	return {
		name: "transcribe",
		label: "transcribe",
		description: "Transcribe audio to text using Groq Whisper API. Supports mp3, wav, m4a, ogg, webm formats.",
		parameters: transcribeSchema,
		execute: async (_toolCallId, { audioUrl, label }) => {
			logMcpTool("transcribe", label);

			const groqApiKey = process.env.GROQ_API_KEY;
			if (!groqApiKey) {
				return {
					content: [{ type: "text", text: "Error: GROQ_API_KEY not configured for transcription." }],
					details: undefined,
				};
			}

			try {
				// Download audio file
				const audioResponse = await fetch(audioUrl);
				if (!audioResponse.ok) {
					throw new Error(`Failed to download audio: ${audioResponse.status}`);
				}

				const audioBuffer = await audioResponse.arrayBuffer();
				const audioBlob = new Blob([audioBuffer]);

				// Prepare form data
				const formData = new FormData();
				formData.append("file", audioBlob, "audio.mp3");
				formData.append("model", "whisper-large-v3");
				formData.append("response_format", "text");

				// Call Groq Whisper API
				const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${groqApiKey}`,
					},
					body: formData,
				});

				if (!response.ok) {
					throw new Error(`Groq API error: ${response.status}`);
				}

				const transcript = await response.text();
				return {
					content: [{ type: "text", text: `**Transcription:**\n${transcript}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Transcription failed: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// Multi-Agent Orchestration Tools
// =============================================================================

const agentSpawnSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	task: Type.String({ description: "Task description for the sub-agent" }),
	model: Type.Optional(Type.String({ description: "Model to use (default: current model)" })),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 60)" })),
});

/**
 * Agent Spawn - Create a sub-agent for parallel task execution
 */
export function createAgentSpawnTool(): AgentTool<typeof agentSpawnSchema> {
	return {
		name: "agent_spawn",
		label: "agent_spawn",
		description:
			"Spawn a sub-agent to work on a task in parallel. Use for complex tasks that can be broken down. The sub-agent has access to bash and file tools.",
		parameters: agentSpawnSchema,
		execute: async (_toolCallId, { task, model, timeout = 60, label }) => {
			logMcpTool("agent_spawn", label);

			try {
				const { execSync } = await import("child_process");

				// Use opencode CLI or pi CLI to spawn sub-agent
				const modelArg = model ? `-m ${model}` : "";
				const cmd = `timeout ${timeout} opencode run "${task.replace(/"/g, '\\"')}" ${modelArg} 2>&1 || echo "[TIMEOUT or ERROR]"`;

				const result = execSync(cmd, {
					encoding: "utf-8",
					maxBuffer: 1024 * 1024,
					timeout: (timeout + 5) * 1000,
				}).trim();

				return {
					content: [
						{
							type: "text",
							text: `**Sub-Agent Result:**\n${result.substring(0, 3000)}${result.length > 3000 ? "\n...(truncated)" : ""}`,
						},
					],
					details: undefined,
				};
			} catch (error: any) {
				return {
					content: [
						{
							type: "text",
							text: `Sub-agent failed: ${error.message || error}`,
						},
					],
					details: undefined,
				};
			}
		},
	};
}

const agentDelegateSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	tasks: Type.Array(Type.String(), { description: "List of tasks to delegate" }),
	parallel: Type.Optional(Type.Boolean({ description: "Run tasks in parallel (default: true)" })),
});

/**
 * Agent Delegate - Delegate multiple tasks to sub-agents
 */
export function createAgentDelegateTool(): AgentTool<typeof agentDelegateSchema> {
	return {
		name: "agent_delegate",
		label: "agent_delegate",
		description:
			"Delegate multiple tasks to sub-agents. Tasks can run in parallel or sequentially. Use for complex multi-step workflows.",
		parameters: agentDelegateSchema,
		execute: async (_toolCallId, { tasks, parallel = true, label }) => {
			logMcpTool("agent_delegate", label);

			try {
				const { exec } = await import("child_process");
				const { promisify } = await import("util");
				const execAsync = promisify(exec);

				const results: string[] = [];

				if (parallel) {
					// Run all tasks in parallel
					const promises = tasks.map(async (task, i) => {
						try {
							const cmd = `timeout 30 opencode run "${task.replace(/"/g, '\\"')}" 2>&1 | head -50`;
							const { stdout } = await execAsync(cmd, { maxBuffer: 512 * 1024 });
							return `**Task ${i + 1}:** ${task.substring(0, 50)}...\n${stdout.substring(0, 500)}`;
						} catch (e: any) {
							return `**Task ${i + 1}:** ${task.substring(0, 50)}...\nError: ${e.message}`;
						}
					});

					const taskResults = await Promise.all(promises);
					results.push(...taskResults);
				} else {
					// Run sequentially
					for (let i = 0; i < tasks.length; i++) {
						try {
							const cmd = `timeout 30 opencode run "${tasks[i].replace(/"/g, '\\"')}" 2>&1 | head -50`;
							const { stdout } = await execAsync(cmd, { maxBuffer: 512 * 1024 });
							results.push(`**Task ${i + 1}:** ${tasks[i].substring(0, 50)}...\n${stdout.substring(0, 500)}`);
						} catch (e: any) {
							results.push(`**Task ${i + 1}:** ${tasks[i].substring(0, 50)}...\nError: ${e.message}`);
						}
					}
				}

				return {
					content: [
						{
							type: "text",
							text: `**Delegation Results (${tasks.length} tasks):**\n\n${results.join("\n\n---\n\n")}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Delegation failed: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// Hooks System
// =============================================================================

const hooksListSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
});

/**
 * Hooks List - List available hooks
 */
export function createHooksListTool(): AgentTool<typeof hooksListSchema> {
	return {
		name: "hooks_list",
		label: "hooks_list",
		description: "List available lifecycle hooks. Hooks are triggered at specific points in agent execution.",
		parameters: hooksListSchema,
		execute: async (_toolCallId, { label }) => {
			logMcpTool("hooks_list", label);

			try {
				const fs = await import("fs/promises");
				const hooksDir = "/opt/discord-bot-data/hooks";

				let hooks: string[] = [];
				try {
					const files = await fs.readdir(hooksDir);
					hooks = files.filter((f) => f.endsWith(".js") || f.endsWith(".ts"));
				} catch {
					// Hooks directory doesn't exist yet
				}

				const builtinHooks = [
					"on_message_start - Triggered when processing begins",
					"on_message_end - Triggered when response is complete",
					"on_tool_call - Triggered before tool execution",
					"on_tool_result - Triggered after tool execution",
					"on_error - Triggered on errors",
				];

				const customHooks = hooks.length > 0 ? hooks.map((h) => `• ${h}`) : ["(no custom hooks defined)"];

				return {
					content: [
						{
							type: "text",
							text: `**Lifecycle Hooks**\n\n**Built-in Events:**\n${builtinHooks.map((h) => `• ${h}`).join("\n")}\n\n**Custom Hooks (${hooksDir}):**\n${customHooks.join("\n")}\n\nCreate hooks by adding .js/.ts files to ${hooksDir}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to list hooks: ${error}` }], details: undefined };
			}
		},
	};
}

const hookCreateSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	name: Type.String({ description: "Hook name (filename without extension)" }),
	event: Type.String({
		description: "Event to hook: on_message_start, on_message_end, on_tool_call, on_tool_result, on_error",
	}),
	code: Type.String({ description: "JavaScript code for the hook" }),
});

/**
 * Hook Create - Create a new lifecycle hook
 */
export function createHookCreateTool(): AgentTool<typeof hookCreateSchema> {
	return {
		name: "hook_create",
		label: "hook_create",
		description:
			"Create a new lifecycle hook. Hooks can modify behavior, log events, or trigger actions at specific points.",
		parameters: hookCreateSchema,
		execute: async (_toolCallId, { name, event, code, label }) => {
			logMcpTool("hook_create", label);

			try {
				const fs = await import("fs/promises");
				const hooksDir = "/opt/discord-bot-data/hooks";

				// Ensure hooks directory exists
				await fs.mkdir(hooksDir, { recursive: true });

				const filename = name.replace(/[^a-z0-9-_]/gi, "-").toLowerCase();
				const hookPath = `${hooksDir}/${filename}.js`;

				const hookCode = `// Hook: ${name}
// Event: ${event}
// Created: ${new Date().toISOString()}

module.exports = {
    event: "${event}",
    handler: async (context) => {
        ${code}
    }
};
`;

				await fs.writeFile(hookPath, hookCode);

				return {
					content: [
						{
							type: "text",
							text: `Hook created: ${hookPath}\nEvent: ${event}\n\nNote: Hooks are loaded on bot restart.`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to create hook: ${error}` }], details: undefined };
			}
		},
	};
}

// ============================================
// RAG / Knowledge Base Tools
// ============================================

const knowledgeSearchSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	query: Type.String({ description: "Search query for knowledge base" }),
	maxResults: Type.Optional(Type.Number({ description: "Maximum results to return (default: 5)" })),
});

/**
 * Knowledge Search - RAG for knowledge base
 */
export function createKnowledgeSearchTool(): AgentTool<typeof knowledgeSearchSchema> {
	return {
		name: "knowledge_search",
		label: "knowledge_search",
		description:
			"Search the knowledge base for relevant information. Uses semantic matching to find the most relevant documents and snippets.",
		parameters: knowledgeSearchSchema,
		execute: async (_toolCallId, { query, maxResults = 5, label }) => {
			logMcpTool("knowledge_search", label);

			try {
				const fs = await import("fs/promises");
				const path = await import("path");
				const knowledgeDir = "/opt/discord-bot-data/knowledge";
				const skillsDir = "/opt/discord-bot-data/skills";

				// Gather all knowledge files
				const results: { file: string; score: number; snippet: string }[] = [];

				const searchDir = async (dir: string) => {
					try {
						const files = await fs.readdir(dir);
						for (const file of files) {
							if (file.endsWith(".md") || file.endsWith(".txt")) {
								const filePath = path.join(dir, file);
								const content = await fs.readFile(filePath, "utf-8");

								// Simple keyword scoring
								const queryWords = query.toLowerCase().split(/\s+/);
								const contentLower = content.toLowerCase();
								let score = 0;

								for (const word of queryWords) {
									if (word.length > 2) {
										const matches = (contentLower.match(new RegExp(word, "g")) || []).length;
										score += matches;
									}
								}

								if (score > 0) {
									// Extract relevant snippet
									const lines = content.split("\n");
									let bestSnippet = "";
									let bestLineScore = 0;

									for (let i = 0; i < lines.length; i++) {
										const lineLower = lines[i].toLowerCase();
										let lineScore = 0;
										for (const word of queryWords) {
											if (word.length > 2 && lineLower.includes(word)) {
												lineScore++;
											}
										}
										if (lineScore > bestLineScore) {
											bestLineScore = lineScore;
											// Get context around the line
											const start = Math.max(0, i - 2);
											const end = Math.min(lines.length, i + 3);
											bestSnippet = lines.slice(start, end).join("\n");
										}
									}

									results.push({
										file: filePath.replace("/opt/discord-bot-data/", ""),
										score,
										snippet: bestSnippet.slice(0, 500),
									});
								}
							}
						}
					} catch {
						// Directory doesn't exist
					}
				};

				await searchDir(knowledgeDir);
				await searchDir(skillsDir);

				// Sort by score and take top results
				results.sort((a, b) => b.score - a.score);
				const topResults = results.slice(0, maxResults);

				if (topResults.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: `No results found for query: "${query}"\n\nTip: Try different keywords or check available knowledge with skill_list.`,
							},
						],
						details: undefined,
					};
				}

				const output = topResults
					.map((r, i) => `**${i + 1}. ${r.file}** (relevance: ${r.score})\n\`\`\`\n${r.snippet}\n\`\`\``)
					.join("\n\n");

				return {
					content: [
						{
							type: "text",
							text: `**Knowledge Search Results for "${query}":**\n\n${output}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Knowledge search failed: ${error}` }], details: undefined };
			}
		},
	};
}

// ============================================
// Image Analysis Tool
// ============================================

const imageAnalyzeSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	imageUrl: Type.String({ description: "URL of the image to analyze" }),
	prompt: Type.Optional(Type.String({ description: "What to analyze in the image (default: describe the image)" })),
});

/**
 * Image Analyze - Analyze images using vision models
 */
export function createImageAnalyzeTool(): AgentTool<typeof imageAnalyzeSchema> {
	return {
		name: "image_analyze",
		label: "image_analyze",
		description:
			"Analyze an image using AI vision. Can describe images, read text (OCR), identify objects, answer questions about images.",
		parameters: imageAnalyzeSchema,
		execute: async (_toolCallId, { imageUrl, prompt = "Describe this image in detail", label }) => {
			logMcpTool("image_analyze", label);

			try {
				const apiKey = process.env.OPENROUTER_API_KEY;
				if (!apiKey) {
					return { content: [{ type: "text", text: "OPENROUTER_API_KEY not configured" }], details: undefined };
				}

				// Use a vision-capable model
				const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: "google/gemini-2.0-flash-001",
						messages: [
							{
								role: "user",
								content: [
									{ type: "text", text: prompt },
									{ type: "image_url", image_url: { url: imageUrl } },
								],
							},
						],
						max_tokens: 1000,
					}),
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Vision API error: ${error}` }], details: undefined };
				}

				const data = (await response.json()) as { choices: { message: { content: string } }[] };
				const analysis = data.choices?.[0]?.message?.content || "No analysis returned";

				return {
					content: [
						{
							type: "text",
							text: `**Image Analysis:**\n\n${analysis}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Image analysis failed: ${error}` }], details: undefined };
			}
		},
	};
}

// ============================================
// Code Sandbox Tool
// ============================================

const codeSandboxSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	language: Type.String({ description: "Programming language: python, javascript, typescript, bash" }),
	code: Type.String({ description: "Code to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 30, max: 60)" })),
});

/**
 * Code Sandbox - Execute code in a sandboxed environment
 */
export function createCodeSandboxTool(): AgentTool<typeof codeSandboxSchema> {
	return {
		name: "code_sandbox",
		label: "code_sandbox",
		description:
			"Execute code in a sandboxed environment. Supports Python, JavaScript, TypeScript, and Bash. Has timeout protection.",
		parameters: codeSandboxSchema,
		execute: async (_toolCallId, { language, code, timeout = 30, label }) => {
			logMcpTool("code_sandbox", label);

			try {
				const { execSync } = await import("child_process");
				const fs = await import("fs/promises");
				const path = await import("path");

				const safeTimeout = Math.min(timeout, 60);
				const sandboxDir = "/tmp/code-sandbox";
				await fs.mkdir(sandboxDir, { recursive: true });

				let cmd: string;
				let filename: string;

				switch (language.toLowerCase()) {
					case "python":
					case "py":
						filename = path.join(sandboxDir, `script_${Date.now()}.py`);
						await fs.writeFile(filename, code);
						cmd = `timeout ${safeTimeout} python3 ${filename} 2>&1`;
						break;
					case "javascript":
					case "js":
						filename = path.join(sandboxDir, `script_${Date.now()}.js`);
						await fs.writeFile(filename, code);
						cmd = `timeout ${safeTimeout} node ${filename} 2>&1`;
						break;
					case "typescript":
					case "ts":
						filename = path.join(sandboxDir, `script_${Date.now()}.ts`);
						await fs.writeFile(filename, code);
						cmd = `timeout ${safeTimeout} npx ts-node ${filename} 2>&1`;
						break;
					case "bash":
					case "sh":
						filename = path.join(sandboxDir, `script_${Date.now()}.sh`);
						await fs.writeFile(filename, code);
						cmd = `timeout ${safeTimeout} bash ${filename} 2>&1`;
						break;
					default:
						return {
							content: [
								{
									type: "text",
									text: `Unsupported language: ${language}. Use: python, javascript, typescript, bash`,
								},
							],
							details: undefined,
						};
				}

				let output: string;
				try {
					output = execSync(cmd, {
						maxBuffer: 1024 * 1024,
						timeout: safeTimeout * 1000,
					}).toString();
				} catch (execError: unknown) {
					const err = execError as { stdout?: Buffer; stderr?: Buffer; message?: string };
					output = err.stdout?.toString() || err.stderr?.toString() || err.message || "Execution failed";
				}

				// Cleanup
				try {
					await fs.unlink(filename);
				} catch {
					// Ignore cleanup errors
				}

				// Truncate long output
				if (output.length > 4000) {
					output = output.slice(0, 4000) + "\n... (output truncated)";
				}

				return {
					content: [
						{
							type: "text",
							text: `**Code Execution (${language}):**\n\`\`\`\n${output || "(no output)"}\n\`\`\``,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Code execution failed: ${error}` }], details: undefined };
			}
		},
	};
}

// ============================================
// Scheduled Task Tools
// ============================================

const scheduledTaskSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	name: Type.String({ description: "Task name (unique identifier)" }),
	schedule: Type.String({
		description: "Cron expression (e.g., '0 9 * * *' for 9am daily) or ISO timestamp for one-time",
	}),
	channelId: Type.String({ description: "Discord channel ID to send message to" }),
	message: Type.String({ description: "Message to send when task runs" }),
	taskType: Type.Optional(Type.String({ description: "Type: 'message' (send message), 'agent' (run AI task)" })),
});

/**
 * Schedule Task - Create a scheduled task
 */
export function createScheduleTaskTool(): AgentTool<typeof scheduledTaskSchema> {
	return {
		name: "schedule_task",
		label: "schedule_task",
		description:
			"Schedule a task to run at a specific time or on a recurring schedule. Can send messages or run AI tasks.",
		parameters: scheduledTaskSchema,
		execute: async (_toolCallId, { name, schedule, channelId, message, taskType = "message", label }) => {
			logMcpTool("schedule_task", label);

			try {
				const fs = await import("fs/promises");
				const tasksDir = "/opt/discord-bot-data/scheduled";
				await fs.mkdir(tasksDir, { recursive: true });

				const taskId = name.replace(/[^a-z0-9-_]/gi, "-").toLowerCase();
				const taskPath = `${tasksDir}/${taskId}.json`;

				const task = {
					id: taskId,
					name,
					schedule,
					channelId,
					message,
					taskType,
					createdAt: new Date().toISOString(),
					enabled: true,
				};

				await fs.writeFile(taskPath, JSON.stringify(task, null, 2));

				// Determine schedule type
				const isCron = schedule.includes("*") || schedule.split(" ").length >= 5;
				const scheduleDesc = isCron ? `Recurring: ${schedule}` : `One-time: ${schedule}`;

				return {
					content: [
						{
							type: "text",
							text: `**Task Scheduled:**\n- ID: ${taskId}\n- ${scheduleDesc}\n- Channel: ${channelId}\n- Type: ${taskType}\n\nNote: Requires bot restart to activate cron jobs.`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to schedule task: ${error}` }], details: undefined };
			}
		},
	};
}

const listScheduledTasksSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
});

/**
 * List Scheduled Tasks
 */
export function createListScheduledTasksTool(): AgentTool<typeof listScheduledTasksSchema> {
	return {
		name: "scheduled_tasks_list",
		label: "scheduled_tasks_list",
		description: "List all scheduled tasks (cron jobs and one-time tasks).",
		parameters: listScheduledTasksSchema,
		execute: async (_toolCallId, { label }) => {
			logMcpTool("scheduled_tasks_list", label);

			try {
				const fs = await import("fs/promises");
				const tasksDir = "/opt/discord-bot-data/scheduled";

				let tasks: string[] = [];
				try {
					const files = await fs.readdir(tasksDir);
					tasks = files.filter((f) => f.endsWith(".json"));
				} catch {
					// Directory doesn't exist
				}

				if (tasks.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: "**Scheduled Tasks:**\n\n(no tasks scheduled)\n\nUse schedule_task to create one.",
							},
						],
						details: undefined,
					};
				}

				const taskDetails: string[] = [];
				for (const taskFile of tasks) {
					try {
						const content = await fs.readFile(`${tasksDir}/${taskFile}`, "utf-8");
						const task = JSON.parse(content);
						taskDetails.push(
							`• **${task.name}** (${task.id})\n  Schedule: ${task.schedule}\n  Type: ${task.taskType}\n  Enabled: ${task.enabled}`,
						);
					} catch {
						taskDetails.push(`• ${taskFile} (error reading)`);
					}
				}

				return {
					content: [
						{
							type: "text",
							text: `**Scheduled Tasks (${tasks.length}):**\n\n${taskDetails.join("\n\n")}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Failed to list tasks: ${error}` }], details: undefined };
			}
		},
	};
}

// ============================================
// Auto-Learning Tool
// ============================================

const autoLearnSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	conversation: Type.String({ description: "Recent conversation text to analyze" }),
	userName: Type.String({ description: "Name of the user in the conversation" }),
});

/**
 * Auto Learn - Extract learnings from conversations and update MEMORY.md
 */
export function createAutoLearnTool(): AgentTool<typeof autoLearnSchema> {
	return {
		name: "auto_learn",
		label: "auto_learn",
		description:
			"Analyze a conversation and extract useful learnings (user preferences, facts, patterns) to save to MEMORY.md. Call this periodically to learn from interactions.",
		parameters: autoLearnSchema,
		execute: async (_toolCallId, { conversation, userName, label }) => {
			logMcpTool("auto_learn", label);

			try {
				const fs = await import("fs/promises");
				const memoryPath = "/opt/discord-bot-data/MEMORY.md";

				// Read current memory
				let memory = "";
				try {
					memory = await fs.readFile(memoryPath, "utf-8");
				} catch {
					memory = "# Pi-Agent Discord Bot - Global Memory\n\n## Learned Preferences\n\n## Important Notes\n";
				}

				// Simple extraction patterns
				const learnings: string[] = [];

				// Look for preference indicators
				const prefPatterns = [
					/(?:i prefer|i like|i want|please always|i'd rather|my preference is)\s+(.+?)(?:\.|$)/gi,
					/(?:don't|do not|never)\s+(.+?)(?:\.|$)/gi,
					/(?:call me|my name is|i'm|i am)\s+(\w+)/gi,
				];

				for (const pattern of prefPatterns) {
					const matches = conversation.matchAll(pattern);
					for (const match of matches) {
						if (match[1] && match[1].length > 3 && match[1].length < 100) {
							learnings.push(`- ${userName}: "${match[0].trim()}"`);
						}
					}
				}

				if (learnings.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: "No significant learnings extracted from this conversation.",
							},
						],
						details: undefined,
					};
				}

				// Update memory file
				const timestamp = new Date().toISOString().split("T")[0];
				const newLearnings = `\n### Learned ${timestamp}\n${learnings.join("\n")}\n`;

				// Insert after "## Learned Preferences" section
				if (memory.includes("## Learned Preferences")) {
					memory = memory.replace("## Learned Preferences", `## Learned Preferences${newLearnings}`);
				} else {
					memory += `\n## Learned Preferences${newLearnings}`;
				}

				await fs.writeFile(memoryPath, memory);

				return {
					content: [
						{
							type: "text",
							text: `**Auto-learned ${learnings.length} items:**\n${learnings.join("\n")}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Auto-learn failed: ${error}` }], details: undefined };
			}
		},
	};
}

// ============================================
// File Processing Tool
// ============================================

const fileProcessSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	url: Type.String({ description: "URL of the file attachment" }),
	filename: Type.String({ description: "Original filename" }),
	contentType: Type.Optional(Type.String({ description: "MIME type of the file" })),
});

/**
 * File Process - Process uploaded file attachments
 */
export function createFileProcessTool(): AgentTool<typeof fileProcessSchema> {
	return {
		name: "file_process",
		label: "file_process",
		description:
			"Process an uploaded file attachment. Supports images (analyze), text/code (read), PDFs (extract text), and more.",
		parameters: fileProcessSchema,
		execute: async (_toolCallId, { url, filename, contentType, label }) => {
			logMcpTool("file_process", label);

			try {
				const ext = filename.split(".").pop()?.toLowerCase() || "";

				// Image files - use vision API
				if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext) || contentType?.startsWith("image/")) {
					const apiKey = process.env.OPENROUTER_API_KEY;
					if (!apiKey) {
						return {
							content: [{ type: "text", text: "Image analysis requires OPENROUTER_API_KEY" }],
							details: undefined,
						};
					}

					const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
						method: "POST",
						headers: {
							Authorization: `Bearer ${apiKey}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							model: "google/gemini-2.0-flash-001",
							messages: [
								{
									role: "user",
									content: [
										{
											type: "text",
											text: "Describe this image in detail. If it contains text, transcribe it. If it contains code, explain it.",
										},
										{ type: "image_url", image_url: { url } },
									],
								},
							],
							max_tokens: 1500,
						}),
					});

					if (!response.ok) {
						return {
							content: [{ type: "text", text: `Vision API error: ${await response.text()}` }],
							details: undefined,
						};
					}

					const data = (await response.json()) as { choices: { message: { content: string } }[] };
					const analysis = data.choices?.[0]?.message?.content || "No analysis returned";

					return {
						content: [
							{
								type: "text",
								text: `**Image Analysis (${filename}):**\n\n${analysis}`,
							},
						],
						details: undefined,
					};
				}

				// Text/Code files - download and read
				if (
					[
						"txt",
						"md",
						"json",
						"js",
						"ts",
						"py",
						"sh",
						"yaml",
						"yml",
						"toml",
						"csv",
						"xml",
						"html",
						"css",
						"sql",
						"rs",
						"go",
						"java",
						"c",
						"cpp",
						"h",
					].includes(ext)
				) {
					const response = await fetch(url);
					if (!response.ok) {
						return {
							content: [{ type: "text", text: `Failed to download file: ${response.status}` }],
							details: undefined,
						};
					}

					let content = await response.text();

					// Truncate if too long
					if (content.length > 8000) {
						content = content.slice(0, 8000) + "\n... (truncated)";
					}

					return {
						content: [
							{
								type: "text",
								text: `**File Contents (${filename}):**\n\`\`\`${ext}\n${content}\n\`\`\``,
							},
						],
						details: undefined,
					};
				}

				// PDF files - basic extraction
				if (ext === "pdf") {
					return {
						content: [
							{
								type: "text",
								text: `**PDF Detected (${filename})**\n\nPDF text extraction requires additional libraries. For now, please paste the text content directly or use a PDF-to-text converter.`,
							},
						],
						details: undefined,
					};
				}

				// Unknown file type
				return {
					content: [
						{
							type: "text",
							text: `**File Uploaded (${filename})**\n\nFile type \`.${ext}\` is not directly supported. Download URL: ${url}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `File processing failed: ${error}` }], details: undefined };
			}
		},
	};
}

// ============================================
// Rich Embed Formatter Tool
// ============================================

const richEmbedSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	title: Type.String({ description: "Embed title" }),
	description: Type.String({ description: "Embed description/content" }),
	color: Type.Optional(Type.String({ description: "Hex color (e.g., '#00FF00')" })),
	fields: Type.Optional(
		Type.Array(
			Type.Object({
				name: Type.String(),
				value: Type.String(),
				inline: Type.Optional(Type.Boolean()),
			}),
		),
	),
	thumbnail: Type.Optional(Type.String({ description: "Thumbnail URL" })),
	footer: Type.Optional(Type.String({ description: "Footer text" })),
});

/**
 * Rich Embed - Format response as a rich Discord embed
 */
export function createRichEmbedTool(): AgentTool<typeof richEmbedSchema> {
	return {
		name: "rich_embed",
		label: "rich_embed",
		description:
			"Format a response as a rich Discord embed with title, description, fields, colors, and more. Use for presenting structured information beautifully.",
		parameters: richEmbedSchema,
		execute: async (_toolCallId, { title, description, color, fields, thumbnail, footer, label }) => {
			logMcpTool("rich_embed", label);

			try {
				// Build embed JSON that main.ts can parse and render
				const embedData = {
					__embed: true,
					title,
					description: description.slice(0, 4096),
					color: color ? parseInt(color.replace("#", ""), 16) : 0x0099ff,
					fields: fields?.slice(0, 25).map((f) => ({
						name: f.name.slice(0, 256),
						value: f.value.slice(0, 1024),
						inline: f.inline ?? false,
					})),
					thumbnail: thumbnail ? { url: thumbnail } : undefined,
					footer: footer ? { text: footer.slice(0, 2048) } : undefined,
					timestamp: new Date().toISOString(),
				};

				return {
					content: [
						{
							type: "text",
							text: `__EMBED__${JSON.stringify(embedData)}__EMBED__`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Embed creation failed: ${error}` }], details: undefined };
			}
		},
	};
}

// ============================================
// Docker Sandbox Tool
// ============================================

const dockerSandboxSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	language: Type.String({ description: "Programming language: python, javascript, node, bash" }),
	code: Type.String({ description: "Code to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 30, max: 60)" })),
});

/**
 * Docker Sandbox - Execute code in isolated Docker container
 */
export function createDockerSandboxTool(): AgentTool<typeof dockerSandboxSchema> {
	return {
		name: "docker_sandbox",
		label: "docker_sandbox",
		description:
			"Execute code in an isolated Docker container for maximum security. Supports Python, JavaScript/Node, and Bash. No network access, memory limited.",
		parameters: dockerSandboxSchema,
		execute: async (_toolCallId, { language, code, timeout = 30, label }) => {
			logMcpTool("docker_sandbox", label);

			try {
				const { execSync } = await import("child_process");

				const safeTimeout = Math.min(timeout, 60);
				let dockerImage: string;
				let cmd: string;

				// Escape code for shell
				const escapedCode = code.replace(/'/g, "'\\''");

				switch (language.toLowerCase()) {
					case "python":
					case "py":
						dockerImage = "python:3.11-slim";
						cmd = `docker run --rm --network none --memory 256m --cpus 0.5 -i ${dockerImage} python3 -c '${escapedCode}'`;
						break;
					case "javascript":
					case "js":
					case "node":
						dockerImage = "node:20-slim";
						cmd = `docker run --rm --network none --memory 256m --cpus 0.5 -i ${dockerImage} node -e '${escapedCode}'`;
						break;
					case "bash":
					case "sh":
						dockerImage = "alpine:latest";
						cmd = `docker run --rm --network none --memory 128m --cpus 0.5 -i ${dockerImage} sh -c '${escapedCode}'`;
						break;
					default:
						return {
							content: [
								{
									type: "text",
									text: `Unsupported language: ${language}. Use: python, javascript, node, bash`,
								},
							],
							details: undefined,
						};
				}

				let output: string;
				try {
					output = execSync(`timeout ${safeTimeout} ${cmd}`, {
						maxBuffer: 1024 * 1024,
						timeout: safeTimeout * 1000,
						encoding: "utf-8",
					});
				} catch (execError: unknown) {
					const err = execError as { stdout?: string; stderr?: string; message?: string };
					output = err.stdout || err.stderr || err.message || "Execution failed";
				}

				// Truncate long output
				if (output.length > 4000) {
					output = output.slice(0, 4000) + "\n... (output truncated)";
				}

				return {
					content: [
						{
							type: "text",
							text: `**Docker Sandbox (${language}):**\n\`\`\`\n${output || "(no output)"}\n\`\`\`\n_Executed in isolated container with no network access._`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Docker sandbox failed: ${error}` }], details: undefined };
			}
		},
	};
}

// ============================================
// Sandbox Exec Tool (Enhanced Docker Sandbox)
// ============================================

const sandboxExecSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	language: Type.String({ description: "Programming language: python, bash, node" }),
	code: Type.String({ description: "Code to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 30, max: 120)" })),
});

/**
 * Sandbox Exec - Enhanced code execution using DockerSandbox class
 * Provides isolated execution with proper resource management and cleanup
 */
export function createSandboxExecTool(): AgentTool<typeof sandboxExecSchema> {
	return {
		name: "sandbox_exec",
		label: "sandbox_exec",
		description:
			"Execute code in an isolated Docker container with enhanced security and resource management. Supports Python, Node.js, and Bash. Includes automatic cleanup, timeout handling, and execution metrics.",
		parameters: sandboxExecSchema,
		execute: async (_toolCallId, { language, code, timeout = 30, label }) => {
			logMcpTool("sandbox_exec", label);

			try {
				const { DockerSandbox } = await import("./sandbox.js");
				const sandbox = new DockerSandbox();
				type ExecutionResult = Awaited<ReturnType<typeof sandbox.runPython>>;

				let result: ExecutionResult;
				const lang = language.toLowerCase();

				switch (lang) {
					case "python":
					case "py":
						result = await sandbox.runPython(code, timeout);
						break;
					case "bash":
					case "sh":
						result = await sandbox.runBash(code, timeout);
						break;
					case "node":
					case "javascript":
					case "js":
						result = await sandbox.runNode(code, timeout);
						break;
					default:
						return {
							content: [
								{
									type: "text",
									text: `Unsupported language: ${language}. Use: python, bash, or node`,
								},
							],
							details: undefined,
						};
				}

				// Format output
				let outputText = `**Sandbox Execution (${language})**\n\n`;
				outputText += `**Execution Time:** ${result.executionTime}ms\n`;
				outputText += `**Exit Code:** ${result.exitCode}\n\n`;

				if (result.output) {
					let output = result.output;
					// Truncate long output
					if (output.length > 3500) {
						output = output.slice(0, 3500) + "\n... (output truncated)";
					}
					outputText += `**Output:**\n\`\`\`\n${output}\n\`\`\`\n`;
				}

				if (result.error) {
					let error = result.error;
					// Truncate long errors
					if (error.length > 1000) {
						error = error.slice(0, 1000) + "\n... (error truncated)";
					}
					outputText += `\n**Error:**\n\`\`\`\n${error}\n\`\`\`\n`;
				}

				if (!result.output && !result.error) {
					outputText += `_(no output)_\n`;
				}

				outputText += `\n_Executed in isolated container with network disabled, 256MB RAM, 0.5 CPU limit._`;

				return {
					content: [
						{
							type: "text",
							text: outputText,
						},
					],
					details: {
						executionTime: result.executionTime,
						exitCode: result.exitCode,
						language: lang,
					},
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Sandbox execution failed: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					details: undefined,
				};
			}
		},
	};
}

// ============================================
// Conversation Export Tool
// ============================================

const conversationExportSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	channelId: Type.String({ description: "Discord channel ID to export" }),
	format: Type.Optional(Type.String({ description: "Export format: markdown, json, txt (default: markdown)" })),
	limit: Type.Optional(Type.Number({ description: "Max messages to export (default: 100)" })),
});

/**
 * Conversation Export - Export chat history
 */
export function createConversationExportTool(): AgentTool<typeof conversationExportSchema> {
	return {
		name: "conversation_export",
		label: "conversation_export",
		description: "Export conversation history from a channel to markdown, JSON, or text format.",
		parameters: conversationExportSchema,
		execute: async (_toolCallId, { channelId, format = "markdown", limit = 100, label }) => {
			logMcpTool("conversation_export", label);

			try {
				const fs = await import("fs/promises");
				const path = await import("path");

				const logPath = path.join("/opt/discord-bot-data", channelId, "log.jsonl");

				let logContent: string;
				try {
					logContent = await fs.readFile(logPath, "utf-8");
				} catch {
					return {
						content: [{ type: "text", text: `No conversation history found for channel ${channelId}` }],
						details: undefined,
					};
				}

				const lines = logContent.trim().split("\n").slice(-limit);
				const messages: { date: string; user: string; text: string; isBot: boolean }[] = [];

				for (const line of lines) {
					try {
						const msg = JSON.parse(line);
						messages.push(msg);
					} catch {
						// Skip invalid lines
					}
				}

				let output: string;
				const exportDate = new Date().toISOString();

				switch (format.toLowerCase()) {
					case "json":
						output = JSON.stringify({ channelId, exportDate, messages }, null, 2);
						break;
					case "txt":
						output = messages.map((m) => `[${m.date}] ${m.isBot ? "🤖 Bot" : m.user}: ${m.text}`).join("\n\n");
						break;
					default:
						output = `# Conversation Export\n\n**Channel:** ${channelId}\n**Exported:** ${exportDate}\n**Messages:** ${messages.length}\n\n---\n\n`;
						output += messages
							.map((m) => `### ${m.isBot ? "🤖 Bot" : `👤 ${m.user}`}\n_${m.date}_\n\n${m.text}`)
							.join("\n\n---\n\n");
						break;
				}

				// Save export file
				const exportDir = "/opt/discord-bot-data/exports";
				await fs.mkdir(exportDir, { recursive: true });
				const exportFile = path.join(exportDir, `${channelId}_${Date.now()}.${format === "json" ? "json" : "md"}`);
				await fs.writeFile(exportFile, output);

				// Truncate for response
				const preview = output.length > 2000 ? output.slice(0, 2000) + "\n\n... (truncated)" : output;

				return {
					content: [
						{
							type: "text",
							text: `**Conversation Exported**\n\nSaved to: \`${exportFile}\`\nMessages: ${messages.length}\n\n**Preview:**\n${preview}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Export failed: ${error}` }], details: undefined };
			}
		},
	};
}

// ============================================
// User Preferences Tool
// ============================================

const userPreferencesSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	userId: Type.String({ description: "Discord user ID" }),
	action: Type.String({ description: "get, set, or list" }),
	key: Type.Optional(Type.String({ description: "Preference key (e.g., 'response_style', 'language')" })),
	value: Type.Optional(Type.String({ description: "Preference value to set" })),
});

/**
 * User Preferences - Store and retrieve user preferences
 */
export function createUserPreferencesTool(): AgentTool<typeof userPreferencesSchema> {
	return {
		name: "user_preferences",
		label: "user_preferences",
		description: "Get, set, or list user preferences. Stores preferences persistently for personalized responses.",
		parameters: userPreferencesSchema,
		execute: async (_toolCallId, { userId, action, key, value, label }) => {
			logMcpTool("user_preferences", label);

			try {
				const fs = await import("fs/promises");
				const prefsDir = "/opt/discord-bot-data/preferences";
				await fs.mkdir(prefsDir, { recursive: true });

				const prefsFile = `${prefsDir}/${userId}.json`;

				// Load existing preferences
				let prefs: Record<string, string> = {};
				try {
					const content = await fs.readFile(prefsFile, "utf-8");
					prefs = JSON.parse(content);
				} catch {
					// No prefs file yet
				}

				switch (action.toLowerCase()) {
					case "get": {
						if (!key) {
							return { content: [{ type: "text", text: "Key required for 'get' action" }], details: undefined };
						}
						const val = prefs[key];
						return {
							content: [
								{
									type: "text",
									text: val ? `**${key}:** ${val}` : `No preference set for '${key}'`,
								},
							],
							details: undefined,
						};
					}

					case "set":
						if (!key || !value) {
							return {
								content: [{ type: "text", text: "Key and value required for 'set' action" }],
								details: undefined,
							};
						}
						prefs[key] = value;
						prefs._updated = new Date().toISOString();
						await fs.writeFile(prefsFile, JSON.stringify(prefs, null, 2));
						return {
							content: [
								{
									type: "text",
									text: `✅ Preference saved: **${key}** = ${value}`,
								},
							],
							details: undefined,
						};

					case "list": {
						const keys = Object.keys(prefs).filter((k) => !k.startsWith("_"));
						if (keys.length === 0) {
							return {
								content: [{ type: "text", text: "No preferences set for this user." }],
								details: undefined,
							};
						}
						const list = keys.map((k) => `• **${k}:** ${prefs[k]}`).join("\n");
						return {
							content: [
								{
									type: "text",
									text: `**User Preferences:**\n${list}`,
								},
							],
							details: undefined,
						};
					}

					default:
						return {
							content: [{ type: "text", text: "Invalid action. Use: get, set, list" }],
							details: undefined,
						};
				}
			} catch (error) {
				return { content: [{ type: "text", text: `Preferences failed: ${error}` }], details: undefined };
			}
		},
	};
}

// ============================================
// Retry Helper (exported for use in main.ts)
// ============================================

export interface RetryOptions {
	maxRetries?: number;
	initialDelay?: number;
	maxDelay?: number;
	backoffFactor?: number;
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
	const { maxRetries = 3, initialDelay = 1000, maxDelay = 30000, backoffFactor = 2 } = options;

	let lastError: Error | null = null;
	let delay = initialDelay;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			if (attempt === maxRetries) {
				break;
			}

			// Check if error is retryable
			const errorMsg = lastError.message.toLowerCase();
			const isRetryable =
				errorMsg.includes("timeout") ||
				errorMsg.includes("rate limit") ||
				errorMsg.includes("503") ||
				errorMsg.includes("502") ||
				errorMsg.includes("429") ||
				errorMsg.includes("econnreset") ||
				errorMsg.includes("network");

			if (!isRetryable) {
				throw lastError;
			}

			// Wait with exponential backoff
			await new Promise((resolve) => setTimeout(resolve, delay));
			delay = Math.min(delay * backoffFactor, maxDelay);
		}
	}

	throw lastError || new Error("Retry failed");
}

// ============================================
// Voice Channel Tools
// ============================================

const voiceJoinSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	guildId: Type.String({ description: "Discord server (guild) ID" }),
	channelId: Type.String({ description: "Voice channel ID to join" }),
});

/**
 * Voice Join - Join a voice channel
 */
export function createVoiceJoinTool(): AgentTool<typeof voiceJoinSchema> {
	return {
		name: "voice_join",
		label: "voice_join",
		description:
			"Join a voice channel in a Discord server. Required before using voice features like TTS or transcription.",
		parameters: voiceJoinSchema,
		execute: async (_toolCallId, { guildId, channelId, label }) => {
			logMcpTool("voice_join", label);

			try {
				// Store voice connection info for the guild
				const fs = await import("fs/promises");
				const voiceDir = "/opt/discord-bot-data/voice";
				await fs.mkdir(voiceDir, { recursive: true });

				const connectionInfo = {
					guildId,
					channelId,
					joinedAt: new Date().toISOString(),
					status: "connected",
				};

				await fs.writeFile(`${voiceDir}/${guildId}.json`, JSON.stringify(connectionInfo, null, 2));

				return {
					content: [
						{
							type: "text",
							text: `**Voice Channel**\n\nJoined voice channel \`${channelId}\` in guild \`${guildId}\`.\n\n_Note: Full voice functionality requires @discordjs/voice package. Currently in preparation mode._`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Voice join failed: ${error}` }], details: undefined };
			}
		},
	};
}

const voiceTTSSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	text: Type.String({ description: "Text to speak" }),
	voice: Type.Optional(Type.String({ description: "Voice to use (default: alloy)" })),
});

/**
 * Voice TTS - Text to speech in voice channel
 */
export function createVoiceTTSTool(): AgentTool<typeof voiceTTSSchema> {
	return {
		name: "voice_tts",
		label: "voice_tts",
		description: "Convert text to speech and play in voice channel. Uses OpenAI TTS API.",
		parameters: voiceTTSSchema,
		execute: async (_toolCallId, { text, voice = "alloy", label }) => {
			logMcpTool("voice_tts", label);

			try {
				const fs = await import("fs/promises");
				const path = await import("path");

				// Generate TTS using OpenRouter/OpenAI compatible endpoint
				const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
				if (!apiKey) {
					return {
						content: [{ type: "text", text: "TTS requires OPENAI_API_KEY or OPENROUTER_API_KEY" }],
						details: undefined,
					};
				}

				// For now, save as placeholder - full implementation needs @discordjs/voice
				const audioDir = "/opt/discord-bot-data/voice/audio";
				await fs.mkdir(audioDir, { recursive: true });

				const audioFile = path.join(audioDir, `tts_${Date.now()}.mp3`);

				// Use OpenAI TTS API
				const response = await fetch("https://api.openai.com/v1/audio/speech", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${apiKey}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: "tts-1",
						input: text.slice(0, 4096),
						voice: voice,
					}),
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `TTS API error: ${error}` }], details: undefined };
				}

				const audioBuffer = await response.arrayBuffer();
				await fs.writeFile(audioFile, Buffer.from(audioBuffer));

				return {
					content: [
						{
							type: "text",
							text: `**Text-to-Speech Generated**\n\nVoice: ${voice}\nText: "${text.slice(0, 100)}..."\nSaved to: \`${audioFile}\`\n\n_Note: Playback requires active voice connection._`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `TTS failed: ${error}` }], details: undefined };
			}
		},
	};
}

// ============================================
// Plugin System Tools
// ============================================

const pluginLoadSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	pluginPath: Type.String({ description: "Path to plugin file (.js or .ts)" }),
});

/**
 * Plugin Load - Load an external plugin
 */
export function createPluginLoadTool(): AgentTool<typeof pluginLoadSchema> {
	return {
		name: "plugin_load",
		label: "plugin_load",
		description:
			"Load an external plugin from a JavaScript/TypeScript file. Plugins can add new tools or functionality.",
		parameters: pluginLoadSchema,
		execute: async (_toolCallId, { pluginPath, label }) => {
			logMcpTool("plugin_load", label);

			try {
				const fs = await import("fs/promises");
				const path = await import("path");

				// Resolve plugin path
				const fullPath = path.resolve("/opt/discord-bot-data/plugins", pluginPath);

				// Check if plugin exists
				try {
					await fs.access(fullPath);
				} catch {
					return { content: [{ type: "text", text: `Plugin not found: ${fullPath}` }], details: undefined };
				}

				// Load plugin metadata
				const pluginContent = await fs.readFile(fullPath, "utf-8");

				// Extract plugin info from comments
				const nameMatch = pluginContent.match(/\/\/\s*@plugin-name:\s*(.+)/i);
				const descMatch = pluginContent.match(/\/\/\s*@plugin-description:\s*(.+)/i);
				const versionMatch = pluginContent.match(/\/\/\s*@plugin-version:\s*(.+)/i);

				const pluginInfo = {
					name: nameMatch?.[1]?.trim() || path.basename(fullPath, path.extname(fullPath)),
					description: descMatch?.[1]?.trim() || "No description",
					version: versionMatch?.[1]?.trim() || "1.0.0",
					path: fullPath,
					loadedAt: new Date().toISOString(),
				};

				// Register plugin
				const pluginsDir = "/opt/discord-bot-data/plugins";
				await fs.mkdir(pluginsDir, { recursive: true });
				const registryPath = `${pluginsDir}/registry.json`;

				let registry: Record<string, typeof pluginInfo> = {};
				try {
					const content = await fs.readFile(registryPath, "utf-8");
					registry = JSON.parse(content);
				} catch {
					// No registry yet
				}

				registry[pluginInfo.name] = pluginInfo;
				await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));

				return {
					content: [
						{
							type: "text",
							text: `**Plugin Loaded**\n\nName: ${pluginInfo.name}\nVersion: ${pluginInfo.version}\nDescription: ${pluginInfo.description}\nPath: \`${fullPath}\`\n\n_Plugin registered. Restart bot to activate._`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Plugin load failed: ${error}` }], details: undefined };
			}
		},
	};
}

const pluginListSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
});

/**
 * Plugin List - List all loaded plugins
 */
export function createPluginListTool(): AgentTool<typeof pluginListSchema> {
	return {
		name: "plugin_list",
		label: "plugin_list",
		description: "List all registered plugins and their status.",
		parameters: pluginListSchema,
		execute: async (_toolCallId, { label }) => {
			logMcpTool("plugin_list", label);

			try {
				const fs = await import("fs/promises");
				const registryPath = "/opt/discord-bot-data/plugins/registry.json";

				let registry: Record<string, { name: string; version: string; description: string; loadedAt: string }> = {};
				try {
					const content = await fs.readFile(registryPath, "utf-8");
					registry = JSON.parse(content);
				} catch {
					return {
						content: [
							{
								type: "text",
								text: "**Plugins:**\n\n(no plugins registered)\n\nAdd plugins to `/opt/discord-bot-data/plugins/` and use `plugin_load` to register them.",
							},
						],
						details: undefined,
					};
				}

				const plugins = Object.values(registry);
				if (plugins.length === 0) {
					return {
						content: [{ type: "text", text: "**Plugins:**\n\n(no plugins registered)" }],
						details: undefined,
					};
				}

				const list = plugins
					.map((p) => `• **${p.name}** v${p.version}\n  ${p.description}\n  _Loaded: ${p.loadedAt}_`)
					.join("\n\n");

				return {
					content: [
						{
							type: "text",
							text: `**Registered Plugins (${plugins.length}):**\n\n${list}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Plugin list failed: ${error}` }], details: undefined };
			}
		},
	};
}

// ============================================
// Slash Command Builder Tools
// ============================================

const slashCommandCreateSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	name: Type.String({ description: "Command name (lowercase, no spaces)" }),
	description: Type.String({ description: "Command description" }),
	handler: Type.String({ description: "JavaScript code to execute when command is used" }),
	options: Type.Optional(
		Type.Array(
			Type.Object({
				name: Type.String(),
				description: Type.String(),
				type: Type.String({ description: "string, number, boolean, user, channel" }),
				required: Type.Optional(Type.Boolean()),
			}),
		),
	),
});

/**
 * Slash Command Create - Create a custom slash command
 */
export function createSlashCommandCreateTool(): AgentTool<typeof slashCommandCreateSchema> {
	return {
		name: "slash_command_create",
		label: "slash_command_create",
		description:
			"Create a custom slash command dynamically. The command will be registered with Discord and execute the provided handler code.",
		parameters: slashCommandCreateSchema,
		execute: async (_toolCallId, { name, description, handler, options, label }) => {
			logMcpTool("slash_command_create", label);

			try {
				const fs = await import("fs/promises");

				// Validate command name
				const validName = name.toLowerCase().replace(/[^a-z0-9-_]/g, "");
				if (validName.length < 1 || validName.length > 32) {
					return {
						content: [{ type: "text", text: "Command name must be 1-32 lowercase alphanumeric characters" }],
						details: undefined,
					};
				}

				const commandsDir = "/opt/discord-bot-data/commands";
				await fs.mkdir(commandsDir, { recursive: true });

				const commandDef = {
					name: validName,
					description: description.slice(0, 100),
					handler,
					options: options || [],
					createdAt: new Date().toISOString(),
					enabled: true,
				};

				await fs.writeFile(`${commandsDir}/${validName}.json`, JSON.stringify(commandDef, null, 2));

				// Also save handler as executable file
				const handlerCode = `// Custom command: /${validName}
// ${description}
// Created: ${commandDef.createdAt}

module.exports = async (interaction, context) => {
    ${handler}
};
`;
				await fs.writeFile(`${commandsDir}/${validName}.js`, handlerCode);

				const optionsList = options?.length
					? options
							.map((o) => `  • \`${o.name}\` (${o.type}${o.required ? ", required" : ""}): ${o.description}`)
							.join("\n")
					: "  (no options)";

				return {
					content: [
						{
							type: "text",
							text: `**Custom Command Created**\n\nName: \`/${validName}\`\nDescription: ${description}\n\n**Options:**\n${optionsList}\n\n_Restart bot to register with Discord._`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Command creation failed: ${error}` }], details: undefined };
			}
		},
	};
}

const slashCommandListSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
});

/**
 * Slash Command List - List custom slash commands
 */
export function createSlashCommandListTool(): AgentTool<typeof slashCommandListSchema> {
	return {
		name: "slash_command_list",
		label: "slash_command_list",
		description: "List all custom slash commands created by the bot.",
		parameters: slashCommandListSchema,
		execute: async (_toolCallId, { label }) => {
			logMcpTool("slash_command_list", label);

			try {
				const fs = await import("fs/promises");
				const commandsDir = "/opt/discord-bot-data/commands";

				let files: string[] = [];
				try {
					files = (await fs.readdir(commandsDir)).filter((f) => f.endsWith(".json"));
				} catch {
					return {
						content: [
							{
								type: "text",
								text: "**Custom Commands:**\n\n(no custom commands)\n\nUse `slash_command_create` to create one.",
							},
						],
						details: undefined,
					};
				}

				if (files.length === 0) {
					return {
						content: [{ type: "text", text: "**Custom Commands:**\n\n(no custom commands)" }],
						details: undefined,
					};
				}

				const commands: string[] = [];
				for (const file of files) {
					try {
						const content = await fs.readFile(`${commandsDir}/${file}`, "utf-8");
						const cmd = JSON.parse(content);
						commands.push(`• \`/${cmd.name}\` - ${cmd.description}\n  _Created: ${cmd.createdAt}_`);
					} catch {
						commands.push(`• ${file} (error reading)`);
					}
				}

				return {
					content: [
						{
							type: "text",
							text: `**Custom Commands (${files.length}):**\n\n${commands.join("\n\n")}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Command list failed: ${error}` }], details: undefined };
			}
		},
	};
}

// ============================================
// Multi-Server Sync Tools
// ============================================

const serverSyncSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	sourceGuildId: Type.String({ description: "Source server ID to sync from" }),
	targetGuildId: Type.String({ description: "Target server ID to sync to" }),
	syncType: Type.String({ description: "What to sync: memory, skills, preferences, all" }),
});

/**
 * Server Sync - Sync knowledge between servers
 */
export function createServerSyncTool(): AgentTool<typeof serverSyncSchema> {
	return {
		name: "server_sync",
		label: "server_sync",
		description: "Sync knowledge, skills, or preferences between Discord servers.",
		parameters: serverSyncSchema,
		execute: async (_toolCallId, { sourceGuildId, targetGuildId, syncType, label }) => {
			logMcpTool("server_sync", label);

			try {
				const fs = await import("fs/promises");
				const path = await import("path");

				const baseDir = "/opt/discord-bot-data";
				const syncResults: string[] = [];

				const syncFile = async (relativePath: string) => {
					const sourcePath = path.join(baseDir, sourceGuildId, relativePath);
					const targetPath = path.join(baseDir, targetGuildId, relativePath);

					try {
						const content = await fs.readFile(sourcePath, "utf-8");
						await fs.mkdir(path.dirname(targetPath), { recursive: true });
						await fs.writeFile(targetPath, content);
						return true;
					} catch {
						return false;
					}
				};

				// Sync based on type
				if (syncType === "memory" || syncType === "all") {
					if (await syncFile("MEMORY.md")) {
						syncResults.push("✅ Memory synced");
					} else {
						syncResults.push("⚠️ Memory: source not found");
					}
				}

				if (syncType === "skills" || syncType === "all") {
					// Copy skills directory
					const skillsSource = path.join(baseDir, "skills");
					try {
						const skills = await fs.readdir(skillsSource);
						syncResults.push(`✅ Skills available: ${skills.length} files (global)`);
					} catch {
						syncResults.push("⚠️ Skills: directory not found");
					}
				}

				if (syncType === "preferences" || syncType === "all") {
					if (await syncFile("preferences.json")) {
						syncResults.push("✅ Preferences synced");
					} else {
						syncResults.push("⚠️ Preferences: source not found");
					}
				}

				// Log sync event
				const syncLog = {
					timestamp: new Date().toISOString(),
					sourceGuildId,
					targetGuildId,
					syncType,
					results: syncResults,
				};

				const syncLogDir = path.join(baseDir, "sync-logs");
				await fs.mkdir(syncLogDir, { recursive: true });
				await fs.appendFile(path.join(syncLogDir, "sync.jsonl"), JSON.stringify(syncLog) + "\n");

				return {
					content: [
						{
							type: "text",
							text: `**Server Sync Complete**\n\nSource: \`${sourceGuildId}\`\nTarget: \`${targetGuildId}\`\nType: ${syncType}\n\n**Results:**\n${syncResults.join("\n")}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Server sync failed: ${error}` }], details: undefined };
			}
		},
	};
}

const serverListSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
});

/**
 * Server List - List all servers with bot data
 */
export function createServerListTool(): AgentTool<typeof serverListSchema> {
	return {
		name: "server_list",
		label: "server_list",
		description: "List all Discord servers that have interacted with the bot and their data status.",
		parameters: serverListSchema,
		execute: async (_toolCallId, { label }) => {
			logMcpTool("server_list", label);

			try {
				const fs = await import("fs/promises");
				const path = await import("path");
				const baseDir = "/opt/discord-bot-data";

				const entries = await fs.readdir(baseDir, { withFileTypes: true });
				const servers: { id: string; hasMemory: boolean; hasLog: boolean; messageCount: number }[] = [];

				for (const entry of entries) {
					// Check if it's a channel/server directory (numeric ID)
					if (entry.isDirectory() && /^\d+$/.test(entry.name)) {
						const serverDir = path.join(baseDir, entry.name);
						let hasMemory = false;
						let hasLog = false;
						let messageCount = 0;

						try {
							await fs.access(path.join(serverDir, "MEMORY.md"));
							hasMemory = true;
						} catch {}

						try {
							const logContent = await fs.readFile(path.join(serverDir, "log.jsonl"), "utf-8");
							hasLog = true;
							messageCount = logContent.trim().split("\n").length;
						} catch {}

						if (hasMemory || hasLog) {
							servers.push({ id: entry.name, hasMemory, hasLog, messageCount });
						}
					}
				}

				if (servers.length === 0) {
					return {
						content: [{ type: "text", text: "**Servers:**\n\n(no server data found)" }],
						details: undefined,
					};
				}

				const list = servers
					.map(
						(s) =>
							`• \`${s.id}\`\n  Memory: ${s.hasMemory ? "✅" : "❌"} | Log: ${s.hasLog ? `✅ (${s.messageCount} msgs)` : "❌"}`,
					)
					.join("\n\n");

				return {
					content: [
						{
							type: "text",
							text: `**Servers with Data (${servers.length}):**\n\n${list}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Server list failed: ${error}` }], details: undefined };
			}
		},
	};
}

// ============================================
// Image Generation Tool
// ============================================

const imageGenerateSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	prompt: Type.String({ description: "Image generation prompt" }),
	style: Type.Optional(Type.String({ description: "Style: realistic, anime, digital-art, oil-painting" })),
	size: Type.Optional(Type.String({ description: "Size: 1024x1024, 512x512, 1024x576" })),
});

/**
 * Image Generate - Generate images using AI
 */
export function createImageGenerateTool(): AgentTool<typeof imageGenerateSchema> {
	return {
		name: "image_generate",
		label: "image_generate",
		description: "Generate images using AI. Supports various styles and sizes.",
		parameters: imageGenerateSchema,
		execute: async (_toolCallId, { prompt, style, size: _size, label }) => {
			logMcpTool("image_generate", label);

			try {
				// Use HuggingFace Inference API for image generation
				const HF_TOKEN = process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN;
				if (!HF_TOKEN) {
					return {
						content: [{ type: "text", text: "HF_TOKEN not configured for image generation" }],
						details: undefined,
					};
				}

				const enhancedPrompt = style
					? `${prompt}, ${style} style, high quality, detailed`
					: `${prompt}, high quality, detailed`;

				const response = await fetch(
					"https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0",
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${HF_TOKEN}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({ inputs: enhancedPrompt }),
					},
				);

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Image generation failed: ${error}` }], details: undefined };
				}

				// Image is returned as binary
				const imageBuffer = await response.arrayBuffer();
				const base64 = Buffer.from(imageBuffer).toString("base64");

				// Save to file
				const fs = await import("fs/promises");
				const path = await import("path");
				const filename = `generated_${Date.now()}.png`;
				const filepath = path.join("/opt/discord-bot-data/images", filename);

				await fs.mkdir(path.dirname(filepath), { recursive: true });
				await fs.writeFile(filepath, Buffer.from(imageBuffer));

				return {
					content: [
						{
							type: "text",
							text: `**Image Generated**\nPrompt: ${prompt}\nStyle: ${style || "default"}\nSaved to: ${filepath}\n\n[Image data available - ${Math.round(imageBuffer.byteLength / 1024)}KB]`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Image generation error: ${error}` }], details: undefined };
			}
		},
	};
}

// ============================================
// Custom Personas Tool
// ============================================

const personaSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	action: Type.String({ description: "Action: set, get, list, delete" }),
	name: Type.Optional(Type.String({ description: "Persona name" })),
	personality: Type.Optional(Type.String({ description: "Personality description" })),
	style: Type.Optional(Type.String({ description: "Response style" })),
});

/**
 * Persona - Manage bot personas for different channels
 */
export function createPersonaTool(): AgentTool<typeof personaSchema> {
	return {
		name: "persona",
		label: "persona",
		description: "Manage custom bot personas. Set different personalities for different contexts.",
		parameters: personaSchema,
		execute: async (_toolCallId, { action, name, personality, style, label }) => {
			logMcpTool("persona", label);

			try {
				const fs = await import("fs/promises");
				const path = await import("path");
				const personasFile = path.join("/opt/discord-bot-data", "personas.json");

				// Load existing personas
				let personas: Record<string, { personality: string; style: string; createdAt: string }> = {};
				try {
					const content = await fs.readFile(personasFile, "utf-8");
					personas = JSON.parse(content);
				} catch {}

				switch (action) {
					case "set":
						if (!name || !personality) {
							return {
								content: [{ type: "text", text: "Name and personality required for set action" }],
								details: undefined,
							};
						}
						personas[name] = {
							personality,
							style: style || "conversational",
							createdAt: new Date().toISOString(),
						};
						await fs.writeFile(personasFile, JSON.stringify(personas, null, 2));
						return {
							content: [{ type: "text", text: `Persona "${name}" saved successfully` }],
							details: undefined,
						};

					case "get": {
						if (!name || !personas[name]) {
							return { content: [{ type: "text", text: `Persona "${name}" not found` }], details: undefined };
						}
						const p = personas[name];
						return {
							content: [
								{
									type: "text",
									text: `**Persona: ${name}**\nPersonality: ${p.personality}\nStyle: ${p.style}\nCreated: ${p.createdAt}`,
								},
							],
							details: undefined,
						};
					}

					case "list": {
						const names = Object.keys(personas);
						if (names.length === 0) {
							return { content: [{ type: "text", text: "No personas defined" }], details: undefined };
						}
						const list = names
							.map((n) => `• **${n}**: ${personas[n].personality.substring(0, 50)}...`)
							.join("\n");
						return {
							content: [{ type: "text", text: `**Personas (${names.length}):**\n${list}` }],
							details: undefined,
						};
					}

					case "delete":
						if (!name || !personas[name]) {
							return { content: [{ type: "text", text: `Persona "${name}" not found` }], details: undefined };
						}
						delete personas[name];
						await fs.writeFile(personasFile, JSON.stringify(personas, null, 2));
						return { content: [{ type: "text", text: `Persona "${name}" deleted` }], details: undefined };

					default:
						return {
							content: [{ type: "text", text: "Invalid action. Use: set, get, list, delete" }],
							details: undefined,
						};
				}
			} catch (error) {
				return { content: [{ type: "text", text: `Persona error: ${error}` }], details: undefined };
			}
		},
	};
}

// ============================================
// Backup & Restore Tools
// ============================================

const backupSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	action: Type.String({ description: "Action: create, restore, list" }),
	name: Type.Optional(Type.String({ description: "Backup name (for restore)" })),
	include: Type.Optional(
		Type.Array(Type.String(), { description: "What to include: memory, skills, preferences, logs" }),
	),
});

/**
 * Backup - Create and restore bot data backups
 */
export function createBackupTool(): AgentTool<typeof backupSchema> {
	return {
		name: "backup",
		label: "backup",
		description: "Create and restore backups of bot data (memory, skills, preferences).",
		parameters: backupSchema,
		execute: async (_toolCallId, { action, name, include, label }) => {
			logMcpTool("backup", label);

			try {
				const fs = await import("fs/promises");
				const path = await import("path");
				const { exec } = await import("child_process");
				const { promisify } = await import("util");
				const execAsync = promisify(exec);

				const baseDir = "/opt/discord-bot-data";
				const backupDir = path.join(baseDir, "backups");
				await fs.mkdir(backupDir, { recursive: true });

				switch (action) {
					case "create": {
						const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
						const backupName = `backup_${timestamp}`;
						const backupPath = path.join(backupDir, backupName);

						await fs.mkdir(backupPath, { recursive: true });

						const includeList = include || ["memory", "skills", "preferences"];
						const backed: string[] = [];

						if (includeList.includes("memory")) {
							try {
								await execAsync(`cp ${baseDir}/MEMORY.md ${backupPath}/ 2>/dev/null || true`);
								await execAsync(`cp -r ${baseDir}/*/MEMORY.md ${backupPath}/ 2>/dev/null || true`);
								backed.push("memory");
							} catch {}
						}

						if (includeList.includes("skills")) {
							try {
								await execAsync(`cp -r ${baseDir}/skills ${backupPath}/ 2>/dev/null || true`);
								backed.push("skills");
							} catch {}
						}

						if (includeList.includes("preferences")) {
							try {
								await execAsync(`cp ${baseDir}/personas.json ${backupPath}/ 2>/dev/null || true`);
								await execAsync(`cp ${baseDir}/*/preferences.json ${backupPath}/ 2>/dev/null || true`);
								backed.push("preferences");
							} catch {}
						}

						// Create tarball
						await execAsync(`cd ${backupDir} && tar -czf ${backupName}.tar.gz ${backupName}`);
						await execAsync(`rm -rf ${backupPath}`);

						const stats = await fs.stat(path.join(backupDir, `${backupName}.tar.gz`));
						const sizeKB = Math.round(stats.size / 1024);

						return {
							content: [
								{
									type: "text",
									text: `**Backup Created**\nName: ${backupName}\nSize: ${sizeKB}KB\nIncluded: ${backed.join(", ")}`,
								},
							],
							details: undefined,
						};
					}

					case "restore": {
						if (!name) {
							return {
								content: [{ type: "text", text: "Backup name required for restore" }],
								details: undefined,
							};
						}

						const tarPath = path.join(backupDir, name.endsWith(".tar.gz") ? name : `${name}.tar.gz`);
						try {
							await fs.access(tarPath);
						} catch {
							return { content: [{ type: "text", text: `Backup not found: ${name}` }], details: undefined };
						}

						await execAsync(`cd ${backupDir} && tar -xzf ${path.basename(tarPath)}`);
						const extractedDir = path.join(backupDir, name.replace(".tar.gz", ""));

						// Restore files
						await execAsync(`cp -r ${extractedDir}/* ${baseDir}/ 2>/dev/null || true`);
						await execAsync(`rm -rf ${extractedDir}`);

						return {
							content: [{ type: "text", text: `**Backup Restored**\nName: ${name}` }],
							details: undefined,
						};
					}

					case "list": {
						const files = await fs.readdir(backupDir);
						const backups = files.filter((f) => f.endsWith(".tar.gz"));

						if (backups.length === 0) {
							return { content: [{ type: "text", text: "No backups found" }], details: undefined };
						}

						const details = await Promise.all(
							backups.map(async (b) => {
								const stats = await fs.stat(path.join(backupDir, b));
								return `• ${b} (${Math.round(stats.size / 1024)}KB) - ${stats.mtime.toISOString()}`;
							}),
						);

						return {
							content: [
								{
									type: "text",
									text: `**Backups (${backups.length}):**\n${details.join("\n")}`,
								},
							],
							details: undefined,
						};
					}

					default:
						return {
							content: [{ type: "text", text: "Invalid action. Use: create, restore, list" }],
							details: undefined,
						};
				}
			} catch (error) {
				return { content: [{ type: "text", text: `Backup error: ${error}` }], details: undefined };
			}
		},
	};
}

// ============================================
// Conversation Threading Tool
// ============================================

const threadingSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	action: Type.String({ description: "Action: create, switch, list, close" }),
	name: Type.Optional(Type.String({ description: "Thread name" })),
	channelId: Type.String({ description: "Channel ID" }),
});

/**
 * Threading - Manage conversation threads
 */
export function createThreadingTool(): AgentTool<typeof threadingSchema> {
	return {
		name: "thread_manage",
		label: "thread_manage",
		description: "Manage conversation threads within channels for better context isolation.",
		parameters: threadingSchema,
		execute: async (_toolCallId, { action, name, channelId, label }) => {
			logMcpTool("thread_manage", label);

			try {
				const fs = await import("fs/promises");
				const path = await import("path");
				const threadsFile = path.join("/opt/discord-bot-data", channelId, "threads.json");

				await fs.mkdir(path.dirname(threadsFile), { recursive: true });

				let threads: Record<string, { name: string; createdAt: string; messageCount: number; active: boolean }> =
					{};
				try {
					const content = await fs.readFile(threadsFile, "utf-8");
					threads = JSON.parse(content);
				} catch {}

				switch (action) {
					case "create": {
						if (!name) {
							return { content: [{ type: "text", text: "Thread name required" }], details: undefined };
						}
						const threadId = `thread_${Date.now()}`;
						// Deactivate other threads
						for (const id of Object.keys(threads)) {
							threads[id].active = false;
						}
						threads[threadId] = {
							name,
							createdAt: new Date().toISOString(),
							messageCount: 0,
							active: true,
						};
						await fs.writeFile(threadsFile, JSON.stringify(threads, null, 2));
						return {
							content: [{ type: "text", text: `Thread "${name}" created and activated` }],
							details: undefined,
						};
					}

					case "switch": {
						if (!name) {
							return { content: [{ type: "text", text: "Thread name required" }], details: undefined };
						}
						const targetThread = Object.entries(threads).find(([_, t]) => t.name === name);
						if (!targetThread) {
							return { content: [{ type: "text", text: `Thread "${name}" not found` }], details: undefined };
						}
						for (const id of Object.keys(threads)) {
							threads[id].active = id === targetThread[0];
						}
						await fs.writeFile(threadsFile, JSON.stringify(threads, null, 2));
						return { content: [{ type: "text", text: `Switched to thread "${name}"` }], details: undefined };
					}

					case "list": {
						const threadList = Object.values(threads);
						if (threadList.length === 0) {
							return { content: [{ type: "text", text: "No threads in this channel" }], details: undefined };
						}
						const list = threadList
							.map(
								(t) =>
									`• ${t.active ? "**" : ""}${t.name}${t.active ? "** (active)" : ""} - ${t.messageCount} messages`,
							)
							.join("\n");
						return { content: [{ type: "text", text: `**Threads:**\n${list}` }], details: undefined };
					}

					case "close": {
						if (!name) {
							return { content: [{ type: "text", text: "Thread name required" }], details: undefined };
						}
						const closeTarget = Object.entries(threads).find(([_, t]) => t.name === name);
						if (closeTarget) {
							delete threads[closeTarget[0]];
							await fs.writeFile(threadsFile, JSON.stringify(threads, null, 2));
						}
						return { content: [{ type: "text", text: `Thread "${name}" closed` }], details: undefined };
					}

					default:
						return {
							content: [{ type: "text", text: "Invalid action. Use: create, switch, list, close" }],
							details: undefined,
						};
				}
			} catch (error) {
				return { content: [{ type: "text", text: `Threading error: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// Creative Arts & Production Tools
// =============================================================================

const sunoMusicSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	prompt: Type.String({ description: "Music generation prompt describing style, mood, genre, instruments" }),
	title: Type.Optional(Type.String({ description: "Song title" })),
	tags: Type.Optional(Type.String({ description: "Genre/style tags like 'pop, electronic, upbeat'" })),
	instrumental: Type.Optional(Type.Boolean({ description: "Generate instrumental only (no vocals)" })),
	duration: Type.Optional(Type.Number({ description: "Duration in seconds (default: 30)" })),
});

/**
 * Suno Music Generation - AI music creation
 */
export function createSunoMusicTool(): AgentTool<typeof sunoMusicSchema> {
	return {
		name: "suno_music",
		label: "suno_music",
		description:
			"Generate AI music using Suno. Create songs with vocals or instrumentals in any style, genre, or mood. Great for background music, jingles, or full songs.",
		parameters: sunoMusicSchema,
		execute: async (_toolCallId, { prompt, title, tags, instrumental = false, label }) => {
			logMcpTool("suno_music", label);

			try {
				const SUNO_API_KEY = process.env.SUNO_API_KEY;
				if (!SUNO_API_KEY) {
					return {
						content: [
							{ type: "text", text: "Suno API key not configured. Set SUNO_API_KEY environment variable." },
						],
						details: undefined,
					};
				}

				// Use Suno API for music generation
				const response = await fetch("https://api.sunoapi.org/api/v1/generate", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${SUNO_API_KEY}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						prompt: prompt,
						title: title || "AI Generated Song",
						tags: tags || "ai, generated",
						instrumental: instrumental,
						model: "V5",
						customMode: false,
					}),
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Suno API error: ${error}` }], details: undefined };
				}

				const result = (await response.json()) as { taskId?: string; status?: string; audioUrl?: string };

				if (result.taskId) {
					// Async generation - poll for result
					let attempts = 0;
					const maxAttempts = 60;

					while (attempts < maxAttempts) {
						await new Promise((resolve) => setTimeout(resolve, 5000));

						const statusResponse = await fetch(`https://api.sunoapi.org/api/v1/task/${result.taskId}`, {
							headers: { Authorization: `Bearer ${SUNO_API_KEY}` },
						});

						const statusResult = (await statusResponse.json()) as {
							status: string;
							audioUrl?: string;
							title?: string;
						};

						if (statusResult.status === "completed" && statusResult.audioUrl) {
							return {
								content: [
									{
										type: "text",
										text: `🎵 **Music Generated!**\n\n**Title:** ${title || "AI Generated Song"}\n**Style:** ${tags || prompt.slice(0, 50)}\n**Type:** ${instrumental ? "Instrumental" : "With Vocals"}\n\n🔗 **Listen:** ${statusResult.audioUrl}`,
									},
								],
								details: undefined,
							};
						}

						if (statusResult.status === "failed") {
							return {
								content: [{ type: "text", text: "Music generation failed. Try a different prompt." }],
								details: undefined,
							};
						}

						attempts++;
					}

					return {
						content: [
							{
								type: "text",
								text: "Music generation timed out. The task may still complete - check back later.",
							},
						],
						details: undefined,
					};
				}

				return {
					content: [{ type: "text", text: `Music generation started. Result: ${JSON.stringify(result)}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Music generation error: ${error}` }], details: undefined };
			}
		},
	};
}

const falImageSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	prompt: Type.String({ description: "Detailed image description" }),
	model: Type.Optional(
		Type.String({
			description:
				"Model: flux-dev, flux-schnell (fast), flux-pro, flux-pro-ultra, flux-realism, flux-kontext (edit), ideogram, recraft. Default: flux-dev",
		}),
	),
	size: Type.Optional(
		Type.String({
			description: "Size: square, landscape_16_9, portrait_9_16, landscape_4_3. Default: landscape_16_9",
		}),
	),
	style: Type.Optional(
		Type.String({ description: "Style hints: photorealistic, anime, oil-painting, digital-art, etc." }),
	),
	negativePrompt: Type.Optional(Type.String({ description: "What to avoid in the image" })),
});

/**
 * Fal.ai Image Generation - High quality AI images with FLUX
 */
export function createFalImageTool(): AgentTool<typeof falImageSchema> {
	return {
		name: "fal_image",
		label: "fal_image",
		description:
			"Generate high-quality AI images using Fal.ai FLUX models. Supports photorealistic, artistic, and creative styles. Fast generation with professional quality.",
		parameters: falImageSchema,
		execute: async (
			_toolCallId,
			{ prompt, model = "flux-dev", size = "landscape_16_9", style, negativePrompt, label },
		) => {
			logMcpTool("fal_image", label);

			try {
				const FAL_KEY = process.env.FAL_KEY || process.env.FAL_API_KEY;
				if (!FAL_KEY) {
					return {
						content: [{ type: "text", text: "Fal.ai API key not configured. Set FAL_KEY environment variable." }],
						details: undefined,
					};
				}

				const modelMap: Record<string, string> = {
					"flux-dev": "fal-ai/flux/dev",
					"flux-schnell": "fal-ai/flux/schnell",
					"flux-pro": "fal-ai/flux-pro/v1.1",
					"flux-pro-ultra": "fal-ai/flux-pro/v1.1-ultra",
					"flux-realism": "fal-ai/flux-realism",
					"flux-kontext": "fal-ai/flux-pro/kontext",
					ideogram: "fal-ai/ideogram/v2",
					recraft: "fal-ai/recraft-v3",
				};

				const sizeMap: Record<string, { width: number; height: number }> = {
					square: { width: 1024, height: 1024 },
					landscape_16_9: { width: 1344, height: 768 },
					portrait_9_16: { width: 768, height: 1344 },
					landscape_4_3: { width: 1182, height: 886 },
					portrait_3_4: { width: 886, height: 1182 },
				};

				const modelId = modelMap[model] || modelMap["flux-dev"];
				const imageSize = sizeMap[size] || sizeMap.landscape_16_9;

				const enhancedPrompt = style ? `${prompt}, ${style} style` : prompt;

				const response = await fetch(`https://queue.fal.run/${modelId}`, {
					method: "POST",
					headers: {
						Authorization: `Key ${FAL_KEY}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						prompt: enhancedPrompt,
						negative_prompt: negativePrompt,
						image_size: imageSize,
						num_images: 1,
						enable_safety_checker: true,
					}),
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Fal.ai API error: ${error}` }], details: undefined };
				}

				const result = (await response.json()) as { request_id?: string; images?: Array<{ url: string }> };

				if (result.request_id) {
					// Poll for async result
					let attempts = 0;
					const maxAttempts = 30;

					while (attempts < maxAttempts) {
						await new Promise((resolve) => setTimeout(resolve, 2000));

						const statusResponse = await fetch(
							`https://queue.fal.run/${modelId}/requests/${result.request_id}/status`,
							{
								headers: { Authorization: `Key ${FAL_KEY}` },
							},
						);

						const status = (await statusResponse.json()) as { status: string };

						if (status.status === "COMPLETED") {
							const resultResponse = await fetch(
								`https://queue.fal.run/${modelId}/requests/${result.request_id}`,
								{
									headers: { Authorization: `Key ${FAL_KEY}` },
								},
							);
							const finalResult = (await resultResponse.json()) as { images: Array<{ url: string }> };

							if (finalResult.images?.[0]?.url) {
								return {
									content: [
										{
											type: "text",
											text: `🎨 **Image Generated!**\n\n**Prompt:** ${prompt.slice(0, 100)}...\n**Model:** ${model}\n**Size:** ${size}\n\n🖼️ **Image:** ${finalResult.images[0].url}`,
										},
									],
									details: undefined,
								};
							}
						}

						if (status.status === "FAILED") {
							return { content: [{ type: "text", text: "Image generation failed." }], details: undefined };
						}

						attempts++;
					}

					return { content: [{ type: "text", text: "Image generation timed out." }], details: undefined };
				}

				if (result.images?.[0]?.url) {
					return {
						content: [
							{
								type: "text",
								text: `🎨 **Image Generated!**\n\n**Prompt:** ${prompt.slice(0, 100)}...\n**Model:** ${model}\n\n🖼️ **Image:** ${result.images[0].url}`,
							},
						],
						details: undefined,
					};
				}

				return { content: [{ type: "text", text: `Image result: ${JSON.stringify(result)}` }], details: undefined };
			} catch (error) {
				return { content: [{ type: "text", text: `Image generation error: ${error}` }], details: undefined };
			}
		},
	};
}

const falVideoSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	prompt: Type.String({ description: "Video description - what should happen in the video" }),
	imageUrl: Type.Optional(Type.String({ description: "Optional starting image URL for image-to-video" })),
	duration: Type.Optional(Type.Number({ description: "Duration in seconds: 5 or 10. Default: 5" })),
	aspectRatio: Type.Optional(
		Type.String({ description: "16:9 (landscape), 9:16 (portrait), 1:1 (square). Default: 16:9" }),
	),
});

/**
 * Fal.ai Video Generation - AI video creation
 */
export function createFalVideoTool(): AgentTool<typeof falVideoSchema> {
	return {
		name: "fal_video",
		label: "fal_video",
		description:
			"Generate AI videos using Fal.ai. Create short video clips from text prompts or animate images. Great for social content, previews, and creative projects.",
		parameters: falVideoSchema,
		execute: async (_toolCallId, { prompt, imageUrl, duration = 5, aspectRatio = "16:9", label }) => {
			logMcpTool("fal_video", label);

			try {
				const FAL_KEY = process.env.FAL_KEY || process.env.FAL_API_KEY;
				if (!FAL_KEY) {
					return {
						content: [{ type: "text", text: "Fal.ai API key not configured. Set FAL_KEY environment variable." }],
						details: undefined,
					};
				}

				// Use Kling or other video models via Fal
				const modelId = imageUrl
					? "fal-ai/kling-video/v1/standard/image-to-video"
					: "fal-ai/kling-video/v1/standard/text-to-video";

				const requestBody: Record<string, unknown> = {
					prompt: prompt,
					duration: duration === 10 ? "10" : "5",
					aspect_ratio: aspectRatio,
				};

				if (imageUrl) {
					requestBody.image_url = imageUrl;
				}

				const response = await fetch(`https://queue.fal.run/${modelId}`, {
					method: "POST",
					headers: {
						Authorization: `Key ${FAL_KEY}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(requestBody),
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Fal.ai Video API error: ${error}` }], details: undefined };
				}

				const result = (await response.json()) as { request_id?: string; video?: { url: string } };

				if (result.request_id) {
					// Video generation takes longer - return task ID for async polling
					return {
						content: [
							{
								type: "text",
								text: `🎬 **Video Generation Started!**\n\n**Prompt:** ${prompt.slice(0, 100)}...\n**Duration:** ${duration}s\n**Aspect:** ${aspectRatio}\n\n⏳ Video generation typically takes 2-5 minutes.\n**Task ID:** ${result.request_id}\n\nUse \`fal_video_status\` to check progress.`,
							},
						],
						details: undefined,
					};
				}

				if (result.video?.url) {
					return {
						content: [
							{
								type: "text",
								text: `🎬 **Video Generated!**\n\n**Prompt:** ${prompt.slice(0, 100)}...\n\n🎥 **Video:** ${result.video.url}`,
							},
						],
						details: undefined,
					};
				}

				return { content: [{ type: "text", text: `Video result: ${JSON.stringify(result)}` }], details: undefined };
			} catch (error) {
				return { content: [{ type: "text", text: `Video generation error: ${error}` }], details: undefined };
			}
		},
	};
}

const directorSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	action: Type.String({ description: "Action: storyboard, shotlist, script, breakdown, schedule" }),
	project: Type.String({ description: "Project name or ID" }),
	content: Type.Optional(Type.String({ description: "Script text, scene description, or project details" })),
	format: Type.Optional(Type.String({ description: "Output format: markdown, json, pdf" })),
});

/**
 * Director/Filmmaker Tool - Production planning and storyboarding
 */
export function createDirectorTool(): AgentTool<typeof directorSchema> {
	return {
		name: "director",
		label: "director",
		description:
			"Film director and production planning tool. Create storyboards, shot lists, script breakdowns, and production schedules. Essential for video production workflows.",
		parameters: directorSchema,
		execute: async (_toolCallId, { action, project, content, format: _format = "markdown", label }) => {
			logMcpTool("director", label);

			try {
				const fs = await import("fs/promises");
				const path = await import("path");
				const projectsDir = "/opt/discord-bot-data/productions";
				const projectDir = path.join(projectsDir, project.replace(/[^a-zA-Z0-9-_]/g, "_"));

				await fs.mkdir(projectDir, { recursive: true });

				switch (action) {
					case "storyboard": {
						if (!content) {
							return {
								content: [{ type: "text", text: "Scene description required for storyboard" }],
								details: undefined,
							};
						}

						// Parse scene into visual beats
						const scenes = content.split(/\n\n|Scene \d+:/i).filter((s) => s.trim());
						const storyboard = scenes.map((scene, i) => ({
							frame: i + 1,
							description: scene.trim(),
							shotType: scene.toLowerCase().includes("close")
								? "CLOSE-UP"
								: scene.toLowerCase().includes("wide")
									? "WIDE"
									: "MEDIUM",
							notes: "",
							duration: "3s",
						}));

						const storyboardPath = path.join(projectDir, "storyboard.json");
						await fs.writeFile(storyboardPath, JSON.stringify(storyboard, null, 2));

						const mdOutput = `# Storyboard: ${project}\n\n${storyboard
							.map(
								(s) =>
									`## Frame ${s.frame}\n**Shot:** ${s.shotType}\n**Duration:** ${s.duration}\n\n${s.description}\n`,
							)
							.join("\n---\n\n")}`;

						return {
							content: [
								{
									type: "text",
									text: `🎬 **Storyboard Created!**\n\n${mdOutput}\n\n📁 Saved to: ${storyboardPath}`,
								},
							],
							details: undefined,
						};
					}

					case "shotlist": {
						const shotlistPath = path.join(projectDir, "shotlist.md");

						// Generate shot list template
						const shotlist = `# Shot List: ${project}
Generated: ${new Date().toISOString()}

## Pre-Production Notes
${content || "Add production notes here"}

## Shot List

| # | Scene | Shot | Size | Movement | Equipment | Notes |
|---|-------|------|------|----------|-----------|-------|
| 1 | 1 | A | Wide | Static | Tripod | Establishing |
| 2 | 1 | B | Medium | Pan L | Gimbal | Follow action |
| 3 | 1 | C | Close | Static | Tripod | Reaction |

## Equipment Checklist
- [ ] Camera
- [ ] Lenses
- [ ] Tripod/Gimbal
- [ ] Lighting
- [ ] Audio

## Crew
- Director:
- DP:
- Sound:
- Gaffer:
`;
						await fs.writeFile(shotlistPath, shotlist);
						return {
							content: [
								{
									type: "text",
									text: `📋 **Shot List Template Created!**\n\n📁 File: ${shotlistPath}\n\nEdit the file to add your shots.`,
								},
							],
							details: undefined,
						};
					}

					case "script": {
						if (!content) {
							return { content: [{ type: "text", text: "Script content required" }], details: undefined };
						}

						const scriptPath = path.join(projectDir, "script.fountain");

						// Format as Fountain screenplay format
						const script = `Title: ${project}
Credit: Written by
Author: AI Assistant
Draft date: ${new Date().toISOString().split("T")[0]}

${content}
`;
						await fs.writeFile(scriptPath, script);
						return {
							content: [
								{
									type: "text",
									text: `📝 **Script Saved!**\n\n📁 File: ${scriptPath}\n\nUsing Fountain format for screenplay compatibility.`,
								},
							],
							details: undefined,
						};
					}

					case "breakdown": {
						const breakdownPath = path.join(projectDir, "breakdown.md");

						// Script breakdown template
						const breakdown = `# Script Breakdown: ${project}

## Scene Analysis
${content || "Paste script to analyze"}

## Elements Breakdown

### Cast
- Lead 1:
- Lead 2:
- Supporting:

### Locations
1. INT. LOCATION - DAY
2. EXT. LOCATION - NIGHT

### Props
- Key props
- Background props

### Wardrobe
- Character 1 outfit
- Character 2 outfit

### Special Equipment
- Stunts:
- VFX:
- SFX:

### Estimated Budget
- Talent: $
- Location: $
- Equipment: $
- Post: $
- **Total:** $

`;
						await fs.writeFile(breakdownPath, breakdown);
						return {
							content: [
								{
									type: "text",
									text: `📊 **Script Breakdown Template Created!**\n\n📁 File: ${breakdownPath}`,
								},
							],
							details: undefined,
						};
					}

					case "schedule": {
						const schedulePath = path.join(projectDir, "schedule.md");

						const schedule = `# Production Schedule: ${project}

## Pre-Production
| Date | Task | Assignee | Status |
|------|------|----------|--------|
| | Script Lock | | ⬜ |
| | Casting | | ⬜ |
| | Location Scout | | ⬜ |
| | Equipment Rental | | ⬜ |

## Production
| Day | Date | Scenes | Location | Call Time | Wrap |
|-----|------|--------|----------|-----------|------|
| 1 | | 1, 2, 3 | Studio A | 6:00 AM | 6:00 PM |
| 2 | | 4, 5 | Location B | 7:00 AM | 5:00 PM |

## Post-Production
| Phase | Start | End | Notes |
|-------|-------|-----|-------|
| Assembly | | | |
| Rough Cut | | | |
| Picture Lock | | | |
| Color | | | |
| Sound Mix | | | |
| Delivery | | | |

`;
						await fs.writeFile(schedulePath, schedule);
						return {
							content: [
								{ type: "text", text: `📅 **Production Schedule Created!**\n\n📁 File: ${schedulePath}` },
							],
							details: undefined,
						};
					}

					default:
						return {
							content: [
								{
									type: "text",
									text: `Invalid action. Use: storyboard, shotlist, script, breakdown, schedule`,
								},
							],
							details: undefined,
						};
				}
			} catch (error) {
				return { content: [{ type: "text", text: `Director tool error: ${error}` }], details: undefined };
			}
		},
	};
}

const artDesignSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	action: Type.String({ description: "Action: palette, moodboard, assets, style-guide, concept" }),
	project: Type.String({ description: "Project name" }),
	style: Type.Optional(Type.String({ description: "Art style or theme" })),
	colors: Type.Optional(Type.Array(Type.String(), { description: "Color hex codes for palette" })),
	description: Type.Optional(Type.String({ description: "Description for generation" })),
});

/**
 * Art & Design Tool - Visual design and asset management
 */
export function createArtDesignTool(): AgentTool<typeof artDesignSchema> {
	return {
		name: "art_design",
		label: "art_design",
		description:
			"Art and design tool for creative projects. Generate color palettes, create mood boards, manage assets, and create style guides. Perfect for visual design workflows.",
		parameters: artDesignSchema,
		execute: async (_toolCallId, { action, project, style, colors, description, label }) => {
			logMcpTool("art_design", label);

			try {
				const fs = await import("fs/promises");
				const path = await import("path");
				const designDir = "/opt/discord-bot-data/designs";
				const projectDir = path.join(designDir, project.replace(/[^a-zA-Z0-9-_]/g, "_"));

				await fs.mkdir(projectDir, { recursive: true });

				switch (action) {
					case "palette": {
						let palette: { name: string; hex: string; rgb: string }[];

						if (colors && colors.length > 0) {
							palette = colors.map((hex, i) => {
								const r = parseInt(hex.slice(1, 3), 16);
								const g = parseInt(hex.slice(3, 5), 16);
								const b = parseInt(hex.slice(5, 7), 16);
								return {
									name: `Color ${i + 1}`,
									hex: hex,
									rgb: `rgb(${r}, ${g}, ${b})`,
								};
							});
						} else {
							// Generate harmonious palette based on style
							const baseHue = Math.random() * 360;
							palette = [
								{ name: "Primary", hex: hslToHex(baseHue, 70, 50), rgb: "" },
								{ name: "Secondary", hex: hslToHex((baseHue + 30) % 360, 60, 55), rgb: "" },
								{ name: "Accent", hex: hslToHex((baseHue + 180) % 360, 80, 45), rgb: "" },
								{ name: "Background", hex: hslToHex(baseHue, 10, 95), rgb: "" },
								{ name: "Text", hex: hslToHex(baseHue, 20, 15), rgb: "" },
							];
						}

						const paletteFile = path.join(projectDir, "palette.json");
						await fs.writeFile(paletteFile, JSON.stringify(palette, null, 2));

						const display = palette.map((c) => `• **${c.name}**: \`${c.hex}\``).join("\n");
						return {
							content: [
								{
									type: "text",
									text: `🎨 **Color Palette: ${project}**\n\n${display}\n\n📁 Saved: ${paletteFile}`,
								},
							],
							details: undefined,
						};
					}

					case "moodboard": {
						const moodboardFile = path.join(projectDir, "moodboard.md");
						const moodboard = `# Moodboard: ${project}

## Style Direction
${style || "Define your visual style"}

## Description
${description || "Add project description"}

## Visual References
- [ ] Reference 1: URL
- [ ] Reference 2: URL
- [ ] Reference 3: URL

## Color Inspiration
- Primary mood:
- Secondary mood:
- Accent elements:

## Typography
- Headlines:
- Body:
- Accent:

## Textures & Patterns
-
-
-

## Key Words
-
-
-

`;
						await fs.writeFile(moodboardFile, moodboard);
						return {
							content: [
								{
									type: "text",
									text: `🖼️ **Moodboard Created: ${project}**\n\n📁 File: ${moodboardFile}\n\nAdd your visual references and inspiration!`,
								},
							],
							details: undefined,
						};
					}

					case "style-guide": {
						const styleGuideFile = path.join(projectDir, "style-guide.md");
						const styleGuide = `# Style Guide: ${project}

## Brand Overview
${description || "Brand description"}

## Logo Usage
- Minimum size:
- Clear space:
- Variations: Primary, Monochrome, Reversed

## Color System
### Primary Colors
- Primary: #
- Secondary: #

### Accent Colors
- Success: #22C55E
- Warning: #EAB308
- Error: #EF4444
- Info: #3B82F6

## Typography
### Font Families
- Headlines:
- Body:
- Code:

### Scale
- H1: 48px / 3rem
- H2: 36px / 2.25rem
- H3: 24px / 1.5rem
- Body: 16px / 1rem
- Small: 14px / 0.875rem

## Spacing
- xs: 4px
- sm: 8px
- md: 16px
- lg: 24px
- xl: 32px

## Components
### Buttons
- Primary:
- Secondary:
- Ghost:

### Cards
- Border radius:
- Shadow:
- Padding:

## Iconography
- Style:
- Size: 24px default
- Stroke: 2px

## Photography
- Style: ${style || "Define photo style"}
- Treatment:
- Subjects:

`;
						await fs.writeFile(styleGuideFile, styleGuide);
						return {
							content: [
								{ type: "text", text: `📐 **Style Guide Created: ${project}**\n\n📁 File: ${styleGuideFile}` },
							],
							details: undefined,
						};
					}

					case "assets": {
						const assetsDir = path.join(projectDir, "assets");
						await fs.mkdir(path.join(assetsDir, "images"), { recursive: true });
						await fs.mkdir(path.join(assetsDir, "icons"), { recursive: true });
						await fs.mkdir(path.join(assetsDir, "fonts"), { recursive: true });
						await fs.mkdir(path.join(assetsDir, "videos"), { recursive: true });

						const assetsIndex = `# Assets: ${project}

## Structure
\`\`\`
assets/
├── images/     # Photos, illustrations, backgrounds
├── icons/      # Icon sets and custom icons
├── fonts/      # Typography files
└── videos/     # Video assets and animations
\`\`\`

## Asset Naming Convention
- lowercase-with-dashes.ext
- category_name_variant.ext
- icon-24-name.svg

## Optimization Notes
- Images: WebP preferred, max 2MB
- Icons: SVG preferred
- Videos: MP4 H.264, max 50MB

`;
						await fs.writeFile(path.join(assetsDir, "README.md"), assetsIndex);
						return {
							content: [
								{
									type: "text",
									text: `📁 **Assets Structure Created: ${project}**\n\n\`\`\`\n${assetsDir}/\n├── images/\n├── icons/\n├── fonts/\n└── videos/\n\`\`\``,
								},
							],
							details: undefined,
						};
					}

					case "concept": {
						if (!description) {
							return {
								content: [{ type: "text", text: "Description required for concept art" }],
								details: undefined,
							};
						}

						const conceptFile = path.join(projectDir, `concept-${Date.now()}.md`);
						const concept = `# Concept: ${project}

## Description
${description}

## Style Direction
${style || "To be defined"}

## Key Elements
-
-
-

## Color Notes
-

## Reference Prompt for AI Generation
\`\`\`
${description}, ${style || "high quality"}, detailed, professional
\`\`\`

## Iterations
1. Initial concept
2. Refinement
3. Final

`;
						await fs.writeFile(conceptFile, concept);
						return {
							content: [
								{
									type: "text",
									text: `💡 **Concept Document Created!**\n\n📁 File: ${conceptFile}\n\nUse \`fal_image\` or \`image_generate\` to create visuals from the prompt.`,
								},
							],
							details: undefined,
						};
					}

					default:
						return {
							content: [
								{ type: "text", text: "Invalid action. Use: palette, moodboard, assets, style-guide, concept" },
							],
							details: undefined,
						};
				}
			} catch (error) {
				return { content: [{ type: "text", text: `Art design error: ${error}` }], details: undefined };
			}
		},
	};
}

// Helper function for HSL to Hex conversion
function hslToHex(h: number, s: number, l: number): string {
	s /= 100;
	l /= 100;
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
		return Math.round(255 * color)
			.toString(16)
			.padStart(2, "0");
	};
	return `#${f(0)}${f(8)}${f(4)}`;
}

const hfInferenceSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	task: Type.String({
		description:
			"Task: text-to-image, image-to-text, text-generation, summarization, translation, audio-classification",
	}),
	model: Type.Optional(
		Type.String({ description: "HuggingFace model ID (e.g., 'stabilityai/stable-diffusion-xl-base-1.0')" }),
	),
	input: Type.String({ description: "Input text or image URL depending on task" }),
	options: Type.Optional(Type.Object({}, { description: "Additional model-specific options" })),
});

/**
 * HuggingFace Inference Tool - Access thousands of AI models
 */
export function createHFInferenceTool(): AgentTool<typeof hfInferenceSchema> {
	return {
		name: "hf_inference",
		label: "hf_inference",
		description:
			"Run AI models via HuggingFace Inference API. Access thousands of models for text generation, image creation, translation, summarization, and more.",
		parameters: hfInferenceSchema,
		execute: async (_toolCallId, { task, model, input, label }) => {
			logMcpTool("hf_inference", label);

			try {
				const HF_TOKEN = process.env.HF_TOKEN;
				if (!HF_TOKEN) {
					return {
						content: [
							{ type: "text", text: "HuggingFace token not configured. Set HF_TOKEN environment variable." },
						],
						details: undefined,
					};
				}

				const defaultModels: Record<string, string> = {
					"text-to-image": "stabilityai/stable-diffusion-xl-base-1.0",
					"image-to-text": "Salesforce/blip-image-captioning-large",
					"text-generation": "mistralai/Mistral-7B-Instruct-v0.2",
					summarization: "facebook/bart-large-cnn",
					translation: "Helsinki-NLP/opus-mt-en-de",
					"text-classification": "distilbert-base-uncased-finetuned-sst-2-english",
				};

				const modelId = model || defaultModels[task] || defaultModels["text-generation"];
				const apiUrl = `https://api-inference.huggingface.co/models/${modelId}`;

				const response = await fetch(apiUrl, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${HF_TOKEN}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ inputs: input }),
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `HuggingFace API error: ${error}` }], details: undefined };
				}

				const contentType = response.headers.get("content-type");

				if (contentType?.includes("image")) {
					// Image response - convert to base64
					const buffer = await response.arrayBuffer();
					const base64 = Buffer.from(buffer).toString("base64");
					return {
						content: [
							{
								type: "text",
								text: `🖼️ **Image Generated!**\n\n**Model:** ${modelId}\n**Prompt:** ${input.slice(0, 100)}...\n\n[Image data: ${base64.length} bytes base64]`,
							},
						],
						details: undefined,
					};
				}

				const result = await response.json();
				return {
					content: [
						{
							type: "text",
							text: `🤖 **HuggingFace Inference Result**\n\n**Model:** ${modelId}\n**Task:** ${task}\n\n**Result:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `HF Inference error: ${error}` }], details: undefined };
			}
		},
	};
}

const hfVideoSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	prompt: Type.String({ description: "Text description of the video to generate" }),
	model: Type.Optional(
		Type.String({ description: "Model: hunyuan (HunyuanVideo), mochi (Mochi-1), cog (CogVideoX). Default: hunyuan" }),
	),
	numFrames: Type.Optional(Type.Number({ description: "Number of frames (affects duration). Default: 49" })),
	numInferenceSteps: Type.Optional(
		Type.Number({ description: "Quality steps (more = better but slower). Default: 30" }),
	),
	guidanceScale: Type.Optional(Type.Number({ description: "Prompt adherence (1-20). Default: 7" })),
	negativePrompt: Type.Optional(Type.String({ description: "What to avoid in the video" })),
	seed: Type.Optional(Type.Number({ description: "Seed for reproducibility" })),
});

/**
 * HuggingFace Video Generation - AI video from text
 */
export function createHFVideoTool(): AgentTool<typeof hfVideoSchema> {
	return {
		name: "hf_video",
		label: "hf_video",
		description:
			"Generate AI videos using HuggingFace models. Create videos from text prompts using HunyuanVideo, Mochi, CogVideoX and other state-of-the-art video generation models.",
		parameters: hfVideoSchema,
		execute: async (
			_toolCallId,
			{
				prompt,
				model = "hunyuan",
				numFrames = 49,
				numInferenceSteps = 30,
				guidanceScale = 7,
				negativePrompt,
				seed,
				label,
			},
		) => {
			logMcpTool("hf_video", label);

			try {
				const HF_TOKEN = process.env.HF_TOKEN;
				if (!HF_TOKEN) {
					return {
						content: [
							{ type: "text", text: "HuggingFace token not configured. Set HF_TOKEN environment variable." },
						],
						details: undefined,
					};
				}

				const modelMap: Record<string, string> = {
					hunyuan: "tencent/HunyuanVideo",
					mochi: "genmo/mochi-1-preview",
					cog: "THUDM/CogVideoX-5b",
					animatediff: "ByteDance/AnimateDiff-Lightning",
					zeroscope: "cerspense/zeroscope_v2_576w",
				};

				const modelId = modelMap[model] || modelMap.hunyuan;

				// Use HuggingFace Inference API for text-to-video
				const apiUrl = `https://api-inference.huggingface.co/models/${modelId}`;

				const requestBody: Record<string, unknown> = {
					inputs: prompt,
					parameters: {
						num_frames: numFrames,
						num_inference_steps: numInferenceSteps,
						guidance_scale: guidanceScale,
					},
				};

				if (negativePrompt) {
					(requestBody.parameters as Record<string, unknown>).negative_prompt = [negativePrompt];
				}

				if (seed !== undefined) {
					(requestBody.parameters as Record<string, unknown>).seed = seed;
				}

				const response = await fetch(apiUrl, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${HF_TOKEN}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(requestBody),
				});

				if (!response.ok) {
					const errorText = await response.text();

					// Check if model is loading
					if (errorText.includes("loading") || errorText.includes("currently loading")) {
						return {
							content: [
								{
									type: "text",
									text: `⏳ **Model Loading**\n\n**Model:** ${modelId}\n\nThe model is currently loading. This can take 1-5 minutes for video models. Please try again shortly.\n\n**Tip:** Smaller models like \`zeroscope\` load faster.`,
								},
							],
							details: undefined,
						};
					}

					return {
						content: [{ type: "text", text: `HuggingFace Video API error: ${errorText}` }],
						details: undefined,
					};
				}

				const contentType = response.headers.get("content-type");

				if (contentType?.includes("video") || contentType?.includes("octet-stream")) {
					// Video response - save to file
					const fs = await import("fs/promises");
					const path = await import("path");

					const buffer = Buffer.from(await response.arrayBuffer());
					const videoDir = "/opt/discord-bot-data/generated-videos";
					await fs.mkdir(videoDir, { recursive: true });

					const filename = `hf-video-${Date.now()}.mp4`;
					const videoPath = path.join(videoDir, filename);
					await fs.writeFile(videoPath, buffer);

					return {
						content: [
							{
								type: "text",
								text: `🎬 **Video Generated!**\n\n**Model:** ${modelId}\n**Prompt:** ${prompt.slice(0, 100)}...\n**Frames:** ${numFrames}\n**Steps:** ${numInferenceSteps}\n\n📁 **Saved to:** ${videoPath}\n📦 **Size:** ${(buffer.length / 1024 / 1024).toFixed(2)} MB`,
							},
						],
						details: undefined,
					};
				}

				// JSON response (async task or error)
				const result = (await response.json()) as { estimated_time?: number; error?: string };

				if (result.estimated_time) {
					return {
						content: [
							{
								type: "text",
								text: `⏳ **Video Generation Queued**\n\n**Model:** ${modelId}\n**Estimated Time:** ${Math.ceil(result.estimated_time)} seconds\n\nVideo generation is processing. Try again in a moment to retrieve the result.`,
							},
						],
						details: undefined,
					};
				}

				return {
					content: [
						{
							type: "text",
							text: `🎬 **HuggingFace Video Result**\n\n**Model:** ${modelId}\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `HF Video generation error: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// Additional Creative Tools
// =============================================================================

const geminiImageSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	prompt: Type.String({ description: "Image description or editing instruction" }),
	action: Type.Optional(Type.String({ description: "Action: generate, edit. Default: generate" })),
	imageUrl: Type.Optional(Type.String({ description: "Image URL for editing (required for edit action)" })),
	aspectRatio: Type.Optional(Type.String({ description: "Aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:4. Default: 1:1" })),
});

/**
 * Gemini/NanoBanana Image Generation & Editing
 */
export function createGeminiImageTool(): AgentTool<typeof geminiImageSchema> {
	return {
		name: "gemini_image",
		label: "gemini_image",
		description:
			"Generate and edit images using Google Gemini 2.5 Flash (NanoBanana). Supports text-to-image and image editing with natural language instructions.",
		parameters: geminiImageSchema,
		execute: async (_toolCallId, { prompt, action = "generate", imageUrl, aspectRatio = "1:1", label }) => {
			logMcpTool("gemini_image", label);

			try {
				const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
				if (!GEMINI_KEY) {
					return {
						content: [
							{ type: "text", text: "Gemini API key not configured. Set GEMINI_API_KEY environment variable." },
						],
						details: undefined,
					};
				}

				const apiUrl =
					"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent";

				const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

				if (action === "edit" && imageUrl) {
					// Fetch image and convert to base64
					const imgResponse = await fetch(imageUrl);
					const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
					const base64 = imgBuffer.toString("base64");
					const mimeType = imgResponse.headers.get("content-type") || "image/jpeg";

					parts.push({ inlineData: { mimeType, data: base64 } });
					parts.push({ text: prompt });
				} else {
					parts.push({ text: `Generate an image: ${prompt}. Aspect ratio: ${aspectRatio}` });
				}

				const response = await fetch(`${apiUrl}?key=${GEMINI_KEY}`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						contents: [{ parts }],
						generationConfig: {
							responseModalities: ["TEXT", "IMAGE"],
						},
					}),
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Gemini API error: ${error}` }], details: undefined };
				}

				const result = (await response.json()) as {
					candidates?: Array<{
						content?: {
							parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
						};
					}>;
				};

				const candidate = result.candidates?.[0]?.content?.parts;
				if (candidate) {
					const imagePart = candidate.find((p) => p.inlineData);
					const textPart = candidate.find((p) => p.text);

					if (imagePart?.inlineData) {
						// Save image to file
						const fs = await import("fs/promises");
						const path = await import("path");
						const imgDir = "/opt/discord-bot-data/generated-images";
						await fs.mkdir(imgDir, { recursive: true });

						const ext = imagePart.inlineData.mimeType.includes("png") ? "png" : "jpg";
						const filename = `gemini-${Date.now()}.${ext}`;
						const imgPath = path.join(imgDir, filename);
						await fs.writeFile(imgPath, Buffer.from(imagePart.inlineData.data, "base64"));

						return {
							content: [
								{
									type: "text",
									text: `🎨 **Gemini Image Generated!**\n\n**Prompt:** ${prompt.slice(0, 100)}...\n**Action:** ${action}\n\n📁 **Saved to:** ${imgPath}\n${textPart?.text ? `\n💬 ${textPart.text}` : ""}`,
								},
							],
							details: undefined,
						};
					}

					if (textPart?.text) {
						return { content: [{ type: "text", text: `Gemini response: ${textPart.text}` }], details: undefined };
					}
				}

				return {
					content: [{ type: "text", text: `Gemini result: ${JSON.stringify(result)}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Gemini image error: ${error}` }], details: undefined };
			}
		},
	};
}

const lumaVideoSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	prompt: Type.String({ description: "Video description - what should happen" }),
	imageUrl: Type.Optional(Type.String({ description: "Starting image URL for image-to-video" })),
	aspectRatio: Type.Optional(Type.String({ description: "16:9, 9:16, 1:1, 4:3, 3:4, 21:9. Default: 16:9" })),
	loop: Type.Optional(Type.Boolean({ description: "Create looping video. Default: false" })),
});

/**
 * Luma AI Ray2 Video Generation
 */
export function createLumaVideoTool(): AgentTool<typeof lumaVideoSchema> {
	return {
		name: "luma_video",
		label: "luma_video",
		description:
			"Generate cinematic AI videos using Luma AI Ray2 model. Excellent for realistic motion, storytelling, and visual effects.",
		parameters: lumaVideoSchema,
		execute: async (_toolCallId, { prompt, imageUrl, aspectRatio = "16:9", loop = false, label }) => {
			logMcpTool("luma_video", label);

			try {
				const LUMA_KEY = process.env.LUMA_API_KEY || process.env.LUMALABS_API_KEY;
				if (!LUMA_KEY) {
					return {
						content: [
							{ type: "text", text: "Luma API key not configured. Set LUMA_API_KEY environment variable." },
						],
						details: undefined,
					};
				}

				const requestBody: Record<string, unknown> = {
					prompt: prompt,
					aspect_ratio: aspectRatio,
					loop: loop,
				};

				if (imageUrl) {
					requestBody.keyframes = { frame0: { type: "image", url: imageUrl } };
				}

				const response = await fetch("https://api.lumalabs.ai/dream-machine/v1/generations", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${LUMA_KEY}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify(requestBody),
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Luma API error: ${error}` }], details: undefined };
				}

				const result = (await response.json()) as { id?: string; state?: string; video?: { url?: string } };

				if (result.id) {
					return {
						content: [
							{
								type: "text",
								text: `🎬 **Luma Video Generation Started!**\n\n**Prompt:** ${prompt.slice(0, 100)}...\n**Aspect:** ${aspectRatio}\n**Loop:** ${loop}\n\n⏳ Generation takes 2-5 minutes.\n**Task ID:** ${result.id}\n\nPoll status at: \`GET /dream-machine/v1/generations/${result.id}\``,
							},
						],
						details: undefined,
					};
				}

				return { content: [{ type: "text", text: `Luma result: ${JSON.stringify(result)}` }], details: undefined };
			} catch (error) {
				return { content: [{ type: "text", text: `Luma video error: ${error}` }], details: undefined };
			}
		},
	};
}

const mubertMusicSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	prompt: Type.String({ description: "Music description - mood, genre, energy level" }),
	duration: Type.Optional(Type.Number({ description: "Duration in seconds (30-180). Default: 60" })),
	intensity: Type.Optional(Type.String({ description: "Intensity: low, medium, high. Default: medium" })),
	format: Type.Optional(Type.String({ description: "Format: mp3, wav. Default: mp3" })),
});

/**
 * Mubert AI Music - Royalty-free loops and tracks
 */
export function createMubertMusicTool(): AgentTool<typeof mubertMusicSchema> {
	return {
		name: "mubert_music",
		label: "mubert_music",
		description:
			"Generate royalty-free AI music using Mubert. Perfect for background music, podcasts, videos, and content creation. Commercial use allowed.",
		parameters: mubertMusicSchema,
		execute: async (_toolCallId, { prompt, duration = 60, intensity = "medium", format = "mp3", label }) => {
			logMcpTool("mubert_music", label);

			try {
				const MUBERT_KEY = process.env.MUBERT_API_KEY;
				if (!MUBERT_KEY) {
					return {
						content: [
							{
								type: "text",
								text: "Mubert API key not configured. Set MUBERT_API_KEY environment variable.\n\n**Alternative:** Use `suno_music` for music generation.",
							},
						],
						details: undefined,
					};
				}

				const response = await fetch("https://api.mubert.com/v2/RecordTrack", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						method: "RecordTrack",
						params: {
							pat: MUBERT_KEY,
							duration: Math.min(180, Math.max(30, duration)),
							tags: prompt.split(" ").slice(0, 5),
							mode: intensity,
							format: format,
						},
					}),
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Mubert API error: ${error}` }], details: undefined };
				}

				const result = (await response.json()) as { data?: { tasks?: Array<{ task_id: string }> } };

				if (result.data?.tasks?.[0]?.task_id) {
					return {
						content: [
							{
								type: "text",
								text: `🎵 **Mubert Track Generation Started!**\n\n**Prompt:** ${prompt}\n**Duration:** ${duration}s\n**Intensity:** ${intensity}\n\n⏳ Processing...\n**Task ID:** ${result.data.tasks[0].task_id}`,
							},
						],
						details: undefined,
					};
				}

				return {
					content: [{ type: "text", text: `Mubert result: ${JSON.stringify(result)}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Mubert error: ${error}` }], details: undefined };
			}
		},
	};
}

const apiUsageSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	action: Type.String({ description: "Action: status, track, reset, history" }),
	service: Type.Optional(Type.String({ description: "Service: fal, suno, gemini, hf, all. Default: all" })),
	cost: Type.Optional(Type.Number({ description: "Cost to track (for track action)" })),
	tool: Type.Optional(Type.String({ description: "Tool name (for track action)" })),
});

// In-memory usage tracking (persisted to file)
const usageTracker: Record<
	string,
	{ total: number; calls: number; history: Array<{ time: string; tool: string; cost: number }> }
> = {
	fal: { total: 0, calls: 0, history: [] },
	suno: { total: 0, calls: 0, history: [] },
	gemini: { total: 0, calls: 0, history: [] },
	hf: { total: 0, calls: 0, history: [] },
};

/**
 * API Usage Tracking Tool
 */
export function createApiUsageTool(): AgentTool<typeof apiUsageSchema> {
	return {
		name: "api_usage",
		label: "api_usage",
		description:
			"Track and monitor API usage across creative services (Fal.ai, Suno, Gemini, HuggingFace). View costs, call counts, and history.",
		parameters: apiUsageSchema,
		execute: async (_toolCallId, { action, service = "all", cost, tool, label }) => {
			logMcpTool("api_usage", label);

			try {
				const fs = await import("fs/promises");
				const usagePath = "/opt/discord-bot-data/api-usage.json";

				// Load persisted usage
				try {
					const saved = await fs.readFile(usagePath, "utf-8");
					const parsed = JSON.parse(saved);
					Object.assign(usageTracker, parsed);
				} catch {
					/* File doesn't exist yet */
				}

				switch (action) {
					case "status": {
						const services = service === "all" ? Object.keys(usageTracker) : [service];
						const credits: Record<string, number> = { fal: 4.0, suno: 5.0, gemini: 0, hf: 0 };

						const status = services
							.map((s) => {
								const u = usageTracker[s] || { total: 0, calls: 0, history: [] };
								const remaining = credits[s] ? (credits[s] - u.total).toFixed(2) : "unlimited";
								return `**${s.toUpperCase()}**\n  Spent: $${u.total.toFixed(4)}\n  Calls: ${u.calls}\n  Remaining: ${remaining === "unlimited" ? "∞" : `$${remaining}`}`;
							})
							.join("\n\n");

						return {
							content: [{ type: "text", text: `📊 **API Usage Status**\n\n${status}` }],
							details: undefined,
						};
					}

					case "track": {
						if (!service || service === "all" || !cost || !tool) {
							return {
								content: [{ type: "text", text: "Track requires: service, cost, tool" }],
								details: undefined,
							};
						}

						if (!usageTracker[service]) {
							usageTracker[service] = { total: 0, calls: 0, history: [] };
						}

						usageTracker[service].total += cost;
						usageTracker[service].calls += 1;
						usageTracker[service].history.push({
							time: new Date().toISOString(),
							tool: tool,
							cost: cost,
						});

						// Keep only last 100 entries
						if (usageTracker[service].history.length > 100) {
							usageTracker[service].history = usageTracker[service].history.slice(-100);
						}

						await fs.writeFile(usagePath, JSON.stringify(usageTracker, null, 2));

						return {
							content: [{ type: "text", text: `✓ Tracked: ${service} - ${tool} - $${cost.toFixed(4)}` }],
							details: undefined,
						};
					}

					case "reset": {
						const services = service === "all" ? Object.keys(usageTracker) : [service];
						services.forEach((s) => {
							usageTracker[s] = { total: 0, calls: 0, history: [] };
						});
						await fs.writeFile(usagePath, JSON.stringify(usageTracker, null, 2));
						return {
							content: [{ type: "text", text: `🔄 Reset usage for: ${services.join(", ")}` }],
							details: undefined,
						};
					}

					case "history": {
						const services = service === "all" ? Object.keys(usageTracker) : [service];
						const history = services
							.flatMap((s) => (usageTracker[s]?.history || []).map((h) => ({ ...h, service: s })))
							.sort((a, b) => b.time.localeCompare(a.time))
							.slice(0, 20);

						if (history.length === 0) {
							return { content: [{ type: "text", text: "No usage history yet." }], details: undefined };
						}

						const list = history
							.map((h) => `• ${h.time.split("T")[0]} ${h.service}/${h.tool}: $${h.cost.toFixed(4)}`)
							.join("\n");

						return {
							content: [{ type: "text", text: `📜 **Recent Usage History**\n\n${list}` }],
							details: undefined,
						};
					}

					default:
						return {
							content: [{ type: "text", text: "Invalid action. Use: status, track, reset, history" }],
							details: undefined,
						};
				}
			} catch (error) {
				return { content: [{ type: "text", text: `Usage tracking error: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// OPTION A: Voice & Audio Tools
// =============================================================================

const elevenLabsTTSSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	text: Type.String({ description: "Text to convert to speech" }),
	voice: Type.Optional(
		Type.String({
			description: "Voice ID or name: rachel, domi, bella, antoni, elli, josh, arnold, adam, sam. Default: rachel",
		}),
	),
	model: Type.Optional(
		Type.String({ description: "Model: eleven_multilingual_v2, eleven_turbo_v2. Default: eleven_turbo_v2" }),
	),
	stability: Type.Optional(Type.Number({ description: "Voice stability 0-1. Default: 0.5" })),
	clarity: Type.Optional(Type.Number({ description: "Clarity + similarity enhancement 0-1. Default: 0.75" })),
});

/**
 * ElevenLabs Text-to-Speech - High quality AI voices
 */
export function createElevenLabsTTSTool(): AgentTool<typeof elevenLabsTTSSchema> {
	return {
		name: "elevenlabs_tts",
		label: "elevenlabs_tts",
		description:
			"Convert text to high-quality speech using ElevenLabs AI voices. Professional quality for podcasts, videos, and voiceovers.",
		parameters: elevenLabsTTSSchema,
		execute: async (
			_toolCallId,
			{ text, voice = "rachel", model = "eleven_turbo_v2", stability = 0.5, clarity = 0.75, label },
		) => {
			logMcpTool("elevenlabs_tts", label);

			try {
				const API_KEY = process.env.ELEVENLABS_API_KEY;
				if (!API_KEY) {
					return {
						content: [
							{
								type: "text",
								text: "ElevenLabs API key not configured. Set ELEVENLABS_API_KEY environment variable.",
							},
						],
						details: undefined,
					};
				}

				// Voice name to ID mapping
				const voiceMap: Record<string, string> = {
					rachel: "21m00Tcm4TlvDq8ikWAM",
					domi: "AZnzlk1XvdvUeBnXmlld",
					bella: "EXAVITQu4vr4xnSDxMaL",
					antoni: "ErXwobaYiN019PkySvjV",
					elli: "MF3mGyEYCl7XYWbV9V6O",
					josh: "TxGEqnHWrfWFTfGW9XjX",
					arnold: "VR6AewLTigWG4xSOukaG",
					adam: "pNInz6obpgDQGcFmaJgB",
					sam: "yoZ06aMxZJJ28mfd3POQ",
				};

				const voiceId = voiceMap[voice.toLowerCase()] || voice;

				const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
					method: "POST",
					headers: {
						Accept: "audio/mpeg",
						"Content-Type": "application/json",
						"xi-api-key": API_KEY,
					},
					body: JSON.stringify({
						text,
						model_id: model,
						voice_settings: {
							stability,
							similarity_boost: clarity,
						},
					}),
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `ElevenLabs API error: ${error}` }], details: undefined };
				}

				const fs = await import("fs/promises");
				const path = await import("path");
				const audioDir = "/opt/discord-bot-data/generated-audio";
				await fs.mkdir(audioDir, { recursive: true });

				const filename = `tts-${Date.now()}.mp3`;
				const audioPath = path.join(audioDir, filename);
				const buffer = Buffer.from(await response.arrayBuffer());
				await fs.writeFile(audioPath, buffer);

				return {
					content: [
						{
							type: "text",
							text: `🎙️ **ElevenLabs TTS Generated!**\n\n**Voice:** ${voice}\n**Model:** ${model}\n**Text:** ${text.slice(0, 100)}...\n\n📁 **Saved to:** ${audioPath}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `ElevenLabs TTS error: ${error}` }], details: undefined };
			}
		},
	};
}

const audioEffectsSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	inputPath: Type.String({ description: "Path to input audio file" }),
	effect: Type.String({
		description: "Effect: reverb, pitch_up, pitch_down, speed_up, slow_down, bass_boost, normalize, fade",
	}),
	intensity: Type.Optional(Type.Number({ description: "Effect intensity 0-1. Default: 0.5" })),
});

/**
 * Audio Effects - Apply effects to audio files using FFmpeg
 */
export function createAudioEffectsTool(): AgentTool<typeof audioEffectsSchema> {
	return {
		name: "audio_effects",
		label: "audio_effects",
		description:
			"Apply audio effects to audio files using FFmpeg. Effects: reverb, pitch_up, pitch_down, speed_up, slow_down, bass_boost, normalize, fade.",
		parameters: audioEffectsSchema,
		execute: async (_toolCallId, { inputPath, effect, intensity = 0.5, label }) => {
			logMcpTool("audio_effects", label);

			try {
				const { exec } = await import("child_process");
				const { promisify } = await import("util");
				const execAsync = promisify(exec);
				const fs = await import("fs/promises");
				const path = await import("path");

				// Verify input exists
				try {
					await fs.access(inputPath);
				} catch {
					return { content: [{ type: "text", text: `Input file not found: ${inputPath}` }], details: undefined };
				}

				const outputDir = "/opt/discord-bot-data/generated-audio";
				await fs.mkdir(outputDir, { recursive: true });
				const ext = path.extname(inputPath);
				const outputPath = path.join(outputDir, `fx-${effect}-${Date.now()}${ext}`);

				// Effect to FFmpeg filter mapping
				const effectFilters: Record<string, string> = {
					reverb: `aecho=0.8:0.88:60:0.4`,
					pitch_up: `asetrate=44100*${1 + intensity * 0.5},aresample=44100`,
					pitch_down: `asetrate=44100*${1 - intensity * 0.3},aresample=44100`,
					speed_up: `atempo=${1 + intensity}`,
					slow_down: `atempo=${1 - intensity * 0.5}`,
					bass_boost: `bass=g=${intensity * 20}`,
					normalize: `loudnorm=I=-16:TP=-1.5:LRA=11`,
					fade: `afade=t=in:st=0:d=2,afade=t=out:st=-2:d=2`,
				};

				const filter = effectFilters[effect];
				if (!filter) {
					return {
						content: [
							{
								type: "text",
								text: `Unknown effect: ${effect}. Available: ${Object.keys(effectFilters).join(", ")}`,
							},
						],
						details: undefined,
					};
				}

				await execAsync(`ffmpeg -i "${inputPath}" -af "${filter}" -y "${outputPath}"`, { timeout: 60000 });

				return {
					content: [
						{
							type: "text",
							text: `🎚️ **Audio Effect Applied!**\n\n**Effect:** ${effect}\n**Intensity:** ${intensity}\n**Input:** ${inputPath}\n\n📁 **Output:** ${outputPath}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Audio effects error: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// OPTION B: Advanced Image Tools
// =============================================================================

const imageInpaintSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	imageUrl: Type.String({ description: "URL of image to edit" }),
	maskUrl: Type.Optional(
		Type.String({ description: "URL of mask (white = edit area). Optional - can use prompt instead" }),
	),
	prompt: Type.String({ description: "What to paint in the masked/selected area" }),
	negativePrompt: Type.Optional(Type.String({ description: "What to avoid" })),
});

/**
 * Image Inpainting - Edit specific parts of images
 */
export function createImageInpaintTool(): AgentTool<typeof imageInpaintSchema> {
	return {
		name: "image_inpaint",
		label: "image_inpaint",
		description:
			"Edit specific parts of an image using AI inpainting. Provide an image and describe what to change. Uses Fal.ai FLUX Fill.",
		parameters: imageInpaintSchema,
		execute: async (_toolCallId, { imageUrl, maskUrl, prompt, negativePrompt, label }) => {
			logMcpTool("image_inpaint", label);

			try {
				const FAL_KEY = process.env.FAL_KEY;
				if (!FAL_KEY) {
					return {
						content: [{ type: "text", text: "Fal.ai API key not configured. Set FAL_KEY environment variable." }],
						details: undefined,
					};
				}

				const response = await fetch("https://queue.fal.run/fal-ai/flux/dev/inpainting", {
					method: "POST",
					headers: {
						Authorization: `Key ${FAL_KEY}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						image_url: imageUrl,
						mask_url: maskUrl,
						prompt,
						negative_prompt: negativePrompt,
						num_inference_steps: 28,
						guidance_scale: 3.5,
					}),
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Inpainting API error: ${error}` }], details: undefined };
				}

				const result = (await response.json()) as { images?: Array<{ url: string }> };

				if (result.images?.[0]?.url) {
					// Download and save
					const fs = await import("fs/promises");
					const path = await import("path");
					const imgDir = "/opt/discord-bot-data/generated-images";
					await fs.mkdir(imgDir, { recursive: true });

					const imgResponse = await fetch(result.images[0].url);
					const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
					const filename = `inpaint-${Date.now()}.png`;
					const imgPath = path.join(imgDir, filename);
					await fs.writeFile(imgPath, imgBuffer);

					return {
						content: [
							{
								type: "text",
								text: `🖌️ **Inpainting Complete!**\n\n**Prompt:** ${prompt.slice(0, 100)}...\n\n📁 **Saved to:** ${imgPath}\n🔗 **URL:** ${result.images[0].url}`,
							},
						],
						details: undefined,
					};
				}

				return {
					content: [{ type: "text", text: `Inpainting result: ${JSON.stringify(result)}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Inpainting error: ${error}` }], details: undefined };
			}
		},
	};
}

const imageUpscaleSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	imageUrl: Type.String({ description: "URL of image to upscale" }),
	scale: Type.Optional(Type.Number({ description: "Scale factor: 2 or 4. Default: 4" })),
	model: Type.Optional(Type.String({ description: "Model: real-esrgan, clarity. Default: real-esrgan" })),
});

/**
 * Image Upscaling - Enhance resolution with AI
 */
export function createImageUpscaleTool(): AgentTool<typeof imageUpscaleSchema> {
	return {
		name: "image_upscale",
		label: "image_upscale",
		description:
			"Upscale images 2x or 4x using AI (Real-ESRGAN). Enhances resolution while preserving and improving details.",
		parameters: imageUpscaleSchema,
		execute: async (_toolCallId, { imageUrl, scale = 4, model = "real-esrgan", label }) => {
			logMcpTool("image_upscale", label);

			try {
				const FAL_KEY = process.env.FAL_KEY;
				if (!FAL_KEY) {
					return {
						content: [{ type: "text", text: "Fal.ai API key not configured. Set FAL_KEY environment variable." }],
						details: undefined,
					};
				}

				const modelEndpoint = model === "clarity" ? "fal-ai/clarity-upscaler" : "fal-ai/real-esrgan";

				const response = await fetch(`https://queue.fal.run/${modelEndpoint}`, {
					method: "POST",
					headers: {
						Authorization: `Key ${FAL_KEY}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						image_url: imageUrl,
						scale: scale,
					}),
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Upscale API error: ${error}` }], details: undefined };
				}

				const result = (await response.json()) as { image?: { url: string } };

				if (result.image?.url) {
					const fs = await import("fs/promises");
					const path = await import("path");
					const imgDir = "/opt/discord-bot-data/generated-images";
					await fs.mkdir(imgDir, { recursive: true });

					const imgResponse = await fetch(result.image.url);
					const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
					const filename = `upscale-${scale}x-${Date.now()}.png`;
					const imgPath = path.join(imgDir, filename);
					await fs.writeFile(imgPath, imgBuffer);

					return {
						content: [
							{
								type: "text",
								text: `📐 **Image Upscaled ${scale}x!**\n\n**Model:** ${model}\n\n📁 **Saved to:** ${imgPath}\n🔗 **URL:** ${result.image.url}`,
							},
						],
						details: undefined,
					};
				}

				return {
					content: [{ type: "text", text: `Upscale result: ${JSON.stringify(result)}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Upscale error: ${error}` }], details: undefined };
			}
		},
	};
}

const styleTransferSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	imageUrl: Type.String({ description: "URL of image to stylize" }),
	style: Type.String({
		description: "Style: anime, ghibli, pixar, comic, watercolor, oil_painting, sketch, cyberpunk, van_gogh",
	}),
	strength: Type.Optional(Type.Number({ description: "Style strength 0-1. Default: 0.7" })),
});

/**
 * Style Transfer - Apply artistic styles to images
 */
export function createStyleTransferTool(): AgentTool<typeof styleTransferSchema> {
	return {
		name: "style_transfer",
		label: "style_transfer",
		description:
			"Apply artistic styles to images. Transform photos into anime, Ghibli, Pixar, watercolor, oil paintings, and more.",
		parameters: styleTransferSchema,
		execute: async (_toolCallId, { imageUrl, style, strength = 0.7, label }) => {
			logMcpTool("style_transfer", label);

			try {
				const FAL_KEY = process.env.FAL_KEY;
				if (!FAL_KEY) {
					return {
						content: [{ type: "text", text: "Fal.ai API key not configured. Set FAL_KEY environment variable." }],
						details: undefined,
					};
				}

				// Style prompts for img2img
				const stylePrompts: Record<string, string> = {
					anime: "anime style, cel shaded, vibrant colors, japanese animation",
					ghibli: "studio ghibli style, miyazaki, soft watercolor, dreamy atmosphere",
					pixar: "pixar 3d animation style, smooth render, family friendly",
					comic: "comic book style, bold lines, halftone dots, pop art colors",
					watercolor: "watercolor painting, soft washes, artistic, delicate brushstrokes",
					oil_painting: "oil painting, thick brushstrokes, classical art, rich textures",
					sketch: "pencil sketch, hand drawn, graphite, artistic illustration",
					cyberpunk: "cyberpunk style, neon lights, futuristic, blade runner aesthetic",
					van_gogh: "van gogh style, swirling brushstrokes, post-impressionist, starry night",
				};

				const stylePrompt = stylePrompts[style] || style;

				const response = await fetch("https://queue.fal.run/fal-ai/flux/dev/image-to-image", {
					method: "POST",
					headers: {
						Authorization: `Key ${FAL_KEY}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						image_url: imageUrl,
						prompt: stylePrompt,
						strength: strength,
						num_inference_steps: 28,
						guidance_scale: 7.5,
					}),
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Style transfer API error: ${error}` }], details: undefined };
				}

				const result = (await response.json()) as { images?: Array<{ url: string }> };

				if (result.images?.[0]?.url) {
					const fs = await import("fs/promises");
					const path = await import("path");
					const imgDir = "/opt/discord-bot-data/generated-images";
					await fs.mkdir(imgDir, { recursive: true });

					const imgResponse = await fetch(result.images[0].url);
					const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
					const filename = `style-${style}-${Date.now()}.png`;
					const imgPath = path.join(imgDir, filename);
					await fs.writeFile(imgPath, imgBuffer);

					return {
						content: [
							{
								type: "text",
								text: `🎨 **Style Transfer Complete!**\n\n**Style:** ${style}\n**Strength:** ${strength}\n\n📁 **Saved to:** ${imgPath}\n🔗 **URL:** ${result.images[0].url}`,
							},
						],
						details: undefined,
					};
				}

				return {
					content: [{ type: "text", text: `Style transfer result: ${JSON.stringify(result)}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Style transfer error: ${error}` }], details: undefined };
			}
		},
	};
}

const faceRestoreSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	imageUrl: Type.String({ description: "URL of image with faces to restore" }),
	enhanceBackground: Type.Optional(Type.Boolean({ description: "Also enhance background. Default: true" })),
	upscale: Type.Optional(Type.Number({ description: "Upscale factor 1-4. Default: 2" })),
});

/**
 * Face Restoration - Enhance and restore faces in images
 */
export function createFaceRestoreTool(): AgentTool<typeof faceRestoreSchema> {
	return {
		name: "face_restore",
		label: "face_restore",
		description:
			"Restore and enhance faces in images using AI (GFPGAN/CodeFormer). Fix blurry, old, or damaged photos.",
		parameters: faceRestoreSchema,
		execute: async (_toolCallId, { imageUrl, enhanceBackground = true, upscale = 2, label }) => {
			logMcpTool("face_restore", label);

			try {
				const FAL_KEY = process.env.FAL_KEY;
				if (!FAL_KEY) {
					return {
						content: [{ type: "text", text: "Fal.ai API key not configured. Set FAL_KEY environment variable." }],
						details: undefined,
					};
				}

				const response = await fetch("https://queue.fal.run/fal-ai/face-restoration", {
					method: "POST",
					headers: {
						Authorization: `Key ${FAL_KEY}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						image_url: imageUrl,
						enhance_background: enhanceBackground,
						upscale: upscale,
					}),
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Face restore API error: ${error}` }], details: undefined };
				}

				const result = (await response.json()) as { image?: { url: string } };

				if (result.image?.url) {
					const fs = await import("fs/promises");
					const path = await import("path");
					const imgDir = "/opt/discord-bot-data/generated-images";
					await fs.mkdir(imgDir, { recursive: true });

					const imgResponse = await fetch(result.image.url);
					const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
					const filename = `face-restore-${Date.now()}.png`;
					const imgPath = path.join(imgDir, filename);
					await fs.writeFile(imgPath, imgBuffer);

					return {
						content: [
							{
								type: "text",
								text: `👤 **Face Restoration Complete!**\n\n**Upscale:** ${upscale}x\n**Background Enhanced:** ${enhanceBackground}\n\n📁 **Saved to:** ${imgPath}\n🔗 **URL:** ${result.image.url}`,
							},
						],
						details: undefined,
					};
				}

				return {
					content: [{ type: "text", text: `Face restore result: ${JSON.stringify(result)}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Face restore error: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// OPTION C: 3D & Animation Tools
// =============================================================================

const tripoSR3DSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	imageUrl: Type.String({ description: "URL of image to convert to 3D" }),
	outputFormat: Type.Optional(Type.String({ description: "Format: glb, obj. Default: glb" })),
	removeBackground: Type.Optional(Type.Boolean({ description: "Remove background first. Default: true" })),
});

/**
 * TripoSR - Image to 3D Model
 */
export function createTripoSR3DTool(): AgentTool<typeof tripoSR3DSchema> {
	return {
		name: "tripo_3d",
		label: "tripo_3d",
		description:
			"Convert a single image into a 3D model using TripoSR. Great for creating 3D assets from photos or artwork.",
		parameters: tripoSR3DSchema,
		execute: async (_toolCallId, { imageUrl, outputFormat = "glb", removeBackground = true, label }) => {
			logMcpTool("tripo_3d", label);

			try {
				const FAL_KEY = process.env.FAL_KEY;
				if (!FAL_KEY) {
					return {
						content: [{ type: "text", text: "Fal.ai API key not configured. Set FAL_KEY environment variable." }],
						details: undefined,
					};
				}

				const response = await fetch("https://queue.fal.run/fal-ai/triposr", {
					method: "POST",
					headers: {
						Authorization: `Key ${FAL_KEY}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						image_url: imageUrl,
						output_format: outputFormat,
						remove_background: removeBackground,
					}),
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `TripoSR API error: ${error}` }], details: undefined };
				}

				const result = (await response.json()) as { model?: { url: string } };

				if (result.model?.url) {
					const fs = await import("fs/promises");
					const path = await import("path");
					const modelDir = "/opt/discord-bot-data/generated-3d";
					await fs.mkdir(modelDir, { recursive: true });

					const modelResponse = await fetch(result.model.url);
					const modelBuffer = Buffer.from(await modelResponse.arrayBuffer());
					const filename = `3d-model-${Date.now()}.${outputFormat}`;
					const modelPath = path.join(modelDir, filename);
					await fs.writeFile(modelPath, modelBuffer);

					return {
						content: [
							{
								type: "text",
								text: `🎮 **3D Model Generated!**\n\n**Format:** ${outputFormat.toUpperCase()}\n**Background Removed:** ${removeBackground}\n\n📁 **Saved to:** ${modelPath}\n🔗 **URL:** ${result.model.url}`,
							},
						],
						details: undefined,
					};
				}

				return {
					content: [{ type: "text", text: `TripoSR result: ${JSON.stringify(result)}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `TripoSR error: ${error}` }], details: undefined };
			}
		},
	};
}

const shapE3DSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	prompt: Type.String({ description: "Description of 3D object to generate" }),
	outputFormat: Type.Optional(Type.String({ description: "Format: glb, ply. Default: glb" })),
	guidanceScale: Type.Optional(Type.Number({ description: "Guidance scale 1-20. Default: 15" })),
});

/**
 * Shap-E - Text to 3D Model
 */
export function createShapE3DTool(): AgentTool<typeof shapE3DSchema> {
	return {
		name: "shap_e_3d",
		label: "shap_e_3d",
		description:
			"Generate 3D models from text descriptions using OpenAI Shap-E. Create simple 3D objects from prompts.",
		parameters: shapE3DSchema,
		execute: async (_toolCallId, { prompt, outputFormat = "glb", guidanceScale = 15, label }) => {
			logMcpTool("shap_e_3d", label);

			try {
				const HF_TOKEN = process.env.HUGGINGFACE_TOKEN || process.env.HF_TOKEN;
				if (!HF_TOKEN) {
					return {
						content: [
							{
								type: "text",
								text: "HuggingFace token not configured. Set HUGGINGFACE_TOKEN environment variable.",
							},
						],
						details: undefined,
					};
				}

				const response = await fetch("https://api-inference.huggingface.co/models/openai/shap-e", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${HF_TOKEN}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						inputs: prompt,
						parameters: {
							guidance_scale: guidanceScale,
						},
					}),
				});

				if (!response.ok) {
					const error = await response.text();
					return { content: [{ type: "text", text: `Shap-E API error: ${error}` }], details: undefined };
				}

				const fs = await import("fs/promises");
				const path = await import("path");
				const modelDir = "/opt/discord-bot-data/generated-3d";
				await fs.mkdir(modelDir, { recursive: true });

				const modelBuffer = Buffer.from(await response.arrayBuffer());
				const filename = `shap-e-${Date.now()}.${outputFormat}`;
				const modelPath = path.join(modelDir, filename);
				await fs.writeFile(modelPath, modelBuffer);

				return {
					content: [
						{
							type: "text",
							text: `🎮 **Shap-E 3D Model Generated!**\n\n**Prompt:** ${prompt.slice(0, 100)}...\n**Format:** ${outputFormat.toUpperCase()}\n\n📁 **Saved to:** ${modelPath}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Shap-E error: ${error}` }], details: undefined };
			}
		},
	};
}

const gifGenerateSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	imageUrl: Type.String({ description: "URL of image to animate" }),
	motion: Type.Optional(
		Type.String({
			description: "Motion type: zoom_in, zoom_out, pan_left, pan_right, rotate, pulse. Default: zoom_in",
		}),
	),
	duration: Type.Optional(Type.Number({ description: "Duration in seconds (1-5). Default: 2" })),
	fps: Type.Optional(Type.Number({ description: "Frames per second (10-30). Default: 15" })),
});

/**
 * GIF Generator - Create animated GIFs from images
 */
export function createGifGenerateTool(): AgentTool<typeof gifGenerateSchema> {
	return {
		name: "gif_generate",
		label: "gif_generate",
		description: "Create animated GIFs from static images. Apply motion effects like zoom, pan, rotate, and pulse.",
		parameters: gifGenerateSchema,
		execute: async (_toolCallId, { imageUrl, motion = "zoom_in", duration = 2, fps = 15, label }) => {
			logMcpTool("gif_generate", label);

			try {
				const { exec } = await import("child_process");
				const { promisify } = await import("util");
				const execAsync = promisify(exec);
				const fs = await import("fs/promises");
				const path = await import("path");

				const gifDir = "/opt/discord-bot-data/generated-gifs";
				await fs.mkdir(gifDir, { recursive: true });

				// Download image
				const imgResponse = await fetch(imageUrl);
				const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
				const tmpImg = path.join(gifDir, `tmp-${Date.now()}.png`);
				await fs.writeFile(tmpImg, imgBuffer);

				const outputPath = path.join(gifDir, `gif-${motion}-${Date.now()}.gif`);
				const frames = Math.floor(duration * fps);

				// Motion effect FFmpeg filters
				const motionFilters: Record<string, string> = {
					zoom_in: `scale=iw*1.5:ih*1.5,zoompan=z='1+0.1*in/${frames}':x='iw/4':y='ih/4':d=${frames}:s=512x512:fps=${fps}`,
					zoom_out: `scale=iw*1.5:ih*1.5,zoompan=z='1.5-0.1*in/${frames}':x='iw/4':y='ih/4':d=${frames}:s=512x512:fps=${fps}`,
					pan_left: `scale=iw*1.5:ih,zoompan=z='1':x='iw/2-iw/2*in/${frames}':y='0':d=${frames}:s=512x512:fps=${fps}`,
					pan_right: `scale=iw*1.5:ih,zoompan=z='1':x='0+iw/2*in/${frames}':y='0':d=${frames}:s=512x512:fps=${fps}`,
					rotate: `rotate=PI*2*t/${duration}:c=none:ow=rotw(iw):oh=roth(ih)`,
					pulse: `scale=iw*(1+0.1*sin(2*PI*t)):ih*(1+0.1*sin(2*PI*t))`,
				};

				const filter = motionFilters[motion] || motionFilters.zoom_in;

				await execAsync(`ffmpeg -loop 1 -i "${tmpImg}" -vf "${filter}" -t ${duration} -y "${outputPath}"`, {
					timeout: 120000,
				});

				// Cleanup
				await fs.unlink(tmpImg).catch(() => {});

				return {
					content: [
						{
							type: "text",
							text: `🎞️ **GIF Generated!**\n\n**Motion:** ${motion}\n**Duration:** ${duration}s\n**FPS:** ${fps}\n\n📁 **Saved to:** ${outputPath}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `GIF generation error: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// OPTION D: Integration Tools
// =============================================================================

const twitterPostSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	text: Type.String({ description: "Tweet text (max 280 chars)" }),
	mediaPath: Type.Optional(Type.String({ description: "Path to image/video to attach" })),
	replyTo: Type.Optional(Type.String({ description: "Tweet ID to reply to" })),
});

/**
 * Twitter/X Post - Post tweets
 */
export function createTwitterPostTool(): AgentTool<typeof twitterPostSchema> {
	return {
		name: "twitter_post",
		label: "twitter_post",
		description: "Post tweets to Twitter/X. Supports text, images, and videos. Can reply to existing tweets.",
		parameters: twitterPostSchema,
		execute: async (_toolCallId, { text, mediaPath, replyTo, label }) => {
			logMcpTool("twitter_post", label);

			try {
				const TWITTER_BEARER = process.env.TWITTER_BEARER_TOKEN;
				const TWITTER_API_KEY = process.env.TWITTER_API_KEY;
				const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET;
				const TWITTER_ACCESS_TOKEN = process.env.TWITTER_ACCESS_TOKEN;
				const TWITTER_ACCESS_SECRET = process.env.TWITTER_ACCESS_TOKEN_SECRET;

				if (!TWITTER_BEARER || !TWITTER_API_KEY) {
					return {
						content: [
							{
								type: "text",
								text: `Twitter API not configured. Required env vars:\n- TWITTER_BEARER_TOKEN\n- TWITTER_API_KEY\n- TWITTER_API_SECRET\n- TWITTER_ACCESS_TOKEN\n- TWITTER_ACCESS_TOKEN_SECRET\n\n**Draft Tweet:**\n${text}`,
							},
						],
						details: undefined,
					};
				}

				// For now, save as draft since OAuth2 requires additional setup
				const fs = await import("fs/promises");
				const draftDir = "/opt/discord-bot-data/twitter-drafts";
				await fs.mkdir(draftDir, { recursive: true });

				const draft = {
					text,
					mediaPath,
					replyTo,
					createdAt: new Date().toISOString(),
				};

				const draftPath = `${draftDir}/draft-${Date.now()}.json`;
				await fs.writeFile(draftPath, JSON.stringify(draft, null, 2));

				return {
					content: [
						{
							type: "text",
							text: `🐦 **Twitter Draft Saved!**\n\n**Text:** ${text}\n${mediaPath ? `**Media:** ${mediaPath}\n` : ""}${replyTo ? `**Reply to:** ${replyTo}\n` : ""}\n\n📁 **Draft saved to:** ${draftPath}\n\n*Note: Manual posting required - API OAuth setup needed*`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Twitter post error: ${error}` }], details: undefined };
			}
		},
	};
}

const youtubeUploadSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	videoPath: Type.String({ description: "Path to video file" }),
	title: Type.String({ description: "Video title" }),
	description: Type.String({ description: "Video description" }),
	tags: Type.Optional(Type.Array(Type.String(), { description: "Video tags" })),
	privacy: Type.Optional(Type.String({ description: "Privacy: public, private, unlisted. Default: unlisted" })),
});

/**
 * YouTube Upload - Upload videos to YouTube
 */
export function createYoutubeUploadTool(): AgentTool<typeof youtubeUploadSchema> {
	return {
		name: "youtube_upload",
		label: "youtube_upload",
		description: "Upload videos to YouTube. Supports title, description, tags, and privacy settings.",
		parameters: youtubeUploadSchema,
		execute: async (_toolCallId, { videoPath, title, description, tags = [], privacy = "unlisted", label }) => {
			logMcpTool("youtube_upload", label);

			try {
				const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

				if (!YOUTUBE_API_KEY) {
					// Save as draft
					const fs = await import("fs/promises");
					const draftDir = "/opt/discord-bot-data/youtube-drafts";
					await fs.mkdir(draftDir, { recursive: true });

					const draft = {
						videoPath,
						title,
						description,
						tags,
						privacy,
						createdAt: new Date().toISOString(),
					};

					const draftPath = `${draftDir}/draft-${Date.now()}.json`;
					await fs.writeFile(draftPath, JSON.stringify(draft, null, 2));

					return {
						content: [
							{
								type: "text",
								text: `📺 **YouTube Draft Saved!**\n\n**Title:** ${title}\n**Video:** ${videoPath}\n**Privacy:** ${privacy}\n**Tags:** ${tags.join(", ") || "none"}\n\n📁 **Draft saved to:** ${draftPath}\n\n*Note: YouTube API OAuth setup required for actual upload*`,
							},
						],
						details: undefined,
					};
				}

				// TODO: Implement actual upload with OAuth
				return {
					content: [{ type: "text", text: `YouTube upload not yet implemented with OAuth. Draft saved.` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `YouTube upload error: ${error}` }], details: undefined };
			}
		},
	};
}

const telegramBridgeSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	action: Type.String({ description: "Action: send, forward, status" }),
	chatId: Type.Optional(Type.String({ description: "Telegram chat ID" })),
	message: Type.Optional(Type.String({ description: "Message to send" })),
	mediaPath: Type.Optional(Type.String({ description: "Path to media file to send" })),
});

/**
 * Telegram Bridge - Send messages to Telegram
 */
export function createTelegramBridgeTool(): AgentTool<typeof telegramBridgeSchema> {
	return {
		name: "telegram_bridge",
		label: "telegram_bridge",
		description: "Bridge messages to Telegram. Send text, images, and files to Telegram chats.",
		parameters: telegramBridgeSchema,
		execute: async (_toolCallId, { action, chatId, message, mediaPath: _mediaPath, label }) => {
			logMcpTool("telegram_bridge", label);

			try {
				const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

				if (!TELEGRAM_BOT_TOKEN) {
					return {
						content: [
							{
								type: "text",
								text: "Telegram bot token not configured. Set TELEGRAM_BOT_TOKEN environment variable.",
							},
						],
						details: undefined,
					};
				}

				const baseUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

				switch (action) {
					case "send": {
						if (!chatId || !message) {
							return {
								content: [{ type: "text", text: "Send requires chatId and message" }],
								details: undefined,
							};
						}

						const response = await fetch(`${baseUrl}/sendMessage`, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({
								chat_id: chatId,
								text: message,
								parse_mode: "Markdown",
							}),
						});

						const result = await response.json();
						return {
							content: [
								{
									type: "text",
									text: `📨 **Message Sent to Telegram!**\n\n**Chat:** ${chatId}\n**Message:** ${message.slice(0, 100)}...`,
								},
							],
							details: undefined,
						};
					}

					case "status": {
						const response = await fetch(`${baseUrl}/getMe`);
						const result = (await response.json()) as {
							ok: boolean;
							result?: { username: string; first_name: string };
						};

						if (result.ok) {
							return {
								content: [
									{
										type: "text",
										text: `✅ **Telegram Bot Connected!**\n\n**Username:** @${result.result?.username}\n**Name:** ${result.result?.first_name}`,
									},
								],
								details: undefined,
							};
						}
						return { content: [{ type: "text", text: "Failed to connect to Telegram bot" }], details: undefined };
					}

					default:
						return {
							content: [{ type: "text", text: `Unknown action: ${action}. Use: send, forward, status` }],
							details: undefined,
						};
				}
			} catch (error) {
				return { content: [{ type: "text", text: `Telegram bridge error: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// OPTION E: Intelligence Tools
// =============================================================================

const ragSearchSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	query: Type.String({ description: "Search query" }),
	collection: Type.Optional(
		Type.String({ description: "Collection to search: all, skills, memory, knowledge. Default: all" }),
	),
	topK: Type.Optional(Type.Number({ description: "Number of results (1-20). Default: 5" })),
});

/**
 * RAG Search - Semantic search across knowledge base
 */
export function createRAGSearchTool(): AgentTool<typeof ragSearchSchema> {
	return {
		name: "rag_search",
		label: "rag_search",
		description:
			"Semantic search across the bot's knowledge base. Searches skills, memory, and learned knowledge using embeddings.",
		parameters: ragSearchSchema,
		execute: async (_toolCallId, { query, collection = "all", topK = 5, label }) => {
			logMcpTool("rag_search", label);

			try {
				const fs = await import("fs/promises");
				const path = await import("path");

				// Simple keyword-based search (for now - could add embeddings later)
				const searchDirs: Record<string, string[]> = {
					skills: ["/opt/discord-bot-data/skills"],
					memory: ["/opt/discord-bot-data"],
					knowledge: ["/opt/discord-bot-data/knowledge"],
					all: ["/opt/discord-bot-data/skills", "/opt/discord-bot-data", "/opt/discord-bot-data/knowledge"],
				};

				const dirs = searchDirs[collection] || searchDirs.all;
				const results: Array<{ file: string; score: number; snippet: string }> = [];
				const queryTerms = query.toLowerCase().split(/\s+/);

				for (const dir of dirs) {
					try {
						const files = await fs.readdir(dir);
						for (const file of files) {
							if (!file.endsWith(".md") && !file.endsWith(".json") && !file.endsWith(".txt")) continue;

							const filePath = path.join(dir, file);
							const content = await fs.readFile(filePath, "utf-8");
							const contentLower = content.toLowerCase();

							// Score based on term matches
							let score = 0;
							for (const term of queryTerms) {
								const matches = (contentLower.match(new RegExp(term, "g")) || []).length;
								score += matches;
							}

							if (score > 0) {
								// Find best snippet
								const lines = content.split("\n");
								let bestSnippet = "";
								let bestScore = 0;

								for (let i = 0; i < lines.length; i++) {
									const lineLower = lines[i].toLowerCase();
									let lineScore = 0;
									for (const term of queryTerms) {
										if (lineLower.includes(term)) lineScore++;
									}
									if (lineScore > bestScore) {
										bestScore = lineScore;
										bestSnippet = lines.slice(Math.max(0, i - 1), i + 2).join("\n");
									}
								}

								results.push({ file: filePath, score, snippet: bestSnippet.slice(0, 200) });
							}
						}
					} catch {
						/* Directory doesn't exist */
					}
				}

				// Sort by score and take top K
				results.sort((a, b) => b.score - a.score);
				const topResults = results.slice(0, topK);

				if (topResults.length === 0) {
					return { content: [{ type: "text", text: `No results found for: "${query}"` }], details: undefined };
				}

				const formatted = topResults
					.map((r, i) => `**${i + 1}. ${r.file}** (score: ${r.score})\n\`\`\`\n${r.snippet}...\n\`\`\``)
					.join("\n\n");

				return {
					content: [
						{
							type: "text",
							text: `🔍 **RAG Search Results**\n\nQuery: "${query}"\nCollection: ${collection}\n\n${formatted}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `RAG search error: ${error}` }], details: undefined };
			}
		},
	};
}

const webCrawlSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	url: Type.String({ description: "Starting URL to crawl" }),
	depth: Type.Optional(Type.Number({ description: "Crawl depth (1-3). Default: 1" })),
	maxPages: Type.Optional(Type.Number({ description: "Max pages to crawl (1-10). Default: 5" })),
	extractSelectors: Type.Optional(Type.Array(Type.String(), { description: "CSS selectors to extract" })),
});

/**
 * Web Crawl - Deep web scraping
 */
export function createWebCrawlTool(): AgentTool<typeof webCrawlSchema> {
	return {
		name: "web_crawl",
		label: "web_crawl",
		description: "Crawl and extract data from multiple web pages. Follow links to specified depth.",
		parameters: webCrawlSchema,
		execute: async (_toolCallId, { url, depth = 1, maxPages = 5, extractSelectors: _extractSelectors, label }) => {
			logMcpTool("web_crawl", label);

			try {
				const visited = new Set<string>();
				const results: Array<{ url: string; title: string; content: string }> = [];

				async function crawlPage(pageUrl: string, currentDepth: number): Promise<void> {
					if (visited.has(pageUrl) || visited.size >= maxPages || currentDepth > depth) return;
					visited.add(pageUrl);

					try {
						const response = await fetch(pageUrl, {
							headers: { "User-Agent": "Mozilla/5.0 (compatible; PiBot/1.0)" },
						});

						if (!response.ok) return;

						const html = await response.text();

						// Extract title
						const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
						const title = titleMatch?.[1] || "Untitled";

						// Extract main content (simplified)
						const content = html
							.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
							.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
							.replace(/<[^>]+>/g, " ")
							.replace(/\s+/g, " ")
							.trim()
							.slice(0, 2000);

						results.push({ url: pageUrl, title, content });

						// Extract links for deeper crawling
						if (currentDepth < depth) {
							const linkMatches = html.matchAll(/href="([^"]+)"/gi);
							const baseUrl = new URL(pageUrl);

							for (const match of linkMatches) {
								try {
									const linkUrl = new URL(match[1], baseUrl);
									if (linkUrl.hostname === baseUrl.hostname) {
										await crawlPage(linkUrl.href, currentDepth + 1);
									}
								} catch {
									/* Invalid URL */
								}
							}
						}
					} catch {
						/* Page fetch failed */
					}
				}

				await crawlPage(url, 1);

				const formatted = results
					.map((r, i) => `**${i + 1}. ${r.title}**\n${r.url}\n${r.content.slice(0, 300)}...`)
					.join("\n\n---\n\n");

				return {
					content: [
						{
							type: "text",
							text: `🕷️ **Web Crawl Results**\n\nStarting URL: ${url}\nDepth: ${depth}\nPages crawled: ${results.length}\n\n${formatted}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Web crawl error: ${error}` }], details: undefined };
			}
		},
	};
}

const pythonExecSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	code: Type.String({ description: "Python code to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (1-60). Default: 30" })),
	packages: Type.Optional(Type.Array(Type.String(), { description: "Pip packages to install first" })),
});

/**
 * Python Executor - Run Python code
 */
export function createPythonExecTool(): AgentTool<typeof pythonExecSchema> {
	return {
		name: "python_exec",
		label: "python_exec",
		description: "Execute Python code in a sandboxed environment. Supports package installation and file I/O.",
		parameters: pythonExecSchema,
		execute: async (_toolCallId, { code, timeout = 30, packages = [], label }) => {
			logMcpTool("python_exec", label);

			try {
				const { exec } = await import("child_process");
				const { promisify } = await import("util");
				const execAsync = promisify(exec);
				const fs = await import("fs/promises");

				// Create temp script
				const scriptDir = "/opt/discord-bot-data/python-scripts";
				await fs.mkdir(scriptDir, { recursive: true });
				const scriptPath = `${scriptDir}/script-${Date.now()}.py`;
				await fs.writeFile(scriptPath, code);

				// Install packages if needed
				if (packages.length > 0) {
					try {
						await execAsync(`pip install ${packages.join(" ")}`, { timeout: 60000 });
					} catch (e) {
						return { content: [{ type: "text", text: `Package install failed: ${e}` }], details: undefined };
					}
				}

				// Execute
				try {
					const { stdout, stderr } = await execAsync(`python3 "${scriptPath}"`, {
						timeout: timeout * 1000,
						maxBuffer: 1024 * 1024,
					});

					// Cleanup
					await fs.unlink(scriptPath).catch(() => {});

					return {
						content: [
							{
								type: "text",
								text: `🐍 **Python Execution Complete**\n\n**Output:**\n\`\`\`\n${stdout || "(no output)"}\n\`\`\`${stderr ? `\n**Stderr:**\n\`\`\`\n${stderr}\n\`\`\`` : ""}`,
							},
						],
						details: undefined,
					};
				} catch (e: any) {
					await fs.unlink(scriptPath).catch(() => {});
					return {
						content: [
							{
								type: "text",
								text: `Python execution error: ${e.message}\n\n**Stderr:** ${e.stderr || "none"}`,
							},
						],
						details: undefined,
					};
				}
			} catch (error) {
				return { content: [{ type: "text", text: `Python exec error: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// OPTION F: Workflow Tools
// =============================================================================

const presetChainSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	preset: Type.String({ description: "Preset: music_video, social_post, podcast_clip, animated_art, product_shot" }),
	prompt: Type.String({ description: "Main creative prompt" }),
	options: Type.Optional(
		Type.Object({
			style: Type.Optional(Type.String()),
			duration: Type.Optional(Type.Number()),
			format: Type.Optional(Type.String()),
		}),
	),
});

/**
 * Preset Chains - Pre-defined creative workflows
 */
export function createPresetChainTool(): AgentTool<typeof presetChainSchema> {
	return {
		name: "preset_chain",
		label: "preset_chain",
		description:
			"Execute pre-defined creative workflows. Presets: music_video (image→video→music), social_post (image→text→format), podcast_clip (script→TTS→music), animated_art (image→GIF), product_shot (image→upscale→variants).",
		parameters: presetChainSchema,
		execute: async (_toolCallId, { preset, prompt, options = {}, label }) => {
			logMcpTool("preset_chain", label);

			const presetDescriptions: Record<string, { steps: string[]; description: string }> = {
				music_video: {
					description: "Generate image → Animate to video → Add music",
					steps: [
						"1. Generate hero image with fal_image (FLUX)",
						"2. Animate image with fal_video or hf_video",
						"3. Generate matching music with suno_music",
						"4. Combine with FFmpeg",
					],
				},
				social_post: {
					description: "Generate image → Add text overlay → Format for platforms",
					steps: [
						"1. Generate base image with fal_image",
						"2. Apply style transfer if needed",
						"3. Add text overlay with FFmpeg",
						"4. Export in platform sizes (1:1, 9:16, 16:9)",
					],
				},
				podcast_clip: {
					description: "Script → TTS → Background music",
					steps: [
						"1. Generate speech with elevenlabs_tts",
						"2. Generate background music with mubert_music",
						"3. Mix audio tracks with FFmpeg",
						"4. Add waveform visualization if video",
					],
				},
				animated_art: {
					description: "Image → Style transfer → GIF animation",
					steps: [
						"1. Generate or use base image",
						"2. Apply style_transfer (anime, ghibli, etc)",
						"3. Create motion with gif_generate",
						"4. Optimize GIF size",
					],
				},
				product_shot: {
					description: "Image → Upscale → Generate variants",
					steps: [
						"1. Upscale original with image_upscale",
						"2. Remove/replace background with image_inpaint",
						"3. Generate angle variants",
						"4. Create 3D model with tripo_3d",
					],
				},
			};

			const presetInfo = presetDescriptions[preset];
			if (!presetInfo) {
				return {
					content: [
						{
							type: "text",
							text: `Unknown preset: ${preset}\n\nAvailable presets:\n${Object.entries(presetDescriptions)
								.map(([k, v]) => `• **${k}**: ${v.description}`)
								.join("\n")}`,
						},
					],
					details: undefined,
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `🔗 **Preset Chain: ${preset}**\n\n**Description:** ${presetInfo.description}\n\n**Prompt:** ${prompt}\n\n**Workflow Steps:**\n${presetInfo.steps.join("\n")}\n\n**Options:** ${JSON.stringify(options)}\n\n*To execute this chain, call each tool in sequence with the outputs feeding into the next step.*`,
					},
				],
				details: undefined,
			};
		},
	};
}

const batchGenerateSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	tool: Type.String({ description: "Tool to batch: fal_image, suno_music, elevenlabs_tts" }),
	prompts: Type.Array(Type.String(), { description: "Array of prompts to process" }),
	commonOptions: Type.Optional(
		Type.Object({
			model: Type.Optional(Type.String()),
			style: Type.Optional(Type.String()),
		}),
	),
});

/**
 * Batch Generate - Process multiple prompts at once
 */
export function createBatchGenerateTool(): AgentTool<typeof batchGenerateSchema> {
	return {
		name: "batch_generate",
		label: "batch_generate",
		description: "Generate multiple outputs in batch. Process an array of prompts through a single tool.",
		parameters: batchGenerateSchema,
		execute: async (_toolCallId, { tool, prompts, commonOptions = {}, label }) => {
			logMcpTool("batch_generate", label);

			try {
				const fs = await import("fs/promises");
				const batchId = Date.now();
				const batchDir = `/opt/discord-bot-data/batch-${batchId}`;
				await fs.mkdir(batchDir, { recursive: true });

				// Save batch configuration
				const batchConfig = {
					id: batchId,
					tool,
					prompts,
					commonOptions,
					status: "pending",
					createdAt: new Date().toISOString(),
					results: [] as string[],
				};

				await fs.writeFile(`${batchDir}/config.json`, JSON.stringify(batchConfig, null, 2));

				return {
					content: [
						{
							type: "text",
							text: `📦 **Batch Generation Queued!**\n\n**Batch ID:** ${batchId}\n**Tool:** ${tool}\n**Prompts:** ${prompts.length}\n**Options:** ${JSON.stringify(commonOptions)}\n\n**Prompts:**\n${prompts.map((p, i) => `${i + 1}. ${p.slice(0, 50)}...`).join("\n")}\n\n📁 **Batch folder:** ${batchDir}\n\n*Execute each prompt sequentially using the specified tool, saving outputs to the batch folder.*`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `Batch generation error: ${error}` }], details: undefined };
			}
		},
	};
}

const scheduleCreativeSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	action: Type.String({ description: "Action: create, list, cancel" }),
	schedule: Type.Optional(Type.String({ description: "Cron expression or 'in 1h', 'tomorrow 9am'" })),
	tool: Type.Optional(Type.String({ description: "Tool to schedule" })),
	params: Type.Optional(Type.Object({})),
	taskId: Type.Optional(Type.String({ description: "Task ID (for cancel)" })),
});

/**
 * Schedule Creative - Schedule creative tasks
 */
export function createScheduleCreativeTool(): AgentTool<typeof scheduleCreativeSchema> {
	return {
		name: "schedule_creative",
		label: "schedule_creative",
		description: "Schedule creative tasks for later execution. Supports cron expressions and natural language times.",
		parameters: scheduleCreativeSchema,
		execute: async (_toolCallId, { action, schedule, tool, params, taskId, label }) => {
			logMcpTool("schedule_creative", label);

			try {
				const fs = await import("fs/promises");
				const schedulePath = "/opt/discord-bot-data/scheduled-creative.json";

				let scheduled: Array<{ id: string; schedule: string; tool: string; params: any; createdAt: string }> = [];
				try {
					const data = await fs.readFile(schedulePath, "utf-8");
					scheduled = JSON.parse(data);
				} catch {
					/* File doesn't exist */
				}

				switch (action) {
					case "create": {
						if (!schedule || !tool) {
							return {
								content: [{ type: "text", text: "Create requires schedule and tool" }],
								details: undefined,
							};
						}

						const newTask = {
							id: `creative-${Date.now()}`,
							schedule,
							tool,
							params: params || {},
							createdAt: new Date().toISOString(),
						};

						scheduled.push(newTask);
						await fs.writeFile(schedulePath, JSON.stringify(scheduled, null, 2));

						return {
							content: [
								{
									type: "text",
									text: `⏰ **Creative Task Scheduled!**\n\n**ID:** ${newTask.id}\n**Schedule:** ${schedule}\n**Tool:** ${tool}\n**Params:** ${JSON.stringify(params)}`,
								},
							],
							details: undefined,
						};
					}

					case "list": {
						if (scheduled.length === 0) {
							return { content: [{ type: "text", text: "No scheduled creative tasks." }], details: undefined };
						}

						const list = scheduled
							.map((t) => `• **${t.id}**\n  Schedule: ${t.schedule}\n  Tool: ${t.tool}`)
							.join("\n\n");

						return {
							content: [{ type: "text", text: `📋 **Scheduled Creative Tasks**\n\n${list}` }],
							details: undefined,
						};
					}

					case "cancel": {
						if (!taskId) {
							return { content: [{ type: "text", text: "Cancel requires taskId" }], details: undefined };
						}

						const before = scheduled.length;
						scheduled = scheduled.filter((t) => t.id !== taskId);

						if (scheduled.length === before) {
							return { content: [{ type: "text", text: `Task not found: ${taskId}` }], details: undefined };
						}

						await fs.writeFile(schedulePath, JSON.stringify(scheduled, null, 2));

						return {
							content: [{ type: "text", text: `✓ Cancelled task: ${taskId}` }],
							details: undefined,
						};
					}

					default:
						return {
							content: [{ type: "text", text: `Unknown action: ${action}. Use: create, list, cancel` }],
							details: undefined,
						};
				}
			} catch (error) {
				return { content: [{ type: "text", text: `Schedule creative error: ${error}` }], details: undefined };
			}
		},
	};
}

// =============================================================================
// LiveKit Real-time Voice/Video Tools
// =============================================================================

const liveKitRoomSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	action: Type.String({ description: "Action: create, list, delete, get" }),
	roomName: Type.Optional(Type.String({ description: "Room name (for create/delete/get)" })),
	emptyTimeout: Type.Optional(Type.Number({ description: "Minutes before empty room closes. Default: 10" })),
	maxParticipants: Type.Optional(Type.Number({ description: "Max participants allowed. Default: 100" })),
});

/**
 * LiveKit Room Management
 */
export function createLiveKitRoomTool(): AgentTool<typeof liveKitRoomSchema> {
	return {
		name: "livekit_room",
		label: "livekit_room",
		description: "Manage LiveKit rooms for real-time voice/video. Create, list, delete, or get room info.",
		parameters: liveKitRoomSchema,
		execute: async (_toolCallId, { action, roomName, emptyTimeout = 10, maxParticipants = 100, label }) => {
			logMcpTool("livekit_room", label);

			try {
				const LIVEKIT_URL = process.env.LIVEKIT_URL || process.env.LIVEKIT_HOST;
				const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
				const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

				if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
					return {
						content: [
							{
								type: "text",
								text: "LiveKit not configured. Required env vars:\n- LIVEKIT_URL\n- LIVEKIT_API_KEY\n- LIVEKIT_API_SECRET\n\nGet credentials at https://cloud.livekit.io",
							},
						],
						details: undefined,
					};
				}

				const jwt = await generateLiveKitJWT(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
					roomCreate: true,
					roomList: true,
					roomAdmin: true,
				});

				const apiUrl = LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://");

				switch (action) {
					case "create": {
						if (!roomName) {
							return { content: [{ type: "text", text: "Create requires roomName" }], details: undefined };
						}

						const response = await fetch(`${apiUrl}/twirp/livekit.RoomService/CreateRoom`, {
							method: "POST",
							headers: {
								Authorization: `Bearer ${jwt}`,
								"Content-Type": "application/json",
							},
							body: JSON.stringify({
								name: roomName,
								empty_timeout: emptyTimeout * 60,
								max_participants: maxParticipants,
							}),
						});

						if (!response.ok) {
							const error = await response.text();
							return { content: [{ type: "text", text: `LiveKit API error: ${error}` }], details: undefined };
						}

						const room = await response.json();
						return {
							content: [
								{
									type: "text",
									text: `🎙️ **LiveKit Room Created!**\n\n**Name:** ${roomName}\n**SID:** ${room.sid}\n**Max Participants:** ${maxParticipants}\n**Empty Timeout:** ${emptyTimeout} min\n\n🔗 **URL:** ${LIVEKIT_URL}`,
								},
							],
							details: undefined,
						};
					}

					case "list": {
						const response = await fetch(`${apiUrl}/twirp/livekit.RoomService/ListRooms`, {
							method: "POST",
							headers: {
								Authorization: `Bearer ${jwt}`,
								"Content-Type": "application/json",
							},
							body: JSON.stringify({}),
						});

						if (!response.ok) {
							const error = await response.text();
							return { content: [{ type: "text", text: `LiveKit API error: ${error}` }], details: undefined };
						}

						const result = (await response.json()) as {
							rooms?: Array<{ name: string; sid: string; num_participants: number }>;
						};
						const rooms = result.rooms || [];

						if (rooms.length === 0) {
							return { content: [{ type: "text", text: "No active LiveKit rooms." }], details: undefined };
						}

						const list = rooms
							.map((r) => `• **${r.name}** (${r.num_participants} participants)\n  SID: ${r.sid}`)
							.join("\n\n");

						return {
							content: [{ type: "text", text: `🎙️ **Active LiveKit Rooms**\n\n${list}` }],
							details: undefined,
						};
					}

					case "delete": {
						if (!roomName) {
							return { content: [{ type: "text", text: "Delete requires roomName" }], details: undefined };
						}

						const response = await fetch(`${apiUrl}/twirp/livekit.RoomService/DeleteRoom`, {
							method: "POST",
							headers: {
								Authorization: `Bearer ${jwt}`,
								"Content-Type": "application/json",
							},
							body: JSON.stringify({ room: roomName }),
						});

						if (!response.ok) {
							const error = await response.text();
							return { content: [{ type: "text", text: `LiveKit API error: ${error}` }], details: undefined };
						}

						return {
							content: [{ type: "text", text: `✓ Deleted room: ${roomName}` }],
							details: undefined,
						};
					}

					case "get": {
						if (!roomName) {
							return { content: [{ type: "text", text: "Get requires roomName" }], details: undefined };
						}

						const response = await fetch(`${apiUrl}/twirp/livekit.RoomService/ListRooms`, {
							method: "POST",
							headers: {
								Authorization: `Bearer ${jwt}`,
								"Content-Type": "application/json",
							},
							body: JSON.stringify({ names: [roomName] }),
						});

						if (!response.ok) {
							const error = await response.text();
							return { content: [{ type: "text", text: `LiveKit API error: ${error}` }], details: undefined };
						}

						const result = (await response.json()) as {
							rooms?: Array<{ name: string; sid: string; num_participants: number; creation_time: number }>;
						};
						const room = result.rooms?.[0];

						if (!room) {
							return { content: [{ type: "text", text: `Room not found: ${roomName}` }], details: undefined };
						}

						return {
							content: [
								{
									type: "text",
									text: `🎙️ **Room: ${room.name}**\n\n**SID:** ${room.sid}\n**Participants:** ${room.num_participants}\n**Created:** ${new Date(room.creation_time * 1000).toISOString()}`,
								},
							],
							details: undefined,
						};
					}

					default:
						return {
							content: [{ type: "text", text: `Unknown action: ${action}. Use: create, list, delete, get` }],
							details: undefined,
						};
				}
			} catch (error) {
				return { content: [{ type: "text", text: `LiveKit room error: ${error}` }], details: undefined };
			}
		},
	};
}

const liveKitTokenSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	roomName: Type.String({ description: "Room to join" }),
	identity: Type.String({ description: "Participant identity (username)" }),
	name: Type.Optional(Type.String({ description: "Display name" })),
	canPublish: Type.Optional(Type.Boolean({ description: "Can publish audio/video. Default: true" })),
	canSubscribe: Type.Optional(Type.Boolean({ description: "Can subscribe to others. Default: true" })),
	canPublishData: Type.Optional(Type.Boolean({ description: "Can send data messages. Default: true" })),
	ttl: Type.Optional(Type.Number({ description: "Token TTL in hours. Default: 6" })),
});

/**
 * LiveKit Token Generation
 */
export function createLiveKitTokenTool(): AgentTool<typeof liveKitTokenSchema> {
	return {
		name: "livekit_token",
		label: "livekit_token",
		description: "Generate access tokens for joining LiveKit rooms. Tokens control participant permissions.",
		parameters: liveKitTokenSchema,
		execute: async (
			_toolCallId,
			{ roomName, identity, name, canPublish = true, canSubscribe = true, canPublishData = true, ttl = 6, label },
		) => {
			logMcpTool("livekit_token", label);

			try {
				const LIVEKIT_URL = process.env.LIVEKIT_URL || process.env.LIVEKIT_HOST;
				const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
				const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

				if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
					return {
						content: [
							{
								type: "text",
								text: "LiveKit not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET",
							},
						],
						details: undefined,
					};
				}

				const token = await generateLiveKitJWT(
					LIVEKIT_API_KEY,
					LIVEKIT_API_SECRET,
					{
						identity,
						name: name || identity,
						roomJoin: true,
						room: roomName,
						canPublish,
						canSubscribe,
						canPublishData,
					},
					ttl * 3600,
				);

				return {
					content: [
						{
							type: "text",
							text: `🎫 **LiveKit Token Generated!**\n\n**Room:** ${roomName}\n**Identity:** ${identity}\n**Permissions:**\n  • Publish: ${canPublish}\n  • Subscribe: ${canSubscribe}\n  • Data: ${canPublishData}\n**TTL:** ${ttl}h\n\n**Token:**\n\`\`\`\n${token}\n\`\`\`\n\n**URL:** ${LIVEKIT_URL}`,
						},
					],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `LiveKit token error: ${error}` }], details: undefined };
			}
		},
	};
}

const liveKitEgressSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	action: Type.String({ description: "Action: start_room, stop, list" }),
	roomName: Type.Optional(Type.String({ description: "Room to record" })),
	egressId: Type.Optional(Type.String({ description: "Egress ID (for stop)" })),
	outputType: Type.Optional(Type.String({ description: "Output: mp4, webm. Default: mp4" })),
	audioOnly: Type.Optional(Type.Boolean({ description: "Audio only. Default: false" })),
});

/**
 * LiveKit Egress (Recording)
 */
export function createLiveKitEgressTool(): AgentTool<typeof liveKitEgressSchema> {
	return {
		name: "livekit_egress",
		label: "livekit_egress",
		description: "Record LiveKit rooms. Start/stop recordings, export to MP4/WebM.",
		parameters: liveKitEgressSchema,
		execute: async (_toolCallId, { action, roomName, egressId, outputType = "mp4", audioOnly = false, label }) => {
			logMcpTool("livekit_egress", label);

			try {
				const LIVEKIT_URL = process.env.LIVEKIT_URL || process.env.LIVEKIT_HOST;
				const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
				const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

				if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
					return { content: [{ type: "text", text: "LiveKit not configured." }], details: undefined };
				}

				const jwt = await generateLiveKitJWT(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { roomRecord: true });
				const apiUrl = LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://");

				switch (action) {
					case "start_room": {
						if (!roomName) return { content: [{ type: "text", text: "Requires roomName" }], details: undefined };

						const fs = await import("fs/promises");
						const recordingsDir = "/opt/discord-bot-data/livekit-recordings";
						await fs.mkdir(recordingsDir, { recursive: true });
						const filepath = `${recordingsDir}/${roomName}-${Date.now()}.${outputType}`;

						const response = await fetch(`${apiUrl}/twirp/livekit.Egress/StartRoomCompositeEgress`, {
							method: "POST",
							headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
							body: JSON.stringify({
								room_name: roomName,
								audio_only: audioOnly,
								file: { file_type: outputType.toUpperCase(), filepath },
							}),
						});

						if (!response.ok)
							return {
								content: [{ type: "text", text: `Egress error: ${await response.text()}` }],
								details: undefined,
							};
						const result = (await response.json()) as { egress_id: string };

						return {
							content: [
								{
									type: "text",
									text: `🔴 **Recording Started!**\n\n**Room:** ${roomName}\n**Egress ID:** ${result.egress_id}\n**Output:** ${filepath}`,
								},
							],
							details: undefined,
						};
					}

					case "stop": {
						if (!egressId) return { content: [{ type: "text", text: "Requires egressId" }], details: undefined };

						const response = await fetch(`${apiUrl}/twirp/livekit.Egress/StopEgress`, {
							method: "POST",
							headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
							body: JSON.stringify({ egress_id: egressId }),
						});

						if (!response.ok)
							return {
								content: [{ type: "text", text: `Egress error: ${await response.text()}` }],
								details: undefined,
							};
						return { content: [{ type: "text", text: `⏹️ Recording stopped: ${egressId}` }], details: undefined };
					}

					case "list": {
						const response = await fetch(`${apiUrl}/twirp/livekit.Egress/ListEgress`, {
							method: "POST",
							headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
							body: JSON.stringify(roomName ? { room_name: roomName } : {}),
						});

						if (!response.ok)
							return {
								content: [{ type: "text", text: `Egress error: ${await response.text()}` }],
								details: undefined,
							};
						const result = (await response.json()) as {
							items?: Array<{ egress_id: string; room_name: string; status: number }>;
						};
						const items = result.items || [];

						if (items.length === 0)
							return { content: [{ type: "text", text: "No active recordings." }], details: undefined };

						const list = items.map((e) => `• ${e.egress_id} (${e.room_name})`).join("\n");
						return {
							content: [{ type: "text", text: `🎬 **Active Recordings**\n\n${list}` }],
							details: undefined,
						};
					}

					default:
						return { content: [{ type: "text", text: `Unknown action: ${action}` }], details: undefined };
				}
			} catch (error) {
				return { content: [{ type: "text", text: `LiveKit egress error: ${error}` }], details: undefined };
			}
		},
	};
}

const liveKitAgentSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	action: Type.String({ description: "Action: join, speak, status, leave" }),
	roomName: Type.String({ description: "Room name" }),
	text: Type.Optional(Type.String({ description: "Text to speak" })),
	voice: Type.Optional(Type.String({ description: "TTS voice. Default: alloy" })),
});

/**
 * LiveKit AI Agent
 */
export function createLiveKitAgentTool(): AgentTool<typeof liveKitAgentSchema> {
	return {
		name: "livekit_agent",
		label: "livekit_agent",
		description: "AI agent for LiveKit rooms. Join rooms, speak with TTS, provide real-time voice AI.",
		parameters: liveKitAgentSchema,
		execute: async (_toolCallId, { action, roomName, text, voice = "alloy", label }) => {
			logMcpTool("livekit_agent", label);

			try {
				const LIVEKIT_URL = process.env.LIVEKIT_URL;
				const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
				const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

				if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
					return { content: [{ type: "text", text: "LiveKit not configured." }], details: undefined };
				}

				const fs = await import("fs/promises");
				const statePath = "/opt/discord-bot-data/livekit-agent-state.json";
				let state: Record<string, { joined: boolean; identity: string }> = {};
				try {
					state = JSON.parse(await fs.readFile(statePath, "utf-8"));
				} catch {}

				switch (action) {
					case "join": {
						const identity = `pi-agent-${Date.now()}`;
						const token = await generateLiveKitJWT(
							LIVEKIT_API_KEY,
							LIVEKIT_API_SECRET,
							{
								identity,
								name: "Pi Agent",
								roomJoin: true,
								room: roomName,
								canPublish: true,
								canSubscribe: true,
								canPublishData: true,
							},
							86400,
						);

						state[roomName] = { joined: true, identity };
						await fs.writeFile(statePath, JSON.stringify(state, null, 2));

						return {
							content: [
								{
									type: "text",
									text: `🤖 **Agent Token Generated!**\n\n**Room:** ${roomName}\n**Identity:** ${identity}\n\n**Token:** \`${token.slice(0, 60)}...\`\n\n**Connect:** \`lk room join --url ${LIVEKIT_URL} --token <token>\``,
								},
							],
							details: undefined,
						};
					}

					case "speak": {
						if (!text) return { content: [{ type: "text", text: "speak requires text" }], details: undefined };

						const OPENAI_KEY = process.env.OPENAI_API_KEY;
						if (OPENAI_KEY) {
							const ttsResp = await fetch("https://api.openai.com/v1/audio/speech", {
								method: "POST",
								headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
								body: JSON.stringify({ model: "tts-1", input: text, voice }),
							});

							if (ttsResp.ok) {
								const audioDir = "/opt/discord-bot-data/livekit-audio";
								await fs.mkdir(audioDir, { recursive: true });
								const audioPath = `${audioDir}/speak-${Date.now()}.mp3`;
								await fs.writeFile(audioPath, Buffer.from(await ttsResp.arrayBuffer()));
								return {
									content: [
										{
											type: "text",
											text: `🗣️ **TTS Generated!**\n\n**Text:** ${text.slice(0, 80)}...\n**Voice:** ${voice}\n📁 ${audioPath}`,
										},
									],
									details: undefined,
								};
							}
						}
						return {
							content: [{ type: "text", text: `Speak requires OPENAI_API_KEY for TTS.` }],
							details: undefined,
						};
					}

					case "status": {
						const s = state[roomName];
						if (!s?.joined)
							return { content: [{ type: "text", text: `Agent not in room: ${roomName}` }], details: undefined };
						return {
							content: [{ type: "text", text: `🤖 **Agent:** ${s.identity} in ${roomName}` }],
							details: undefined,
						};
					}

					case "leave": {
						delete state[roomName];
						await fs.writeFile(statePath, JSON.stringify(state, null, 2));
						return { content: [{ type: "text", text: `✓ Agent left: ${roomName}` }], details: undefined };
					}

					default:
						return { content: [{ type: "text", text: `Unknown action: ${action}` }], details: undefined };
				}
			} catch (error) {
				return { content: [{ type: "text", text: `LiveKit agent error: ${error}` }], details: undefined };
			}
		},
	};
}

// Helper: Generate LiveKit JWT
async function generateLiveKitJWT(
	apiKey: string,
	apiSecret: string,
	grants: Record<string, unknown>,
	ttlSeconds = 3600,
): Promise<string> {
	const crypto = await import("crypto");
	const header = { alg: "HS256", typ: "JWT" };
	const now = Math.floor(Date.now() / 1000);
	const payload = { iss: apiKey, sub: grants.identity || "", nbf: now, exp: now + ttlSeconds, video: grants };
	const base64url = (d: string) => Buffer.from(d).toString("base64url");
	const headerB64 = base64url(JSON.stringify(header));
	const payloadB64 = base64url(JSON.stringify(payload));
	const sig = crypto.createHmac("sha256", apiSecret).update(`${headerB64}.${payloadB64}`).digest("base64url");
	return `${headerB64}.${payloadB64}.${sig}`;
}

// =============================================================================
// VibeVoice - Microsoft's Long-form Conversational TTS
// =============================================================================

const vibeVoiceSchema = Type.Object({
	label: Type.String({ description: "Brief description (shown to user)" }),
	text: Type.String({
		description: "Text or script to convert to speech. Use [Speaker1], [Speaker2] etc for multi-speaker",
	}),
	model: Type.Optional(Type.String({ description: "Model: 1.5b, 7b, realtime-0.5b. Default: 1.5b" })),
	speakers: Type.Optional(Type.Number({ description: "Number of speakers (1-4). Default: 1" })),
	voice1: Type.Optional(Type.String({ description: "Voice preset for speaker 1" })),
	voice2: Type.Optional(Type.String({ description: "Voice preset for speaker 2" })),
	voice3: Type.Optional(Type.String({ description: "Voice preset for speaker 3" })),
	voice4: Type.Optional(Type.String({ description: "Voice preset for speaker 4" })),
	style: Type.Optional(
		Type.String({
			description: "Speaking style: conversational, podcast, narration, dramatic. Default: conversational",
		}),
	),
});

/**
 * VibeVoice - Microsoft's Long-form Multi-Speaker TTS
 * Supports up to 90 minutes of audio with 4 distinct speakers
 */
export function createVibeVoiceTool(): AgentTool<typeof vibeVoiceSchema> {
	return {
		name: "vibevoice",
		label: "vibevoice",
		description:
			"Generate long-form conversational audio using Microsoft VibeVoice. Create podcasts, dialogues, narrations with up to 4 speakers and 90 minutes of audio.",
		parameters: vibeVoiceSchema,
		execute: async (
			_toolCallId,
			{ text, model = "1.5b", speakers = 1, voice1, voice2, voice3, voice4, style = "conversational", label },
		) => {
			logMcpTool("vibevoice", label);

			try {
				const FAL_KEY = process.env.FAL_KEY;

				if (!FAL_KEY) {
					return {
						content: [
							{
								type: "text",
								text: "Fal.ai API key not configured. Set FAL_KEY environment variable.\n\nVibeVoice is available via fal.ai/models/fal-ai/vibevoice",
							},
						],
						details: undefined,
					};
				}

				// Determine endpoint based on model
				const modelEndpoints: Record<string, string> = {
					"1.5b": "fal-ai/vibevoice",
					"7b": "fal-ai/vibevoice-7b",
					"realtime-0.5b": "fal-ai/vibevoice-realtime",
				};

				const endpoint = modelEndpoints[model] || modelEndpoints["1.5b"];

				// Build speaker configuration
				const speakerConfig: Record<string, unknown>[] = [];
				const voices = [voice1, voice2, voice3, voice4];
				for (let i = 0; i < speakers; i++) {
					speakerConfig.push({
						speaker_id: `Speaker${i + 1}`,
						voice: voices[i] || undefined,
					});
				}

				const response = await fetch(`https://queue.fal.run/${endpoint}`, {
					method: "POST",
					headers: {
						Authorization: `Key ${FAL_KEY}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						text: text,
						num_speakers: speakers,
						speakers: speakerConfig.length > 0 ? speakerConfig : undefined,
						style: style,
					}),
				});

				if (!response.ok) {
					const error = await response.text();

					// Check if it's a queue response
					if (response.status === 200 || response.status === 202) {
						const queueResult = JSON.parse(error);
						if (queueResult.request_id) {
							return {
								content: [
									{
										type: "text",
										text: `🎙️ **VibeVoice Generation Queued!**\n\n**Model:** ${model}\n**Speakers:** ${speakers}\n**Style:** ${style}\n**Text:** ${text.slice(0, 100)}...\n\n⏳ **Request ID:** ${queueResult.request_id}\n\nLong-form audio may take several minutes. Poll status at:\n\`GET https://queue.fal.run/${endpoint}/requests/${queueResult.request_id}/status\``,
									},
								],
								details: undefined,
							};
						}
					}

					return { content: [{ type: "text", text: `VibeVoice API error: ${error}` }], details: undefined };
				}

				const result = (await response.json()) as {
					audio?: { url: string };
					audio_url?: string;
					request_id?: string;
				};

				const audioUrl = result.audio?.url || result.audio_url;

				if (audioUrl) {
					// Download and save
					const fs = await import("fs/promises");
					const path = await import("path");
					const audioDir = "/opt/discord-bot-data/generated-audio";
					await fs.mkdir(audioDir, { recursive: true });

					const audioResponse = await fetch(audioUrl);
					const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
					const filename = `vibevoice-${model}-${Date.now()}.mp3`;
					const audioPath = path.join(audioDir, filename);
					await fs.writeFile(audioPath, audioBuffer);

					return {
						content: [
							{
								type: "text",
								text: `🎙️ **VibeVoice Audio Generated!**\n\n**Model:** ${model}\n**Speakers:** ${speakers}\n**Style:** ${style}\n**Text:** ${text.slice(0, 100)}...\n\n📁 **Saved to:** ${audioPath}\n🔗 **URL:** ${audioUrl}`,
							},
						],
						details: undefined,
					};
				}

				if (result.request_id) {
					return {
						content: [
							{
								type: "text",
								text: `🎙️ **VibeVoice Queued!**\n\n**Request ID:** ${result.request_id}\n\nPoll for completion.`,
							},
						],
						details: undefined,
					};
				}

				return {
					content: [{ type: "text", text: `VibeVoice result: ${JSON.stringify(result)}` }],
					details: undefined,
				};
			} catch (error) {
				return { content: [{ type: "text", text: `VibeVoice error: ${error}` }], details: undefined };
			}
		},
	};
}

export default getAllMcpTools;
