import type { Model } from "@mariozechner/pi-ai";
import type { ExtensionRunner } from "./runner.js";

/**
 * Headers that should have their values redacted in http_request events.
 * These headers contain sensitive authentication information.
 */
const REDACTED_HEADERS = [
	"authorization",
	"x-api-key",
	"api-key",
	"x-goog-api-key",
	"anthropic-api-key",
	"proxy-authorization",
	"cookie",
	"set-cookie",
];

/**
 * Patterns to detect sensitive headers by name.
 * If a header name (lowercase) contains any of these, it should be redacted.
 */
const SENSITIVE_HEADER_PATTERNS = ["auth", "token", "key", "secret", "cookie"];

/**
 * Redact sensitive header values from a headers object.
 */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		const lowerKey = key.toLowerCase();
		const shouldRedact =
			REDACTED_HEADERS.includes(lowerKey) || SENSITIVE_HEADER_PATTERNS.some((pattern) => lowerKey.includes(pattern));
		result[key] = shouldRedact ? "[REDACTED]" : value;
	}
	return result;
}

/**
 * Convert Headers object to plain Record.
 */
export function headersToRecord(headers: Headers): Record<string, string> {
	const result: Record<string, string> = {};
	headers.forEach((value, key) => {
		result[key] = value;
	});
	return result;
}

/**
 * Create a fetch factory function for extension HTTP events.
 *
 * Returns undefined if no http_request or http_response handlers are registered,
 * allowing the Agent to use the default fetch.
 *
 * When handlers exist, returns a factory that creates a fetch wrapper which:
 * - Emits http_request events before requests (with redacted auth headers)
 * - Allows extensions to add custom headers or cancel requests
 * - Emits http_response events after responses with timing
 *
 * Note: Not all providers support a custom fetch (depends on underlying SDK usage).
 */
export function createExtensionFetchFactory(
	runner: ExtensionRunner | undefined,
): ((model: Model<any>) => typeof globalThis.fetch) | undefined {
	if (!runner) return undefined;

	const hasHttpRequestHandlers = runner.hasHandlers("http_request");
	const hasHttpResponseHandlers = runner.hasHandlers("http_response");

	if (!hasHttpRequestHandlers && !hasHttpResponseHandlers) {
		return undefined;
	}

	return (model: Model<any>): typeof globalThis.fetch => {
		return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
			const method =
				init?.method || (typeof input !== "string" && !(input instanceof URL) ? input.method : undefined) || "GET";

			const normalizeHeaderValue = (value: unknown): string => {
				if (Array.isArray(value)) {
					return value.map((v) => String(v)).join(", ");
				}
				if (value === undefined || value === null) return "";
				return String(value);
			};

			// Build headers record from input Request + init
			let headers: Record<string, string> = {};

			if (typeof input !== "string" && !(input instanceof URL)) {
				headers = headersToRecord(input.headers);
			}

			if (init?.headers) {
				if (init.headers instanceof Headers) {
					headers = { ...headers, ...headersToRecord(init.headers) };
				} else if (Array.isArray(init.headers)) {
					for (const [key, value] of init.headers) {
						headers[key] = normalizeHeaderValue(value);
					}
				} else {
					for (const [key, value] of Object.entries(init.headers)) {
						headers[key] = normalizeHeaderValue(value);
					}
				}
			}

			// Emit http_request event with redacted headers
			let extraHeaders: Record<string, string> | undefined;
			if (hasHttpRequestHandlers) {
				const result = await runner.emitHttpRequest({
					provider: model.provider,
					modelId: model.id,
					url,
					method,
					headers: redactHeaders(headers),
					body: typeof init?.body === "string" ? init.body : undefined,
				});

				if (result?.cancel) {
					throw new Error("HTTP request cancelled by extension");
				}
				extraHeaders = result?.headers;
			}

			const finalInit: RequestInit = { ...init };
			if (extraHeaders) {
				finalInit.headers = { ...headers, ...extraHeaders };
			}

			const startTime = Date.now();
			const response = await globalThis.fetch(input, finalInit);
			const durationMs = Date.now() - startTime;

			if (hasHttpResponseHandlers) {
				await runner.emitHttpResponse({
					provider: model.provider,
					modelId: model.id,
					status: response.status,
					headers: headersToRecord(response.headers),
					durationMs,
				});
			}

			return response;
		};
	};
}
