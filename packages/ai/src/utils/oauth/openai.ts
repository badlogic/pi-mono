/**
 * OpenAI OAuth flow (ChatGPT Plus/Pro/Team/Enterprise subscription)
 *
 * NOTE: This module uses Node.js http.createServer for the OAuth callback.
 * It is only intended for CLI use, not browser environments.
 */

import { createServer, type Server } from "http";
import { generatePKCE } from "./pkce.js";
import type { OAuthCredentials } from "./types.js";

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const ISSUER = "https://auth.openai.com";
const DEFAULT_PORT = 1455;
const SCOPES = "openid profile email offline_access";
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

interface TokenResponse {
	id_token: string;
	access_token: string;
	refresh_token: string;
	expires_in?: number;
}

/**
 * Generate random state string for CSRF protection
 */
function generateState(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Build authorization URL
 */
function buildAuthorizeUrl(redirectUri: string, codeChallenge: string, state: string): string {
	const params = new URLSearchParams({
		response_type: "code",
		client_id: CLIENT_ID,
		redirect_uri: redirectUri,
		scope: SCOPES,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
		state: state,
		id_token_add_organizations: "true",
		codex_cli_simplified_flow: "true",
		originator: "codex_cli_rs",
	});

	return `${ISSUER}/oauth/authorize?${params.toString()}`;
}

/**
 * Start a local HTTP server to receive the OAuth callback
 */
async function startCallbackServer(port: number): Promise<{
	server: Server;
	getCode: () => Promise<{ code: string; state: string }>;
}> {
	return new Promise((resolve, reject) => {
		let codeResolve: (value: { code: string; state: string }) => void;
		let codeReject: (error: Error) => void;

		const codePromise = new Promise<{ code: string; state: string }>((res, rej) => {
			codeResolve = res;
			codeReject = rej;
		});

		const server = createServer((req, res) => {
			const url = new URL(req.url || "", `http://localhost:${port}`);

			if (url.pathname === "/auth/callback") {
				const code = url.searchParams.get("code");
				const state = url.searchParams.get("state");
				const error = url.searchParams.get("error");

				if (error) {
					res.writeHead(400, { "Content-Type": "text/html" });
					res.end(
						`<html><body><h1>Authentication Failed</h1><p>Error: ${error}</p><p>You can close this window.</p></body></html>`,
					);
					codeReject(new Error(`OAuth error: ${error}`));
					return;
				}

				if (code && state) {
					res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
					res.end(`<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>Authentication Successful</title>
</head>
<body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
	<div style="text-align: center;">
		<h1 style="color: #10a37f;">&#10003; Authentication Successful</h1>
		<p>You can close this window and return to the terminal.</p>
	</div>
</body>
</html>`);
					codeResolve({ code, state });
				} else {
					res.writeHead(400, { "Content-Type": "text/html" });
					res.end(
						`<html><body><h1>Authentication Failed</h1><p>Missing code or state parameter.</p></body></html>`,
					);
					codeReject(new Error("Missing code or state in callback"));
				}
			} else {
				res.writeHead(404);
				res.end();
			}
		});

		server.on("error", (err: NodeJS.ErrnoException) => {
			if (err.code === "EADDRINUSE") {
				reject(
					new Error(
						`Port ${port} is already in use. Please close any other authentication windows and try again.`,
					),
				);
			} else {
				reject(err);
			}
		});

		server.listen(port, "127.0.0.1", () => {
			resolve({
				server,
				getCode: () => codePromise,
			});
		});
	});
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(redirectUri: string, codeVerifier: string, code: string): Promise<TokenResponse> {
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		code: code,
		redirect_uri: redirectUri,
		client_id: CLIENT_ID,
		code_verifier: codeVerifier,
	});

	const response = await fetch(`${ISSUER}/oauth/token`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: body.toString(),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Token exchange failed (${response.status}): ${errorText}`);
	}

	return response.json() as Promise<TokenResponse>;
}

/**
 * Extract account ID from JWT id_token
 */
function extractAccountIdFromToken(idToken: string): string | undefined {
	try {
		const parts = idToken.split(".");
		if (parts.length !== 3) return undefined;

		// Decode base64url payload
		const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const decoded = JSON.parse(atob(payload));
		const authClaims = decoded["https://api.openai.com/auth"];

		return authClaims?.chatgpt_account_id;
	} catch {
		return undefined;
	}
}

/**
 * Extract plan type from JWT id_token
 */
function extractPlanTypeFromToken(idToken: string): string | undefined {
	try {
		const parts = idToken.split(".");
		if (parts.length !== 3) return undefined;

		const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
		const decoded = JSON.parse(atob(payload));
		const authClaims = decoded["https://api.openai.com/auth"];

		return authClaims?.chatgpt_plan_type;
	} catch {
		return undefined;
	}
}

/**
 * Try to parse JSON, return undefined on failure
 */
function tryParseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * Login with OpenAI OAuth (browser-based PKCE flow)
 *
 * @param onAuth - Callback with URL and optional instructions
 * @param onProgress - Optional progress callback
 */
export async function loginOpenAI(
	onAuth: (info: { url: string; instructions?: string }) => void,
	onProgress?: (message: string) => void,
): Promise<OAuthCredentials> {
	const port = DEFAULT_PORT;
	const redirectUri = `http://localhost:${port}/auth/callback`;

	// Generate PKCE
	onProgress?.("Generating PKCE challenge...");
	const { verifier, challenge } = await generatePKCE();
	const state = generateState();

	// Start local server for callback
	onProgress?.("Starting local server for OAuth callback...");
	const { server, getCode } = await startCallbackServer(port);

	try {
		// Build authorization URL
		const authUrl = buildAuthorizeUrl(redirectUri, challenge, state);

		// Notify caller with URL to open
		onAuth({
			url: authUrl,
			instructions: "Complete sign-in in your browser. This window will update automatically.",
		});

		// Wait for the callback
		onProgress?.("Waiting for browser authentication...");
		const { code, state: returnedState } = await getCode();

		// Verify state matches (CSRF protection)
		if (returnedState !== state) {
			throw new Error("State mismatch - possible CSRF attack");
		}

		// Exchange code for tokens
		onProgress?.("Exchanging authorization code for tokens...");
		const tokens = await exchangeCodeForTokens(redirectUri, verifier, code);

		// Extract account ID and plan type from id_token
		const accountId = extractAccountIdFromToken(tokens.id_token);
		const planType = extractPlanTypeFromToken(tokens.id_token);

		onProgress?.(`Authentication successful! Plan: ${planType || "unknown"}`);

		// Calculate expiry time
		const expiresIn = tokens.expires_in || 3600;
		const expiresAt = Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_BUFFER_MS;

		return {
			refresh: tokens.refresh_token,
			access: tokens.access_token,
			expires: expiresAt,
			accountId,
		};
	} finally {
		server.close();
	}
}

/**
 * Refresh OpenAI OAuth token
 */
export async function refreshOpenAIToken(refreshToken: string): Promise<OAuthCredentials> {
	const response = await fetch(`${ISSUER}/oauth/token`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: CLIENT_ID,
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();

		// Handle specific refresh token errors
		if (response.status === 401) {
			const errorData = tryParseJson(errorText) as Record<string, unknown> | undefined;
			const errorCode = (errorData?.error as Record<string, unknown>)?.code || errorData?.error || errorData?.code;

			if (errorCode === "refresh_token_expired") {
				throw new Error("Your refresh token has expired. Please log out and sign in again.");
			}
			if (errorCode === "refresh_token_reused") {
				throw new Error("Your refresh token was already used. Please log out and sign in again.");
			}
			if (errorCode === "refresh_token_invalidated") {
				throw new Error("Your refresh token was revoked. Please log out and sign in again.");
			}
		}

		throw new Error(`OpenAI token refresh failed (${response.status}): ${errorText}`);
	}

	const data = (await response.json()) as TokenResponse;

	const expiresIn = data.expires_in || 3600;
	const expiresAt = Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_BUFFER_MS;

	// Extract account ID from new token
	const accountId = extractAccountIdFromToken(data.id_token);

	return {
		refresh: data.refresh_token,
		access: data.access_token,
		expires: expiresAt,
		accountId,
	};
}
