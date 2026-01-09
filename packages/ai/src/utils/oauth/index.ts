/**
 * OAuth credential management for AI providers.
 *
 * This module handles login, token refresh, and credential storage
 * for OAuth-based providers:
 * - Anthropic (Claude Pro/Max)
 * - GitHub Copilot
 * - Google Cloud Code Assist (Gemini CLI)
 * - Antigravity (Gemini 3, Claude, GPT-OSS via Google Cloud)
 */

// GitHub Copilot
export {
	getGitHubCopilotBaseUrl,
	loginGitHubCopilot,
	normalizeDomain,
	refreshGitHubCopilotToken,
} from "./github-copilot.js";
// Google Antigravity
export {
	loginAntigravity,
	refreshAntigravityToken,
} from "./google-antigravity.js";
// Google Gemini CLI
export {
	loginGeminiCli,
	refreshGoogleCloudToken,
} from "./google-gemini-cli.js";
// OpenAI Codex (ChatGPT OAuth)
export {
	loginOpenAICodex,
	refreshOpenAICodexToken,
} from "./openai-codex.js";

export * from "./types.js";

// ============================================================================
// High-level API
// ============================================================================

import { refreshGitHubCopilotToken } from "./github-copilot.js";
import { refreshAntigravityToken } from "./google-antigravity.js";
import { refreshGoogleCloudToken } from "./google-gemini-cli.js";
import { refreshOpenAICodexToken } from "./openai-codex.js";
import type { OAuthCredentials, OAuthProvider, OAuthProviderInfo } from "./types.js";

/**
 * Refresh token for any OAuth provider.
 * Saves the new credentials and returns the new access token.
 */
export async function refreshOAuthToken(
	provider: OAuthProvider,
	credentials: OAuthCredentials,
): Promise<OAuthCredentials> {
	if (!credentials) {
		throw new Error(`No OAuth credentials found for ${provider}`);
	}

	let newCredentials: OAuthCredentials;

	switch (provider) {
		case "github-copilot":
			newCredentials = await refreshGitHubCopilotToken(credentials.refresh, credentials.enterpriseUrl);
			break;
		case "google-gemini-cli":
			if (!credentials.projectId) {
				throw new Error("Google Cloud credentials missing projectId");
			}
			newCredentials = await refreshGoogleCloudToken(credentials.refresh, credentials.projectId);
			break;
		case "google-antigravity":
			if (!credentials.projectId) {
				throw new Error("Antigravity credentials missing projectId");
			}
			newCredentials = await refreshAntigravityToken(credentials.refresh, credentials.projectId);
			break;
		case "openai-codex":
			newCredentials = await refreshOpenAICodexToken(credentials.refresh);
			break;
		default:
			throw new Error(`Unknown OAuth provider: ${provider}`);
	}

	return newCredentials;
}

/**
 * Get API key for a provider from OAuth credentials.
 * Automatically refreshes expired tokens.
 *
 * For google-gemini-cli and antigravity, returns JSON-encoded { token, projectId }
 *
 * @returns API key string, or null if no credentials
 * @throws Error if refresh fails
 */
export async function getOAuthApiKey(
	provider: OAuthProvider,
	credentials: Record<string, OAuthCredentials>,
): Promise<{ newCredentials: OAuthCredentials; apiKey: string } | null> {
	let creds = credentials[provider];
	if (!creds) {
		return null;
	}

	// Refresh if expired
	if (Date.now() >= creds.expires) {
		try {
			creds = await refreshOAuthToken(provider, creds);
		} catch (_error) {
			throw new Error(`Failed to refresh OAuth token for ${provider}`);
		}
	}

	// For providers that need projectId, return JSON
	const needsProjectId = provider === "google-gemini-cli" || provider === "google-antigravity";
	const apiKey = needsProjectId ? JSON.stringify({ token: creds.access, projectId: creds.projectId }) : creds.access;
	return { newCredentials: creds, apiKey };
}

/**
 * Get list of OAuth providers
 */
export function getOAuthProviders(): OAuthProviderInfo[] {
	return [
		{
			id: "openai-codex",
			name: "ChatGPT Plus/Pro (Codex Subscription)",
			available: true,
		},
		{
			id: "github-copilot",
			name: "GitHub Copilot",
			available: true,
		},
		{
			id: "google-gemini-cli",
			name: "Google Cloud Code Assist (Gemini CLI)",
			available: true,
		},
		{
			id: "google-antigravity",
			name: "Antigravity (Gemini 3, Claude, GPT-OSS)",
			available: true,
		},
	];
}
