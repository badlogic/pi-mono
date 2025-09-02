import { describe, it, beforeAll, expect } from "vitest";
import { GoogleLLM } from "../src/providers/google.js";
import { OpenAICompletionsLLM } from "../src/providers/openai-completions.js";
import { OpenAIResponsesLLM } from "../src/providers/openai-responses.js";
import { AnthropicLLM } from "../src/providers/anthropic.js";
import type { LLM, LLMOptions, Context, UserMessage, AssistantMessage } from "../src/types.js";
import { getModel } from "../src/models.js";

async function testEmptyMessage<T extends LLMOptions>(llm: LLM<T>, options: T = {} as T) {
    // Test with completely empty content array
    const emptyMessage: UserMessage = {
        role: "user",
        content: []
    };

    const context: Context = {
        messages: [emptyMessage]
    };

    const response = await llm.generate(context, options);
    
    // Should either handle gracefully or return an error
    expect(response).toBeDefined();
    expect(response.role).toBe("assistant");
    
    // Most providers should return an error or empty response
    if (response.stopReason === "error") {
        expect(response.error).toBeDefined();
    } else {
        // If it didn't error, it should have some content or gracefully handle empty
        expect(response.content).toBeDefined();
    }
}

async function testEmptyStringMessage<T extends LLMOptions>(llm: LLM<T>, options: T = {} as T) {
    // Test with empty string content
    const context: Context = {
        messages: [{
            role: "user",
            content: ""
        }]
    };

    const response = await llm.generate(context, options);
    
    expect(response).toBeDefined();
    expect(response.role).toBe("assistant");
    
    // Should handle empty string gracefully
    if (response.stopReason === "error") {
        expect(response.error).toBeDefined();
    } else {
        expect(response.content).toBeDefined();
    }
}

async function testWhitespaceOnlyMessage<T extends LLMOptions>(llm: LLM<T>, options: T = {} as T) {
    // Test with whitespace-only content
    const context: Context = {
        messages: [{
            role: "user",
            content: "   \n\t  "
        }]
    };

    const response = await llm.generate(context, options);
    
    expect(response).toBeDefined();
    expect(response.role).toBe("assistant");
    
    // Should handle whitespace-only gracefully
    if (response.stopReason === "error") {
        expect(response.error).toBeDefined();
    } else {
        expect(response.content).toBeDefined();
    }
}

async function testEmptyAssistantMessage<T extends LLMOptions>(llm: LLM<T>, options: T = {} as T) {
    // Test with empty assistant message in conversation flow
    // User -> Empty Assistant -> User
    const emptyAssistant: AssistantMessage = {
        role: "assistant",
        content: [],
        api: llm.getApi(),
        provider: llm.getModel().provider,
        model: llm.getModel().id,
        usage: {
            input: 10,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: "stop"
    };

    const context: Context = {
        messages: [
            {
                role: "user",
                content: "Hello, how are you?"
            },
            emptyAssistant,
            {
                role: "user",
                content: "Please respond this time."
            }
        ]
    };

    const response = await llm.generate(context, options);
    
    expect(response).toBeDefined();
    expect(response.role).toBe("assistant");
    
    // Should handle empty assistant message in context gracefully
    if (response.stopReason === "error") {
        expect(response.error).toBeDefined();
    } else {
        expect(response.content).toBeDefined();
        expect(response.content.length).toBeGreaterThan(0);
    }
}

describe("AI Providers Empty Message Tests", () => {
    describe.skipIf(!process.env.GEMINI_API_KEY)("Google Provider Empty Messages", () => {
        let llm: GoogleLLM;

        beforeAll(() => {
            llm = new GoogleLLM(getModel("google", "gemini-2.5-flash")!, process.env.GEMINI_API_KEY!);
        });

        it("should handle empty content array", async () => {
            await testEmptyMessage(llm);
        });

        it("should handle empty string content", async () => {
            await testEmptyStringMessage(llm);
        });

        it("should handle whitespace-only content", async () => {
            await testWhitespaceOnlyMessage(llm);
        });

        it("should handle empty assistant message in conversation", async () => {
            await testEmptyAssistantMessage(llm);
        });
    });

    describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Completions Provider Empty Messages", () => {
        let llm: OpenAICompletionsLLM;

        beforeAll(() => {
            llm = new OpenAICompletionsLLM(getModel("openai", "gpt-4o-mini")!, process.env.OPENAI_API_KEY!);
        });

        it("should handle empty content array", async () => {
            await testEmptyMessage(llm);
        });

        it("should handle empty string content", async () => {
            await testEmptyStringMessage(llm);
        });

        it("should handle whitespace-only content", async () => {
            await testWhitespaceOnlyMessage(llm);
        });

        it("should handle empty assistant message in conversation", async () => {
            await testEmptyAssistantMessage(llm);
        });
    });

    describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Responses Provider Empty Messages", () => {
        let llm: OpenAIResponsesLLM;

        beforeAll(() => {
            const model = getModel("openai", "gpt-5-mini");
            if (!model) {
                throw new Error("Model gpt-5-mini not found");
            }
            llm = new OpenAIResponsesLLM(model, process.env.OPENAI_API_KEY!);
        });

        it("should handle empty content array", async () => {
            await testEmptyMessage(llm);
        });

        it("should handle empty string content", async () => {
            await testEmptyStringMessage(llm);
        });

        it("should handle whitespace-only content", async () => {
            await testWhitespaceOnlyMessage(llm);
        });

        it("should handle empty assistant message in conversation", async () => {
            await testEmptyAssistantMessage(llm);
        });
    });

    describe.skipIf(!process.env.ANTHROPIC_OAUTH_TOKEN)("Anthropic Provider Empty Messages", () => {
        let llm: AnthropicLLM;

        beforeAll(() => {
            llm = new AnthropicLLM(getModel("anthropic", "claude-3-5-haiku-20241022")!, process.env.ANTHROPIC_OAUTH_TOKEN!);
        });

        it("should handle empty content array", async () => {
            await testEmptyMessage(llm);
        });

        it("should handle empty string content", async () => {
            await testEmptyStringMessage(llm);
        });

        it("should handle whitespace-only content", async () => {
            await testWhitespaceOnlyMessage(llm);
        });

        it("should handle empty assistant message in conversation", async () => {
            await testEmptyAssistantMessage(llm);
        });
    });

    // Test with xAI/Grok if available
    describe.skipIf(!process.env.XAI_API_KEY)("xAI Provider Empty Messages", () => {
        let llm: OpenAICompletionsLLM;

        beforeAll(() => {
            const model = getModel("xai", "grok-3");
            if (!model) {
                throw new Error("Model grok-3 not found");
            }
            llm = new OpenAICompletionsLLM(model, process.env.XAI_API_KEY!);
        });

        it("should handle empty content array", async () => {
            await testEmptyMessage(llm);
        });

        it("should handle empty string content", async () => {
            await testEmptyStringMessage(llm);
        });

        it("should handle whitespace-only content", async () => {
            await testWhitespaceOnlyMessage(llm);
        });

        it("should handle empty assistant message in conversation", async () => {
            await testEmptyAssistantMessage(llm);
        });
    });

    // Test with Groq if available
    describe.skipIf(!process.env.GROQ_API_KEY)("Groq Provider Empty Messages", () => {
        let llm: OpenAICompletionsLLM;

        beforeAll(() => {
            const model = getModel("groq", "llama-3.3-70b-versatile");
            if (!model) {
                throw new Error("Model llama-3.3-70b-versatile not found");
            }
            llm = new OpenAICompletionsLLM(model, process.env.GROQ_API_KEY!);
        });

        it("should handle empty content array", async () => {
            await testEmptyMessage(llm);
        });

        it("should handle empty string content", async () => {
            await testEmptyStringMessage(llm);
        });

        it("should handle whitespace-only content", async () => {
            await testWhitespaceOnlyMessage(llm);
        });

        it("should handle empty assistant message in conversation", async () => {
            await testEmptyAssistantMessage(llm);
        });
    });

    // Test with Cerebras if available
    describe.skipIf(!process.env.CEREBRAS_API_KEY)("Cerebras Provider Empty Messages", () => {
        let llm: OpenAICompletionsLLM;

        beforeAll(() => {
            const model = getModel("cerebras", "gpt-oss-120b");
            if (!model) {
                throw new Error("Model gpt-oss-120b not found");
            }
            llm = new OpenAICompletionsLLM(model, process.env.CEREBRAS_API_KEY!);
        });

        it("should handle empty content array", async () => {
            await testEmptyMessage(llm);
        });

        it("should handle empty string content", async () => {
            await testEmptyStringMessage(llm);
        });

        it("should handle whitespace-only content", async () => {
            await testWhitespaceOnlyMessage(llm);
        });

        it("should handle empty assistant message in conversation", async () => {
            await testEmptyAssistantMessage(llm);
        });
    });
});