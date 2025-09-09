import { describe, expect, it } from "vitest";
import { complete, stream } from "../src/generate.js";
import { getModel } from "../src/models.js";
import type { Api, Context, Model, OptionsForApi } from "../src/types.js";

async function testAbortSignal<TApi extends Api>(llm: Model<TApi>, options: OptionsForApi<TApi> = {}) {
	const context: Context = {
		messages: [
			{
				role: "user",
				content: "What is 15 + 27? Think step by step. Then list 50 first names.",
			},
		],
	};

	let abortFired = false;
	const controller = new AbortController();
	const response = await stream(llm, context, { ...options, signal: controller.signal });
	for await (const event of response) {
		if (abortFired) return;
		setTimeout(() => controller.abort(), 3000);
		abortFired = true;
		break;
	}
	const msg = await response.result();

	// If we get here without throwing, the abort didn't work
	expect(msg.stopReason).toBe("error");
	expect(msg.content.length).toBeGreaterThan(0);

	context.messages.push(msg);
	context.messages.push({ role: "user", content: "Please continue, but only generate 5 names." });

	const followUp = await complete(llm, context, options);
	expect(followUp.stopReason).toBe("stop");
	expect(followUp.content.length).toBeGreaterThan(0);
}

async function testImmediateAbort<TApi extends Api>(llm: Model<TApi>, options: OptionsForApi<TApi> = {}) {
	const controller = new AbortController();

	controller.abort();

	const context: Context = {
		messages: [{ role: "user", content: "Hello" }],
	};

	const response = await complete(llm, context, { ...options, signal: controller.signal });
	expect(response.stopReason).toBe("error");
}

describe("AI Providers Abort Tests", () => {
	describe.skipIf(!process.env.GEMINI_API_KEY)("Google Provider Abort", () => {
		const llm = getModel("google", "gemini-2.5-flash");

		it("should abort mid-stream", async () => {
			await testAbortSignal(llm, { thinking: { enabled: true } });
		});

		it("should handle immediate abort", async () => {
			await testImmediateAbort(llm, { thinking: { enabled: true } });
		});
	});

	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Completions Provider Abort", () => {
		const llm: Model<"openai-completions"> = {
			...getModel("openai", "gpt-4o-mini")!,
			api: "openai-completions",
		};

		it("should abort mid-stream", async () => {
			await testAbortSignal(llm);
		});

		it("should handle immediate abort", async () => {
			await testImmediateAbort(llm);
		});
	});

	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Responses Provider Abort", () => {
		const llm = getModel("openai", "gpt-5-mini");

		it("should abort mid-stream", async () => {
			await testAbortSignal(llm);
		});

		it("should handle immediate abort", async () => {
			await testImmediateAbort(llm);
		});
	});

	describe.skipIf(!process.env.ANTHROPIC_OAUTH_TOKEN)("Anthropic Provider Abort", () => {
		const llm = getModel("anthropic", "claude-opus-4-1-20250805");

		it("should abort mid-stream", async () => {
			await testAbortSignal(llm, { thinkingEnabled: true, thinkingBudgetTokens: 2048 });
		});

		it("should handle immediate abort", async () => {
			await testImmediateAbort(llm, { thinkingEnabled: true, thinkingBudgetTokens: 2048 });
		});
	});
});
