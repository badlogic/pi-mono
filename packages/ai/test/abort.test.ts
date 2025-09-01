import { describe, it, beforeAll, expect } from "vitest";
import { GoogleLLM } from "../src/providers/google.js";
import { OpenAICompletionsLLM } from "../src/providers/openai-completions.js";
import { OpenAIResponsesLLM } from "../src/providers/openai-responses.js";
import { AnthropicLLM } from "../src/providers/anthropic.js";
import type { LLM, LLMOptions, Context } from "../src/types.js";
import { getModel } from "../src/models.js";

async function testAbortSignal<T extends LLMOptions>(llm: LLM<T>, options: T = {} as T) {
    const context: Context = {
        messages: [{
            role: "user",
            content: "What is 15 + 27? Think step by step. Then list 50 first names."
        }]
    };

    let abortFired = false;
    const controller = new AbortController();
    const response = await llm.generate(context, {
        ...options,
        signal: controller.signal,
        onEvent: (event) => {
            // console.log(JSON.stringify(event, null, 2));
            if (abortFired) return;
            setTimeout(() => controller.abort(), 2000);
            abortFired = true;
        }
    });

    // If we get here without throwing, the abort didn't work
    expect(response.stopReason).toBe("error");
    expect(response.content.length).toBeGreaterThan(0);

    context.messages.push(response);
    context.messages.push({ role: "user", content: "Please continue, but only generate 5 names." });

    // Ensure we can still make requests after abort
    const followUp = await llm.generate(context, options);
    expect(followUp.stopReason).toBe("stop");
    expect(followUp.content.length).toBeGreaterThan(0);
}

async function testImmediateAbort<T extends LLMOptions>(llm: LLM<T>, options: T = {} as T) {
    const controller = new AbortController();

    // Abort immediately
    controller.abort();

    const context: Context = {
        messages: [{ role: "user", content: "Hello" }]
    };

    const response = await llm.generate(context, {
        ...options,
        signal: controller.signal
    });
    expect(response.stopReason).toBe("error");
}

describe("AI Providers Abort Tests", () => {
    describe.skipIf(!process.env.GEMINI_API_KEY)("Google Provider Abort", () => {
        let llm: GoogleLLM;

        beforeAll(() => {
            llm = new GoogleLLM(getModel("google", "gemini-2.5-flash")!, process.env.GEMINI_API_KEY!);
        });

        it("should abort mid-stream", async () => {
            await testAbortSignal(llm, { thinking: { enabled: true } });
        });

        it("should handle immediate abort", async () => {
            await testImmediateAbort(llm, { thinking: { enabled: true } });
        });
    });

    describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Completions Provider Abort", () => {
        let llm: OpenAICompletionsLLM;

        beforeAll(() => {
            llm = new OpenAICompletionsLLM(getModel("openai", "gpt-4o-mini")!, process.env.OPENAI_API_KEY!);
        });

        it("should abort mid-stream", async () => {
            await testAbortSignal(llm);
        });

        it("should handle immediate abort", async () => {
            await testImmediateAbort(llm);
        });
    });

    describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Responses Provider Abort", () => {
        let llm: OpenAIResponsesLLM;

        beforeAll(() => {
            const model = getModel("openai", "gpt-5-mini");
            if (!model) {
                throw new Error("Model not found");
            }
            llm = new OpenAIResponsesLLM(model, process.env.OPENAI_API_KEY!);
        });

        it("should abort mid-stream", async () => {
            await testAbortSignal(llm, {});
        });

        it("should handle immediate abort", async () => {
            await testImmediateAbort(llm, {});
        });
    });

    describe.skipIf(!process.env.ANTHROPIC_OAUTH_TOKEN)("Anthropic Provider Abort", () => {
        let llm: AnthropicLLM;

        beforeAll(() => {
            llm = new AnthropicLLM(getModel("anthropic", "claude-opus-4-1")!, process.env.ANTHROPIC_OAUTH_TOKEN!);
        });

        it("should abort mid-stream", async () => {
            await testAbortSignal(llm, {thinking: { enabled: true, budgetTokens: 2048 }});
        });

        it("should handle immediate abort", async () => {
            await testImmediateAbort(llm, {thinking: { enabled: true, budgetTokens: 2048 }});
        });
    });
});