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
	type OAuthCredentials,
	type OAuthProvider,
} from "@mariozechner/pi-ai";
import { execFileSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

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
	private claudeCliChecked = false;

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
		// Runtime override takes highest priority
		const runtimeKey = this.runtimeOverrides.get(provider);
		if (runtimeKey) {
			return runtimeKey;
		}

		let cred = this.data[provider];
		if (!cred && provider === "anthropic" && !this.claudeCliChecked) {
			this.claudeCliChecked = true;
			const imported = loadClaudeCliCredentials();
			if (imported) {
				this.data[provider] = { type: "oauth", ...imported };
				this.save();
				cred = this.data[provider];
			}
		}

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
}

function loadClaudeCliCredentials(): OAuthCredentials | undefined {
	const fromFiles = loadClaudeCliCredentialsFromFiles();
	if (fromFiles) return fromFiles;
	return loadClaudeCliCredentialsFromKeychain();
}

function loadClaudeCliCredentialsFromFiles(): OAuthCredentials | undefined {
	const home = homedir();
	const paths = [
		join(home, ".claude", ".credentials.json"),
		join(home, ".claude", "credentials.json"),
		join(home, ".config", "claude", "credentials.json"),
	];

	for (const path of paths) {
		const data = readJsonFile(path);
		if (!data) continue;
		const creds = extractClaudeCliCredentials(data);
		if (creds) return creds;
	}

	return undefined;
}

function loadClaudeCliCredentialsFromKeychain(): OAuthCredentials | undefined {
	if (process.platform !== "darwin") return undefined;

	const services = ["Claude Code-credentials", "Claude Code"];
	for (const service of services) {
		try {
			const output = execFileSync("security", ["find-generic-password", "-s", service, "-w"], {
				encoding: "utf-8",
			}).trim();
			if (!output) continue;
			const parsed = JSON.parse(output);
			const creds = extractClaudeCliCredentials(parsed);
			if (creds) return creds;
		} catch {}
	}

	return undefined;
}

function extractClaudeCliCredentials(data: unknown): OAuthCredentials | undefined {
	if (!isRecord(data)) return undefined;

	const candidates: Record<string, unknown>[] = [];
	const nestedClaude = data.claudeAiOauth;
	const nestedClaudeSnake = data.claude_ai_oauth;

	if (isRecord(nestedClaude)) candidates.push(nestedClaude);
	if (isRecord(nestedClaudeSnake)) candidates.push(nestedClaudeSnake);
	if (isRecord(data.oauth)) candidates.push(data.oauth);
	candidates.push(data);

	for (const candidate of candidates) {
		const creds = toOAuthCredentials(candidate);
		if (creds) return creds;
	}

	return undefined;
}

function toOAuthCredentials(candidate: Record<string, unknown>): OAuthCredentials | undefined {
	const access =
		getString(candidate.accessToken) ??
		getString(candidate.access_token) ??
		getString(candidate.access) ??
		getString(candidate.token);
	const refresh =
		getString(candidate.refreshToken) ?? getString(candidate.refresh_token) ?? getString(candidate.refresh);
	const expires = resolveExpires(candidate);

	if (!access || !refresh || !expires) {
		return undefined;
	}

	const email = getString(candidate.email);
	return email ? { access, refresh, expires, email } : { access, refresh, expires };
}

function resolveExpires(candidate: Record<string, unknown>): number | undefined {
	const absolute =
		parseAbsoluteExpiry(candidate.expiresAt) ??
		parseAbsoluteExpiry(candidate.expires_at) ??
		parseAbsoluteExpiry(candidate.expires);
	if (absolute) return absolute;

	const relative = parseNumber(candidate.expiresIn) ?? parseNumber(candidate.expires_in);
	if (relative !== undefined) {
		return Date.now() + relative * 1000;
	}

	return undefined;
}

function parseAbsoluteExpiry(value: unknown): number | undefined {
	if (typeof value === "number") return normalizeEpoch(value);
	if (typeof value === "string") {
		const numeric = Number(value);
		if (!Number.isNaN(numeric)) return normalizeEpoch(numeric);
		const parsed = Date.parse(value);
		if (!Number.isNaN(parsed)) return parsed;
	}
	return undefined;
}

function normalizeEpoch(value: number): number {
	return value < 1_000_000_000_000 ? value * 1000 : value;
}

function parseNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

function getString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readJsonFile(path: string): unknown | undefined {
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return undefined;
	}
}
