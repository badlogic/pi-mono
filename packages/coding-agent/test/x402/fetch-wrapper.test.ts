import { describe, expect, test, vi } from "vitest";
import { PermitCache } from "../../examples/extensions/custom-provider-x402/src/cache.js";
import { createX402Fetch } from "../../examples/extensions/custom-provider-x402/src/fetch-wrapper.js";
import type { RouterConfig } from "../../examples/extensions/custom-provider-x402/src/types.js";

const ROUTER_CONFIG: RouterConfig = {
	network: "eip155:8453",
	asset: "0xAsset",
	payTo: "0xPayTo",
	facilitatorSigner: "0xPayTo",
	tokenName: "USD Coin",
	tokenVersion: "2",
	paymentHeader: "PAYMENT-SIGNATURE",
};

describe("x402 fetch wrapper", () => {
	test("skips payment header for /v1/config", async () => {
		const baseFetch = vi.fn(async () => new Response("{}", { status: 200 }));
		const signer = vi.fn();
		const cache = new PermitCache(() => 0);
		const wrappedFetch = createX402Fetch({
			baseFetch,
			resolveRouterConfig: async () => ROUTER_CONFIG,
			permitCache: cache,
			permitCap: "10000000",
			privateKey: `0x${"1".repeat(64)}`,
			routerUrl: "http://localhost:8080",
			signer,
		});

		await wrappedFetch("http://localhost:8080/v1/config");

		expect(baseFetch).toHaveBeenCalledTimes(1);
		expect(signer).not.toHaveBeenCalled();
	});

	test("injects payment header for inference requests", async () => {
		const baseFetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			expect(headers.get("PAYMENT-SIGNATURE")).toBe("sig-1");
			return new Response("{}", { status: 200 });
		});

		const signer = vi.fn(async () => ({
			paymentSig: "sig-1",
			deadline: 99999,
			maxValue: "10000000",
			nonce: "1",
			network: ROUTER_CONFIG.network,
			asset: ROUTER_CONFIG.asset,
			payTo: ROUTER_CONFIG.payTo,
		}));

		const wrappedFetch = createX402Fetch({
			baseFetch,
			resolveRouterConfig: async () => ROUTER_CONFIG,
			permitCache: new PermitCache(() => 0),
			permitCap: "10000000",
			privateKey: `0x${"1".repeat(64)}`,
			routerUrl: "http://localhost:8080",
			signer,
		});

		await wrappedFetch("http://localhost:8080/v1/chat/completions", { method: "POST", body: "{}" });

		expect(baseFetch).toHaveBeenCalledTimes(1);
		expect(signer).toHaveBeenCalledTimes(1);
	});

	test("retries once when response indicates stale permit", async () => {
		let call = 0;
		const paymentRequired = Buffer.from(
			JSON.stringify({
				accepts: [
					{
						network: "eip155:8453",
						asset: "0xAsset",
						payTo: "0xPayTo",
						extra: { maxAmountRequired: "20000000" },
					},
				],
			}),
			"utf8",
		).toString("base64");

		const seenHeaders: string[] = [];
		const baseFetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			seenHeaders.push(headers.get("PAYMENT-SIGNATURE") || "");
			call += 1;
			if (call === 1) {
				return new Response(JSON.stringify({ error: { code: "invalid_payment_signature", message: "stale" } }), {
					status: 402,
					headers: {
						"content-type": "application/json",
						"PAYMENT-REQUIRED": paymentRequired,
					},
				});
			}
			return new Response("{}", { status: 200 });
		});

		const signer = vi.fn(async ({ permitCap }: { permitCap: string }) => ({
			paymentSig: `sig-${permitCap}`,
			deadline: 99999,
			maxValue: permitCap,
			nonce: permitCap,
			network: ROUTER_CONFIG.network,
			asset: ROUTER_CONFIG.asset,
			payTo: ROUTER_CONFIG.payTo,
		}));

		const wrappedFetch = createX402Fetch({
			baseFetch,
			resolveRouterConfig: async () => ROUTER_CONFIG,
			permitCache: new PermitCache(() => 0),
			permitCap: "10000000",
			privateKey: `0x${"1".repeat(64)}`,
			routerUrl: "http://localhost:8080",
			signer,
		});

		const response = await wrappedFetch("http://localhost:8080/v1/chat/completions", {
			method: "POST",
			body: "{}",
		});

		expect(response.status).toBe(200);
		expect(baseFetch).toHaveBeenCalledTimes(2);
		expect(signer).toHaveBeenCalledTimes(2);
		expect(seenHeaders).toEqual(["sig-10000000", "sig-20000000"]);
	});
});
