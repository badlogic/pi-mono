import { describe, expect, it } from "vitest";
import { getChatgptAccountIdFromAccessToken } from "../src/utils/openai-account-id.js";

describe("getChatgptAccountIdFromAccessToken", () => {
	it("returns account id for a valid JWT-like token", () => {
		const payload = Buffer.from(
			JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acc_test" } }),
			"utf8",
		).toString("base64");
		const token = `aaa.${payload}.bbb`;
		expect(getChatgptAccountIdFromAccessToken(token)).toBe("acc_test");
	});

	it("returns null for malformed tokens", () => {
		expect(getChatgptAccountIdFromAccessToken("not-a-jwt")).toBe(null);
		expect(getChatgptAccountIdFromAccessToken("a.b")).toBe(null);
		expect(getChatgptAccountIdFromAccessToken("a.b.c.d")).toBe(null);
	});

	it("returns null when claim is missing", () => {
		const payload = Buffer.from(JSON.stringify({}), "utf8").toString("base64");
		const token = `aaa.${payload}.bbb`;
		expect(getChatgptAccountIdFromAccessToken(token)).toBe(null);
	});
});
