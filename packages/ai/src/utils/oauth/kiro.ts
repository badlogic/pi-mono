/**
 * Kiro OAuth flow
 *
 * Uses AWS Builder ID via SSO OIDC device code flow.
 * This is the same flow used by kiro-cli.
 *
 * For organization SSO (IAM Identity Center), users should login via kiro-cli
 * and pi will automatically pick up the credentials.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./types.js";

const SSO_OIDC_ENDPOINT = "https://oidc.us-east-1.amazonaws.com";
const BUILDER_ID_START_URL = "https://view.awsapps.com/start";
const USER_AGENT = "pi-cli";

const SCOPES = [
	"codewhisperer:completions",
	"codewhisperer:analysis",
	"codewhisperer:conversations",
	"codewhisperer:transformations",
	"codewhisperer:taskassist",
];

interface KiroCredentials extends OAuthCredentials {
	clientId: string;
	clientSecret: string;
	region: string;
}

/**
 * Login with Kiro via AWS Builder ID (device code flow)
 */
async function loginKiroBuilderID(callbacks: OAuthLoginCallbacks): Promise<KiroCredentials> {
	callbacks.onProgress?.("Registering client...");

	// Register client
	const registerResponse = await fetch(`${SSO_OIDC_ENDPOINT}/client/register`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"User-Agent": USER_AGENT,
		},
		body: JSON.stringify({
			clientName: "pi-cli",
			clientType: "public",
			scopes: SCOPES,
			grantTypes: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
		}),
	});

	if (!registerResponse.ok) {
		throw new Error(`Client registration failed: ${registerResponse.status}`);
	}

	const { clientId, clientSecret } = (await registerResponse.json()) as {
		clientId: string;
		clientSecret: string;
	};

	callbacks.onProgress?.("Starting device authorization...");

	// Start device authorization
	const deviceAuthResponse = await fetch(`${SSO_OIDC_ENDPOINT}/device_authorization`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"User-Agent": USER_AGENT,
		},
		body: JSON.stringify({
			clientId,
			clientSecret,
			startUrl: BUILDER_ID_START_URL,
		}),
	});

	if (!deviceAuthResponse.ok) {
		throw new Error(`Device authorization failed: ${deviceAuthResponse.status}`);
	}

	const deviceAuth = (await deviceAuthResponse.json()) as {
		verificationUri: string;
		verificationUriComplete: string;
		userCode: string;
		deviceCode: string;
		interval: number;
		expiresIn: number;
	};

	// Show verification URL
	callbacks.onAuth({
		url: deviceAuth.verificationUriComplete,
		instructions: `Your code: ${deviceAuth.userCode}`,
	});

	callbacks.onProgress?.("Waiting for authorization (sign in with Google, GitHub, or AWS)...");

	// Poll for token
	const interval = (deviceAuth.interval || 5) * 1000;
	const maxAttempts = Math.floor((deviceAuth.expiresIn || 600) / (deviceAuth.interval || 5));
	let currentInterval = interval;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		if (callbacks.signal?.aborted) {
			throw new Error("Login cancelled");
		}

		await new Promise((resolve) => setTimeout(resolve, currentInterval));

		const tokenResponse = await fetch(`${SSO_OIDC_ENDPOINT}/token`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"User-Agent": USER_AGENT,
			},
			body: JSON.stringify({
				clientId,
				clientSecret,
				deviceCode: deviceAuth.deviceCode,
				grantType: "urn:ietf:params:oauth:grant-type:device_code",
			}),
		});

		const tokenData = (await tokenResponse.json()) as {
			error?: string;
			accessToken?: string;
			refreshToken?: string;
			expiresIn?: number;
		};

		if (tokenData.error === "authorization_pending") continue;
		if (tokenData.error === "slow_down") {
			currentInterval += 5000;
			continue;
		}
		if (tokenData.error) throw new Error(`Authorization failed: ${tokenData.error}`);

		if (tokenData.accessToken && tokenData.refreshToken) {
			return {
				refresh: `${tokenData.refreshToken}|${clientId}|${clientSecret}|idc`,
				access: tokenData.accessToken,
				expires: Date.now() + (tokenData.expiresIn || 3600) * 1000 - 5 * 60 * 1000,
				clientId,
				clientSecret,
				region: "us-east-1",
			};
		}
	}

	throw new Error("Authorization timed out");
}

/**
 * Refresh Kiro token
 */
export async function refreshKiroToken(credentials: KiroCredentials): Promise<KiroCredentials> {
	// Parse encoded refresh token: refreshToken|clientId|clientSecret|idc
	const parts = credentials.refresh.split("|");
	const refreshToken = parts[0];
	const clientId = parts[1] || credentials.clientId;
	const clientSecret = parts[2] || credentials.clientSecret;

	const response = await fetch(`${SSO_OIDC_ENDPOINT}/token`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"User-Agent": USER_AGENT,
		},
		body: JSON.stringify({
			clientId,
			clientSecret,
			refreshToken,
			grantType: "refresh_token",
		}),
	});

	if (!response.ok) throw new Error(`Token refresh failed: ${response.status}`);

	const data = (await response.json()) as {
		accessToken: string;
		refreshToken: string;
		expiresIn: number;
	};

	return {
		refresh: `${data.refreshToken}|${clientId}|${clientSecret}|idc`,
		access: data.accessToken,
		expires: Date.now() + data.expiresIn * 1000 - 5 * 60 * 1000,
		clientId,
		clientSecret,
		region: credentials.region,
	};
}

/**
 * Get Kiro access token from kiro-cli's SQLite database.
 * This provides automatic credential sharing for users who have kiro-cli installed.
 */
function getKiroCliToken(): string | undefined {
	try {
		const p = platform();
		let dbPath: string;
		if (p === "win32") {
			dbPath = join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "kiro-cli", "data.sqlite3");
		} else if (p === "darwin") {
			dbPath = join(homedir(), "Library", "Application Support", "kiro-cli", "data.sqlite3");
		} else {
			dbPath = join(homedir(), ".local", "share", "kiro-cli", "data.sqlite3");
		}

		if (!existsSync(dbPath)) return undefined;

		// Read SQLite database directly instead of shelling out
		const db = readFileSync(dbPath);
		const dbStr = db.toString("utf-8");

		// Look for the token in the database
		// Format: kirocli:odic:token -> {"access_token":"...","refresh_token":"..."}
		const tokenMatch = dbStr.match(/kirocli:odic:token[^{]*(\{[^}]+\})/);
		if (tokenMatch?.[1]) {
			const data = JSON.parse(tokenMatch[1]);
			if (data.access_token) {
				return data.access_token;
			}
		}
	} catch {
		// Database not available, locked, or malformed
	}
	return undefined;
}

export const kiroOAuthProvider: OAuthProviderInterface = {
	id: "kiro",
	name: "Kiro (AWS Builder ID)",

	async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
		return loginKiroBuilderID(callbacks);
	},

	async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
		return refreshKiroToken(credentials as KiroCredentials);
	},

	getApiKey(credentials: OAuthCredentials): string {
		return credentials.access;
	},

	getCliToken(): string | undefined {
		return getKiroCliToken();
	},
};
