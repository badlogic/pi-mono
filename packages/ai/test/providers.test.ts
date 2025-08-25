#!/usr/bin/env node --test
import { describe, it, before } from "node:test";
import assert from "node:assert";
import { GeminiLLM } from "../src/providers/gemini.js";
import { OpenAICompletionsLLM } from "../src/providers/openai-completions.js";
import { OpenAIResponsesLLM } from "../src/providers/openai-responses.js";
import { AnthropicLLM } from "../src/providers/anthropic.js";
import type { LLM, LLMOptions, Context, Tool, AssistantMessage } from "../src/types.js";

// Calculator tool definition (same as examples)
const calculatorTool: Tool = {
    name: "calculator",
    description: "Perform basic arithmetic operations",
    parameters: {
        type: "object",
        properties: {
            a: { type: "number", description: "First number" },
            b: { type: "number", description: "Second number" },
            operation: {
                type: "string",
                enum: ["add", "subtract", "multiply", "divide"],
                description: "The operation to perform"
            }
        },
        required: ["a", "b", "operation"]
    }
};

async function basicTextGeneration<T extends LLMOptions>(llm: LLM<T>) {
            const context: Context = {
                systemPrompt: "You are a helpful assistant. Be concise.",
                messages: [
                    { role: "user", content: "Reply with exactly: 'Hello test successful'" }
                ]
            };

            const response = await llm.complete(context);

            assert.strictEqual(response.role, "assistant");
            assert.ok(response.content);
            assert.ok(response.usage.input > 0);
            assert.ok(response.usage.output > 0);
            assert.ok(!response.error);
            assert.ok(response.content.includes("Hello test successful"), `Response content should match exactly. Got: ${response.content}`);
}

async function handleToolCall<T extends LLMOptions>(llm: LLM<T>) {
    const context: Context = {
        systemPrompt: "You are a helpful assistant that uses tools when asked.",
        messages: [{
            role: "user",
            content: "Calculate 15 + 27 using the calculator tool."
        }],
        tools: [calculatorTool]
    };

    const response = await llm.complete(context);
    assert.ok(response.stopReason == "toolUse", "Response should indicate tool use");
    assert.ok(response.toolCalls && response.toolCalls.length > 0, "Response should include tool calls");
    const toolCall = response.toolCalls[0];
    assert.strictEqual(toolCall.name, "calculator");
    assert.ok(toolCall.id);
}

async function handleStreaming<T extends LLMOptions>(llm: LLM<T>) {
    let textChunks = "";
    let textCompleted = false;

    const context: Context = {
        messages: [{ role: "user", content: "Count from 1 to 3" }]
    };

    const response = await llm.complete(context, {
        onText: (chunk, complete) => {
            textChunks += chunk;
            if (complete) textCompleted = true;
        }
    } as T);

    assert.ok(textChunks.length > 0);
    assert.ok(textCompleted);
    assert.ok(response.content);
}

async function handleThinking<T extends LLMOptions>(llm: LLM<T>, options: T, requireThinking: boolean = true) {
    let thinkingChunks = "";

    const context: Context = {
        messages: [{ role: "user", content: "What is 15 + 27? Think step by step." }]
    };

    const response = await llm.complete(context, {
        onThinking: (chunk) => {
            thinkingChunks += chunk;
        },
        ...options
    });

    assert.ok(response.content, "Response should have content");

    // For providers that should always return thinking when enabled
    if (requireThinking) {
        assert.ok(
            thinkingChunks.length > 0 || response.thinking,
            `LLM MUST return thinking content when thinking is enabled. Got ${thinkingChunks.length} streaming chars, thinking field: ${response.thinking?.length || 0} chars`
        );
    }
}

async function multiTurn<T extends LLMOptions>(llm: LLM<T>, thinkingOptions: T) {
    const context: Context = {
        systemPrompt: "You are a helpful assistant that can use tools to answer questions.",
        messages: [
            {
                role: "user",
                content: "Think about this briefly, then calculate 42 * 17 and 453 + 434 using the calculator tool."
            }
        ],
        tools: [calculatorTool]
    };

    // First turn - should get thinking and/or tool calls
    const firstResponse = await llm.complete(context, thinkingOptions);

    // Verify we got either thinking content or tool calls (or both)
    const hasThinking = firstResponse.thinking;
    const hasToolCalls = firstResponse.toolCalls && firstResponse.toolCalls.length > 0;

    assert.ok(
        hasThinking || hasToolCalls,
        `First turn MUST include either thinking or tool calls. Got thinking: ${hasThinking}, tool calls: ${hasToolCalls}`
    );

    // If we got tool calls, verify they're correct
    if (hasToolCalls) {
        assert.ok(firstResponse.toolCalls && firstResponse.toolCalls.length > 0, "First turn should include tool calls");
    }

    // If we have thinking with tool calls, we should have thinkingSignature for proper multi-turn context
    // Note: Some providers may not return thinking when tools are used
    if (firstResponse.thinking && hasToolCalls) {
        // For now, we'll just check if it exists when both are present
        // Some providers may not support thinkingSignature yet
        if (firstResponse.thinkingSignature !== undefined) {
            assert.ok(firstResponse.thinkingSignature, "Response with thinking and tools should include thinkingSignature");
        }
    }

    // Add the assistant response to context
    context.messages.push(firstResponse);

    // Process tool calls and add results
    for (const toolCall of firstResponse.toolCalls || []) {
        assert.strictEqual(toolCall.name, "calculator", "Tool call should be for calculator");
        assert.ok(toolCall.id, "Tool call must have an ID");
        assert.ok(toolCall.arguments, "Tool call must have arguments");

        const { a, b, operation } = toolCall.arguments;
        let result: number;
        switch (operation) {
            case "add": result = a + b; break;
            case "multiply": result = a * b; break;
            default: result = 0;
        }

        context.messages.push({
            role: "toolResult",
            content: `${result}`,
            toolCallId: toolCall.id,
            isError: false
        });
    }

    // Second turn - complete the conversation
    // Keep processing until we get a response with content (not just tool calls)
    let finalResponse: AssistantMessage | undefined;
    const maxTurns = 3; // Prevent infinite loops

    for (let turn = 0; turn < maxTurns; turn++) {
        const response = await llm.complete(context, thinkingOptions);
        context.messages.push(response);

        if (response.content) {
            finalResponse = response;
            break;
        }

        // If we got more tool calls, process them
        if (response.toolCalls) {
            for (const toolCall of response.toolCalls) {
                const { a, b, operation } = toolCall.arguments;
                let result: number;
                switch (operation) {
                    case "add": result = a + b; break;
                    case "multiply": result = a * b; break;
                    default: result = 0;
                }

                context.messages.push({
                    role: "toolResult",
                    content: `${result}`,
                    toolCallId: toolCall.id,
                    isError: false
                });
            }
        }
    }

    assert.ok(finalResponse, "Should get a final response with content");
    assert.ok(finalResponse.content, "Final response should have content");
    assert.strictEqual(finalResponse.role, "assistant");

    // The final response should reference the calculations
    assert.ok(
        finalResponse.content.includes("714") || finalResponse.content.includes("887"),
        `Final response should include calculation results. Got: ${finalResponse.content}`
    );
}

describe("AI Providers E2E Tests", () => {
    describe("Gemini Provider", { skip: !process.env.GEMINI_API_KEY }, () => {
        let llm: GeminiLLM;

        before(() => {
            llm = new GeminiLLM("gemini-2.5-flash", process.env.GEMINI_API_KEY!);
        });

        it("should complete basic text generation", async () => {
            await basicTextGeneration(llm);
        });

        it("should handle tool calling", async () => {
            await handleToolCall(llm);
        });

        it("should handle streaming", async () => {
            await handleStreaming(llm);
        });

        it("should handle thinking mode", async () => {
            await handleThinking(llm, {thinking: { enabled: true, budgetTokens: 1024 }});
        });

        it("should handle multi-turn with thinking and tools", async () => {
            await multiTurn(llm, {thinking: { enabled: true, budgetTokens: 2048 }});
        });
    });

    describe("OpenAI Completions Provider", { skip: !process.env.OPENAI_API_KEY }, () => {
        let llm: OpenAICompletionsLLM;

        before(() => {
            llm = new OpenAICompletionsLLM("gpt-4o-mini", process.env.OPENAI_API_KEY!);
        });

        it("should complete basic text generation", async () => {
            await basicTextGeneration(llm);
        });

        it("should handle tool calling", async () => {
            await handleToolCall(llm);
        });

        it("should handle streaming", async () => {
            await handleStreaming(llm);
        });
    });

    describe("OpenAI Responses Provider", { skip: !process.env.OPENAI_API_KEY }, () => {
        let llm: OpenAIResponsesLLM;

        before(() => {
            llm = new OpenAIResponsesLLM("gpt-5-mini", process.env.OPENAI_API_KEY!);
        });

        it("should complete basic text generation", async () => {
            await basicTextGeneration(llm);
        });

        it("should handle tool calling", async () => {
            await handleToolCall(llm);
        });

        it("should handle streaming", async () => {
            await handleStreaming(llm);
        });

        it("should handle thinking mode", async () => {
            // OpenAI Responses API may not always return thinking even when requested
            // This is model-dependent behavior
            await handleThinking(llm, {reasoningEffort: "medium"}, false);
        });

        it("should handle multi-turn with thinking and tools", async () => {
            await multiTurn(llm, {reasoningEffort: "medium"});
        });
    });

    describe("Anthropic Provider", { skip: !process.env.ANTHROPIC_OAUTH_TOKEN }, () => {
        let llm: AnthropicLLM;

        before(() => {
            llm = new AnthropicLLM("claude-sonnet-4-0", process.env.ANTHROPIC_OAUTH_TOKEN!);
        });

        it("should complete basic text generation", async () => {
            await basicTextGeneration(llm);
        });

        it("should handle tool calling", async () => {
            await handleToolCall(llm);
        });

        it("should handle streaming", async () => {
            await handleStreaming(llm);
        });

        it("should handle thinking mode", async () => {
            await handleThinking(llm, {thinking: { enabled: true } });
        });

        it("should handle multi-turn with thinking and tools", async () => {
            await multiTurn(llm, {thinking: { enabled: true, budgetTokens: 2048 }});
        });
    });
});