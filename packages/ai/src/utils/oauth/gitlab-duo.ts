/**
 * GitLab Duo OAuth flow
 * Uses the same client ID as gitlab-vscode-extension and gitlab-ai-provider
 */

import { generatePKCE } from "./pkce.js";
import type { OAuthCredentials } from "./types.js";

// Bundled OAuth client ID for GitLab.com (same as gitlab-vscode-extension)
const BUNDLED_CLIENT_ID = "36f2a70cddeb5a0889d4fd8295c241b7e9848e89cf9e599d0eed2d8e5350fbf5";
const DEFAULT_INSTANCE_URL = "https://gitlab.com";
const REDIRECT_URI = "http://127.0.0.1:1455/callback";
const SCOPES = "api";

/**
 * Login with GitLab OAuth
 *
 * @param onAuthUrl - Callback to handle the authorization URL (e.g., open browser)
 * @param onPromptCode - Callback to prompt user for the authorization code
 * @param instanceUrl - GitLab instance URL (defaults to gitlab.com)
 */
export async function loginGitLabDuo(
	onAuthUrl: (url: string) => void,
	onPromptCode: () => Promise<string>,
	instanceUrl: string = DEFAULT_INSTANCE_URL,
): Promise<OAuthCredentials> {
	const { verifier, challenge } = await generatePKCE();

	// Build authorization URL
	const authParams = new URLSearchParams({
		client_id: BUNDLED_CLIENT_ID,
		response_type: "code",
		redirect_uri: REDIRECT_URI,
		scope: SCOPES,
		code_challenge: challenge,
		code_challenge_method: "S256",
		state: verifier,
	});

	const authUrl = `${instanceUrl}/oauth/authorize?${authParams.toString()}`;

	// Notify caller with URL to open
	onAuthUrl(authUrl);

	// Wait for user to paste authorization code
	const code = await onPromptCode();

	// Exchange code for tokens
	const tokenResponse = await fetch(`${instanceUrl}/oauth/token`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			client_id: BUNDLED_CLIENT_ID,
			grant_type: "authorization_code",
			code: code,
			redirect_uri: REDIRECT_URI,
			code_verifier: verifier,
		}).toString(),
	});

	if (!tokenResponse.ok) {
		const error = await tokenResponse.text();
		throw new Error(`GitLab token exchange failed: ${error}`);
	}

	const tokenData = (await tokenResponse.json()) as {
		access_token: string;
		refresh_token: string;
		expires_in: number;
		created_at: number;
	};

	// GitLab returns created_at (Unix timestamp in seconds) and expires_in (seconds)
	const createdAt = tokenData.created_at * 1000;
	const expiresIn = tokenData.expires_in * 1000;
	const expiresAt = createdAt + expiresIn - 5 * 60 * 1000; // 5 min buffer

	return {
		refresh: tokenData.refresh_token,
		access: tokenData.access_token,
		expires: expiresAt,
		enterpriseUrl: instanceUrl !== DEFAULT_INSTANCE_URL ? instanceUrl : undefined,
	};
}

/**
 * Refresh GitLab OAuth token
 */
export async function refreshGitLabDuoToken(
	refreshToken: string,
	instanceUrl: string = DEFAULT_INSTANCE_URL,
): Promise<OAuthCredentials> {
	const response = await fetch(`${instanceUrl}/oauth/token`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			client_id: BUNDLED_CLIENT_ID,
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		}).toString(),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`GitLab token refresh failed: ${error}`);
	}

	const data = (await response.json()) as {
		access_token: string;
		refresh_token: string;
		expires_in: number;
		created_at: number;
	};

	const createdAt = data.created_at * 1000;
	const expiresIn = data.expires_in * 1000;
	const expiresAt = createdAt + expiresIn - 5 * 60 * 1000;

	return {
		refresh: data.refresh_token,
		access: data.access_token,
		expires: expiresAt,
		enterpriseUrl: instanceUrl !== DEFAULT_INSTANCE_URL ? instanceUrl : undefined,
	};
}
