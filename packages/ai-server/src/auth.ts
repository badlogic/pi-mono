import type { OAuthCredentials } from "@mariozechner/pi-ai";
import { getOAuthApiKey } from "@mariozechner/pi-ai";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

// Default auth file: packages/ai/auth.json (same file used by pi-ai CLI)
const DEFAULT_AUTH_FILE = resolve(fileURLToPath(import.meta.url), "../../../ai/auth.json");

export function getAuthFile(): string {
	return process.env.AUTH_FILE ?? DEFAULT_AUTH_FILE;
}

export type AuthStore = Record<string, { type: "oauth" } & OAuthCredentials>;

export function loadAuth(authFile: string): AuthStore {
	if (!existsSync(authFile)) return {};
	try {
		return JSON.parse(readFileSync(authFile, "utf-8")) as AuthStore;
	} catch {
		return {};
	}
}

export function saveAuth(authFile: string, auth: AuthStore): void {
	writeFileSync(authFile, JSON.stringify(auth, null, 2), "utf-8");
}

/**
 * Get a valid API key for an OAuth provider.
 * Automatically refreshes expired tokens and saves updated credentials.
 * Returns null if no credentials are stored for the provider.
 */
export async function getAndRefreshApiKey(providerId: string): Promise<string | null> {
	const authFile = getAuthFile();
	const auth = loadAuth(authFile);
	const result = await getOAuthApiKey(providerId, auth as Record<string, OAuthCredentials>);
	if (!result) return null;

	// Persist refreshed credentials
	auth[providerId] = { type: "oauth", ...result.newCredentials };
	saveAuth(authFile, auth);

	return result.apiKey;
}
