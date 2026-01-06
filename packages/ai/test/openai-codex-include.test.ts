import { describe, expect, it } from "vitest";
import { type RequestBody, transformRequestBody } from "../src/providers/openai-codex/request-transformer.js";

describe("openai-codex include handling", () => {
	it("always includes reasoning.encrypted_content when caller include is custom", async () => {
		const body: RequestBody = {
			model: "gpt-5.1-codex",
		};

		const transformed = await transformRequestBody(body, { include: ["foo"] });
		expect(transformed.include).toEqual(["foo", "reasoning.encrypted_content"]);
	});

	it("does not duplicate reasoning.encrypted_content", async () => {
		const body: RequestBody = {
			model: "gpt-5.1-codex",
		};

		const transformed = await transformRequestBody(body, {
			include: ["foo", "reasoning.encrypted_content"],
		});
		expect(transformed.include).toEqual(["foo", "reasoning.encrypted_content"]);
	});
});
