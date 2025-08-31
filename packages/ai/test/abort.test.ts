import { describe, it, beforeAll, expect } from "vitest";
import { GoogleLLM } from "../src/providers/google.js";
import { OpenAICompletionsLLM } from "../src/providers/openai-completions.js";
import { OpenAIResponsesLLM } from "../src/providers/openai-responses.js";
import { AnthropicLLM } from "../src/providers/anthropic.js";
import type { LLM, LLMOptions, Context } from "../src/types.js";
import { getModel } from "../src/models.js";

async function testAbortSignal<T extends LLMOptions>(llm: LLM<T>) {
    const controller = new AbortController();

    // Abort after 100ms
    setTimeout(() => controller.abort(), 1000);

    const context: Context = {
        messages: [{
            role: "user",
            content: "Write a very long story about a dragon that lives in a mountain. Include lots of details about the dragon's appearance, its daily life, the treasures it guards, and its interactions with nearby villages. Make it at least 1000 words long."
        }]
    };

    const response = await llm.complete(context, {
        signal: controller.signal
    } as T);

    // If we get here without throwing, the abort didn't work
    expect(response.stopReason).toBe("error");
}

async function testImmediateAbort<T extends LLMOptions>(llm: LLM<T>) {
    const controller = new AbortController();

    // Abort immediately
    controller.abort();

    const context: Context = {
        messages: [{ role: "user", content: "Hello" }]
    };

    const response = await llm.complete(context, {
        signal: controller.signal
    } as T);
    expect(response.stopReason).toBe("error");
}

describe("AI Providers Abort Tests", () => {
    describe.skipIf(!process.env.GEMINI_API_KEY)("Google Provider Abort", () => {
        let llm: GoogleLLM;

        beforeAll(() => {
            llm = new GoogleLLM(getModel("google", "gemini-2.5-flash")!, process.env.GEMINI_API_KEY!);
        });

        it("should abort mid-stream", async () => {
            await testAbortSignal(llm);
        });

        it("should handle immediate abort", async () => {
            await testImmediateAbort(llm);
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
            await testAbortSignal(llm);
        });

        it("should handle immediate abort", async () => {
            await testImmediateAbort(llm);
        });
    });

    describe.skipIf(!process.env.ANTHROPIC_API_KEY)("Anthropic Provider Abort", () => {
        let llm: AnthropicLLM;

        beforeAll(() => {
            llm = new AnthropicLLM(getModel("anthropic", "claude-3-5-haiku-latest")!, process.env.ANTHROPIC_API_KEY!);
        });

        it("should abort mid-stream", async () => {
            await testAbortSignal(llm);
        });

        it("should handle immediate abort", async () => {
            await testImmediateAbort(llm);
        });
    });
});