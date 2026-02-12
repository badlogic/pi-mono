import { describe, expect, test } from "vitest";
import { loadX402Env } from "../../examples/extensions/custom-provider-x402/src/env.js";

const VALID_PRIVATE_KEY = `0x${"1".repeat(64)}`;

describe("x402 env", () => {
	test("loads env with defaults", () => {
		const config = loadX402Env({
			X402_PRIVATE_KEY: VALID_PRIVATE_KEY,
		});

		expect(config.privateKey).toBe(VALID_PRIVATE_KEY);
		expect(config.routerUrl).toBe("http://localhost:8080");
		expect(config.network).toBe("eip155:8453");
		expect(config.permitCap).toBe("10000000");
		expect(config.paymentHeader).toBe("PAYMENT-SIGNATURE");
		expect(config.modelId).toBe("x402/gpt-4.1-mini");
		expect(config.modelName).toBe("x402 GPT-4.1 Mini");
	});

	test("throws when private key is missing", () => {
		expect(() => loadX402Env({})).toThrow("X402_PRIVATE_KEY is required");
	});

	test("throws when private key format is invalid", () => {
		expect(() =>
			loadX402Env({
				X402_PRIVATE_KEY: "not-a-key",
			}),
		).toThrow("X402_PRIVATE_KEY must be a 0x-prefixed 64-byte hex string");
	});

	test("normalizes uppercase private key prefix", () => {
		const config = loadX402Env({
			X402_PRIVATE_KEY: `0X${"a".repeat(64)}`,
		});

		expect(config.privateKey).toBe(`0x${"a".repeat(64)}`);
	});

	test("throws when permit cap is invalid", () => {
		expect(() =>
			loadX402Env({
				X402_PRIVATE_KEY: VALID_PRIVATE_KEY,
				X402_PERMIT_CAP: "-1",
			}),
		).toThrow("X402_PERMIT_CAP must be a positive integer string");
	});
});
