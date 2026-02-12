import { describe, expect, test } from "vitest";
import { normalizeRouterConfig } from "../../examples/extensions/custom-provider-x402/src/router-config.js";

describe("x402 router config", () => {
	test("normalizes config response with explicit network data", () => {
		const config = normalizeRouterConfig({
			networks: [
				{
					network_id: "eip155:8453",
					active: true,
					asset: { address: "0xAsset" },
					pay_to: "0xPayTo",
				},
			],
			eip712_config: {
				domain_name: "USD Coin",
				domain_version: "2",
			},
			payment_header: "X-PAYMENT",
		});

		expect(config.network).toBe("eip155:8453");
		expect(config.asset).toBe("0xAsset");
		expect(config.payTo).toBe("0xPayTo");
		expect(config.facilitatorSigner).toBe("0xPayTo");
		expect(config.tokenName).toBe("USD Coin");
		expect(config.tokenVersion).toBe("2");
		expect(config.paymentHeader).toBe("X-PAYMENT");
	});

	test("chooses active network when multiple are provided", () => {
		const config = normalizeRouterConfig({
			networks: [
				{
					network_id: "eip155:84532",
					active: false,
					asset: { address: "0xSepolia" },
					pay_to: "0xSepoliaPay",
				},
				{
					network_id: "eip155:8453",
					active: true,
					asset: { address: "0xMainnet" },
					pay_to: "0xMainnetPay",
				},
			],
		});

		expect(config.network).toBe("eip155:8453");
		expect(config.asset).toBe("0xMainnet");
		expect(config.payTo).toBe("0xMainnetPay");
	});

	test("falls back to defaults when response is sparse", () => {
		const config = normalizeRouterConfig({});

		expect(config.network).toBe("eip155:8453");
		expect(config.asset).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
		expect(config.payTo).toBe("");
		expect(config.tokenName).toBe("USD Coin");
		expect(config.tokenVersion).toBe("2");
		expect(config.paymentHeader).toBe("PAYMENT-SIGNATURE");
	});
});
