import { describe, expect, it } from "vitest";
import { isThinkingPart, retainThoughtSignature } from "../src/providers/google-shared.js";

describe("Google thinking detection (thoughtSignature)", () => {
	it("treats part.thought === true as thinking", () => {
		expect(isThinkingPart({ thought: true, thoughtSignature: undefined })).toBe(true);
	});

	it("treats a non-empty thoughtSignature as thinking even if thought is missing", () => {
		// This is the bug: some backends omit `thought: true` but still include `thoughtSignature`
		expect(isThinkingPart({ thought: undefined, thoughtSignature: "opaque-signature" })).toBe(true);
		expect(isThinkingPart({ thought: false, thoughtSignature: "opaque-signature" })).toBe(true);
	});

	it("does not treat empty/missing signatures as thinking if thought is not set", () => {
		expect(isThinkingPart({ thought: undefined, thoughtSignature: undefined })).toBe(false);
		expect(isThinkingPart({ thought: false, thoughtSignature: "" })).toBe(false);
	});

	it("preserves the existing signature when subsequent deltas omit thoughtSignature", () => {
		const first = retainThoughtSignature(undefined, "sig-1");
		expect(first).toBe("sig-1");

		const second = retainThoughtSignature(first, undefined);
		expect(second).toBe("sig-1");

		const third = retainThoughtSignature(second, "");
		expect(third).toBe("sig-1");
	});

	it("updates the signature when a new non-empty signature arrives", () => {
		const updated = retainThoughtSignature("sig-1", "sig-2");
		expect(updated).toBe("sig-2");
	});

	// Note: signature-only parts (empty text + thoughtSignature) are handled by isThinkingPart via thoughtSignature presence.
});
