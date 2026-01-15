/**
 * GitLab Duo OAuth flow
 * Uses a local callback server for OAuth authorization.
 * Requires GITLAB_OAUTH_CLIENT_ID env var with a registered OAuth app,
 * or uses the opencode-gitlab-auth bundled client ID by default.
 */

import http from "http";
import { generatePKCE } from "./pkce.js";
import type { OAuthCredentials } from "./types.js";

// Default client ID from opencode-gitlab-auth (registered with http://127.0.0.1:8080/callback)
const DEFAULT_CLIENT_ID =
	process.env.GITLAB_OAUTH_CLIENT_ID || "1d89f9fdb23ee96d4e603201f6861dab6e143c5c3c00469a018a2d94bdc03d4e";
const DEFAULT_INSTANCE_URL = "https://gitlab.com";
const CALLBACK_PORT = 8080;
const CALLBACK_HOST = "127.0.0.1";
const SCOPES = "api";

interface CallbackResult {
	code: string;
	state: string;
}

/**
 * Create a local HTTP server to handle OAuth callback
 */
function createCallbackServer(
	expectedState: string,
	timeout: number,
): Promise<{ result: Promise<CallbackResult>; url: string; close: () => void }> {
	return new Promise((resolveServer, rejectServer) => {
		let resultResolve: (result: CallbackResult) => void;
		let resultReject: (error: Error) => void;
		let timeoutHandle: NodeJS.Timeout | undefined;

		const resultPromise = new Promise<CallbackResult>((resolve, reject) => {
			resultResolve = resolve;
			resultReject = reject;
		});

		const server = http.createServer((req, res) => {
			const url = new URL(req.url || "/", `http://${CALLBACK_HOST}:${CALLBACK_PORT}`);

			if (url.pathname === "/callback") {
				const code = url.searchParams.get("code");
				const state = url.searchParams.get("state");
				const error = url.searchParams.get("error");
				const errorDescription = url.searchParams.get("error_description");

				if (error) {
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end(`
						<!DOCTYPE html>
						<html>
							<head><title>Authentication Failed</title></head>
							<body>
								<h1>Authentication Failed</h1>
								<p>${errorDescription || error}</p>
								<p>You can close this window.</p>
							</body>
						</html>
					`);
					resultReject(new Error(`OAuth error: ${errorDescription || error}`));
					return;
				}

				if (!code || !state) {
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end(`
						<!DOCTYPE html>
						<html>
							<head><title>Authentication Failed</title></head>
							<body>
								<h1>Authentication Failed</h1>
								<p>Missing required parameters.</p>
								<p>You can close this window.</p>
							</body>
						</html>
					`);
					resultReject(new Error("Missing code or state parameter"));
					return;
				}

				if (state !== expectedState) {
					res.writeHead(200, { "Content-Type": "text/html" });
					res.end(`
						<!DOCTYPE html>
						<html>
							<head><title>Authentication Failed</title></head>
							<body>
								<h1>Authentication Failed</h1>
								<p>State mismatch - possible CSRF attack.</p>
								<p>You can close this window.</p>
							</body>
						</html>
					`);
					resultReject(new Error("State mismatch - possible CSRF attack"));
					return;
				}

				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(`
					<!DOCTYPE html>
					<html>
						<head><title>Authentication Successful</title></head>
						<body>
							<h1>Authentication Successful</h1>
							<p>You can close this window and return to your terminal.</p>
						</body>
					</html>
				`);
				resultResolve({ code, state });
			} else {
				res.writeHead(404);
				res.end("Not found");
			}
		});

		server.on("error", (err) => {
			rejectServer(err);
		});

		server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
			timeoutHandle = setTimeout(() => {
				resultReject(new Error("OAuth callback timeout - authorization took too long"));
				server.close();
			}, timeout);

			resolveServer({
				result: resultPromise,
				url: `http://${CALLBACK_HOST}:${CALLBACK_PORT}/callback`,
				close: () => {
					if (timeoutHandle) {
						clearTimeout(timeoutHandle);
					}
					server.close();
				},
			});
		});
	});
}

/**
 * Login with GitLab OAuth
 *
 * @param onAuth - Callback to show the authorization URL
 * @param onPromptToken - Not used for OAuth flow but kept for API compatibility
 * @param instanceUrl - GitLab instance URL (defaults to gitlab.com)
 */
export async function loginGitLabDuo(
	onAuth: (info: { url: string; instructions?: string }) => void,
	_onPromptToken: (prompt: { message: string; placeholder?: string }) => Promise<string>,
	instanceUrl: string = DEFAULT_INSTANCE_URL,
): Promise<OAuthCredentials> {
	const { verifier, challenge } = await generatePKCE();

	// Generate random state for CSRF protection
	const stateBytes = new Uint8Array(32);
	crypto.getRandomValues(stateBytes);
	const state = Array.from(stateBytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	// Start callback server
	const callbackServer = await createCallbackServer(state, 120000); // 2 minute timeout
	const redirectUri = callbackServer.url;

	try {
		// Build authorization URL
		const authParams = new URLSearchParams({
			client_id: DEFAULT_CLIENT_ID,
			response_type: "code",
			redirect_uri: redirectUri,
			scope: SCOPES,
			code_challenge: challenge,
			code_challenge_method: "S256",
			state: state,
		});

		const normalizedUrl = instanceUrl.replace(/\/$/, "");
		const authUrl = `${normalizedUrl}/oauth/authorize?${authParams.toString()}`;

		// Show URL and open browser
		onAuth({
			url: authUrl,
			instructions: "Your browser will open for authentication. The callback will be handled automatically.",
		});

		// Wait for callback
		const result = await callbackServer.result;

		// Exchange code for tokens
		const tokenResponse = await fetch(`${normalizedUrl}/oauth/token`, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: new URLSearchParams({
				client_id: DEFAULT_CLIENT_ID,
				grant_type: "authorization_code",
				code: result.code,
				redirect_uri: redirectUri,
				code_verifier: verifier,
			}).toString(),
		});

		if (!tokenResponse.ok) {
			const error = await tokenResponse.text();
			throw new Error(`GitLab token exchange failed: ${tokenResponse.status} ${error}`);
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
	} finally {
		callbackServer.close();
	}
}

/**
 * Refresh GitLab OAuth token
 */
export async function refreshGitLabDuoToken(
	refreshToken: string,
	instanceUrl: string = DEFAULT_INSTANCE_URL,
): Promise<OAuthCredentials> {
	const normalizedUrl = instanceUrl.replace(/\/$/, "");

	const response = await fetch(`${normalizedUrl}/oauth/token`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: new URLSearchParams({
			client_id: DEFAULT_CLIENT_ID,
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		}).toString(),
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`GitLab token refresh failed: ${response.status} ${error}`);
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
