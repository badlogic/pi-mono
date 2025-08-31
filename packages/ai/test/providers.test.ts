import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { GoogleLLM } from "../src/providers/google.js";
import { OpenAICompletionsLLM } from "../src/providers/openai-completions.js";
import { OpenAIResponsesLLM } from "../src/providers/openai-responses.js";
import { AnthropicLLM } from "../src/providers/anthropic.js";
import type { LLM, LLMOptions, Context, Tool, AssistantMessage, Model, ImageContent } from "../src/types.js";
import { spawn, ChildProcess, execSync } from "child_process";
import { createLLM, getModel } from "../src/models.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
            expect(response.content.map(b => b.type == "text" ? b.text : "").join("\n")).toContain("Hello test successful");

            context.messages.push(response);
            context.messages.push({ role: "user", content: "Now say 'Goodbye test successful'" });

            const secondResponse = await llm.complete(context);

            expect(secondResponse.role).toBe("assistant");
            expect(secondResponse.content).toBeTruthy();
            expect(secondResponse.usage.input).toBeGreaterThan(0);
            expect(secondResponse.usage.output).toBeGreaterThan(0);
            expect(secondResponse.error).toBeFalsy();
            expect(secondResponse.content.map(b => b.type == "text" ? b.text : "").join("\n")).toContain("Goodbye test successful");
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
    expect(response.content.some(b => b.type == "toolCall")).toBeTruthy();
    const toolCall = response.content.find(b => b.type == "toolCall")!;
    expect(toolCall.name).toBe("calculator");
    expect(toolCall.id).toBeTruthy();
}

async function handleStreaming<T extends LLMOptions>(llm: LLM<T>) {
    let textStarted = false;
    let textChunks = "";
    let textCompleted = false;

    const context: Context = {
        messages: [{ role: "user", content: "Count from 1 to 3" }]
    };

    const response = await llm.complete(context, {
        onEvent: (event) => {
            if (event.type === "text_start") {
                textStarted = true;
            } else if (event.type === "text_delta") {
                textChunks += event.delta;
            } else if (event.type === "text_end") {
                textCompleted = true;
            }
        }
    } as T);

    expect(textStarted).toBe(true);
    expect(textChunks.length).toBeGreaterThan(0);
    expect(textCompleted).toBe(true);
    expect(response.content.some(b => b.type == "text")).toBeTruthy();
}

async function handleThinking<T extends LLMOptions>(llm: LLM<T>, options: T) {
    let thinkingStarted = false;
    let thinkingChunks = "";
    let thinkingCompleted = false;

    const context: Context = {
        messages: [{ role: "user", content: "What is 15 + 27? Think step by step." }]
    };

    const response = await llm.complete(context, {
       onEvent: (event) => {
            if (event.type === "thinking_start") {
                thinkingStarted = true;
            } else if (event.type === "thinking_delta") {
                thinkingChunks += event.delta;
            } else if (event.type === "thinking_end") {
                thinkingCompleted = true;
            }
        },
        ...options
    });


    expect(thinkingStarted).toBe(true);
    expect(thinkingChunks.length).toBeGreaterThan(0);
    expect(thinkingCompleted).toBe(true);
    expect(response.content.some(b => b.type == "thinking")).toBeTruthy();
}

async function handleImage<T extends LLMOptions>(llm: LLM<T>) {
    // Check if the model supports images
    const model = llm.getModel();
    if (!model.input.includes("image")) {
        console.log(`Skipping image test - model ${model.id} doesn't support images`);
        return;
    }

    // Read the test image
    const imagePath = join(__dirname, "data", "red-circle.png");
    const imageBuffer = readFileSync(imagePath);
    const base64Image = imageBuffer.toString("base64");

    const imageContent: ImageContent = {
        type: "image",
        data: base64Image,
        mimeType: "image/png",
    };

    const context: Context = {
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: "What do you see in this image? Please describe the shape and color." },
                    imageContent,
                ],
            },
        ],
    };

    const response = await llm.complete(context);

    // Check the response mentions red and circle
    expect(response.content.length > 0).toBeTruthy();
    const lowerContent = response.content.find(b => b.type == "text")?.text || "";
    expect(lowerContent).toContain("red");
    expect(lowerContent).toContain("circle");
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

    // Collect all text content from all assistant responses
    let allTextContent = "";
    let hasSeenThinking = false;
    let hasSeenToolCalls = false;
    const maxTurns = 5; // Prevent infinite loops

    for (let turn = 0; turn < maxTurns; turn++) {
        const response = await llm.complete(context, thinkingOptions);

        // Add the assistant response to context
        context.messages.push(response);

        // Process content blocks
        for (const block of response.content) {
            if (block.type === "text") {
                allTextContent += block.text + " ";
            } else if (block.type === "thinking") {
                hasSeenThinking = true;
            } else if (block.type === "toolCall") {
                hasSeenToolCalls = true;

                // Process the tool call
                expect(block.name).toBe("calculator");
                expect(block.id).toBeTruthy();
                expect(block.arguments).toBeTruthy();

                const { a, b, operation } = block.arguments;
                let result: number;
                switch (operation) {
                    case "add": result = a + b; break;
                    case "multiply": result = a * b; break;
                    default: result = 0;
                }

                // Add tool result to context
                context.messages.push({
                    role: "toolResult",
                    content: `${result}`,
                    toolCallId: block.id,
                    isError: false
                });
            }
        }

        // If we got a stop response with text content, we're likely done
        expect(response.stopReason).not.toBe("error");
        if (response.stopReason === "stop") {
            break;
        }
    }

    // Verify we got either thinking content or tool calls (or both)
    expect(hasSeenThinking || hasSeenToolCalls).toBe(true);

    // The accumulated text should reference both calculations
    expect(allTextContent).toBeTruthy();
    expect(allTextContent.includes("714")).toBe(true);
    expect(allTextContent.includes("887")).toBe(true);
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

        it("should handle image input", async () => {
            await handleImage(llm);
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
            await handleThinking(llm, {reasoningEffort: "medium"});
        });

        it("should handle multi-turn with thinking and tools", async () => {
            await multiTurn(llm, {reasoningEffort: "medium"});
        });

        it("should handle image input", async () => {
            await handleImage(llm);
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

        it("should handle image input", async () => {
            await handleImage(llm);
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
            await handleThinking(llm, {reasoningEffort: "medium"});
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
            await handleThinking(llm, {reasoningEffort: "medium"});
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
            await handleThinking(llm, {reasoningEffort: "medium"});
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
            await handleThinking(llm, {reasoningEffort: "medium"});
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
            await handleThinking(llm, {reasoningEffort: "medium"});
        });

        it("should handle multi-turn with thinking and tools", async () => {
            await multiTurn(llm, {reasoningEffort: "medium"});
        });
    });

    describe.skipIf(!process.env.OPENROUTER_API_KEY)("OpenRouter Provider (GLM 4.5)", () => {
        let llm: OpenAICompletionsLLM;

        beforeAll(() => {
            llm = createLLM("openrouter", "z-ai/glm-4.5", process.env.OPENROUTER_API_KEY!);
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
            await handleThinking(llm, {reasoningEffort: "medium"});
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

        it("should handle multi-turn with thinking and tools", async () => {
            await multiTurn(llm, {thinking: {enabled: true}});
        });

        it("should handle image input", async () => {
            await handleImage(llm);
        });
    });
});