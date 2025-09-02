import { describe, it, beforeAll, expect } from "vitest";
import { getModel } from "../src/models.js";
import { generate, generateComplete } from "../src/generate.js";
import type { Context, Tool, GenerateOptionsUnified, Model, ImageContent, GenerateStream, GenerateOptions } from "../src/types.js";
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

async function basicTextGeneration<P extends GenerateOptions>(model: Model, options?: P) {
    const context: Context = {
        systemPrompt: "You are a helpful assistant. Be concise.",
        messages: [
            { role: "user", content: "Reply with exactly: 'Hello test successful'" }
        ]
    };

    const response = await generateComplete(model, context, options);

    expect(response.role).toBe("assistant");
    expect(response.content).toBeTruthy();
    expect(response.usage.input + response.usage.cacheRead).toBeGreaterThan(0);
    expect(response.usage.output).toBeGreaterThan(0);
    expect(response.error).toBeFalsy();
    expect(response.content.map(b => b.type == "text" ? b.text : "").join("")).toContain("Hello test successful");

    context.messages.push(response);
    context.messages.push({ role: "user", content: "Now say 'Goodbye test successful'" });

    const secondResponse = await generateComplete(model, context, options);

    expect(secondResponse.role).toBe("assistant");
    expect(secondResponse.content).toBeTruthy();
    expect(secondResponse.usage.input + secondResponse.usage.cacheRead).toBeGreaterThan(0);
    expect(secondResponse.usage.output).toBeGreaterThan(0);
    expect(secondResponse.error).toBeFalsy();
    expect(secondResponse.content.map(b => b.type == "text" ? b.text : "").join("")).toContain("Goodbye test successful");
}

async function handleToolCall(model: Model, options?: GenerateOptionsUnified) {
    const context: Context = {
        systemPrompt: "You are a helpful assistant that uses tools when asked.",
        messages: [{
            role: "user",
            content: "Calculate 15 + 27 using the calculator tool."
        }],
        tools: [calculatorTool]
    };

    const response = await generateComplete(model, context, options);
    expect(response.stopReason).toBe("toolUse");
    expect(response.content.some(b => b.type == "toolCall")).toBeTruthy();
    const toolCall = response.content.find(b => b.type == "toolCall");
    if (toolCall && toolCall.type === "toolCall") {
        expect(toolCall.name).toBe("calculator");
        expect(toolCall.id).toBeTruthy();
    }
}

async function handleStreaming(model: Model, options?: GenerateOptionsUnified) {
    let textStarted = false;
    let textChunks = "";
    let textCompleted = false;

    const context: Context = {
        messages: [{ role: "user", content: "Count from 1 to 3" }]
    };

    const stream = generate(model, context, options);

    for await (const event of stream) {
        if (event.type === "text_start") {
            textStarted = true;
        } else if (event.type === "text_delta") {
            textChunks += event.delta;
        } else if (event.type === "text_end") {
            textCompleted = true;
        }
    }

    const response = await stream.finalMessage();

    expect(textStarted).toBe(true);
    expect(textChunks.length).toBeGreaterThan(0);
    expect(textCompleted).toBe(true);
    expect(response.content.some(b => b.type == "text")).toBeTruthy();
}

async function handleThinking(model: Model, options: GenerateOptionsUnified) {
    let thinkingStarted = false;
    let thinkingChunks = "";
    let thinkingCompleted = false;

    const context: Context = {
        messages: [{ role: "user", content: `Think about ${(Math.random() * 255) | 0} + 27. Think step by step. Then output the result.` }]
    };

    const stream = generate(model, context, options);

    for await (const event of stream) {
        if (event.type === "thinking_start") {
            thinkingStarted = true;
        } else if (event.type === "thinking_delta") {
            thinkingChunks += event.delta;
        } else if (event.type === "thinking_end") {
            thinkingCompleted = true;
        }
    }

    const response = await stream.finalMessage();

    expect(response.stopReason, `Error: ${response.error}`).toBe("stop");
    expect(thinkingStarted).toBe(true);
    expect(thinkingChunks.length).toBeGreaterThan(0);
    expect(thinkingCompleted).toBe(true);
    expect(response.content.some(b => b.type == "thinking")).toBeTruthy();
}

async function handleImage(model: Model, options?: GenerateOptionsUnified) {
    // Check if the model supports images
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
                    { type: "text", text: "What do you see in this image? Please describe the shape (circle, rectangle, square, triangle, ...) and color (red, blue, green, ...)." },
                    imageContent,
                ],
            },
        ],
    };

    const response = await generateComplete(model, context, options);

    // Check the response mentions red and circle
    expect(response.content.length > 0).toBeTruthy();
    const textContent = response.content.find(b => b.type == "text");
    if (textContent && textContent.type === "text") {
        const lowerContent = textContent.text.toLowerCase();
        expect(lowerContent).toContain("red");
        expect(lowerContent).toContain("circle");
    }
}

async function multiTurn(model: Model, options?: GenerateOptionsUnified) {
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
        const response = await generateComplete(model, context, options);

        // Add the assistant response to context
        context.messages.push(response);

        // Process content blocks
        for (const block of response.content) {
            if (block.type === "text") {
                allTextContent += block.text;
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
                    toolCallId: block.id,
                    toolName: block.name,
                    content: `${result}`,
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

describe("Generate E2E Tests", () => {
    describe.skipIf(!process.env.ANTHROPIC_API_KEY)("Anthropic Provider (claude-3-5-haiku-20241022)", () => {
        let model: Model;

        beforeAll(() => {
            model = getModel("anthropic", "claude-3-5-haiku-20241022");
        });

        it("should complete basic text generation", async () => {
            await basicTextGeneration(model);
        });

        it("should handle tool calling", async () => {
            await handleToolCall(model);
        });

        it("should handle streaming", async () => {
            await handleStreaming(model);
        });

        it("should handle image input", async () => {
            await handleImage(model);
        });
    });

    describe.skipIf(!process.env.ANTHROPIC_OAUTH_TOKEN)("Anthropic Provider (claude-sonnet-4-20250514)", () => {
        let model: Model;

        beforeAll(() => {
            model = getModel("anthropic", "claude-sonnet-4-20250514");
        });

        it("should complete basic text generation", async () => {
            await basicTextGeneration(model);
        });

        it("should handle tool calling", async () => {
            await handleToolCall(model);
        });

        it("should handle streaming", async () => {
            await handleStreaming(model);
        });

        it("should handle thinking mode", async () => {
            await handleThinking(model, { reasoning: "low" });
        });

        it("should handle multi-turn with thinking and tools", async () => {
            await multiTurn(model, { reasoning: "medium" });
        });

        it("should handle image input", async () => {
            await handleImage(model);
        });
    });
});