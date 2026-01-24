/**
 * GitLab Duo Provider Extension
 *
 * Provides access to GitLab Duo AI models (Claude and GPT) through GitLab's AI Gateway.
 * Delegates to pi-ai's built-in Anthropic and OpenAI streaming implementations.
 *
 * Usage:
 *   # First install dependencies
 *   cd packages/coding-agent/examples/extensions/gitlab-duo && npm install
 *
 *   # With OAuth (run /login gitlab-duo first)
 *   pi -e ./packages/coding-agent/examples/extensions/gitlab-duo
 *
 *   # With PAT
 *   GITLAB_TOKEN=glpat-... pi -e ./packages/coding-agent/examples/extensions/gitlab-duo
 *
 * Then use /model to select gitlab-duo/duo-chat-sonnet-4-5
 */

import {
	type Api,
	type AssistantMessageEventStream,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	type OAuthCredentials,
	type OAuthLoginCallbacks,
	type SimpleStreamOptions,
	streamSimple,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// =============================================================================
// Constants
// =============================================================================

const GITLAB_COM_URL = "https://gitlab.com";
const AI_GATEWAY_URL = "https://cloud.gitlab.com";
const ANTHROPIC_PROXY_URL = `${AI_GATEWAY_URL}/ai/v1/proxy/anthropic/`;
const OPENAI_PROXY_URL = `${AI_GATEWAY_URL}/ai/v1/proxy/openai/v1`;

// Bundled OAuth client ID for gitlab.com (from opencode-gitlab-auth, registered with localhost redirect)
const BUNDLED_CLIENT_ID = "1d89f9fdb23ee96d4e603201f6861dab6e143c5c3c00469a018a2d94bdc03d4e";
const OAUTH_SCOPES = ["api"];
const REDIRECT_URI = "http://127.0.0.1:8080/callback";

// Direct access token cache (25 min, tokens expire after 30 min)
const DIRECT_ACCESS_TTL = 25 * 60 * 1000;

// Model mappings: duo model ID -> backend config
const MODEL_MAPPINGS: Record<
	string,
	{ api: "anthropic-messages" | "openai-completions"; backendModel: string; baseUrl: string }
> = {
	"duo-chat-opus-4-5": {
		api: "anthropic-messages",
		backendModel: "claude-opus-4-5-20251101",
		baseUrl: ANTHROPIC_PROXY_URL,
	},
	"duo-chat-sonnet-4-5": {
		api: "anthropic-messages",
		backendModel: "claude-sonnet-4-5-20250929",
		baseUrl: ANTHROPIC_PROXY_URL,
	},
	"duo-chat-haiku-4-5": {
		api: "anthropic-messages",
		backendModel: "claude-haiku-4-5-20251001",
		baseUrl: ANTHROPIC_PROXY_URL,
	},
	"duo-chat-gpt-5-1": { api: "openai-completions", backendModel: "gpt-5.1-2025-11-13", baseUrl: OPENAI_PROXY_URL },
	"duo-chat-gpt-5-mini": {
		api: "openai-completions",
		backendModel: "gpt-5-mini-2025-08-07",
		baseUrl: OPENAI_PROXY_URL,
	},
	"duo-chat-gpt-5-codex": { api: "openai-completions", backendModel: "gpt-5-codex", baseUrl: OPENAI_PROXY_URL },
};

// =============================================================================
// Direct Access Token Cache
// =============================================================================

interface DirectAccessToken {
	token: string;
	headers: Record<string, string>;
	expiresAt: number;
}

let cachedDirectAccess: DirectAccessToken | null = null;

async function getDirectAccessToken(gitlabAccessToken: string): Promise<DirectAccessToken> {
	const now = Date.now();
	if (cachedDirectAccess && cachedDirectAccess.expiresAt > now) {
		return cachedDirectAccess;
	}

	const url = `${GITLAB_COM_URL}/api/v4/ai/third_party_agents/direct_access`;
	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${gitlabAccessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ feature_flags: { DuoAgentPlatformNext: true } }),
	});

	if (!response.ok) {
		const errorText = await response.text();
		if (response.status === 403) {
			throw new Error(
				`GitLab Duo access denied. Ensure GitLab Duo is enabled for your account. Error: ${errorText}`,
			);
		}
		throw new Error(`Failed to get direct access token: ${response.status} ${errorText}`);
	}

	const data = (await response.json()) as { token: string; headers: Record<string, string> };
	cachedDirectAccess = {
		token: data.token,
		headers: data.headers,
		expiresAt: now + DIRECT_ACCESS_TTL,
	};
	return cachedDirectAccess;
}

function invalidateDirectAccessToken() {
	cachedDirectAccess = null;
}

// =============================================================================
// OAuth Implementation
// =============================================================================

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	const verifier = btoa(String.fromCharCode(...array))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const hash = await crypto.subtle.digest("SHA-256", data);
	const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

	return { verifier, challenge };
}

async function loginGitLab(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const { verifier, challenge } = await generatePKCE();

	const authParams = new URLSearchParams({
		client_id: BUNDLED_CLIENT_ID,
		redirect_uri: REDIRECT_URI,
		response_type: "code",
		scope: OAUTH_SCOPES.join(" "),
		code_challenge: challenge,
		code_challenge_method: "S256",
		state: crypto.randomUUID(),
	});

	callbacks.onAuth({ url: `${GITLAB_COM_URL}/oauth/authorize?${authParams.toString()}` });
	const callbackUrl = await callbacks.onPrompt({ message: "Paste the callback URL:" });

	const urlObj = new URL(callbackUrl);
	const code = urlObj.searchParams.get("code");
	if (!code) throw new Error("No authorization code found in callback URL");

	const tokenResponse = await fetch(`${GITLAB_COM_URL}/oauth/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: BUNDLED_CLIENT_ID,
			grant_type: "authorization_code",
			code,
			code_verifier: verifier,
			redirect_uri: REDIRECT_URI,
		}).toString(),
	});

	if (!tokenResponse.ok) throw new Error(`Token exchange failed: ${await tokenResponse.text()}`);

	const data = (await tokenResponse.json()) as {
		access_token: string;
		refresh_token: string;
		expires_in: number;
		created_at: number;
	};

	invalidateDirectAccessToken();
	return {
		refresh: data.refresh_token,
		access: data.access_token,
		expires: (data.created_at + data.expires_in) * 1000 - 5 * 60 * 1000,
	};
}

async function refreshGitLabToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
	const response = await fetch(`${GITLAB_COM_URL}/oauth/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: BUNDLED_CLIENT_ID,
			grant_type: "refresh_token",
			refresh_token: credentials.refresh,
		}).toString(),
	});

	if (!response.ok) throw new Error(`Token refresh failed: ${await response.text()}`);

	const data = (await response.json()) as {
		access_token: string;
		refresh_token: string;
		expires_in: number;
		created_at: number;
	};

	invalidateDirectAccessToken();
	return {
		refresh: data.refresh_token,
		access: data.access_token,
		expires: (data.created_at + data.expires_in) * 1000 - 5 * 60 * 1000,
	};
}

// =============================================================================
// Main Stream Function - Delegates to pi-ai's built-in implementations
// =============================================================================

function streamGitLabDuo(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		try {
			const gitlabAccessToken = options?.apiKey;
			if (!gitlabAccessToken) {
				throw new Error("No GitLab access token. Run /login gitlab-duo or set GITLAB_TOKEN");
			}

			const mapping = MODEL_MAPPINGS[model.id];
			if (!mapping) throw new Error(`Unknown model: ${model.id}`);

			// Get direct access token (cached)
			const directAccess = await getDirectAccessToken(gitlabAccessToken);

			// Create a proxy model that uses the backend API
			const proxyModel: Model<typeof mapping.api> = {
				...model,
				id: mapping.backendModel,
				api: mapping.api,
				baseUrl: mapping.baseUrl,
			};

			// Merge GitLab headers with Authorization bearer token
			const headers = {
				...directAccess.headers,
				Authorization: `Bearer ${directAccess.token}`,
			};

			// Delegate to pi-ai's built-in streaming
			const innerStream = streamSimple(proxyModel, context, {
				...options,
				apiKey: "gitlab-duo", // Dummy value to pass validation
				headers,
			});

			// Forward all events
			for await (const event of innerStream) {
				// Patch the model info back to gitlab-duo
				if ("partial" in event && event.partial) {
					event.partial.api = model.api;
					event.partial.provider = model.provider;
					event.partial.model = model.id;
				}
				if ("message" in event && event.message) {
					event.message.api = model.api;
					event.message.provider = model.provider;
					event.message.model = model.id;
				}
				if ("error" in event && event.error) {
					event.error.api = model.api;
					event.error.provider = model.provider;
					event.error.model = model.id;
				}
				stream.push(event);
			}
			stream.end();
		} catch (error) {
			stream.push({
				type: "error",
				reason: "error",
				error: {
					role: "assistant",
					content: [],
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "error",
					errorMessage: error instanceof Error ? error.message : String(error),
					timestamp: Date.now(),
				},
			});
			stream.end();
		}
	})();

	return stream;
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function (pi: ExtensionAPI) {
	pi.registerProvider("gitlab-duo", {
		baseUrl: AI_GATEWAY_URL,
		apiKey: "GITLAB_TOKEN",
		api: "gitlab-duo-api",

		models: [
			// Anthropic models
			{
				id: "duo-chat-opus-4-5",
				name: "GitLab Duo Claude Opus 4.5",
				reasoning: false,
				input: ["text"],
				cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
				contextWindow: 200000,
				maxTokens: 32000,
			},
			{
				id: "duo-chat-sonnet-4-5",
				name: "GitLab Duo Claude Sonnet 4.5",
				reasoning: false,
				input: ["text"],
				cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
				contextWindow: 200000,
				maxTokens: 16384,
			},
			{
				id: "duo-chat-haiku-4-5",
				name: "GitLab Duo Claude Haiku 4.5",
				reasoning: false,
				input: ["text"],
				cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
				contextWindow: 200000,
				maxTokens: 8192,
			},
			// OpenAI models
			{
				id: "duo-chat-gpt-5-1",
				name: "GitLab Duo GPT-5.1",
				reasoning: false,
				input: ["text"],
				cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 16384,
			},
			{
				id: "duo-chat-gpt-5-mini",
				name: "GitLab Duo GPT-5 Mini",
				reasoning: false,
				input: ["text"],
				cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 16384,
			},
			{
				id: "duo-chat-gpt-5-codex",
				name: "GitLab Duo GPT-5 Codex",
				reasoning: false,
				input: ["text"],
				cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 16384,
			},
		],

		oauth: {
			name: "GitLab Duo",
			login: loginGitLab,
			refreshToken: refreshGitLabToken,
			getApiKey: (cred) => cred.access,
		},

		streamSimple: streamGitLabDuo,
	});
}
