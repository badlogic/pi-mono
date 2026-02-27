import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGitHubSignature } from "../src/host.js";

// ─── GitHub HMAC Signature Verification ──────────────────────────────────────

describe("verifyGitHubSignature", () => {
	const secret = "test-webhook-secret-123";
	const body = JSON.stringify({ action: "opened", number: 42 });

	function makeSignature(payload: string, s = secret): string {
		const digest = createHmac("sha256", s).update(payload, "utf-8").digest("hex");
		return `sha256=${digest}`;
	}

	it("returns true for a valid signature", () => {
		const sig = makeSignature(body);
		expect(verifyGitHubSignature(body, sig, secret)).toBe(true);
	});

	it("returns false for a tampered body", () => {
		const sig = makeSignature(body);
		const tamperedBody = JSON.stringify({ action: "opened", number: 99 });
		expect(verifyGitHubSignature(tamperedBody, sig, secret)).toBe(false);
	});

	it("returns false for a wrong secret", () => {
		const sig = makeSignature(body, "wrong-secret");
		expect(verifyGitHubSignature(body, sig, secret)).toBe(false);
	});

	it("returns false when prefix is missing", () => {
		const digest = createHmac("sha256", secret).update(body, "utf-8").digest("hex");
		expect(verifyGitHubSignature(body, digest, secret)).toBe(false);
	});

	it("returns false for empty signature", () => {
		expect(verifyGitHubSignature(body, "", secret)).toBe(false);
	});

	it("returns false for sha1 prefix instead of sha256", () => {
		const digest = createHmac("sha256", secret).update(body, "utf-8").digest("hex");
		expect(verifyGitHubSignature(body, `sha1=${digest}`, secret)).toBe(false);
	});

	it("uses timing-safe comparison (different-length digests return false)", () => {
		// This tests the length guard before timingSafeEqual
		expect(verifyGitHubSignature(body, "sha256=short", secret)).toBe(false);
	});

	it("handles unicode body correctly", () => {
		const unicodeBody = JSON.stringify({ title: "feat: añadir soporte 🚀" });
		const sig = makeSignature(unicodeBody);
		expect(verifyGitHubSignature(unicodeBody, sig, secret)).toBe(true);
	});
});
