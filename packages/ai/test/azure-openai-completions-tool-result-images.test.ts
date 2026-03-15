import { describe, expect, it } from "vitest";
import { convertMessages } from "../src/providers/openai-completions-shared.js";
import type {
    AssistantMessage,
    Context,
    Model,
    OpenAICompletionsCompat,
    ToolResultMessage,
    Usage,
} from "../src/types.js";

const emptyUsage: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const compat: Required<OpenAICompletionsCompat> = {
    supportsStore: false,
    supportsDeveloperRole: true,
    supportsReasoningEffort: true,
    reasoningEffortMap: {},
    supportsUsageInStreaming: true,
    maxTokensField: "max_completion_tokens",
    requiresToolResultName: false,
    requiresAssistantAfterToolResult: false,
    requiresThinkingAsText: false,
    thinkingFormat: "openai",
    openRouterRouting: {},
    vercelGatewayRouting: {},
    supportsStrictMode: true,
};

function makeAzureModel(): Model<"azure-openai-completions"> {
    return {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        api: "azure-openai-completions",
        provider: "azure-openai-completions",
        baseUrl: "https://myresource.openai.azure.com/openai/v1",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
    };
}

function buildToolResult(toolCallId: string, timestamp: number): ToolResultMessage {
    return {
        role: "toolResult",
        toolCallId,
        toolName: "read",
        content: [
            { type: "text", text: "Read image file [image/png]" },
            { type: "image", data: "ZmFrZQ==", mimeType: "image/png" },
        ],
        isError: false,
        timestamp,
    };
}

describe("azure-openai-completions convertMessages", () => {
    it("batches tool-result images after consecutive tool results", () => {
        const model = makeAzureModel();

        const now = Date.now();
        const assistantMessage: AssistantMessage = {
            role: "assistant",
            content: [
                { type: "toolCall", id: "tool-1", name: "read", arguments: { path: "img-1.png" } },
                { type: "toolCall", id: "tool-2", name: "read", arguments: { path: "img-2.png" } },
            ],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: emptyUsage,
            stopReason: "toolUse",
            timestamp: now,
        };

        const context: Context = {
            messages: [
                { role: "user", content: "Read the images", timestamp: now - 2 },
                assistantMessage,
                buildToolResult("tool-1", now + 1),
                buildToolResult("tool-2", now + 2),
            ],
        };

        const messages = convertMessages(model, context, compat);
        const roles = messages.map((message) => message.role);
        expect(roles).toEqual(["user", "assistant", "tool", "tool", "user"]);

        const imageMessage = messages[messages.length - 1];
        expect(imageMessage.role).toBe("user");
        expect(Array.isArray(imageMessage.content)).toBe(true);

        const imageParts = (imageMessage.content as Array<{ type?: string }>).filter(
            (part) => part?.type === "image_url",
        );
        expect(imageParts.length).toBe(2);
    });

    it("converts system prompt using developer role for reasoning models", () => {
        const model: Model<"azure-openai-completions"> = {
            ...makeAzureModel(),
            reasoning: true,
        };

        const context: Context = {
            systemPrompt: "You are a helpful assistant.",
            messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
        };

        const messages = convertMessages(model, context, compat);
        expect(messages[0].role).toBe("developer");
    });

    it("converts system prompt using system role for non-reasoning models", () => {
        const model = makeAzureModel();

        const context: Context = {
            systemPrompt: "You are a helpful assistant.",
            messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
        };

        const messages = convertMessages(model, context, compat);
        expect(messages[0].role).toBe("system");
    });
});
