import { describe, expect, it } from "vitest";
import { isValidId, newId } from "../src/id.js";

describe("newId", () => {
	it("returns a valid UUID v4", () => {
		const id = newId();
		expect(isValidId(id)).toBe(true);
	});

	it("returns unique IDs", () => {
		const ids = new Set(Array.from({ length: 100 }, () => newId()));
		expect(ids.size).toBe(100);
	});
});

describe("isValidId", () => {
	it("accepts valid UUID v4", () => {
		expect(isValidId("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true); // v4
		expect(isValidId("550e8400-e29b-11e4-b716-446655440000")).toBe(false); // v1 (version=1)
	});

	it("rejects empty string", () => {
		expect(isValidId("")).toBe(false);
	});

	it("rejects non-UUID string", () => {
		expect(isValidId("not-a-uuid")).toBe(false);
	});

	it("rejects UUID with wrong version", () => {
		expect(isValidId("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(false); // v1
	});

	it("newId output always passes isValidId", () => {
		for (let i = 0; i < 20; i++) {
			expect(isValidId(newId())).toBe(true);
		}
	});
});
