import { type PermitCache, shouldInvalidatePermit } from "./cache.js";
import {
	applyPaymentRequirement,
	decodePaymentRequiredHeader,
	getRequirementMaxAmountRequired,
	parseErrorResponse,
} from "./payment-required.js";
import type { CachedPermit, RouterConfig, SignPermit } from "./types.js";

interface X402FetchOptions {
	baseFetch?: typeof fetch;
	resolveRouterConfig: () => Promise<RouterConfig>;
	permitCache: PermitCache;
	permitCap: string;
	privateKey: string;
	routerUrl: string;
	signer: SignPermit;
}

function normalizeRouterOrigin(routerUrl: string): string {
	try {
		return new URL(routerUrl).origin;
	} catch {
		return routerUrl;
	}
}

function extractUrl(input: string | URL | Request): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	return input.url;
}

function shouldSkipInjection(pathname: string): boolean {
	return (
		pathname.endsWith("/config") ||
		pathname.endsWith("/v1/config") ||
		pathname.endsWith("/models") ||
		pathname.endsWith("/v1/models")
	);
}

function withHeader(
	input: string | URL | Request,
	init: RequestInit | undefined,
	headerName: string,
	value: string,
): RequestInit {
	const headers = new Headers(input instanceof Request ? input.headers : undefined);
	if (init?.headers) {
		new Headers(init.headers).forEach((headerValue, headerKey) => {
			headers.set(headerKey, headerValue);
		});
	}
	headers.set(headerName, value);
	return { ...init, headers };
}

async function extractErrorResponse(response: Response) {
	try {
		const data = (await response.clone().json()) as unknown;
		return parseErrorResponse(data);
	} catch {
		return null;
	}
}

export function createX402Fetch(options: X402FetchOptions): typeof fetch {
	const baseFetch = options.baseFetch ?? fetch;
	const routerOrigin = normalizeRouterOrigin(options.routerUrl);

	return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const rawUrl = extractUrl(input);
		let requestUrl: URL;
		try {
			requestUrl = new URL(rawUrl, routerOrigin);
		} catch {
			return baseFetch(input, init);
		}

		if (requestUrl.origin !== routerOrigin || shouldSkipInjection(requestUrl.pathname)) {
			return baseFetch(input, init);
		}

		const initialRouterConfig = await options.resolveRouterConfig();
		const sendWithPermit = async (routerConfig: RouterConfig, permitCap: string): Promise<Response> => {
			const cached = options.permitCache.get(
				routerConfig.network,
				routerConfig.asset,
				routerConfig.payTo,
				permitCap,
			);
			const permit: CachedPermit =
				cached ??
				(await options.signer({
					privateKey: options.privateKey,
					routerConfig,
					permitCap,
				}));
			if (!cached) {
				options.permitCache.set(permit);
			}

			const requestInit = withHeader(input, init, routerConfig.paymentHeader, permit.paymentSig);
			return baseFetch(input, requestInit);
		};

		const firstResponse = await sendWithPermit(initialRouterConfig, options.permitCap);
		if (firstResponse.status !== 401 && firstResponse.status !== 402) {
			return firstResponse;
		}

		const parsedError = await extractErrorResponse(firstResponse);
		if (!shouldInvalidatePermit(parsedError)) {
			return firstResponse;
		}

		const paymentRequiredHeader = firstResponse.headers.get("PAYMENT-REQUIRED");
		const decodedPaymentRequired = paymentRequiredHeader ? decodePaymentRequiredHeader(paymentRequiredHeader) : null;
		const requirement = decodedPaymentRequired?.accepts?.[0];
		const retryRouterConfig = applyPaymentRequirement(initialRouterConfig, requirement);
		const requiredPermitCap = getRequirementMaxAmountRequired(requirement) ?? options.permitCap;

		options.permitCache.invalidate(
			initialRouterConfig.network,
			initialRouterConfig.asset,
			initialRouterConfig.payTo,
			options.permitCap,
		);
		if (
			retryRouterConfig.network !== initialRouterConfig.network ||
			retryRouterConfig.asset !== initialRouterConfig.asset ||
			retryRouterConfig.payTo !== initialRouterConfig.payTo ||
			requiredPermitCap !== options.permitCap
		) {
			options.permitCache.invalidate(
				retryRouterConfig.network,
				retryRouterConfig.asset,
				retryRouterConfig.payTo,
				requiredPermitCap,
			);
		}

		return sendWithPermit(retryRouterConfig, requiredPermitCap);
	};
}
