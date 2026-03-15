import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import { stream } from "../src/stream.js";
import type { Model, Tool } from "../src/types.js";
import type { AzureOpenAICompletionsOptions } from "../src/providers/azure-openai-completions.js";

const mockState = vi.hoisted(() => ({ lastParams: undefined as unknown, lastClientConfig: undefined as unknown }));

vi.mock("openai", () => {
    class FakeOpenAI {
        chat = {
            completions: {
                create: async (params: unknown) => {
                    mockState.lastParams = params;
                    return {
                        async *[Symbol.asyncIterator]() {
                            yield {
                                choices: [{ delta: {}, finish_reason: "stop" }],
                                usage: {
                                    prompt_tokens: 1,
                                    completion_tokens: 1,
                                    prompt_tokens_details: { cached_tokens: 0 },
                                    completion_tokens_details: { reasoning_tokens: 0 },
                                },
                            };
                        },
                    };
                },
            },
        };
        constructor(config: unknown) {
            mockState.lastClientConfig = config;
        }
    }

    // AzureOpenAI is what azure-openai-completions imports
    return { default: FakeOpenAI, AzureOpenAI: FakeOpenAI };
});

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

describe("azure-openai-completions tool_choice and params", () => {
    it("forwards toolChoice to payload", async () => {
        const model = makeAzureModel();
        const tools: Tool[] = [
            {
                name: "ping",
                description: "Ping tool",
                parameters: Type.Object({ ok: Type.Boolean() }),
            },
        ];
        let payload: unknown;

        await stream(
            model,
            {
                messages: [{ role: "user", content: "Call ping with ok=true", timestamp: Date.now() }],
                tools,
            },
            {
                apiKey: "test-key",
                toolChoice: "required",
                azureBaseUrl: "https://myresource.openai.azure.com/openai/v1",
                onPayload: (params: unknown) => {
                    payload = params;
                },
            } satisfies AzureOpenAICompletionsOptions,
        ).result();

        const params = (payload ?? mockState.lastParams) as { tool_choice?: string; tools?: unknown[] };
        expect(params.tool_choice).toBe("required");
        expect(Array.isArray(params.tools)).toBe(true);
        expect(params.tools?.length ?? 0).toBeGreaterThan(0);
    });

    it("uses deployment name from azureDeploymentName option", async () => {
        const model = makeAzureModel();
        let payload: unknown;

        await stream(
            model,
            {
                messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
            },
            {
                apiKey: "test-key",
                azureDeploymentName: "my-custom-deployment",
                azureBaseUrl: "https://myresource.openai.azure.com/openai/v1",
                onPayload: (params: unknown) => {
                    payload = params;
                },
            } satisfies AzureOpenAICompletionsOptions,
        ).result();

        const params = (payload ?? mockState.lastParams) as { model?: string };
        expect(params.model).toBe("my-custom-deployment");
    });

    it("uses model.id as deployment name when no override", async () => {
        const model = makeAzureModel();
        let payload: unknown;

        await stream(
            model,
            {
                messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
            },
            {
                apiKey: "test-key",
                azureBaseUrl: "https://myresource.openai.azure.com/openai/v1",
                onPayload: (params: unknown) => {
                    payload = params;
                },
            } satisfies AzureOpenAICompletionsOptions,
        ).result();

        const params = (payload ?? mockState.lastParams) as { model?: string };
        expect(params.model).toBe("gpt-4o-mini");
    });

    it("passes azureBaseUrl to client config", async () => {
        const model = makeAzureModel();

        await stream(
            model,
            {
                messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
            },
            {
                apiKey: "test-key",
                azureBaseUrl: "https://custom.openai.azure.com/openai/v1/",
            } satisfies AzureOpenAICompletionsOptions,
        ).result();

        const config = mockState.lastClientConfig as { baseURL?: string };
        // normalizeAzureBaseUrl strips trailing slashes
        expect(config.baseURL).toBe("https://custom.openai.azure.com/openai/v1");
    });

    it("includes stream_options with include_usage", async () => {
        const model = makeAzureModel();
        let payload: unknown;

        await stream(
            model,
            {
                messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
            },
            {
                apiKey: "test-key",
                azureBaseUrl: "https://myresource.openai.azure.com/openai/v1",
                onPayload: (params: unknown) => {
                    payload = params;
                },
            } satisfies AzureOpenAICompletionsOptions,
        ).result();

        const params = (payload ?? mockState.lastParams) as { stream_options?: { include_usage?: boolean } };
        expect(params.stream_options?.include_usage).toBe(true);
    });

    it("does not set store field (Azure default)", async () => {
        const model = makeAzureModel();
        let payload: unknown;

        await stream(
            model,
            {
                messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
            },
            {
                apiKey: "test-key",
                azureBaseUrl: "https://myresource.openai.azure.com/openai/v1",
                onPayload: (params: unknown) => {
                    payload = params;
                },
            } satisfies AzureOpenAICompletionsOptions,
        ).result();

        const params = (payload ?? mockState.lastParams) as { store?: boolean };
        expect(params.store).toBeUndefined();
    });

    it("passes reasoning_effort for reasoning models", async () => {
        const model: Model<"azure-openai-completions"> = {
            ...makeAzureModel(),
            reasoning: true,
        };
        let payload: unknown;

        await stream(
            model,
            {
                messages: [{ role: "user", content: "Think about this", timestamp: Date.now() }],
            },
            {
                apiKey: "test-key",
                azureBaseUrl: "https://myresource.openai.azure.com/openai/v1",
                reasoningEffort: "high",
                onPayload: (params: unknown) => {
                    payload = params;
                },
            } satisfies AzureOpenAICompletionsOptions,
        ).result();

        const params = (payload ?? mockState.lastParams) as { reasoning_effort?: string };
        expect(params.reasoning_effort).toBe("high");
    });

    it("forwards maxTokens as max_completion_tokens", async () => {
        const model = makeAzureModel();
        let payload: unknown;

        await stream(
            model,
            {
                messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
            },
            {
                apiKey: "test-key",
                azureBaseUrl: "https://myresource.openai.azure.com/openai/v1",
                maxTokens: 512,
                onPayload: (params: unknown) => {
                    payload = params;
                },
            } satisfies AzureOpenAICompletionsOptions,
        ).result();

        const params = (payload ?? mockState.lastParams) as { max_completion_tokens?: number };
        expect(params.max_completion_tokens).toBe(512);
    });

    it("forwards temperature", async () => {
        const model = makeAzureModel();
        let payload: unknown;

        await stream(
            model,
            {
                messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
            },
            {
                apiKey: "test-key",
                azureBaseUrl: "https://myresource.openai.azure.com/openai/v1",
                temperature: 0.3,
                onPayload: (params: unknown) => {
                    payload = params;
                },
            } satisfies AzureOpenAICompletionsOptions,
        ).result();

        const params = (payload ?? mockState.lastParams) as { temperature?: number };
        expect(params.temperature).toBe(0.3);
    });
});
