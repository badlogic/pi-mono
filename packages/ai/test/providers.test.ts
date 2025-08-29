import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { GoogleLLM } from "../src/providers/google.js";
import { OpenAICompletionsLLM } from "../src/providers/openai-completions.js";
import { OpenAIResponsesLLM } from "../src/providers/openai-responses.js";
import { AnthropicLLM } from "../src/providers/anthropic.js";
import type { LLM, LLMOptions, Context, Tool, AssistantMessage, Model } from "../src/types.js";
import { spawn, ChildProcess, execSync } from "child_process";
import { createLLM, getModel } from "../src/models.js";

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

            expect(response.role).toBe("assistant");
            expect(response.content).toBeTruthy();
            expect(response.usage.input).toBeGreaterThan(0);
            expect(response.usage.output).toBeGreaterThan(0);
            expect(response.error).toBeFalsy();
            expect(response.content).toContain("Hello test successful");
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
    expect(response.stopReason).toBe("toolUse");
    expect(response.toolCalls).toBeTruthy();
    expect(response.toolCalls!.length).toBeGreaterThan(0);
    const toolCall = response.toolCalls![0];
    expect(toolCall.name).toBe("calculator");
    expect(toolCall.id).toBeTruthy();
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

    expect(textChunks.length).toBeGreaterThan(0);
    expect(textCompleted).toBe(true);
    expect(response.content).toBeTruthy();
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

    expect(response.content).toBeTruthy();

    // For providers that should always return thinking when enabled
    if (requireThinking) {
        expect(thinkingChunks.length > 0 || !!response.thinking).toBe(true);
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
    const hasThinking = firstResponse.thinking !== undefined && firstResponse.thinking.length > 0;
    const hasToolCalls = firstResponse.toolCalls && firstResponse.toolCalls.length > 0;

    expect(hasThinking || hasToolCalls).toBe(true);

    // If we got tool calls, verify they're correct
    if (hasToolCalls) {
        expect(firstResponse.toolCalls).toBeTruthy();
        expect(firstResponse.toolCalls!.length).toBeGreaterThan(0);
    }

    // If we have thinking with tool calls, we should have thinkingSignature for proper multi-turn context
    // Note: Some providers may not return thinking when tools are used
    if (firstResponse.thinking && hasToolCalls) {
        // For now, we'll just check if it exists when both are present
        // Some providers may not support thinkingSignature yet
        if (firstResponse.thinkingSignature !== undefined) {
            expect(firstResponse.thinkingSignature).toBeTruthy();
        }
    }

    // Add the assistant response to context
    context.messages.push(firstResponse);

    // Process tool calls and add results
    for (const toolCall of firstResponse.toolCalls || []) {
        expect(toolCall.name).toBe("calculator");
        expect(toolCall.id).toBeTruthy();
        expect(toolCall.arguments).toBeTruthy();

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

        if (response.stopReason === "stop" && response.content) {
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

    expect(finalResponse).toBeTruthy();
    expect(finalResponse!.content).toBeTruthy();
    expect(finalResponse!.role).toBe("assistant");

    // The final response should reference the calculations
    expect(
        finalResponse!.content!.includes("714") || finalResponse!.content!.includes("887")
    ).toBe(true);
}

describe("AI Providers E2E Tests", () => {
    describe.skipIf(!process.env.GEMINI_API_KEY)("Gemini Provider", () => {
        let llm: GoogleLLM;

        beforeAll(() => {
            llm = new GoogleLLM(getModel("google", "gemini-2.5-flash")!, process.env.GEMINI_API_KEY!);
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

    describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Completions Provider", () => {
        let llm: OpenAICompletionsLLM;

        beforeAll(() => {
            llm = new OpenAICompletionsLLM(getModel("openai", "gpt-4o-mini")!, process.env.OPENAI_API_KEY!);
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

    describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI Responses Provider", () => {
        let llm: OpenAIResponsesLLM;

        beforeAll(() => {
            llm = new OpenAIResponsesLLM(getModel("openai", "gpt-5-mini")!, process.env.OPENAI_API_KEY!);
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
            await handleThinking(llm, {reasoningEffort: "medium"}, false);
        });

        it("should handle multi-turn with thinking and tools", async () => {
            await multiTurn(llm, {reasoningEffort: "medium"});
        });
    });

    describe.skipIf(!process.env.ANTHROPIC_OAUTH_TOKEN)("Anthropic Provider", () => {
        let llm: AnthropicLLM;

        beforeAll(() => {
            llm = new AnthropicLLM(getModel("anthropic", "claude-sonnet-4-0")!, process.env.ANTHROPIC_OAUTH_TOKEN!);
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

    describe.skipIf(!process.env.XAI_API_KEY)("xAI Provider (via OpenAI Completions)", () => {
        let llm: OpenAICompletionsLLM;

        beforeAll(() => {
            llm = new OpenAICompletionsLLM(getModel("xai", "grok-code-fast-1")!, process.env.XAI_API_KEY!);
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
            await handleThinking(llm, {reasoningEffort: "medium"}, false);
        });

        it("should handle multi-turn with thinking and tools", async () => {
            await multiTurn(llm, {reasoningEffort: "medium"});
        });
    });

    describe.skipIf(!process.env.GROQ_API_KEY)("Groq Provider (via OpenAI Completions)", () => {
        let llm: OpenAICompletionsLLM;

        beforeAll(() => {
            llm = new OpenAICompletionsLLM(getModel("groq", "openai/gpt-oss-20b")!, process.env.GROQ_API_KEY!);
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
            await handleThinking(llm, {reasoningEffort: "medium"}, false);
        });

        it("should handle multi-turn with thinking and tools", async () => {
            await multiTurn(llm, {reasoningEffort: "medium"});
        });
    });

    describe.skipIf(!process.env.CEREBRAS_API_KEY)("Cerebras Provider (via OpenAI Completions)", () => {
        let llm: OpenAICompletionsLLM;

        beforeAll(() => {
            llm = new OpenAICompletionsLLM(getModel("cerebras", "gpt-oss-120b")!, process.env.CEREBRAS_API_KEY!);
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
            await handleThinking(llm, {reasoningEffort: "medium"}, false);
        });

        it("should handle multi-turn with thinking and tools", async () => {
            await multiTurn(llm, {reasoningEffort: "medium"});
        });
    });

    describe.skipIf(!process.env.OPENROUTER_API_KEY)("OpenRouter Provider (via OpenAI Completions)", () => {
        let llm: OpenAICompletionsLLM;

        beforeAll(() => {
            llm = new OpenAICompletionsLLM(getModel("openrouter", "z-ai/glm-4.5")!, process.env.OPENROUTER_API_KEY!);;
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
            await handleThinking(llm, {reasoningEffort: "medium"}, false);
        });

        it("should handle multi-turn with thinking and tools", async () => {
            await multiTurn(llm, {reasoningEffort: "medium"});
        });
    });

    // Check if ollama is installed
    let ollamaInstalled = false;
    try {
        execSync("which ollama", { stdio: "ignore" });
        ollamaInstalled = true;
    } catch {
        ollamaInstalled = false;
    }

    describe.skipIf(!ollamaInstalled)("Ollama Provider (via OpenAI Completions)", () => {
        let llm: OpenAICompletionsLLM;
        let ollamaProcess: ChildProcess | null = null;

        beforeAll(async () => {
            // Check if model is available, if not pull it
            try {
                execSync("ollama list | grep -q 'gpt-oss:20b'", { stdio: "ignore" });
            } catch {
                console.log("Pulling gpt-oss:20b model for Ollama tests...");
                try {
                    execSync("ollama pull gpt-oss:20b", { stdio: "inherit" });
                } catch (e) {
                    console.warn("Failed to pull gpt-oss:20b model, tests will be skipped");
                    return;
                }
            }

            // Start ollama server
            ollamaProcess = spawn("ollama", ["serve"], {
                detached: false,
                stdio: "ignore"
            });

            // Wait for server to be ready
            await new Promise<void>((resolve) => {
                const checkServer = async () => {
                    try {
                        const response = await fetch("http://localhost:11434/api/tags");
                        if (response.ok) {
                            resolve();
                        } else {
                            setTimeout(checkServer, 500);
                        }
                    } catch {
                        setTimeout(checkServer, 500);
                    }
                };
                setTimeout(checkServer, 1000); // Initial delay
            });

            const model: Model = {
                id: "gpt-oss:20b",
                provider: "ollama",
                baseUrl: "http://localhost:11434/v1",
                reasoning: true,
                input: ["text"],
                contextWindow: 128000,
                maxTokens: 16000,
                cost: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                },
                name: "Ollama GPT-OSS 20B"
            }
            llm = new OpenAICompletionsLLM(model, "dummy");
        }, 30000); // 30 second timeout for setup

        afterAll(() => {
            // Kill ollama server
            if (ollamaProcess) {
                ollamaProcess.kill("SIGTERM");
                ollamaProcess = null;
            }
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
            await handleThinking(llm, {reasoningEffort: "medium"}, false);
        });

        it("should handle multi-turn with thinking and tools", async () => {
            await multiTurn(llm, {reasoningEffort: "medium"});
        });
    });

    describe.skipIf(!process.env.OPENROUTER_API_KEY)("OpenRouter Provider (Kimi K2)", () => {
        let llm: OpenAICompletionsLLM;

        beforeAll(() => {
            llm = createLLM("openrouter", "moonshotai/kimi-k2", process.env.OPENROUTER_API_KEY!);
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
            await handleThinking(llm, {reasoningEffort: "medium"}, false);
        });

        it("should handle multi-turn with thinking and tools", async () => {
            await multiTurn(llm, {reasoningEffort: "medium"});
        });
    });

    describe.skipIf(!process.env.ANTHROPIC_API_KEY)("Anthropic Provider (Haiku 3.5)", () => {
        let llm: AnthropicLLM;

        beforeAll(() => {
            llm = createLLM("anthropic", "claude-3-5-haiku-latest");
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
            await handleThinking(llm, {thinking: {enabled: true}}, false);
        });

        it("should handle multi-turn with thinking and tools", async () => {
            await multiTurn(llm, {thinking: {enabled: true}});
        });
    });
});