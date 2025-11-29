import { loginAnthropic, refreshAnthropicToken } from "./anthropic.js";
import { loginOpenAI, type OpenAICredentials, refreshOpenAIToken } from "./openai.js";
import {
	listOAuthProviders as listOAuthProvidersFromStorage,
	loadOAuthCredentials,
	type OAuthCredentials,
	removeOAuthCredentials,
	saveOAuthCredentials,
} from "./storage.js";

// Re-export for convenience
export { listOAuthProvidersFromStorage as listOAuthProviders };
export type { OpenAICredentials } from "./openai.js";

export type SupportedOAuthProvider = "anthropic" | "openai" | "github-copilot";

export type OAuthFlowType = "browser" | "manual";

export interface OAuthProviderInfo {
	id: SupportedOAuthProvider;
	name: string;
	available: boolean;
	flowType: OAuthFlowType;
}

/**
 * Get list of OAuth providers
 */
export function getOAuthProviders(): OAuthProviderInfo[] {
	return [
		{
			id: "anthropic",
			name: "Anthropic (Claude Pro/Max)",
			available: true,
			flowType: "manual",
		},
		{
			id: "openai",
			name: "OpenAI (ChatGPT Plus/Pro)",
			available: true,
			flowType: "browser",
		},
		{
			id: "github-copilot",
			name: "GitHub Copilot (coming soon)",
			available: false,
			flowType: "browser",
		},
	];
}

/**
 * Login with OAuth provider (manual flow - requires code paste)
 */
export async function login(
	provider: SupportedOAuthProvider,
	onAuthUrl: (url: string) => void,
	onPromptCode: () => Promise<string>,
): Promise<void> {
	switch (provider) {
		case "anthropic":
			await loginAnthropic(onAuthUrl, onPromptCode);
			break;
		case "openai":
			throw new Error("OpenAI uses browser flow. Use loginWithBrowser() instead.");
		case "github-copilot":
			throw new Error("GitHub Copilot OAuth is not yet implemented");
		default:
			throw new Error(`Unknown OAuth provider: ${provider}`);
	}
}

/**
 * Login with OAuth provider (browser flow - automatic callback)
 */
export async function loginWithBrowser(
	provider: SupportedOAuthProvider,
	onStatus?: (status: string) => void,
): Promise<void> {
	switch (provider) {
		case "openai":
			await loginOpenAI(onStatus);
			break;
		case "anthropic":
			throw new Error("Anthropic uses manual flow. Use login() instead.");
		case "github-copilot":
			throw new Error("GitHub Copilot OAuth is not yet implemented");
		default:
			throw new Error(`Unknown OAuth provider: ${provider}`);
	}
}

/**
 * Logout from OAuth provider
 */
export async function logout(provider: SupportedOAuthProvider): Promise<void> {
	removeOAuthCredentials(provider);
}

/**
 * Refresh OAuth token for provider
 */
export async function refreshToken(provider: SupportedOAuthProvider): Promise<string> {
	const credentials = loadOAuthCredentials(provider);
	if (!credentials) {
		throw new Error(`No OAuth credentials found for ${provider}`);
	}

	let newCredentials: OAuthCredentials;

	switch (provider) {
		case "anthropic":
			newCredentials = await refreshAnthropicToken(credentials.refresh);
			break;
		case "openai":
			newCredentials = await refreshOpenAIToken(credentials.refresh);
			break;
		case "github-copilot":
			throw new Error("GitHub Copilot OAuth is not yet implemented");
		default:
			throw new Error(`Unknown OAuth provider: ${provider}`);
	}

	// Save new credentials
	saveOAuthCredentials(provider, newCredentials);

	return newCredentials.access;
}

/**
 * Get OAuth token for provider (auto-refreshes if expired)
 */
export async function getOAuthToken(provider: SupportedOAuthProvider): Promise<string | null> {
	const credentials = loadOAuthCredentials(provider);
	if (!credentials) {
		return null;
	}

	// Check if token is expired (with 5 min buffer already applied)
	if (Date.now() >= credentials.expires) {
		// Token expired - refresh it
		try {
			return await refreshToken(provider);
		} catch (error) {
			console.error(`Failed to refresh OAuth token for ${provider}:`, error);
			// Remove invalid credentials
			removeOAuthCredentials(provider);
			return null;
		}
	}

	return credentials.access;
}

/**
 * Get OpenAI OAuth credentials including account ID (auto-refreshes if expired)
 */
export async function getOpenAIOAuthCredentials(): Promise<OpenAICredentials | null> {
	const credentials = loadOAuthCredentials("openai") as OpenAICredentials | null;
	if (!credentials) {
		return null;
	}

	// Check if token is expired (with 5 min buffer already applied)
	if (Date.now() >= credentials.expires) {
		// Token expired - refresh it
		try {
			await refreshToken("openai");
			// Reload updated credentials
			return loadOAuthCredentials("openai") as OpenAICredentials | null;
		} catch (error) {
			console.error("Failed to refresh OpenAI OAuth token:", error);
			// Remove invalid credentials
			removeOAuthCredentials("openai");
			return null;
		}
	}

	return credentials;
}
