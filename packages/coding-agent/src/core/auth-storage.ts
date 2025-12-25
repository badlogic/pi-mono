/**
 * Credential storage for API keys and OAuth tokens.
 * Handles loading, saving, and refreshing credentials from auth.json.
 */

import { getApiKeyFromEnv, getOAuthApiKey, type OAuthCredentials, type OAuthProvider } from "@mariozechner/pi-ai";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

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

	constructor(private authPath: string) {
		this.reload();
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
	get(provider: string): AuthCredential | null {
		return this.data[provider] ?? null;
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
	 * Check if credentials exist for a provider.
	 */
	has(provider: string): boolean {
		return provider in this.data;
	}

	/**
	 * Get all credentials (for passing to getOAuthApiKey).
	 */
	getAll(): AuthStorageData {
		return { ...this.data };
	}

	/**
	 * Get API key for a provider.
	 * Priority:
	 * 1. API key from auth.json
	 * 2. OAuth token from auth.json (auto-refreshed)
	 * 3. Environment variable (via getApiKeyFromEnv)
	 */
	async getApiKey(provider: string): Promise<string | null> {
		const cred = this.data[provider];

		if (cred?.type === "api_key") {
			return cred.key;
		}

		if (cred?.type === "oauth") {
			// Build OAuthCredentials map (without type discriminator)
			const oauthCreds: Record<string, OAuthCredentials> = {};
			for (const [key, value] of Object.entries(this.data)) {
				if (value.type === "oauth") {
					const { type: _, ...rest } = value;
					oauthCreds[key] = rest;
				}
			}

			try {
				const result = await getOAuthApiKey(provider as OAuthProvider, oauthCreds);
				if (result) {
					// Save refreshed credentials
					this.data[provider] = { type: "oauth", ...result.newCredentials };
					this.save();
					return result.apiKey;
				}
			} catch {
				// Token refresh failed, remove invalid credentials
				this.remove(provider);
			}
		}

		// Fall back to environment variable
		return getApiKeyFromEnv(provider) ?? null;
	}
}
