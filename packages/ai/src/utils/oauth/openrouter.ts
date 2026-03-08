/**
 * OpenRouter API key login flow with model discovery validation.
 */

import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./types.js";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

// Far-future expiry — API keys don't expire
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/**
 * Validate an OpenRouter API key by fetching available models.
 * Returns the number of available models on success, throws on failure.
 */
async function validateApiKey(apiKey: string, signal?: AbortSignal): Promise<number> {
	const response = await fetch(OPENROUTER_MODELS_URL, {
		headers: { Authorization: `Bearer ${apiKey}` },
		signal,
	});

	if (!response.ok) {
		if (response.status === 401 || response.status === 403) {
			throw new Error("Invalid API key");
		}
		throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
	}

	const data = (await response.json()) as { data?: unknown[] };
	return data.data?.length ?? 0;
}

export const openrouterOAuthProvider: OAuthProviderInterface = {
	id: "openrouter",
	name: "OpenRouter (API Key)",

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		const apiKey = await callbacks.onPrompt({
			message: "Enter your OpenRouter API key:",
			placeholder: "sk-or-v1-...",
		});

		if (!apiKey || !apiKey.trim()) {
			throw new Error("API key is required");
		}

		const trimmedKey = apiKey.trim();

		// Validate by discovering models
		callbacks.onProgress?.("Validating API key...");
		const modelCount = await validateApiKey(trimmedKey, callbacks.signal);
		callbacks.onProgress?.(`Validated — ${modelCount} models available`);

		return {
			refresh: "",
			access: trimmedKey,
			expires: Date.now() + TEN_YEARS_MS,
		};
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		// API keys don't expire — return as-is
		return credentials;
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},
};
