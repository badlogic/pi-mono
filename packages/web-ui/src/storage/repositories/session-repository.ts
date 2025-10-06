import type { AgentState } from "../../agent/agent.js";
import type { AppMessage } from "../../components/Messages.js";
import type { SessionData, SessionMetadata, SessionStorageBackend } from "../types.js";

/**
 * Repository for managing chat sessions.
 * Handles business logic: title generation, metadata extraction, etc.
 */
export class SessionRepository {
	constructor(public backend: SessionStorageBackend) {}

	/**
	 * Generate a title from the first user message.
	 * Takes first sentence or 50 chars, whichever is shorter.
	 */
	private generateTitle(messages: AppMessage[]): string {
		const firstUserMsg = messages.find((m) => m.role === "user");
		if (!firstUserMsg) return "New Session";

		// Extract text content
		const content = firstUserMsg.content;
		let text = "";

		if (typeof content === "string") {
			text = content;
		} else {
			const textBlocks = content.filter((c) => c.type === "text");
			text = textBlocks.map((c) => (c as any).text || "").join(" ");
		}

		text = text.trim();
		if (!text) return "New Session";

		// Find first sentence (up to 50 chars)
		const sentenceEnd = text.search(/[.!?]/);
		if (sentenceEnd > 0 && sentenceEnd <= 50) {
			return text.substring(0, sentenceEnd + 1);
		}

		// Otherwise take first 50 chars
		return text.length <= 50 ? text : text.substring(0, 47) + "...";
	}

	/**
	 * Extract preview text from messages.
	 * Goes through all messages in sequence, extracts text content only
	 * (excludes tool calls, tool results, thinking blocks), until 2KB.
	 */
	private extractPreview(messages: AppMessage[]): string {
		let preview = "";
		const MAX_SIZE = 2048; // 2KB total

		for (const msg of messages) {
			// Skip tool result messages entirely
			if (msg.role === "toolResult") {
				continue;
			}

			// UserMessage can have string or array content
			if (msg.role === "user") {
				const content = msg.content;

				if (typeof content === "string") {
					// Simple string content
					if (preview.length + content.length <= MAX_SIZE) {
						preview += content + " ";
					} else {
						preview += content.substring(0, MAX_SIZE - preview.length);
						return preview.trim();
					}
				} else {
					// Array of TextContent | ImageContent
					const textBlocks = content.filter((c) => c.type === "text");
					for (const block of textBlocks) {
						const text = (block as any).text || "";
						if (preview.length + text.length <= MAX_SIZE) {
							preview += text + " ";
						} else {
							preview += text.substring(0, MAX_SIZE - preview.length);
							return preview.trim();
						}
					}
				}
			}

			// AssistantMessage has array of TextContent | ThinkingContent | ToolCall
			if (msg.role === "assistant") {
				// Filter to only TextContent (skip ThinkingContent and ToolCall)
				const textBlocks = msg.content.filter((c) => c.type === "text");
				for (const block of textBlocks) {
					const text = (block as any).text || "";
					if (preview.length + text.length <= MAX_SIZE) {
						preview += text + " ";
					} else {
						preview += text.substring(0, MAX_SIZE - preview.length);
						return preview.trim();
					}
				}
			}

			// Stop if we've hit the limit
			if (preview.length >= MAX_SIZE) {
				break;
			}
		}

		return preview.trim();
	}

	/**
	 * Calculate total usage across all messages.
	 */
	private calculateTotals(messages: AppMessage[]): {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite: number;
			total: number;
		};
	} {
		let input = 0;
		let output = 0;
		let cacheRead = 0;
		let cacheWrite = 0;
		const cost = {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		};

		for (const msg of messages) {
			if (msg.role === "assistant" && (msg as any).usage) {
				const usage = (msg as any).usage;
				input += usage.input || 0;
				output += usage.output || 0;
				cacheRead += usage.cacheRead || 0;
				cacheWrite += usage.cacheWrite || 0;
				if (usage.cost) {
					cost.input += usage.cost.input || 0;
					cost.output += usage.cost.output || 0;
					cost.cacheRead += usage.cost.cacheRead || 0;
					cost.cacheWrite += usage.cost.cacheWrite || 0;
					cost.total += usage.cost.total || 0;
				}
			}
		}

		return { input, output, cacheRead, cacheWrite, cost };
	}

	/**
	 * Extract metadata from session data.
	 */
	private extractMetadata(data: SessionData): SessionMetadata {
		const usage = this.calculateTotals(data.messages);
		const preview = this.extractPreview(data.messages);

		return {
			id: data.id,
			title: data.title,
			createdAt: data.createdAt,
			lastModified: data.lastModified,
			messageCount: data.messages.length,
			usage,
			modelId: data.model?.id || null,
			thinkingLevel: data.thinkingLevel,
			preview,
		};
	}

	/**
	 * Save session state.
	 * Extracts metadata and saves both atomically.
	 */
	async saveSession(
		sessionId: string,
		state: AgentState,
		existingCreatedAt?: string,
		existingTitle?: string,
	): Promise<void> {
		const now = new Date().toISOString();

		const data: SessionData = {
			id: sessionId,
			title: existingTitle || this.generateTitle(state.messages),
			model: state.model,
			thinkingLevel: state.thinkingLevel,
			messages: state.messages,
			createdAt: existingCreatedAt || now,
			lastModified: now,
		};

		const metadata = this.extractMetadata(data);

		await this.backend.saveSession(data, metadata);
	}

	/**
	 * Load full session data by ID.
	 */
	async loadSession(id: string): Promise<SessionData | null> {
		return this.backend.getSession(id);
	}

	/**
	 * Get all session metadata, sorted by lastModified descending.
	 */
	async listSessions(): Promise<SessionMetadata[]> {
		const allMetadata = await this.backend.getAllMetadata();
		// Sort by lastModified descending (most recent first)
		return allMetadata.sort((a, b) => {
			return new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime();
		});
	}

	/**
	 * Get the ID of the most recently modified session.
	 * Returns undefined if no sessions exist.
	 */
	async getLatestSessionId(): Promise<string | undefined> {
		const sessions = await this.listSessions();
		return sessions.length > 0 ? sessions[0].id : undefined;
	}

	/**
	 * Search sessions by keyword.
	 * Searches in: title and preview (first 2KB of conversation text)
	 * Returns results sorted by relevance (uses simple substring search for now).
	 */
	async searchSessions(query: string): Promise<SessionMetadata[]> {
		if (!query.trim()) {
			return this.listSessions();
		}

		const allMetadata = await this.backend.getAllMetadata();

		// Simple substring search for now (can upgrade to Fuse.js later)
		const lowerQuery = query.toLowerCase();
		const matches = allMetadata.filter((meta) => {
			return meta.title.toLowerCase().includes(lowerQuery) || meta.preview.toLowerCase().includes(lowerQuery);
		});

		// Sort by lastModified descending
		return matches.sort((a, b) => {
			return new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime();
		});
	}

	/**
	 * Get session metadata by ID.
	 */
	async getMetadata(id: string): Promise<SessionMetadata | null> {
		return this.backend.getMetadata(id);
	}

	/**
	 * Delete a session.
	 */
	async deleteSession(id: string): Promise<void> {
		await this.backend.deleteSession(id);
	}

	/**
	 * Update session title.
	 */
	async updateTitle(id: string, title: string): Promise<void> {
		await this.backend.updateTitle(id, title);
	}

	/**
	 * Get storage quota information.
	 */
	async getQuotaInfo(): Promise<{ usage: number; quota: number; percent: number }> {
		return this.backend.getQuotaInfo();
	}

	/**
	 * Request persistent storage.
	 */
	async requestPersistence(): Promise<boolean> {
		return this.backend.requestPersistence();
	}
}
