import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { streamSimple } from "../src/api/bedrock-mantle.ts";
import { hasApi } from "../src/models.ts";
import { getBuiltinModels } from "../src/providers/all.ts";
import type { Model } from "../src/types.ts";
import { normalizeContext } from "../src/utils/transcript.ts";

function mantleModels(): Model<"openai-responses">[] {
	return getBuiltinModels("amazon-bedrock").filter((model) => hasApi(model, "openai-responses"));
}

const context = normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 0 }] });

describe("Bedrock Mantle", () => {
	let savedToken: string | undefined;
	beforeEach(() => {
		savedToken = process.env.AWS_BEARER_TOKEN_BEDROCK;
		delete process.env.AWS_BEARER_TOKEN_BEDROCK;
	});
	afterEach(() => {
		if (savedToken === undefined) delete process.env.AWS_BEARER_TOKEN_BEDROCK;
		else process.env.AWS_BEARER_TOKEN_BEDROCK = savedToken;
	});

	it("routes models Converse does not serve to the Mantle Responses endpoint", () => {
		const models = mantleModels();
		expect(models.length).toBeGreaterThan(0);
		for (const model of models) {
			expect(model.baseUrl).toMatch(/^https:\/\/bedrock-mantle\.\{region\}\.api\.aws\//);
		}
		const converse = getBuiltinModels("amazon-bedrock").filter((model) => hasApi(model, "bedrock-converse-stream"));
		expect(converse.some((model) => model.id.includes("anthropic.claude"))).toBe(true);
	});

	it("sends Responses requests to the regional Mantle host with the Bedrock API key", async () => {
		const model = mantleModels()[0];
		const requests: { url: string; authorization: string | null }[] = [];
		const result = await streamSimple(model, context, {
			apiKey: "bedrock-api-key",
			env: { AWS_REGION: "us-west-2" },
			fetch: async (input, init) => {
				requests.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
				return new Response(JSON.stringify({ error: { message: "captured" } }), { status: 400 });
			},
		}).result();

		expect(result.stopReason).toBe("error");
		expect(requests[0]).toEqual({
			url: `${model.baseUrl.replace("{region}", "us-west-2")}/responses`,
			authorization: "Bearer bedrock-api-key",
		});
	});

	it("explains that Mantle models need a Bedrock API key", async () => {
		const result = await streamSimple(mantleModels()[0], context, { env: {} }).result();
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toContain("AWS_BEARER_TOKEN_BEDROCK");
	});
});
