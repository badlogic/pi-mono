/**
 * OAuth credential storage for ~/.pi/agent/oauth.json
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export interface OAuthCredentials {
	type: "oauth";
	refresh: string;
	access: string;
	expires: number;
	enterpriseUrl?: string;
	projectId?: string;
	email?: string;
}

export interface OAuthStorage {
	[provider: string]: OAuthCredentials;
}

export type OAuthProvider = "anthropic" | "github-copilot" | "google-gemini-cli" | "google-antigravity";

/**
 * Get the path to the OAuth credentials file
 */
export function getOAuthPath(): string {
	return join(homedir(), ".pi", "agent", "oauth.json");
}

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(): void {
	const configDir = dirname(getOAuthPath());
	if (!existsSync(configDir)) {
		mkdirSync(configDir, { recursive: true, mode: 0o700 });
	}
}

/**
 * Load all OAuth credentials from ~/.pi/agent/oauth.json
 */
export function loadOAuthStorage(): OAuthStorage {
	const filePath = getOAuthPath();
	if (!existsSync(filePath)) {
		return {};
	}

	try {
		const content = readFileSync(filePath, "utf-8");
		return JSON.parse(content);
	} catch {
		return {};
	}
}

/**
 * Save all OAuth credentials to ~/.pi/agent/oauth.json
 */
function saveOAuthStorage(storage: OAuthStorage): void {
	ensureConfigDir();
	const filePath = getOAuthPath();
	writeFileSync(filePath, JSON.stringify(storage, null, 2), "utf-8");
	chmodSync(filePath, 0o600);
}

/**
 * Load OAuth credentials for a specific provider
 */
export function loadOAuthCredentials(provider: string): OAuthCredentials | null {
	const storage = loadOAuthStorage();
	return storage[provider] || null;
}

/**
 * Save OAuth credentials for a specific provider
 */
export function saveOAuthCredentials(provider: string, creds: OAuthCredentials): void {
	const storage = loadOAuthStorage();
	storage[provider] = creds;
	saveOAuthStorage(storage);
}

/**
 * Remove OAuth credentials for a specific provider
 */
export function removeOAuthCredentials(provider: string): void {
	const storage = loadOAuthStorage();
	delete storage[provider];
	saveOAuthStorage(storage);
}

/**
 * Check if OAuth credentials exist for a provider
 */
export function hasOAuthCredentials(provider: string): boolean {
	return loadOAuthCredentials(provider) !== null;
}

/**
 * List all providers with OAuth credentials
 */
export function listOAuthProviders(): string[] {
	const storage = loadOAuthStorage();
	return Object.keys(storage);
}
