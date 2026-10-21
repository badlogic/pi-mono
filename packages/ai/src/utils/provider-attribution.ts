import type { Api, Model, ProviderHeaders } from "../types.ts";

const OPENROUTER_HOST = "openrouter.ai";
const NVIDIA_NIM_HOST = "integrate.api.nvidia.com";
const CLOUDFLARE_API_HOST = "api.cloudflare.com";
const CLOUDFLARE_AI_GATEWAY_HOST = "gateway.ai.cloudflare.com";
const OPENCODE_HOST = "opencode.ai";

function matchesHost(baseUrl: string, expectedHost: string): boolean {
	try {
		return new URL(baseUrl).hostname === expectedHost;
	} catch {
		return false;
	}
}

/** How one pi client identifies itself to providers, grouped by provider. Each field is the value of one header. */
export interface ProviderAttributionClient {
	openRouter: {
		/** `HTTP-Referer`, the app's identity in OpenRouter rankings. Apps are grouped by origin. */
		referer: string;
		/** `X-OpenRouter-Title`, the app's display name. */
		title: string;
		/** `X-OpenRouter-Categories`, comma-separated marketplace categories; absent sends none. */
		categories?: string;
	};
	nvidia: {
		/** `X-BILLING-INVOKE-ORIGIN`. */
		billingOrigin: string;
	};
	cloudflare: {
		/** `User-Agent`. */
		userAgent: string;
	};
	opencode: {
		/** `x-opencode-client`. */
		client: string;
	};
}

/**
 * Headers that attribute requests to a pi client at providers that track client usage: OpenRouter app rankings,
 * NVIDIA NIM billing origin, and the Cloudflare user agent. Undefined for other providers. Request headers should be
 * merged over these, so callers can replace or remove (`null`) each one.
 */
export function getProviderAttributionHeaders(
	model: Model<Api>,
	client: ProviderAttributionClient,
): ProviderHeaders | undefined {
	if (model.provider === "openrouter" || model.baseUrl.includes(OPENROUTER_HOST)) {
		const { referer, title, categories } = client.openRouter;
		return {
			"HTTP-Referer": referer,
			"X-OpenRouter-Title": title,
			...(categories === undefined ? {} : { "X-OpenRouter-Categories": categories }),
		};
	}

	if (model.provider === "nvidia" || matchesHost(model.baseUrl, NVIDIA_NIM_HOST)) {
		return { "X-BILLING-INVOKE-ORIGIN": client.nvidia.billingOrigin };
	}

	if (
		model.provider === "cloudflare-workers-ai" ||
		model.provider === "cloudflare-ai-gateway" ||
		matchesHost(model.baseUrl, CLOUDFLARE_API_HOST) ||
		matchesHost(model.baseUrl, CLOUDFLARE_AI_GATEWAY_HOST)
	) {
		return { "User-Agent": client.cloudflare.userAgent };
	}

	return undefined;
}

/** Headers that tie requests of one session together at OpenCode. Undefined for other providers or without a session. */
export function getProviderSessionHeaders(
	model: Model<Api>,
	sessionId: string | undefined,
	client: ProviderAttributionClient,
): ProviderHeaders | undefined {
	if (!sessionId) return undefined;
	if (
		model.provider !== "opencode" &&
		model.provider !== "opencode-go" &&
		!matchesHost(model.baseUrl, OPENCODE_HOST)
	) {
		return undefined;
	}
	return { "x-opencode-session": sessionId, "x-opencode-client": client.opencode.client };
}
