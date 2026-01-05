const JWT_CLAIM_PATH = "https://api.openai.com/auth";

type JwtPayload = {
	[JWT_CLAIM_PATH]?: {
		chatgpt_account_id?: string;
	};
	[key: string]: unknown;
};

function base64UrlToBase64(input: string): string {
	const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
	const padding = normalized.length % 4;
	if (padding === 0) return normalized;
	return normalized + "=".repeat(4 - padding);
}

function decodeJwtPayload(token: string): JwtPayload | null {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) return null;
		const payload = parts[1] ?? "";
		if (!payload) return null;
		const decoded = Buffer.from(base64UrlToBase64(payload), "base64").toString("utf-8");
		return JSON.parse(decoded) as JwtPayload;
	} catch {
		return null;
	}
}

export function getChatgptAccountIdFromAccessToken(accessToken: string): string | null {
	const payload = decodeJwtPayload(accessToken);
	const auth = payload?.[JWT_CLAIM_PATH];
	const accountId = auth?.chatgpt_account_id;
	return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
}
