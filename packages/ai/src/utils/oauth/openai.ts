/**
 * OpenAI OAuth flow for ChatGPT Codex (device code).
 */

import type { OAuthCredentials } from "./types.js";

const ISSUER = "https://auth.openai.com";
const DEVICE_AUTH_BASE = `${ISSUER}/api/accounts`;
const DEVICE_AUTH_URL = `${ISSUER}/codex/device`;
const DEVICE_AUTH_USER_CODE_URL = `${DEVICE_AUTH_BASE}/deviceauth/usercode`;
const DEVICE_AUTH_TOKEN_URL = `${DEVICE_AUTH_BASE}/deviceauth/token`;
const TOKEN_URL = `${ISSUER}/oauth/token`;
const REDIRECT_URI = `${ISSUER}/deviceauth/callback`;
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const MAX_POLL_DURATION_MS = 15 * 60 * 1000;

type UserCodeResponse = {
	device_auth_id: string;
	user_code?: string;
	usercode?: string;
	interval?: number | string;
};

type DeviceAuthSuccess = {
	authorization_code: string;
	code_challenge: string;
	code_verifier: string;
};

type TokenResponse = {
	id_token?: string;
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
};

function getIntervalSeconds(interval: number | string | undefined): number {
	if (typeof interval === "number" && Number.isFinite(interval) && interval > 0) return interval;
	if (typeof interval === "string") {
		const parsed = Number.parseInt(interval, 10);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	return DEFAULT_POLL_INTERVAL_SECONDS;
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
	const parts = token.split(".");
	if (parts.length < 2) return undefined;
	try {
		const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
		const parsed = JSON.parse(payload);
		if (parsed && typeof parsed === "object") {
			return parsed as Record<string, unknown>;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function parseIdToken(idToken?: string): { email?: string; accountId?: string } {
	if (!idToken) return {};
	const payload = decodeJwtPayload(idToken);
	if (!payload) return {};
	const email = typeof payload.email === "string" ? payload.email : undefined;
	const auth = payload["https://api.openai.com/auth"];
	let accountId: string | undefined;
	if (auth && typeof auth === "object") {
		const authObj = auth as Record<string, unknown>;
		if (typeof authObj.chatgpt_account_id === "string") {
			accountId = authObj.chatgpt_account_id;
		}
	}
	return { email, accountId };
}

async function requestUserCode(): Promise<{ deviceAuthId: string; userCode: string; intervalSeconds: number }> {
	const response = await fetch(DEVICE_AUTH_USER_CODE_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ client_id: CLIENT_ID }),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`OpenAI device auth request failed: ${error}`);
	}

	const data = (await response.json()) as UserCodeResponse;
	if (!data.device_auth_id) {
		throw new Error("OpenAI device auth response missing device auth id");
	}
	const userCode = data.user_code ?? data.usercode;
	if (!userCode) {
		throw new Error("OpenAI device auth response missing user code");
	}

	return {
		deviceAuthId: data.device_auth_id,
		userCode,
		intervalSeconds: getIntervalSeconds(data.interval),
	};
}

async function pollForAuthorizationCode(
	deviceAuthId: string,
	userCode: string,
	intervalSeconds: number,
	onProgress?: (message: string) => void,
): Promise<DeviceAuthSuccess> {
	const startedAt = Date.now();
	onProgress?.("Waiting for OpenAI authorization...");

	while (Date.now() - startedAt < MAX_POLL_DURATION_MS) {
		const response = await fetch(DEVICE_AUTH_TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
		});

		if (response.ok) {
			const data = (await response.json()) as DeviceAuthSuccess;
			return data;
		}

		if (response.status === 403 || response.status === 404) {
			await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
			continue;
		}

		const error = await response.text();
		throw new Error(`OpenAI device auth polling failed: ${error}`);
	}

	throw new Error("OpenAI device auth timed out after 15 minutes");
}

async function exchangeCodeForTokens(authorizationCode: string, codeVerifier: string): Promise<TokenResponse> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code: authorizationCode,
			redirect_uri: REDIRECT_URI,
			client_id: CLIENT_ID,
			code_verifier: codeVerifier,
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`OpenAI token exchange failed: ${error}`);
	}

	return (await response.json()) as TokenResponse;
}

function computeExpiry(expiresInSeconds?: number): number {
	const fallback = 60 * 60;
	const seconds = typeof expiresInSeconds === "number" && expiresInSeconds > 0 ? expiresInSeconds : fallback;
	return Date.now() + seconds * 1000 - 5 * 60 * 1000;
}

/**
 * Login with OpenAI OAuth (device code flow).
 */
export async function loginOpenAI(
	onAuth: (info: { url: string; instructions?: string }) => void,
	onProgress?: (message: string) => void,
): Promise<OAuthCredentials> {
	const { deviceAuthId, userCode, intervalSeconds } = await requestUserCode();

	onAuth({
		url: DEVICE_AUTH_URL,
		instructions: `Enter code: ${userCode}`,
	});

	const deviceAuth = await pollForAuthorizationCode(deviceAuthId, userCode, intervalSeconds, onProgress);
	if (!deviceAuth.authorization_code || !deviceAuth.code_verifier) {
		throw new Error("OpenAI device auth did not return authorization code");
	}
	const tokens = await exchangeCodeForTokens(deviceAuth.authorization_code, deviceAuth.code_verifier);
	if (!tokens.refresh_token) {
		throw new Error("OpenAI token exchange did not return a refresh token");
	}
	const { email, accountId } = parseIdToken(tokens.id_token);

	return {
		refresh: tokens.refresh_token,
		access: tokens.access_token,
		expires: computeExpiry(tokens.expires_in),
		idToken: tokens.id_token,
		accountId,
		email,
	};
}

/**
 * Refresh OpenAI OAuth token.
 */
export async function refreshOpenAIToken(refreshToken: string): Promise<OAuthCredentials> {
	const response = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			client_id: CLIENT_ID,
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			scope: "openid profile email",
		}),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`OpenAI token refresh failed: ${error}`);
	}

	const data = (await response.json()) as TokenResponse;
	const { email, accountId } = parseIdToken(data.id_token);

	return {
		refresh: data.refresh_token || refreshToken,
		access: data.access_token,
		expires: computeExpiry(data.expires_in),
		idToken: data.id_token,
		accountId,
		email,
	};
}
