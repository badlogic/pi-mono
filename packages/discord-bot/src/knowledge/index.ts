/**
 * Knowledge Base Module
 * Provides access to quant, superquant, nanoagents, Moon Dev resources, and pi-mono codebase
 */

import { existsSync } from "fs";
import { readdir, readFile, stat } from "fs/promises";
import { extname, join, relative } from "path";

// Knowledge base paths
export const KNOWLEDGE_PATHS = {
	// Quant & Trading
	quant: "/root/quant",
	quantAgents: "/root/quant/agents/core",
	nanoAgent: "/root/.nano_agent",

	// Platform Trading Docs
	tradingDocs: "/opt/platform/trading/data/docs",
	quantSpecs: "/opt/platform/trading/data/docs/quant_specifications",
	moonDevAnalysis: "/opt/platform/trading/data/docs/MOONDEV_COMPREHENSIVE_ARCHITECTURAL_ANALYSIS.md",

	// Moon Dev GitHub Repos (48+ agents)
	moonDevAIAgents: "/opt/platform/trading/data/docs/moon-dev-ai-agents",
	moonDevAgentsSrc: "/opt/platform/trading/data/docs/moon-dev-ai-agents/src/agents",
	moonDevCode: "/opt/platform/trading/data/docs/Moon-Dev-Code",
	harvardAlgoTrading: "/opt/platform/trading/data/docs/Harvard-Algorithmic-Trading-with-AI",

	// Pi-Mono (self)
	piMono: "/opt/pi-mono",
	piMonoBot: "/opt/pi-mono/packages/discord-bot",
	piMonoSrc: "/opt/pi-mono/packages/discord-bot/src",

	// Skills
	skills: "/opt/discord-bot-data/skills",

	// Superquant (if exists)
	superquant: "/root/superquant",
};

export interface KnowledgeFile {
	path: string;
	relativePath: string;
	name: string;
	extension: string;
	size: number;
	content?: string;
}

export interface KnowledgeSearchResult {
	files: KnowledgeFile[];
	totalMatches: number;
	searchedPaths: string[];
}

export class KnowledgeBase {
	private cache: Map<string, { content: string; timestamp: number }> = new Map();
	private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

	/**
	 * Get available knowledge sources
	 */
	getSources(): { name: string; path: string; exists: boolean }[] {
		return Object.entries(KNOWLEDGE_PATHS).map(([name, path]) => ({
			name,
			path,
			exists: existsSync(path),
		}));
	}

	/**
	 * Read a specific file from knowledge base
	 */
	async readFile(filePath: string, maxSize = 100000): Promise<string> {
		// Check cache
		const cached = this.cache.get(filePath);
		if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
			return cached.content;
		}

		try {
			const stats = await stat(filePath);
			if (stats.size > maxSize) {
				// Read only first part of large files
				const content = await readFile(filePath, "utf-8");
				return content.slice(0, maxSize) + `\n\n[Truncated - file is ${stats.size} bytes]`;
			}

			const content = await readFile(filePath, "utf-8");

			// Cache the content
			this.cache.set(filePath, { content, timestamp: Date.now() });

			return content;
		} catch (error) {
			throw new Error(`Failed to read ${filePath}: ${error}`);
		}
	}

	/**
	 * List files in a knowledge directory
	 */
	async listFiles(
		directory: string,
		options: {
			recursive?: boolean;
			extensions?: string[];
			maxFiles?: number;
		} = {},
	): Promise<KnowledgeFile[]> {
		const { recursive = false, extensions, maxFiles = 100 } = options;
		const files: KnowledgeFile[] = [];

		const scanDir = async (dir: string) => {
			if (files.length >= maxFiles) return;

			try {
				const entries = await readdir(dir, { withFileTypes: true });

				for (const entry of entries) {
					if (files.length >= maxFiles) break;

					const fullPath = join(dir, entry.name);

					if (entry.isDirectory() && recursive) {
						await scanDir(fullPath);
					} else if (entry.isFile()) {
						const ext = extname(entry.name);
						if (extensions && !extensions.includes(ext)) continue;

						const stats = await stat(fullPath);
						files.push({
							path: fullPath,
							relativePath: relative(directory, fullPath),
							name: entry.name,
							extension: ext,
							size: stats.size,
						});
					}
				}
			} catch {
				// Skip inaccessible directories
			}
		};

		await scanDir(directory);
		return files;
	}

	/**
	 * Search for content across knowledge base
	 */
	async search(
		query: string,
		options: {
			sources?: (keyof typeof KNOWLEDGE_PATHS)[];
			extensions?: string[];
			maxResults?: number;
		} = {},
	): Promise<KnowledgeSearchResult> {
		const {
			sources = ["quant", "quantAgents", "tradingDocs", "piMonoSrc", "moonDevAgentsSrc", "moonDevAIAgents"],
			extensions = [".py", ".ts", ".js", ".md", ".yaml", ".json"],
			maxResults = 20,
		} = options;

		const searchedPaths: string[] = [];
		const matchingFiles: KnowledgeFile[] = [];
		const queryLower = query.toLowerCase();

		for (const sourceName of sources) {
			const sourcePath = KNOWLEDGE_PATHS[sourceName];
			if (!existsSync(sourcePath)) continue;

			searchedPaths.push(sourcePath);

			const files = await this.listFiles(sourcePath, {
				recursive: true,
				extensions,
				maxFiles: 200,
			});

			for (const file of files) {
				if (matchingFiles.length >= maxResults) break;

				// Check filename match
				if (file.name.toLowerCase().includes(queryLower)) {
					matchingFiles.push(file);
					continue;
				}

				// Check content match for smaller files
				if (file.size < 50000) {
					try {
						const content = await this.readFile(file.path);
						if (content.toLowerCase().includes(queryLower)) {
							file.content = this.extractContext(content, queryLower, 200);
							matchingFiles.push(file);
						}
					} catch {
						// Skip unreadable files
					}
				}
			}
		}

		return {
			files: matchingFiles,
			totalMatches: matchingFiles.length,
			searchedPaths,
		};
	}

	/**
	 * Extract context around a match
	 */
	private extractContext(content: string, query: string, contextLength: number): string {
		const index = content.toLowerCase().indexOf(query.toLowerCase());
		if (index === -1) return "";

		const start = Math.max(0, index - contextLength / 2);
		const end = Math.min(content.length, index + query.length + contextLength / 2);

		let context = content.slice(start, end);
		if (start > 0) context = "..." + context;
		if (end < content.length) context = context + "...";

		return context;
	}

	/**
	 * Get Moon Dev architecture summary
	 */
	async getMoonDevArchitecture(): Promise<string> {
		const moonDevPath = KNOWLEDGE_PATHS.moonDevAnalysis;
		if (!existsSync(moonDevPath)) {
			return "Moon Dev architecture document not found";
		}
		return this.readFile(moonDevPath);
	}

	/**
	 * Get quant agent code
	 */
	async getQuantAgent(agentName: string): Promise<string | null> {
		const agentPath = join(KNOWLEDGE_PATHS.quantAgents, `${agentName}.py`);
		if (!existsSync(agentPath)) {
			// Try without extension
			const files = await this.listFiles(KNOWLEDGE_PATHS.quantAgents, { extensions: [".py"] });
			const match = files.find((f) => f.name.toLowerCase().includes(agentName.toLowerCase()));
			if (match) {
				return this.readFile(match.path);
			}
			return null;
		}
		return this.readFile(agentPath);
	}

	/**
	 * Get pi-mono source file
	 */
	async getPiMonoSource(filePath: string): Promise<string | null> {
		const fullPath = filePath.startsWith("/") ? filePath : join(KNOWLEDGE_PATHS.piMonoSrc, filePath);
		if (!existsSync(fullPath)) return null;
		return this.readFile(fullPath);
	}

	/**
	 * Get quant specifications
	 */
	async getQuantSpecs(category?: string): Promise<{ category: string; files: KnowledgeFile[] }[]> {
		const specsPath = KNOWLEDGE_PATHS.quantSpecs;
		if (!existsSync(specsPath)) return [];

		const categories = await readdir(specsPath, { withFileTypes: true });
		const results: { category: string; files: KnowledgeFile[] }[] = [];

		for (const cat of categories) {
			if (!cat.isDirectory()) continue;
			if (category && !cat.name.includes(category)) continue;

			const files = await this.listFiles(join(specsPath, cat.name), { extensions: [".md", ".yaml", ".json"] });
			results.push({ category: cat.name, files });
		}

		return results;
	}

	/**
	 * Get Moon Dev agent code (48+ agents)
	 */
	async getMoonDevAgent(agentName: string): Promise<string | null> {
		const agentPath = join(KNOWLEDGE_PATHS.moonDevAgentsSrc, `${agentName}.py`);
		if (existsSync(agentPath)) {
			return this.readFile(agentPath);
		}
		// Try with _agent suffix
		const agentPathSuffix = join(KNOWLEDGE_PATHS.moonDevAgentsSrc, `${agentName}_agent.py`);
		if (existsSync(agentPathSuffix)) {
			return this.readFile(agentPathSuffix);
		}
		// Search for partial match
		const files = await this.listFiles(KNOWLEDGE_PATHS.moonDevAgentsSrc, { extensions: [".py"] });
		const match = files.find((f) => f.name.toLowerCase().includes(agentName.toLowerCase()));
		if (match) {
			return this.readFile(match.path);
		}
		return null;
	}

	/**
	 * List all Moon Dev agents
	 */
	async listMoonDevAgents(): Promise<string[]> {
		if (!existsSync(KNOWLEDGE_PATHS.moonDevAgentsSrc)) return [];
		const files = await this.listFiles(KNOWLEDGE_PATHS.moonDevAgentsSrc, { extensions: [".py"] });
		return files.map((f) => f.name.replace(".py", "")).filter((n) => n !== "__init__" && !n.startsWith("_"));
	}

	/**
	 * Clear cache
	 */
	clearCache(): void {
		this.cache.clear();
	}
}

// Singleton instance
let knowledgeInstance: KnowledgeBase | null = null;

export function getKnowledgeBase(): KnowledgeBase {
	if (!knowledgeInstance) {
		knowledgeInstance = new KnowledgeBase();
	}
	return knowledgeInstance;
}
