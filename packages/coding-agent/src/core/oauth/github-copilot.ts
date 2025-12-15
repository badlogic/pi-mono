import type { OAuthCredentials } from "./storage.js";

const CLIENT_ID = "Iv1.b507a08c87ecfe98";

const COPILOT_HEADERS = {
	"User-Agent": "GitHubCopilotChat/0.35.0",
	"Editor-Version": "vscode/1.105.1",
	"Editor-Plugin-Version": "copilot-chat/0.35.0",
	"Copilot-Integration-Id": "copilot-developer-cli",
	"Openai-Intent": "conversation-edits",
	"X-Initiator": "agent",
} as const;

type DeviceCodeResponse = {
	device_code: string;
	user_code: string;
	verification_uri: string;
	interval: number;
	expires_in: number;
};

type DeviceTokenSuccessResponse = {
	access_token: string;
	token_type?: string;
	scope?: string;
};

type DeviceTokenErrorResponse = {
	error: string;
	error_description?: string;
	interval?: number;
};

export function normalizeDomain(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	try {
		const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
		return url.hostname;
	} catch {
		return null;
	}
}

function getUrls(domain: string): {
	deviceCodeUrl: string;
	accessTokenUrl: string;
	copilotTokenUrl: string;
} {
	return {
		deviceCodeUrl: `https://${domain}/login/device/code`,
		accessTokenUrl: `https://${domain}/login/oauth/access_token`,
		copilotTokenUrl: `https://api.${domain}/copilot_internal/v2/token`,
	};
}

export function getGitHubCopilotBaseUrl(enterpriseDomain?: string): string {
	if (!enterpriseDomain) return "https://api.githubcopilot.com";
	return `https://copilot-api.${enterpriseDomain}`;
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
	const response = await fetch(url, init);
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`${response.status} ${response.statusText}: ${text}`);
	}
	return response.json();
}

async function startDeviceFlow(domain: string): Promise<DeviceCodeResponse> {
	const urls = getUrls(domain);
	const data = await fetchJson(urls.deviceCodeUrl, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			"User-Agent": "GitHubCopilotChat/0.35.0",
		},
		body: JSON.stringify({
			client_id: CLIENT_ID,
			scope: "read:user",
		}),
	});

	if (!data || typeof data !== "object") {
		throw new Error("Invalid device code response");
	}

	const deviceCode = (data as Record<string, unknown>).device_code;
	const userCode = (data as Record<string, unknown>).user_code;
	const verificationUri = (data as Record<string, unknown>).verification_uri;
	const interval = (data as Record<string, unknown>).interval;
	const expiresIn = (data as Record<string, unknown>).expires_in;

	if (
		typeof deviceCode !== "string" ||
		typeof userCode !== "string" ||
		typeof verificationUri !== "string" ||
		typeof interval !== "number" ||
		typeof expiresIn !== "number"
	) {
		throw new Error("Invalid device code response fields");
	}

	return {
		device_code: deviceCode,
		user_code: userCode,
		verification_uri: verificationUri,
		interval,
		expires_in: expiresIn,
	};
}

async function pollForGitHubAccessToken(
	domain: string,
	deviceCode: string,
	intervalSeconds: number,
	expiresIn: number,
) {
	const urls = getUrls(domain);
	const deadline = Date.now() + expiresIn * 1000;
	let intervalMs = Math.max(1000, Math.floor(intervalSeconds * 1000));

	while (Date.now() < deadline) {
		const raw = await fetchJson(urls.accessTokenUrl, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				"User-Agent": "GitHubCopilotChat/0.35.0",
			},
			body: JSON.stringify({
				client_id: CLIENT_ID,
				device_code: deviceCode,
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			}),
		});

		if (raw && typeof raw === "object" && typeof (raw as DeviceTokenSuccessResponse).access_token === "string") {
			return (raw as DeviceTokenSuccessResponse).access_token;
		}

		if (raw && typeof raw === "object" && typeof (raw as DeviceTokenErrorResponse).error === "string") {
			const err = (raw as DeviceTokenErrorResponse).error;
			if (err === "authorization_pending") {
				await new Promise((resolve) => setTimeout(resolve, intervalMs));
				continue;
			}

			if (err === "slow_down") {
				intervalMs += 5000;
				await new Promise((resolve) => setTimeout(resolve, intervalMs));
				continue;
			}

			throw new Error(`Device flow failed: ${err}`);
		}

		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}

	throw new Error("Device flow timed out");
}

export async function refreshGitHubCopilotToken(
	refreshToken: string,
	enterpriseDomain?: string,
): Promise<OAuthCredentials> {
	const domain = enterpriseDomain || "github.com";
	const urls = getUrls(domain);
	const raw = await fetchJson(urls.copilotTokenUrl, {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${refreshToken}`,
			...COPILOT_HEADERS,
		},
	});

	if (!raw || typeof raw !== "object") {
		throw new Error("Invalid Copilot token response");
	}

	const token = (raw as Record<string, unknown>).token;
	const expiresAt = (raw as Record<string, unknown>).expires_at;

	if (typeof token !== "string" || typeof expiresAt !== "number") {
		throw new Error("Invalid Copilot token response fields");
	}

	const expires = expiresAt * 1000 - 5 * 60 * 1000;
	return {
		type: "oauth",
		refresh: refreshToken,
		access: token,
		expires,
		enterpriseUrl: enterpriseDomain,
	} satisfies OAuthCredentials;
}

export async function loginGitHubCopilot(options: {
	onAuth: (url: string, instructions?: string) => void;
	onPrompt: (prompt: { message: string; placeholder?: string; allowEmpty?: boolean }) => Promise<string>;
}): Promise<OAuthCredentials> {
	const input = await options.onPrompt({
		message: "GitHub Enterprise URL/domain (blank for github.com)",
		placeholder: "company.ghe.com",
		allowEmpty: true,
	});

	const trimmed = input.trim();
	const enterpriseDomain = normalizeDomain(input);
	if (trimmed && !enterpriseDomain) {
		throw new Error("Invalid GitHub Enterprise URL/domain");
	}
	const domain = enterpriseDomain || "github.com";

	const device = await startDeviceFlow(domain);
	options.onAuth(device.verification_uri, `Enter code: ${device.user_code}`);

	const githubAccessToken = await pollForGitHubAccessToken(
		domain,
		device.device_code,
		device.interval,
		device.expires_in,
	);
	return await refreshGitHubCopilotToken(githubAccessToken, enterpriseDomain ?? undefined);
}
