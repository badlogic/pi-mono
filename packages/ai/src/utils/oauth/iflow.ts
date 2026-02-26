/**
 * iFlow OAuth flow
 *
 * iFlow uses OAuth 2.0 authorization code flow with client credentials.
 * After OAuth, we exchange access_token for an apiKey (sk-xxx format)
 * which is used for actual API calls.
 *
 * Flow:
 * 1. User opens authorization URL in browser
 * 2. User logs in with phone number
 * 3. User gets authorization code
 * 4. Exchange code for access_token + refresh_token
 * 5. Use access_token to get apiKey
 * 6. Store apiKey for API calls
 */

import * as crypto from "crypto";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./types.js";

// iFlow OAuth configuration
const CLIENT_ID = "10009311001";
const CLIENT_SECRET = "4Z3YjXycVsQvyGF1etiNlIBB4RsqSDtW";
const REDIRECT_URI = "https://iflow.cn/oauth/code-display";

// iFlow OAuth endpoints
const IFLOW_AUTHORIZE_URL = "https://iflow.cn/oauth";
const IFLOW_TOKEN_URL = "https://iflow.cn/oauth/token";
const IFLOW_USER_INFO_URL = "https://iflow.cn/api/oauth/getUserInfo";

// Extended credentials for iFlow (includes apiKey)
export interface IflowCredentials extends OAuthCredentials {
	apiKey?: string;
	userId?: string;
	userName?: string;
	avatar?: string;
	email?: string;
	phone?: string;
}

/**
 * Generate Basic Auth header value
 */
function getBasicAuthHeader(): string {
	const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
	return `Basic ${credentials}`;
}

/**
 * Generate random state parameter (32 bytes = 64 hex chars)
 */
function generateState(): string {
	return crypto.randomBytes(32).toString("hex");
}

/**
 * Build the authorization URL for iFlow OAuth
 */
export function buildAuthorizationUrl(state: string): string {
	const params = new URLSearchParams({
		loginMethod: "phone",
		type: "phone",
		redirect: REDIRECT_URI,
		state: state,
		client_id: CLIENT_ID,
	});

	return `${IFLOW_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
	code: string,
	signal?: AbortSignal,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
	const response = await fetch(IFLOW_TOKEN_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: getBasicAuthHeader(),
		},
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code: code,
			redirect_uri: REDIRECT_URI,
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
		}).toString(),
		signal,
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Token exchange failed: ${response.status} ${error}`);
	}

	const data = (await response.json()) as {
		access_token: string;
		refresh_token: string;
		expires_in: number;
		token_type: string;
		scope: string;
	};

	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresIn: data.expires_in,
	};
}

/**
 * Get user info and apiKey using access_token
 */
export async function getUserInfo(
	accessToken: string,
	signal?: AbortSignal,
): Promise<{
	apiKey: string;
	userId: string;
	userName: string;
	avatar?: string;
	email?: string;
	phone?: string;
}> {
	const response = await fetch(`${IFLOW_USER_INFO_URL}?accessToken=${accessToken}`, {
		method: "GET",
		signal,
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Get user info failed: ${response.status} ${error}`);
	}

	const result = (await response.json()) as {
		success: boolean;
		data?: {
			apiKey: string;
			userId: string;
			userName: string;
			avatar?: string;
			email?: string;
			phone?: string;
		};
		message?: string;
	};

	if (!result.success || !result.data) {
		throw new Error(`Get user info failed: ${result.message || "Unknown error"}`);
	}

	return result.data;
}

/**
 * Refresh access token using refresh_token
 */
export async function refreshIflowToken(
	refreshToken: string,
	signal?: AbortSignal,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
	const response = await fetch(IFLOW_TOKEN_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: getBasicAuthHeader(),
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
		}).toString(),
		signal,
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`Token refresh failed: ${response.status} ${error}`);
	}

	const data = (await response.json()) as {
		access_token: string;
		refresh_token: string;
		expires_in: number;
		token_type: string;
		scope: string;
	};

	return {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresIn: data.expires_in,
	};
}

/**
 * Login with iFlow OAuth
 */
export async function loginIflow(
	onAuthUrl: (url: string, instructions?: string) => void,
	onPromptCode: () => Promise<string>,
	signal?: AbortSignal,
): Promise<IflowCredentials> {
	// Generate state for CSRF protection
	const state = generateState();

	// Build authorization URL
	const authUrl = buildAuthorizationUrl(state);

	// Notify caller with URL to open
	onAuthUrl(authUrl, "Please login with your phone number. After authorization, you will receive a code.");

	// Wait for user to paste authorization code
	const code = await onPromptCode();

	if (signal?.aborted) {
		throw new Error("Login was aborted");
	}

	// Exchange code for tokens
	const tokens = await exchangeCodeForTokens(code, signal);

	// Get user info and apiKey
	const userInfo = await getUserInfo(tokens.accessToken, signal);

	// Calculate expiry time (current time + expires_in seconds - 5 min buffer)
	const expiresAt = Date.now() + tokens.expiresIn * 1000 - 5 * 60 * 1000;

	return {
		refresh: tokens.refreshToken,
		access: tokens.accessToken,
		expires: expiresAt,
		apiKey: userInfo.apiKey,
		userId: userInfo.userId,
		userName: userInfo.userName,
		avatar: userInfo.avatar,
		email: userInfo.email,
		phone: userInfo.phone,
	};
}

/**
 * Refresh iFlow credentials
 */
export async function refreshIflowCredentials(
	credentials: IflowCredentials,
	signal?: AbortSignal,
): Promise<IflowCredentials> {
	const tokens = await refreshIflowToken(credentials.refresh, signal);

	// Get new apiKey with new access token
	const userInfo = await getUserInfo(tokens.accessToken, signal);

	const expiresAt = Date.now() + tokens.expiresIn * 1000 - 5 * 60 * 1000;

	return {
		...credentials,
		refresh: tokens.refreshToken,
		access: tokens.accessToken,
		expires: expiresAt,
		apiKey: userInfo.apiKey,
	};
}

/**
 * iFlow OAuth provider implementation
 */
export const iflowOAuthProvider: OAuthProviderInterface = {
	id: "iflow",
	name: "iFlow",
	usesCallbackServer: false,

	async login(callbacks: OAuthLoginCallbacks): Promise<IflowCredentials> {
		return loginIflow(
			(url, instructions) => callbacks.onAuth({ url, instructions }),
			() => callbacks.onPrompt({ message: "Paste the authorization code from iFlow:" }),
			callbacks.signal,
		);
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		return refreshIflowCredentials(credentials as IflowCredentials);
	},

	getApiKey(credentials: OAuthCredentials): string {
		const iflowCreds = credentials as IflowCredentials;
		// Return apiKey if available, otherwise fall back to access token
		return iflowCreds.apiKey || credentials.access;
	},
};
