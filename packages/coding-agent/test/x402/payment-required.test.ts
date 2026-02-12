import { describe, expect, test } from "vitest";
import {
	applyPaymentRequirement,
	decodePaymentRequiredHeader,
	getRequirementMaxAmountRequired,
	parseErrorResponse,
	shouldInvalidatePermit,
} from "../../examples/extensions/custom-provider-x402/src/payment-required.js";
import type { RouterConfig } from "../../examples/extensions/custom-provider-x402/src/types.js";

describe("x402 payment-required helpers", () => {
	test("decodes PAYMENT-REQUIRED header", () => {
		const payload = {
			accepts: [
				{
					network: "eip155:8453",
					asset: "0xAsset",
					payTo: "0xPayTo",
					extra: {
						name: "USD Coin",
						version: "2",
						maxAmountRequired: "2000000",
					},
				},
			],
		};
		const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

		expect(decodePaymentRequiredHeader(encoded)).toEqual(payload);
	});

	test("extracts required amount across schema variants", () => {
		expect(
			getRequirementMaxAmountRequired({
				extra: { max_amount_required: "1" },
			}),
		).toBe("1");
		expect(
			getRequirementMaxAmountRequired({
				extra: { maxAmountRequired: "2" },
			}),
		).toBe("2");
		expect(
			getRequirementMaxAmountRequired({
				extra: { maxAmount: "3" },
			}),
		).toBe("3");
	});

	test("maps requirement fields onto router config", () => {
		const base: RouterConfig = {
			network: "eip155:8453",
			asset: "0xAsset",
			payTo: "0xPayTo",
			facilitatorSigner: "0xPayTo",
			tokenName: "USD Coin",
			tokenVersion: "2",
			paymentHeader: "PAYMENT-SIGNATURE",
		};

		const updated = applyPaymentRequirement(base, {
			network: "eip155:84532",
			asset: "0xNewAsset",
			pay_to: "0xNewPayTo",
			extra: { name: "USDC", version: "3" },
		});

		expect(updated.network).toBe("eip155:84532");
		expect(updated.asset).toBe("0xNewAsset");
		expect(updated.payTo).toBe("0xNewPayTo");
		expect(updated.facilitatorSigner).toBe("0xNewPayTo");
		expect(updated.tokenName).toBe("USDC");
		expect(updated.tokenVersion).toBe("3");
	});

	test("recognizes invalid-permit style errors for invalidation", () => {
		const parsed = parseErrorResponse({
			error: {
				code: "invalid_payment_signature",
				message: "invalid permit signature",
			},
		});

		expect(parsed).toEqual({
			code: "invalid_payment_signature",
			error: "invalid permit signature",
			message: "invalid permit signature",
		});
		expect(shouldInvalidatePermit(parsed)).toBe(true);
	});

	test("does not invalidate for unrelated errors", () => {
		expect(
			shouldInvalidatePermit({
				code: "rate_limit",
				error: "too many requests",
			}),
		).toBe(false);
	});
});
