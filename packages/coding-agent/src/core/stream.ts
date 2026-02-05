/**
 * Streaming utilities using Vercel AI SDK.
 *
 * Provides completeSimple() for non-streaming completions.
 */

import { generateText, type ModelMessage } from "ai";
import type {
	AssistantMessage,
	Context,
	Model,
	SimpleStreamOptions,
	TextContent,
	ThinkingContent,
} from "./ai-types.js";
import { createLanguageModel } from "./model-providers.js";

/**
 * Simple completion using Vercel AI SDK's generateText.
 * Returns an AssistantMessage with the response.
 */
export async function completeSimple(
	model: Model,
	context: Context,
	options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
	const apiKey = options?.apiKey ?? "";
	const languageModel = createLanguageModel(model, apiKey);

	try {
		const result = await generateText({
			model: languageModel,
			system: context.systemPrompt,
			messages: context.messages.map(convertMessage),
			maxOutputTokens: options?.maxTokens,
			temperature: options?.temperature,
			abortSignal: options?.signal,
		});

		const content: (TextContent | ThinkingContent)[] = [];

		// Add thinking content if present
		if (result.reasoningText) {
			content.push({
				type: "thinking",
				thinking: result.reasoningText,
			});
		}

		// Add text content
		if (result.text) {
			content.push({
				type: "text",
				text: result.text,
			});
		}

		return {
			role: "assistant",
			content,
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: result.usage?.inputTokens ?? 0,
				output: result.usage?.outputTokens ?? 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: mapFinishReason(result.finishReason),
			timestamp: Date.now(),
		};
	} catch (error) {
		// Handle abort
		if (error instanceof Error && error.name === "AbortError") {
			return {
				role: "assistant",
				content: [],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "aborted",
				timestamp: Date.now(),
			};
		}

		// Handle other errors
		return {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "error",
			errorMessage: error instanceof Error ? error.message : String(error),
			timestamp: Date.now(),
		};
	}
}

/**
 * Alias for completeSimple for backward compatibility.
 */
export const complete = completeSimple;

/**
 * Convert our Message type to Vercel AI SDK format.
 */
function convertMessage(msg: Context["messages"][number]): ModelMessage {
	switch (msg.role) {
		case "user":
			if (typeof msg.content === "string") {
				return { role: "user", content: msg.content };
			}
			return {
				role: "user",
				content: msg.content.map((c) => {
					if (c.type === "text") return { type: "text", text: c.text };
					if (c.type === "image") return { type: "image", image: c.data };
					return { type: "text", text: "" };
				}),
			};

		case "assistant": {
			const text = msg.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("");
			return { role: "assistant", content: text };
		}

		case "toolResult": {
			const resultText = msg.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("");
			return {
				role: "tool",
				content: [
					{
						type: "tool-result" as const,
						toolCallId: msg.toolCallId,
						toolName: msg.toolName,
						output: { type: "text" as const, value: resultText },
					},
				],
			};
		}

		default:
			return { role: "user", content: "" };
	}
}

/**
 * Map Vercel AI SDK finish reason to our StopReason.
 */
function mapFinishReason(
	reason: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other" | "unknown",
): "stop" | "length" | "toolUse" | "error" {
	switch (reason) {
		case "stop":
			return "stop";
		case "length":
			return "length";
		case "tool-calls":
			return "toolUse";
		default:
			return "error";
	}
}
