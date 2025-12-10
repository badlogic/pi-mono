import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { stream } from "../src/stream.js";
import type { Api, Context, Model, OptionsForApi } from "../src/types.js";

async function testTokensOnAbort<TApi extends Api>(llm: Model<TApi>, options: OptionsForApi<TApi> = {}) {
	const context: Context = {
		messages: [
			{
				role: "user",
				content: "Write a long poem with 10 stanzas about the beauty of nature.",
				timestamp: Date.now(),
			},
		],
	};

	const controller = new AbortController();
	const response = stream(llm, context, { ...options, signal: controller.signal });

	let abortFired = false;
	for await (const event of response) {
		if (!abortFired && (event.type === "text_delta" || event.type === "thinking_delta")) {
			abortFired = true;
			setTimeout(() => controller.abort(), 3000);
		}
	}

	const msg = await response.result();

	expect(msg.stopReason).toBe("aborted");

	// OpenAI providers only send usage in the final chunk, so when aborted they have no token stats
	// Anthropic and Google send usage information early in the stream
	if (llm.api === "openai-completions" || llm.api === "openai-responses") {
		expect(msg.usage.input).toBe(0);
		expect(msg.usage.output).toBe(0);
	} else {
		expect(msg.usage.input).toBeGreaterThan(0);
		expect(msg.usage.output).toBeGreaterThan(0);
		expect(msg.usage.cost.input).toBeGreaterThan(0);
		expect(msg.usage.cost.total).toBeGreaterThan(0);
	}
}

describe("Token Statistics on Abort", () => {
	describe.skipIf(!process.env.GEMINI_API_KEY)("Google Provider", () => {
		const llm = getModel("google", "gemini-2.5-flash");

		it("should include token stats when aborted mid-stream", async () => {
			await testTokensOnAbort(llm, { thinking: { enabled: true } });
		}, 10000);
	});

	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Completions Provider", () => {
		const llm: Model<"openai-completions"> = {
			...getModel("openai", "gpt-4o-mini")!,
			api: "openai-completions",
		};

		it("should include token stats when aborted mid-stream", async () => {
			await testTokensOnAbort(llm);
		}, 10000);
	});

	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Responses Provider", () => {
		const llm = getModel("openai", "gpt-5-mini");

		it("should include token stats when aborted mid-stream", async () => {
			await testTokensOnAbort(llm);
		}, 20000);
	});

	describe.skipIf(!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_OAUTH_TOKEN)("Anthropic Provider", () => {
		const llm = getModel("anthropic", "claude-opus-4-1-20250805");

		it("should include token stats when aborted mid-stream", async () => {
			await testTokensOnAbort(llm, { thinkingEnabled: true, thinkingBudgetTokens: 2048 });
		}, 10000);
	});

	describe.skipIf(!process.env.MISTRAL_API_KEY)("Mistral Provider", () => {
		const llm = getModel("mistral", "devstral-medium-latest");

		it("should include token stats when aborted mid-stream", async () => {
			await testTokensOnAbort(llm);
		}, 10000);
	});
});
