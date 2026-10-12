import type { ProviderHeaders } from "../types.ts";

const OPENCODE_SESSION_HEADER = "x-opencode-session";

const OPENCODE_HOST = "opencode.ai";

/** True when a base URL is served by OpenCode Zen or OpenCode Go. */
export function isOpenCodeEndpoint(baseUrl: string | undefined): boolean {
	if (!baseUrl) return false;
	try {
		return new URL(baseUrl).hostname === OPENCODE_HOST;
	} catch {
		return false;
	}
}

/**
 * Adds OpenCode's required per-conversation routing header to request headers.
 * A caller-provided value (any case) wins; the header is only filled when absent.
 */
export function withOpenCodeSessionHeader(
	headers: ProviderHeaders | undefined,
	sessionId: string | undefined,
): ProviderHeaders | undefined {
	if (!sessionId) return headers;
	const present = Object.keys(headers ?? {}).some((name) => name.toLowerCase() === OPENCODE_SESSION_HEADER);
	return present ? headers : { ...headers, [OPENCODE_SESSION_HEADER]: sessionId };
}

export function headersToRecord(headers: Headers): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of headers.entries()) {
		result[key] = value;
	}
	return result;
}

export function providerHeadersToRecord(
	...headerSources: (ProviderHeaders | undefined)[]
): Record<string, string> | undefined {
	const merged = new Map<string, [string, string]>();
	for (const source of headerSources) {
		for (const [name, value] of Object.entries(source ?? {})) {
			const normalizedName = name.toLowerCase();
			merged.delete(normalizedName);
			if (value !== null) merged.set(normalizedName, [name, value]);
		}
	}
	return merged.size > 0 ? Object.fromEntries(merged.values()) : undefined;
}
