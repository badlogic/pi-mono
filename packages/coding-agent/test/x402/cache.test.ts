import { describe, expect, test } from "vitest";
import { type CachedPermit, PermitCache } from "../../examples/extensions/custom-provider-x402/src/cache.js";

describe("x402 permit cache", () => {
	test("returns a cached permit while valid", () => {
		const now = 1000;
		const cache = new PermitCache(() => now);
		const permit: CachedPermit = {
			paymentSig: "sig-1",
			deadline: now + 5000,
			maxValue: "10000000",
			nonce: "1",
			network: "eip155:8453",
			asset: "0xAsset",
			payTo: "0xPayTo",
		};

		cache.set(permit);
		expect(cache.get("eip155:8453", "0xAsset", "0xPayTo", "10000000")).toEqual(permit);
	});

	test("returns undefined after expiry", () => {
		let now = 1000;
		const cache = new PermitCache(() => now);
		cache.set({
			paymentSig: "sig-1",
			deadline: now + 10,
			maxValue: "10000000",
			nonce: "1",
			network: "eip155:8453",
			asset: "0xAsset",
			payTo: "0xPayTo",
		});

		now = 2000;
		expect(cache.get("eip155:8453", "0xAsset", "0xPayTo", "10000000")).toBeUndefined();
	});

	test("invalidates permits by key", () => {
		const cache = new PermitCache(() => 1000);
		cache.set({
			paymentSig: "sig-1",
			deadline: 2000,
			maxValue: "10000000",
			nonce: "1",
			network: "eip155:8453",
			asset: "0xAsset",
			payTo: "0xPayTo",
		});

		cache.invalidate("eip155:8453", "0xAsset", "0xPayTo", "10000000");
		expect(cache.get("eip155:8453", "0xAsset", "0xPayTo", "10000000")).toBeUndefined();
	});

	test("separates cache entries by permit cap", () => {
		const cache = new PermitCache(() => 1000);
		cache.set({
			paymentSig: "sig-1",
			deadline: 2000,
			maxValue: "10000000",
			nonce: "1",
			network: "eip155:8453",
			asset: "0xAsset",
			payTo: "0xPayTo",
		});
		cache.set({
			paymentSig: "sig-2",
			deadline: 2000,
			maxValue: "20000000",
			nonce: "2",
			network: "eip155:8453",
			asset: "0xAsset",
			payTo: "0xPayTo",
		});

		expect(cache.get("eip155:8453", "0xAsset", "0xPayTo", "10000000")?.paymentSig).toBe("sig-1");
		expect(cache.get("eip155:8453", "0xAsset", "0xPayTo", "20000000")?.paymentSig).toBe("sig-2");
	});
});
