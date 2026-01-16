import type { Model } from "../types.js";

/**
 * Get GitLab Duo models
 *
 * GitLab Duo uses GitLab's Anthropic proxy to provide access to Claude models.
 * The model IDs map to specific Anthropic models:
 * - duo-chat-opus-4-5 → claude-opus-4-5-20251101
 * - duo-chat-sonnet-4-5 → claude-sonnet-4-5-20250929
 * - duo-chat-haiku-4-5 → claude-haiku-4-5-20251001
 * - duo-chat → claude-sonnet-4-5-20250929 (default)
 *
 * Note: reasoning/thinking is not currently supported by GitLab Duo.
 */
export function getGitLabDuoModels(): Model<"gitlab-duo">[] {
	return [
		{
			id: "duo-chat",
			name: "GitLab Duo Chat (Claude Sonnet 4.5)",
			api: "gitlab-duo",
			baseUrl: "https://cloud.gitlab.com/ai/v1/proxy/anthropic/",
			provider: "gitlab-duo",
			reasoning: false,
			input: ["text"],
			cost: {
				// Costs are handled by GitLab subscription, not per-token
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 200000,
			maxTokens: 4096,
		},
		{
			id: "duo-chat-opus-4-5",
			name: "GitLab Duo Chat (Claude Opus 4.5)",
			api: "gitlab-duo",
			baseUrl: "https://cloud.gitlab.com/ai/v1/proxy/anthropic/",
			provider: "gitlab-duo",
			reasoning: false,
			input: ["text"],
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 200000,
			maxTokens: 4096,
		},
		{
			id: "duo-chat-sonnet-4-5",
			name: "GitLab Duo Chat (Claude Sonnet 4.5)",
			api: "gitlab-duo",
			baseUrl: "https://cloud.gitlab.com/ai/v1/proxy/anthropic/",
			provider: "gitlab-duo",
			reasoning: false,
			input: ["text"],
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 200000,
			maxTokens: 4096,
		},
		{
			id: "duo-chat-haiku-4-5",
			name: "GitLab Duo Chat (Claude Haiku 4.5)",
			api: "gitlab-duo",
			baseUrl: "https://cloud.gitlab.com/ai/v1/proxy/anthropic/",
			provider: "gitlab-duo",
			reasoning: false,
			input: ["text"],
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 200000,
			maxTokens: 4096,
		},
	];
}
