import { describe, expect, it } from "vitest";
import { createRawClient } from "../src/trpc.js";

describe("createRawClient", () => {
	it("creates a client without throwing", () => {
		expect(() => createRawClient("http://localhost:3001")).not.toThrow();
	});

	it("creates a client with default empty baseUrl", () => {
		expect(() => createRawClient()).not.toThrow();
	});
});
