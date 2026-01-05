/**
 * Shared utilities for Google Generative AI and Google Cloud Code Assist providers.
 */

import { type Content, FinishReason, FunctionCallingConfigMode, type Part, type Schema } from "@google/genai";
import type { Context, ImageContent, Model, StopReason, TextContent, Tool } from "../types.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import { transformMessages } from "./transorm-messages.js";

type GoogleApiType = "google-generative-ai" | "google-gemini-cli" | "google-vertex";

/**
 * Convert internal messages to Gemini Content[] format.
 */
export function convertMessages<T extends GoogleApiType>(model: Model<T>, context: Context): Content[] {
	const contents: Content[] = [];
	const transformedMessages = transformMessages(context.messages, model);

	for (const msg of transformedMessages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				contents.push({
					role: "user",
					parts: [{ text: sanitizeSurrogates(msg.content) }],
				});
			} else {
				const parts: Part[] = msg.content.map((item) => {
					if (item.type === "text") {
						return { text: sanitizeSurrogates(item.text) };
					} else {
						return {
							inlineData: {
								mimeType: item.mimeType,
								data: item.data,
							},
						};
					}
				});
				const filteredParts = !model.input.includes("image") ? parts.filter((p) => p.text !== undefined) : parts;
				if (filteredParts.length === 0) continue;
				contents.push({
					role: "user",
					parts: filteredParts,
				});
			}
		} else if (msg.role === "assistant") {
			const parts: Part[] = [];

			for (const block of msg.content) {
				if (block.type === "text") {
					// Skip empty text blocks - they can cause issues with some models (e.g. Claude via Antigravity)
					if (!block.text || block.text.trim() === "") continue;
					parts.push({ text: sanitizeSurrogates(block.text) });
				} else if (block.type === "thinking") {
					// Thinking blocks handling varies by model:
					// - Claude via Antigravity: requires thinkingSignature
					// - Gemini: skip entirely (doesn't understand thoughtSignature, and mimics <thinking> tags)
					// - Other models: convert to text with delimiters
					const isGemini = model.id.toLowerCase().includes("gemini");
					const isClaude = model.id.toLowerCase().includes("claude");
					if (isGemini) {
					} else if (block.thinkingSignature && isClaude) {
						// Claude via Antigravity requires the signature
						parts.push({
							thought: true,
							text: sanitizeSurrogates(block.thinking),
							thoughtSignature: block.thinkingSignature,
						});
					} else {
						// Other models: convert to text with delimiters
						parts.push({
							text: `<thinking>
${sanitizeSurrogates(block.thinking)}
</thinking>`,
						});
					}
				} else if (block.type === "toolCall") {
					const part: Part = {
						functionCall: {
							id: block.id,
							name: block.name,
							args: block.arguments,
						},
					};
					if (model.provider === "google-vertex" && part?.functionCall?.id) {
						delete part.functionCall.id; // Vertex AI does not support 'id' in functionCall
					}
					// Only include thoughtSignature if the model matches.
					// Google Cloud Code Assist API rejects signatures from other models.
					if (block.thoughtSignature && (msg as any).model === model.id) {
						(part as any).thoughtSignature = block.thoughtSignature;
					}
					parts.push(part);
				}
			}

			if (parts.length === 0) continue;
			contents.push({
				role: "model",
				parts,
			});
		} else if (msg.role === "toolResult") {
			// Extract text and image content
			const textContent = msg.content.filter((c): c is TextContent => c.type === "text");
			const textResult = textContent.map((c) => c.text).join("\n");
			const imageContent = model.input.includes("image")
				? msg.content.filter((c): c is ImageContent => c.type === "image")
				: [];

			const hasText = textResult.length > 0;
			const hasImages = imageContent.length > 0;

			// Gemini 3 supports multimodal function responses with images nested inside functionResponse.parts
			// See: https://ai.google.dev/gemini-api/docs/function-calling#multimodal
			// Older models don't support this, so we put images in a separate user message.
			const supportsMultimodalFunctionResponse = model.id.includes("gemini-3");

			// Use "output" key for success, "error" key for errors as per SDK documentation
			const responseValue = hasText ? sanitizeSurrogates(textResult) : hasImages ? "(see attached image)" : "";

			const imageParts: Part[] = imageContent.map((imageBlock) => ({
				inlineData: {
					mimeType: imageBlock.mimeType,
					data: imageBlock.data,
				},
			}));

			const functionResponsePart: Part = {
				functionResponse: {
					id: msg.toolCallId,
					name: msg.toolName,
					response: msg.isError ? { error: responseValue } : { output: responseValue },
					// Nest images inside functionResponse.parts for Gemini 3
					...(hasImages && supportsMultimodalFunctionResponse && { parts: imageParts }),
				},
			};

			if (model.provider === "google-vertex" && functionResponsePart.functionResponse?.id) {
				delete functionResponsePart.functionResponse.id; // Vertex AI does not support 'id' in functionResponse
			}

			// Cloud Code Assist API requires all function responses to be in a single user turn.
			// Check if the last content is already a user turn with function responses and merge.
			const lastContent = contents[contents.length - 1];
			if (lastContent?.role === "user" && lastContent.parts?.some((p) => p.functionResponse)) {
				lastContent.parts.push(functionResponsePart);
			} else {
				contents.push({
					role: "user",
					parts: [functionResponsePart],
				});
			}

			// For older models, add images in a separate user message
			if (hasImages && !supportsMultimodalFunctionResponse) {
				contents.push({
					role: "user",
					parts: [{ text: "Tool result image:" }, ...imageParts],
				});
			}
		}
	}

	// Gemini API requires alternating roles (user/model). Merge consecutive turns of the same role.
	const alternatingContents: Content[] = [];
	for (const content of contents) {
		const last = alternatingContents[alternatingContents.length - 1];
		if (last && last.role === content.role) {
			if (!last.parts) last.parts = [];
			if (content.parts) {
				last.parts.push(...content.parts);
			}
		} else {
			alternatingContents.push(content);
		}
	}

	return alternatingContents;
}

/**
 * Convert tools to Gemini function declarations format.
 */
export function convertTools(
	tools: Tool[],
): { functionDeclarations: { name: string; description?: string; parameters: Schema }[] }[] | undefined {
	if (tools.length === 0) return undefined;
	return [
		{
			functionDeclarations: tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters as Schema,
			})),
		},
	];
}

/**
 * Map tool choice string to Gemini FunctionCallingConfigMode.
 */
export function mapToolChoice(choice: string): FunctionCallingConfigMode {
	switch (choice) {
		case "auto":
			return FunctionCallingConfigMode.AUTO;
		case "none":
			return FunctionCallingConfigMode.NONE;
		case "any":
			return FunctionCallingConfigMode.ANY;
		default:
			return FunctionCallingConfigMode.AUTO;
	}
}

/**
 * Map Gemini FinishReason to our StopReason.
 */
export function mapStopReason(reason: FinishReason): StopReason {
	switch (reason) {
		case FinishReason.STOP:
			return "stop";
		case FinishReason.MAX_TOKENS:
			return "length";
		case FinishReason.BLOCKLIST:
		case FinishReason.PROHIBITED_CONTENT:
		case FinishReason.SPII:
		case FinishReason.SAFETY:
		case FinishReason.IMAGE_SAFETY:
		case FinishReason.IMAGE_PROHIBITED_CONTENT:
		case FinishReason.IMAGE_RECITATION:
		case FinishReason.IMAGE_OTHER:
		case FinishReason.RECITATION:
		case FinishReason.FINISH_REASON_UNSPECIFIED:
		case FinishReason.OTHER:
		case FinishReason.LANGUAGE:
		case FinishReason.MALFORMED_FUNCTION_CALL:
		case FinishReason.UNEXPECTED_TOOL_CALL:
		case FinishReason.NO_IMAGE:
			return "error";
		default: {
			const _exhaustive: never = reason;
			throw new Error(`Unhandled stop reason: ${_exhaustive}`);
		}
	}
}

/**
 * Map string finish reason to our StopReason (for raw API responses).
 */
export function mapStopReasonString(reason: string): StopReason {
	switch (reason) {
		case "STOP":
			return "stop";
		case "MAX_TOKENS":
			return "length";
		default:
			return "error";
	}
}
