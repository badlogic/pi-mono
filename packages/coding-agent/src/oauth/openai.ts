import { openUrl } from "./browser.js";
import { startCallbackServer } from "./local-server.js";
import { generatePKCE, generateState } from "./pkce.js";
import { type OAuthCredentials, saveOAuthCredentials } from "./storage.js";

// OAuth constants (from openai/codex via opencode-openai-codex-auth)
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPES = "openid profile email offline_access";
const CALLBACK_PORT = 1455;

/**
 * Extract ChatGPT account ID from JWT access token.
 * The account ID is needed for the chatgpt-account-id header when using OAuth tokens.
 *
 * Based on official Codex CLI: the account ID is at claim path "https://api.openai.com/auth" -> chatgpt_account_id
 */
function extractChatGptAccountIdFromJwt(accessToken: string): string | undefined {
	try {
		const parts = accessToken.split(".");
		if (parts.length !== 3) return undefined;

		const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));

		// ChatGPT OAuth tokens use nested claim: https://api.openai.com/auth -> chatgpt_account_id
		const authClaim = payload["https://api.openai.com/auth"];
		if (authClaim?.chatgpt_account_id) {
			return authClaim.chatgpt_account_id;
		}

		// Fallback to legacy claim paths
		return payload.account_id || payload.sub;
	} catch {
		return undefined;
	}
}

export interface OpenAICredentials extends OAuthCredentials {
	accountId?: string;
}

/**
 * Login with OpenAI OAuth (browser-based flow with local callback server)
 * @param onStatus Callback for status updates
 * @returns Promise that resolves when login is complete
 */
export async function loginOpenAI(onStatus?: (status: string) => void): Promise<void> {
	const { verifier, challenge } = generatePKCE();
	const state = generateState();

	// Build authorization URL
	const authParams = new URLSearchParams({
		response_type: "code",
		client_id: CLIENT_ID,
		redirect_uri: REDIRECT_URI,
		scope: SCOPES,
		code_challenge: challenge,
		code_challenge_method: "S256",
		state: state,
		// Additional params from official Codex CLI flow
		id_token_add_organizations: "true",
		codex_cli_simplified_flow: "true",
		originator: "codex_cli_rs",
	});

	const authUrl = `${AUTHORIZE_URL}?${authParams.toString()}`;

	// Start local server to receive callback
	onStatus?.("Starting local OAuth server...");
	const callbackPromise = startCallbackServer(state, CALLBACK_PORT);

	// Open browser to authorization URL
	onStatus?.("Opening browser for authentication...");
	try {
		await openUrl(authUrl);
	} catch (error) {
		onStatus?.(`Could not open browser automatically. Please open this URL manually:\n${authUrl}`);
	}

	// Wait for callback
	onStatus?.("Waiting for authorization...");
	const { code } = await callbackPromise;

	// Exchange code for tokens
	onStatus?.("Exchanging authorization code for tokens...");
	const tokenResponse = await fetch(TOKEN_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code: code,
			redirect_uri: REDIRECT_URI,
			code_verifier: verifier,
		}).toString(),
	});

	if (!tokenResponse.ok) {
		const error = await tokenResponse.text();
		throw new Error(`Token exchange failed: ${error}`);
	}

	const tokenData = (await tokenResponse.json()) as {
		access_token: string;
		refresh_token: string;
		expires_in: number;
		token_type: string;
	};

	// Calculate expiry time (current time + expires_in seconds - 5 min buffer)
	const expiresAt = Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000;

	// Extract account ID from JWT (required for chatgpt-account-id header)
	const accountId = extractChatGptAccountIdFromJwt(tokenData.access_token);

	// Save credentials
	const credentials: OpenAICredentials = {
		type: "oauth",
		refresh: tokenData.refresh_token,
		access: tokenData.access_token,
		expires: expiresAt,
		accountId,
	};

	saveOAuthCredentials("openai", credentials);
	onStatus?.("Successfully logged in to OpenAI!");
}

/**
 * Refresh OpenAI OAuth token using refresh token
 */
export async function refreshOpenAIToken(refreshToken: string): Promise<OpenAICredentials> {
	const tokenResponse = await fetch(TOKEN_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			client_id: CLIENT_ID,
			refresh_token: refreshToken,
		}).toString(),
	});

	if (!tokenResponse.ok) {
		const error = await tokenResponse.text();
		throw new Error(`Token refresh failed: ${error}`);
	}

	const tokenData = (await tokenResponse.json()) as {
		access_token: string;
		refresh_token: string;
		expires_in: number;
		token_type: string;
	};

	// Calculate expiry time (current time + expires_in seconds - 5 min buffer)
	const expiresAt = Date.now() + tokenData.expires_in * 1000 - 5 * 60 * 1000;

	// Extract account ID from JWT (required for chatgpt-account-id header)
	const accountId = extractChatGptAccountIdFromJwt(tokenData.access_token);

	return {
		type: "oauth",
		refresh: tokenData.refresh_token,
		access: tokenData.access_token,
		expires: expiresAt,
		accountId,
	};
}

/**
 * Get OpenAI OAuth credentials with account ID
 */
export function getOpenAIAccountId(credentials: OAuthCredentials): string | undefined {
	return (credentials as OpenAICredentials).accountId;
}
