/**
 * Credential storage for API keys and OAuth tokens.
 * Handles loading, saving, and refreshing credentials from auth.json.
 *
 * Uses file locking to prevent race conditions when multiple pi instances
 * try to refresh tokens simultaneously.
 */

import {
	getEnvApiKey,
	getOAuthApiKey,
	loginAnthropic,
	loginAntigravity,
	loginGeminiCli,
	loginGitHubCopilot,
	loginOpenAICodex,
	type OAuthCredentials,
	type OAuthProvider,
} from "@mariozechner/pi-ai";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import lockfile from "proper-lockfile";

export type ApiKeyCredential = {
	type: "api_key";
	key: string;
};

export type OAuthCredential = {
	type: "oauth";
} & OAuthCredentials;

export type AuthCredential = ApiKeyCredential | OAuthCredential;

export type AuthStorageData = Record<string, AuthCredential>;

/**
 * Credential storage backed by a JSON file.
 */
export class AuthStorage {
	private data: AuthStorageData = {};
	private runtimeOverrides: Map<string, string> = new Map();
	private fallbackResolver?: (provider: string) => string | undefined;

	constructor(private authPath: string) {
		this.reload();
	}

	/**
	 * Set a runtime API key override (not persisted to disk).
	 * Used for CLI --api-key flag.
	 */
	setRuntimeApiKey(provider: string, apiKey: string): void {
		this.runtimeOverrides.set(provider, apiKey);
	}

	/**
	 * Remove a runtime API key override.
	 */
	removeRuntimeApiKey(provider: string): void {
		this.runtimeOverrides.delete(provider);
	}

	/**
	 * Set a fallback resolver for API keys not found in auth.json or env vars.
	 * Used for custom provider keys from models.json.
	 */
	setFallbackResolver(resolver: (provider: string) => string | undefined): void {
		this.fallbackResolver = resolver;
	}

	/**
	 * Reload credentials from disk.
	 */
	reload(): void {
		if (!existsSync(this.authPath)) {
			this.data = {};
			return;
		}
		try {
			this.data = JSON.parse(readFileSync(this.authPath, "utf-8"));
		} catch {
			this.data = {};
		}
	}

	/**
	 * Save credentials to disk.
	 */
	private save(): void {
		const dir = dirname(this.authPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
		writeFileSync(this.authPath, JSON.stringify(this.data, null, 2), "utf-8");
		chmodSync(this.authPath, 0o600);
	}

	/**
	 * Get credential for a provider.
	 */
	get(provider: string): AuthCredential | undefined {
		return this.data[provider] ?? undefined;
	}

	/**
	 * Set credential for a provider.
	 */
	set(provider: string, credential: AuthCredential): void {
		this.data[provider] = credential;
		this.save();
	}

	/**
	 * Remove credential for a provider.
	 */
	remove(provider: string): void {
		delete this.data[provider];
		this.save();
	}

	/**
	 * List all providers with credentials.
	 */
	list(): string[] {
		return Object.keys(this.data);
	}

	/**
	 * Check if credentials exist for a provider in auth.json.
	 */
	has(provider: string): boolean {
		return provider in this.data;
	}

	/**
	 * Check if any form of auth is configured for a provider.
	 * Unlike getApiKey(), this doesn't refresh OAuth tokens.
	 */
	hasAuth(provider: string): boolean {
		if (this.runtimeOverrides.has(provider)) return true;
		if (this.data[provider]) return true;
		if (getEnvApiKey(provider)) return true;
		if (this.fallbackResolver?.(provider)) return true;
		return false;
	}

	/**
	 * Get all credentials (for passing to getOAuthApiKey).
	 */
	getAll(): AuthStorageData {
		return { ...this.data };
	}

	/**
	 * Login to an OAuth provider.
	 */
	async login(
		provider: OAuthProvider,
		callbacks: {
			onAuth: (info: { url: string; instructions?: string }) => void;
			onPrompt: (prompt: { message: string; placeholder?: string }) => Promise<string>;
			onProgress?: (message: string) => void;
			/** For providers with local callback servers (e.g., openai-codex), races with browser callback */
			onManualCodeInput?: () => Promise<string>;
		},
	): Promise<void> {
		let credentials: OAuthCredentials;

		switch (provider) {
			case "anthropic":
				credentials = await loginAnthropic(
					(url) => callbacks.onAuth({ url }),
					() => callbacks.onPrompt({ message: "Paste the authorization code:" }),
				);
				break;
			case "github-copilot":
				credentials = await loginGitHubCopilot({
					onAuth: (url, instructions) => callbacks.onAuth({ url, instructions }),
					onPrompt: callbacks.onPrompt,
					onProgress: callbacks.onProgress,
				});
				break;
			case "google-gemini-cli":
				credentials = await loginGeminiCli(callbacks.onAuth, callbacks.onProgress);
				break;
			case "google-antigravity":
				credentials = await loginAntigravity(callbacks.onAuth, callbacks.onProgress);
				break;
			case "openai-codex":
				credentials = await loginOpenAICodex({
					onAuth: callbacks.onAuth,
					onPrompt: callbacks.onPrompt,
					onProgress: callbacks.onProgress,
					onManualCodeInput: callbacks.onManualCodeInput,
				});
				break;
			default:
				throw new Error(`Unknown OAuth provider: ${provider}`);
		}

		this.set(provider, { type: "oauth", ...credentials });
	}

	/**
	 * Logout from a provider.
	 */
	logout(provider: string): void {
		this.remove(provider);
	}

	/**
	 * Refresh OAuth token with file locking to prevent race conditions.
	 * Multiple pi instances may try to refresh simultaneously when tokens expire.
	 * This ensures only one instance refreshes while others wait and use the result.
	 */
	private async refreshOAuthTokenWithLock(
		provider: OAuthProvider,
	): Promise<{ apiKey: string; newCredentials: OAuthCredentials } | null> {
		// Ensure auth file exists for locking
		if (!existsSync(this.authPath)) {
			const dir = dirname(this.authPath);
			if (!existsSync(dir)) {
				mkdirSync(dir, { recursive: true, mode: 0o700 });
			}
			writeFileSync(this.authPath, "{}", "utf-8");
			chmodSync(this.authPath, 0o600);
		}

		let release: (() => Promise<void>) | undefined;

		try {
			// Acquire exclusive lock with retry and timeout
			// Use generous retry window to handle slow token endpoints
			release = await lockfile.lock(this.authPath, {
				retries: {
					retries: 10,
					factor: 2,
					minTimeout: 100,
					maxTimeout: 10000,
					randomize: true,
				},
				stale: 30000, // Consider lock stale after 30 seconds
			});

			// Re-read file after acquiring lock - another instance may have refreshed
			this.reload();

			const cred = this.data[provider];
			if (cred?.type !== "oauth") {
				return null;
			}

			// Check if token is still expired after re-reading
			// (another instance may have already refreshed it)
			if (Date.now() < cred.expires) {
				// Token is now valid - another instance refreshed it
				const needsProjectId = provider === "google-gemini-cli" || provider === "google-antigravity";
				const apiKey = needsProjectId
					? JSON.stringify({ token: cred.access, projectId: cred.projectId })
					: cred.access;
				return { apiKey, newCredentials: cred };
			}

			// Token still expired, we need to refresh
			const oauthCreds: Record<string, OAuthCredentials> = {};
			for (const [key, value] of Object.entries(this.data)) {
				if (value.type === "oauth") {
					oauthCreds[key] = value;
				}
			}

			const result = await getOAuthApiKey(provider, oauthCreds);
			if (result) {
				this.data[provider] = { type: "oauth", ...result.newCredentials };
				this.save();
				return result;
			}

			return null;
		} finally {
			// Always release the lock
			if (release) {
				try {
					await release();
				} catch {
					// Ignore unlock errors (lock may have been compromised)
				}
			}
		}
	}

	/**
	 * Get API key for a provider.
	 * Priority:
	 * 1. Runtime override (CLI --api-key)
	 * 2. API key from auth.json
	 * 3. OAuth token from auth.json (auto-refreshed with locking)
	 * 4. Environment variable
	 * 5. Fallback resolver (models.json custom providers)
	 */
	async getApiKey(provider: string): Promise<string | undefined> {
		// Runtime override takes highest priority
		const runtimeKey = this.runtimeOverrides.get(provider);
		if (runtimeKey) {
			return runtimeKey;
		}

		const cred = this.data[provider];

		if (cred?.type === "api_key") {
			return cred.key;
		}

		if (cred?.type === "oauth") {
			// Check if token needs refresh
			const needsRefresh = Date.now() >= cred.expires;

			if (needsRefresh) {
				// Use locked refresh to prevent race conditions
				try {
					const result = await this.refreshOAuthTokenWithLock(provider as OAuthProvider);
					if (result) {
						return result.apiKey;
					}
				} catch (err) {
					// Refresh failed - re-read file to check if another instance succeeded
					this.reload();
					const updatedCred = this.data[provider];

					if (updatedCred?.type === "oauth" && Date.now() < updatedCred.expires) {
						// Another instance refreshed successfully, use those credentials
						const needsProjectId = provider === "google-gemini-cli" || provider === "google-antigravity";
						return needsProjectId
							? JSON.stringify({ token: updatedCred.access, projectId: updatedCred.projectId })
							: updatedCred.access;
					}

					// Refresh truly failed - DO NOT remove credentials
					// User can retry or re-authenticate manually
					const errorMessage = err instanceof Error ? err.message : String(err);
					throw new Error(
						`OAuth token refresh failed for ${provider}: ${errorMessage}. ` +
							`Please try again or re-authenticate with /login.`,
					);
				}
			} else {
				// Token not expired, use current access token
				const needsProjectId = provider === "google-gemini-cli" || provider === "google-antigravity";
				return needsProjectId ? JSON.stringify({ token: cred.access, projectId: cred.projectId }) : cred.access;
			}
		}

		// Fall back to environment variable
		const envKey = getEnvApiKey(provider);
		if (envKey) return envKey;

		// Fall back to custom resolver (e.g., models.json custom providers)
		return this.fallbackResolver?.(provider) ?? undefined;
	}
}
