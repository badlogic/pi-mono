/**
 * Credential storage for API keys and OAuth tokens.
 * Handles loading, saving, and refreshing credentials from auth.json.
 */

import {
	getEnvApiKey,
	getOAuthApiKey,
	loginAnthropic,
	loginAntigravity,
	loginGeminiCli,
	loginGitHubCopilot,
	loginOpenAI,
	type OAuthCredentials,
	type OAuthProvider,
	refreshOAuthToken,
} from "@mariozechner/pi-ai";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname } from "path";

const OAUTH_PROVIDERS: OAuthProvider[] = [
	"anthropic",
	"github-copilot",
	"google-gemini-cli",
	"google-antigravity",
	"openai",
];

function isOAuthProvider(provider: string): provider is OAuthProvider {
	return OAUTH_PROVIDERS.includes(provider as OAuthProvider);
}

function isAnthropicOAuthToken(token: string): boolean {
	return token.startsWith("sk-ant-oat");
}

export type ApiKeyCredential = {
	type: "api_key";
	key: string;
	/**
	 * Optional token type hint (mainly for Anthropic OAuth tokens stored as api_key).
	 * When set to "oauth", Anthropic OAuth handling is enabled without relying on prefixes.
	 */
	tokenType?: "api_key" | "oauth";
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
	private lastMtimeMs: number | undefined;

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
			this.lastMtimeMs = undefined;
			return;
		}
		try {
			this.data = JSON.parse(readFileSync(this.authPath, "utf-8"));
			this.lastMtimeMs = statSync(this.authPath).mtimeMs;
		} catch {
			this.data = {};
			this.lastMtimeMs = undefined;
		}
	}

	/**
	 * Reload credentials if auth.json has changed on disk.
	 */
	private reloadIfChanged(): void {
		if (!existsSync(this.authPath)) {
			if (this.lastMtimeMs !== undefined) {
				this.data = {};
				this.lastMtimeMs = undefined;
			}
			return;
		}

		try {
			const mtimeMs = statSync(this.authPath).mtimeMs;
			if (this.lastMtimeMs === undefined || mtimeMs !== this.lastMtimeMs) {
				this.reload();
			}
		} catch {
			// Ignore stat/read errors; keep in-memory data
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
		try {
			this.lastMtimeMs = statSync(this.authPath).mtimeMs;
		} catch {
			this.lastMtimeMs = undefined;
		}
	}

	/**
	 * Get credential for a provider.
	 */
	get(provider: string): AuthCredential | undefined {
		this.reloadIfChanged();
		return this.data[provider] ?? undefined;
	}

	/**
	 * Set credential for a provider.
	 */
	set(provider: string, credential: AuthCredential): void {
		this.reloadIfChanged();
		let normalized = credential;
		if (credential.type === "api_key" && provider === "anthropic") {
			const tokenType = credential.tokenType ?? (isAnthropicOAuthToken(credential.key) ? "oauth" : "api_key");
			normalized = { ...credential, tokenType };
		}
		this.data[provider] = normalized;
		this.save();
	}

	/**
	 * Remove credential for a provider.
	 */
	remove(provider: string): void {
		this.reloadIfChanged();
		delete this.data[provider];
		this.save();
	}

	/**
	 * List all providers with credentials.
	 */
	list(): string[] {
		this.reloadIfChanged();
		return Object.keys(this.data);
	}

	/**
	 * Check if credentials exist for a provider in auth.json.
	 */
	has(provider: string): boolean {
		this.reloadIfChanged();
		return provider in this.data;
	}

	/**
	 * Check if any form of auth is configured for a provider.
	 * Unlike getApiKey(), this doesn't refresh OAuth tokens.
	 */
	hasAuth(provider: string): boolean {
		this.reloadIfChanged();
		if (this.runtimeOverrides.has(provider)) return true;
		if (this.data[provider]) return true;
		if (getEnvApiKey(provider)) return true;
		if (this.fallbackResolver?.(provider)) return true;
		return false;
	}

	/**
	 * Check if a provider is authenticated via OAuth (stored or environment).
	 */
	isOAuth(provider: string): boolean {
		this.reloadIfChanged();
		const runtimeKey = this.runtimeOverrides.get(provider);
		if (runtimeKey) {
			return provider === "anthropic" ? isAnthropicOAuthToken(runtimeKey) : false;
		}

		const cred = this.data[provider];
		if (cred?.type === "oauth") return true;
		if (cred?.type === "api_key") {
			if (cred.tokenType === "oauth") return true;
			if (provider === "anthropic") {
				return isAnthropicOAuthToken(cred.key);
			}
			return false;
		}
		if (provider === "anthropic") {
			return Boolean(process.env.ANTHROPIC_OAUTH_TOKEN?.trim());
		}
		return false;
	}

	/**
	 * Get all credentials (for passing to getOAuthApiKey).
	 */
	getAll(): AuthStorageData {
		this.reloadIfChanged();
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
			case "openai":
				credentials = await loginOpenAI(callbacks.onAuth, callbacks.onProgress);
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
	 * Get API key for a provider.
	 * Priority:
	 * 1. Runtime override (CLI --api-key)
	 * 2. API key from auth.json
	 * 3. OAuth token from auth.json (auto-refreshed)
	 * 4. Environment variable
	 * 5. Fallback resolver (models.json custom providers)
	 */
	async getApiKey(provider: string): Promise<string | undefined> {
		this.reloadIfChanged();
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
			// Filter to only oauth credentials for getOAuthApiKey
			const oauthCreds: Record<string, OAuthCredentials> = {};
			for (const [key, value] of Object.entries(this.data)) {
				if (value.type === "oauth") {
					oauthCreds[key] = value;
				}
			}

			try {
				const result = await getOAuthApiKey(provider as OAuthProvider, oauthCreds);
				if (result) {
					this.data[provider] = { type: "oauth", ...result.newCredentials };
					this.save();
					return result.apiKey;
				}
			} catch {
				this.remove(provider);
			}
		}

		// Fall back to environment variable
		const envKey = getEnvApiKey(provider);
		if (envKey) return envKey;

		// Fall back to custom resolver (e.g., models.json custom providers)
		return this.fallbackResolver?.(provider) ?? undefined;
	}

	/**
	 * Force refresh OAuth credentials and return the new API key.
	 */
	async refreshOAuthApiKey(provider: string): Promise<string | undefined> {
		this.reloadIfChanged();
		if (!isOAuthProvider(provider)) return undefined;

		const cred = this.data[provider];
		if (cred?.type !== "oauth") return undefined;

		try {
			const refreshed = await refreshOAuthToken(provider, cred);
			this.data[provider] = { type: "oauth", ...refreshed };
			this.save();
			const result = await getOAuthApiKey(provider, { [provider]: refreshed });
			return result?.apiKey;
		} catch {
			this.remove(provider);
			return undefined;
		}
	}
}
