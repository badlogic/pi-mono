import type { AppRouter } from "@fugue/core";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";

export const trpc = createTRPCReact<AppRouter>();

export function createTrpcClient(baseUrl = "") {
	return trpc.createClient({
		links: [
			httpBatchLink({
				url: `${baseUrl}/trpc`,
				// Let the browser send session cookie automatically
			}),
		],
	});
}

/** Standalone client (non-React, for imperative calls) */
export function createRawClient(baseUrl = "") {
	return createTRPCClient<AppRouter>({
		links: [
			httpBatchLink({
				url: `${baseUrl}/trpc`,
			}),
		],
	});
}
