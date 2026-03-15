import type OpenAI from "openai";
import type {
    ChatCompletionAssistantMessageParam,
    ChatCompletionChunk,
    ChatCompletionContentPart,
    ChatCompletionContentPartImage,
    ChatCompletionContentPartText,
    ChatCompletionMessageParam,
    ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions.js";
import { calculateCost } from "../models.js";
import type {
    Api,
    AssistantMessage,
    Context,
    Message,
    Model,
    OpenAICompletionsCompat,
    StopReason,
    TextContent,
    ThinkingContent,
    Tool,
    ToolCall,
    ToolResultMessage,
} from "../types.js";
import type { AssistantMessageEventStream } from "../utils/event-stream.js";
import { parseStreamingJson } from "../utils/json-parse.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import { transformMessages } from "./transform-messages.js";

/**
 * Check if conversation messages contain tool calls or tool results.
 * This is needed because Anthropic (via proxy) requires the tools param
 * to be present when messages include tool_calls or tool role messages.
 */
export function hasToolHistory(messages: Message[]): boolean {
    for (const msg of messages) {
        if (msg.role === "toolResult") {
            return true;
        }
        if (msg.role === "assistant") {
            if (msg.content.some((block) => block.type === "toolCall")) {
                return true;
            }
        }
    }
    return false;
}

export function convertMessages(
    model: Model<Api>,
    context: Context,
    compat: Required<OpenAICompletionsCompat>,
): ChatCompletionMessageParam[] {
    const params: ChatCompletionMessageParam[] = [];

    const normalizeToolCallId = (id: string): string => {
        // Handle pipe-separated IDs from OpenAI Responses API
        // Format: {call_id}|{id} where {id} can be 400+ chars with special chars (+, /, =)
        // These come from providers like github-copilot, openai-codex, opencode
        // Extract just the call_id part and normalize it
        if (id.includes("|")) {
            const [callId] = id.split("|");
            // Sanitize to allowed chars and truncate to 40 chars (OpenAI limit)
            return callId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
        }

        if (model.provider === "openai") return id.length > 40 ? id.slice(0, 40) : id;
        return id;
    };

    const transformedMessages = transformMessages(context.messages, model, (id) => normalizeToolCallId(id));

    if (context.systemPrompt) {
        const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole;
        const role = useDeveloperRole ? "developer" : "system";
        params.push({ role: role, content: sanitizeSurrogates(context.systemPrompt) });
    }

    let lastRole: string | null = null;

    for (let i = 0; i < transformedMessages.length; i++) {
        const msg = transformedMessages[i];
        // Some providers don't allow user messages directly after tool results
        // Insert a synthetic assistant message to bridge the gap
        if (compat.requiresAssistantAfterToolResult && lastRole === "toolResult" && msg.role === "user") {
            params.push({
                role: "assistant",
                content: "I have processed the tool results.",
            });
        }

        if (msg.role === "user") {
            if (typeof msg.content === "string") {
                params.push({
                    role: "user",
                    content: sanitizeSurrogates(msg.content),
                });
            } else {
                const content: ChatCompletionContentPart[] = msg.content.map((item): ChatCompletionContentPart => {
                    if (item.type === "text") {
                        return {
                            type: "text",
                            text: sanitizeSurrogates(item.text),
                        } satisfies ChatCompletionContentPartText;
                    } else {
                        return {
                            type: "image_url",
                            image_url: {
                                url: `data:${item.mimeType};base64,${item.data}`,
                            },
                        } satisfies ChatCompletionContentPartImage;
                    }
                });
                const filteredContent = !model.input.includes("image")
                    ? content.filter((c) => c.type !== "image_url")
                    : content;
                if (filteredContent.length === 0) continue;
                params.push({
                    role: "user",
                    content: filteredContent,
                });
            }
        } else if (msg.role === "assistant") {
            // Some providers don't accept null content, use empty string instead
            const assistantMsg: ChatCompletionAssistantMessageParam = {
                role: "assistant",
                content: compat.requiresAssistantAfterToolResult ? "" : null,
            };

            const textBlocks = msg.content.filter((b) => b.type === "text") as TextContent[];
            // Filter out empty text blocks to avoid API validation errors
            const nonEmptyTextBlocks = textBlocks.filter((b) => b.text && b.text.trim().length > 0);
            if (nonEmptyTextBlocks.length > 0) {
                // Always send assistant content as a plain string (OpenAI Chat Completions
                // API standard format). Sending as an array of {type:"text", text:"..."}
                // objects is non-standard and causes some models (e.g. DeepSeek V3.2 via
                // NVIDIA NIM) to mirror the content-block structure literally in their
                // output, producing recursive nesting like [{'type':'text','text':'[{...}]'}].
                assistantMsg.content = nonEmptyTextBlocks.map((b) => sanitizeSurrogates(b.text)).join("");
            }

            // Handle thinking blocks
            const thinkingBlocks = msg.content.filter((b) => b.type === "thinking") as ThinkingContent[];
            // Filter out empty thinking blocks to avoid API validation errors
            const nonEmptyThinkingBlocks = thinkingBlocks.filter((b) => b.thinking && b.thinking.trim().length > 0);
            if (nonEmptyThinkingBlocks.length > 0) {
                if (compat.requiresThinkingAsText) {
                    // Convert thinking blocks to plain text (no tags to avoid model mimicking them)
                    const thinkingText = nonEmptyThinkingBlocks.map((b) => b.thinking).join("\n\n");
                    const textContent = assistantMsg.content as Array<{ type: "text"; text: string }> | null;
                    if (textContent) {
                        textContent.unshift({ type: "text", text: thinkingText });
                    } else {
                        assistantMsg.content = [{ type: "text", text: thinkingText }];
                    }
                } else {
                    // Use the signature from the first thinking block if available (for llama.cpp server + gpt-oss)
                    const signature = nonEmptyThinkingBlocks[0].thinkingSignature;
                    if (signature && signature.length > 0) {
                        (assistantMsg as any)[signature] = nonEmptyThinkingBlocks.map((b) => b.thinking).join("\n");
                    }
                }
            }

            const toolCalls = msg.content.filter((b) => b.type === "toolCall") as ToolCall[];
            if (toolCalls.length > 0) {
                assistantMsg.tool_calls = toolCalls.map((tc) => ({
                    id: tc.id,
                    type: "function" as const,
                    function: {
                        name: tc.name,
                        arguments: JSON.stringify(tc.arguments),
                    },
                }));
                const reasoningDetails = toolCalls
                    .filter((tc) => tc.thoughtSignature)
                    .map((tc) => {
                        try {
                            return JSON.parse(tc.thoughtSignature!);
                        } catch {
                            return null;
                        }
                    })
                    .filter(Boolean);
                if (reasoningDetails.length > 0) {
                    (assistantMsg as any).reasoning_details = reasoningDetails;
                }
            }
            // Skip assistant messages that have no content and no tool calls.
            // Some providers require "either content or tool_calls, but not none".
            // Other providers also don't accept empty assistant messages.
            // This handles aborted assistant responses that got no content.
            const content = assistantMsg.content;
            const hasContent =
                content !== null &&
                content !== undefined &&
                (typeof content === "string" ? content.length > 0 : content.length > 0);
            if (!hasContent && !assistantMsg.tool_calls) {
                continue;
            }
            params.push(assistantMsg);
        } else if (msg.role === "toolResult") {
            const imageBlocks: Array<{ type: "image_url"; image_url: { url: string } }> = [];
            let j = i;

            for (; j < transformedMessages.length && transformedMessages[j].role === "toolResult"; j++) {
                const toolMsg = transformedMessages[j] as ToolResultMessage;

                // Extract text and image content
                const textResult = toolMsg.content
                    .filter((c) => c.type === "text")
                    .map((c) => (c as any).text)
                    .join("\n");
                const hasImages = toolMsg.content.some((c) => c.type === "image");

                // Always send tool result with text (or placeholder if only images)
                const hasText = textResult.length > 0;
                // Some providers require the 'name' field in tool results
                const toolResultMsg: ChatCompletionToolMessageParam = {
                    role: "tool",
                    content: sanitizeSurrogates(hasText ? textResult : "(see attached image)"),
                    tool_call_id: toolMsg.toolCallId,
                };
                if (compat.requiresToolResultName && toolMsg.toolName) {
                    (toolResultMsg as any).name = toolMsg.toolName;
                }
                params.push(toolResultMsg);

                if (hasImages && model.input.includes("image")) {
                    for (const block of toolMsg.content) {
                        if (block.type === "image") {
                            imageBlocks.push({
                                type: "image_url",
                                image_url: {
                                    url: `data:${(block as any).mimeType};base64,${(block as any).data}`,
                                },
                            });
                        }
                    }
                }
            }

            i = j - 1;

            if (imageBlocks.length > 0) {
                if (compat.requiresAssistantAfterToolResult) {
                    params.push({
                        role: "assistant",
                        content: "I have processed the tool results.",
                    });
                }

                params.push({
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Attached image(s) from tool result:",
                        },
                        ...imageBlocks,
                    ],
                });
                lastRole = "user";
            } else {
                lastRole = "toolResult";
            }
            continue;
        }

        lastRole = msg.role;
    }

    return params;
}

export function convertTools(
    tools: Tool[],
    compat: Required<OpenAICompletionsCompat>,
): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return tools.map((tool) => ({
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters as any, // TypeBox already generates JSON Schema
            // Only include strict if provider supports it. Some reject unknown fields.
            ...(compat.supportsStrictMode !== false && { strict: false }),
        },
    }));
}

export function parseChunkUsage(
    rawUsage: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
        completion_tokens_details?: { reasoning_tokens?: number };
    },
    model: Model<Api>,
): AssistantMessage["usage"] {
    const cachedTokens = rawUsage.prompt_tokens_details?.cached_tokens || 0;
    const reasoningTokens = rawUsage.completion_tokens_details?.reasoning_tokens || 0;
    // OpenAI includes cached tokens in prompt_tokens, so subtract to get non-cached input
    const input = (rawUsage.prompt_tokens || 0) - cachedTokens;
    // Compute totalTokens ourselves since we add reasoning_tokens to output
    // and some providers (e.g., Groq) don't include them in total_tokens
    const outputTokens = (rawUsage.completion_tokens || 0) + reasoningTokens;
    const usage: AssistantMessage["usage"] = {
        input,
        output: outputTokens,
        cacheRead: cachedTokens,
        cacheWrite: 0,
        totalTokens: input + outputTokens + cachedTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    calculateCost(model, usage);
    return usage;
}

export function mapStopReason(reason: ChatCompletionChunk.Choice["finish_reason"] | string): StopReason {
    if (reason === null) return "stop";
    switch (reason) {
        case "stop":
        case "end":
            return "stop";
        case "length":
            return "length";
        case "function_call":
        case "tool_calls":
            return "toolUse";
        case "content_filter":
            return "error";
        default: {
            const _exhaustive: never = reason as never;
            throw new Error(`Unhandled stop reason: ${_exhaustive}`);
        }
    }
}

/**
 * Process an OpenAI Chat Completions streaming response, emitting events on the stream.
 * Shared by both openai-completions and azure-openai-completions.
 */
export async function processCompletionsStream(
    openaiStream: AsyncIterable<ChatCompletionChunk>,
    output: AssistantMessage,
    stream: AssistantMessageEventStream,
    model: Model<Api>,
): Promise<void> {
    let currentBlock: TextContent | ThinkingContent | (ToolCall & { partialArgs?: string }) | null = null;
    const blocks = output.content;
    const blockIndex = () => blocks.length - 1;
    const finishCurrentBlock = (block?: typeof currentBlock) => {
        if (block) {
            if (block.type === "text") {
                stream.push({
                    type: "text_end",
                    contentIndex: blockIndex(),
                    content: block.text,
                    partial: output,
                });
            } else if (block.type === "thinking") {
                stream.push({
                    type: "thinking_end",
                    contentIndex: blockIndex(),
                    content: block.thinking,
                    partial: output,
                });
            } else if (block.type === "toolCall") {
                block.arguments = parseStreamingJson(block.partialArgs);
                delete block.partialArgs;
                stream.push({
                    type: "toolcall_end",
                    contentIndex: blockIndex(),
                    toolCall: block,
                    partial: output,
                });
            }
        }
    };

    for await (const chunk of openaiStream) {
        if (chunk.usage) {
            output.usage = parseChunkUsage(chunk.usage, model);
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        // Fallback: some providers (e.g., Moonshot) return usage
        // in choice.usage instead of the standard chunk.usage
        if (!chunk.usage && (choice as any).usage) {
            output.usage = parseChunkUsage((choice as any).usage, model);
        }

        if (choice.finish_reason) {
            output.stopReason = mapStopReason(choice.finish_reason);
        }

        if (choice.delta) {
            if (choice.delta.content !== null && choice.delta.content !== undefined && choice.delta.content.length > 0) {
                if (!currentBlock || currentBlock.type !== "text") {
                    finishCurrentBlock(currentBlock);
                    currentBlock = { type: "text", text: "" };
                    output.content.push(currentBlock);
                    stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
                }

                if (currentBlock.type === "text") {
                    currentBlock.text += choice.delta.content;
                    stream.push({
                        type: "text_delta",
                        contentIndex: blockIndex(),
                        delta: choice.delta.content,
                        partial: output,
                    });
                }
            }

            // Some endpoints return reasoning in reasoning_content (llama.cpp),
            // or reasoning (other openai compatible endpoints)
            // Use the first non-empty reasoning field to avoid duplication
            // (e.g., chutes.ai returns both reasoning_content and reasoning with same content)
            const reasoningFields = ["reasoning_content", "reasoning", "reasoning_text"];
            let foundReasoningField: string | null = null;
            for (const field of reasoningFields) {
                if (
                    (choice.delta as any)[field] !== null &&
                    (choice.delta as any)[field] !== undefined &&
                    (choice.delta as any)[field].length > 0
                ) {
                    if (!foundReasoningField) {
                        foundReasoningField = field;
                        break;
                    }
                }
            }

            if (foundReasoningField) {
                if (!currentBlock || currentBlock.type !== "thinking") {
                    finishCurrentBlock(currentBlock);
                    currentBlock = {
                        type: "thinking",
                        thinking: "",
                        thinkingSignature: foundReasoningField,
                    };
                    output.content.push(currentBlock);
                    stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
                }

                if (currentBlock.type === "thinking") {
                    const delta = (choice.delta as any)[foundReasoningField];
                    currentBlock.thinking += delta;
                    stream.push({
                        type: "thinking_delta",
                        contentIndex: blockIndex(),
                        delta,
                        partial: output,
                    });
                }
            }

            if (choice?.delta?.tool_calls) {
                for (const toolCall of choice.delta.tool_calls) {
                    if (
                        !currentBlock ||
                        currentBlock.type !== "toolCall" ||
                        (toolCall.id && currentBlock.id !== toolCall.id)
                    ) {
                        finishCurrentBlock(currentBlock);
                        currentBlock = {
                            type: "toolCall",
                            id: toolCall.id || "",
                            name: toolCall.function?.name || "",
                            arguments: {},
                            partialArgs: "",
                        };
                        output.content.push(currentBlock);
                        stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
                    }

                    if (currentBlock.type === "toolCall") {
                        if (toolCall.id) currentBlock.id = toolCall.id;
                        if (toolCall.function?.name) currentBlock.name = toolCall.function.name;
                        let delta = "";
                        if (toolCall.function?.arguments) {
                            delta = toolCall.function.arguments;
                            currentBlock.partialArgs += toolCall.function.arguments;
                            currentBlock.arguments = parseStreamingJson(currentBlock.partialArgs);
                        }
                        stream.push({
                            type: "toolcall_delta",
                            contentIndex: blockIndex(),
                            delta,
                            partial: output,
                        });
                    }
                }
            }

            const reasoningDetails = (choice.delta as any).reasoning_details;
            if (reasoningDetails && Array.isArray(reasoningDetails)) {
                for (const detail of reasoningDetails) {
                    if (detail.type === "reasoning.encrypted" && detail.id && detail.data) {
                        const matchingToolCall = output.content.find((b) => b.type === "toolCall" && b.id === detail.id) as
                            | ToolCall
                            | undefined;
                        if (matchingToolCall) {
                            matchingToolCall.thoughtSignature = JSON.stringify(detail);
                        }
                    }
                }
            }
        }
    }

    finishCurrentBlock(currentBlock);
}
