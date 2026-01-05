import type {
	Tool as OpenAITool,
	ResponseInput,
	ResponseInputContent,
	ResponseInputImage,
	ResponseInputText,
	ResponseOutputMessage,
	ResponseReasoningItem,
} from "openai/resources/responses/responses.js";
import type { Context, Model, TextContent, Tool, ToolCall } from "../../types.js";
import { sanitizeSurrogates } from "../../utils/sanitize-unicode.js";
import { transformMessages } from "../transorm-messages.js";

/** Fast deterministic hash to shorten long strings */
export function shortHash(str: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

type ResponsesApi = "openai-responses" | "openai-codex-responses";

function isResponseReasoningItem(value: unknown): value is ResponseReasoningItem {
	return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "reasoning";
}

export function convertMessages<TApi extends ResponsesApi>(model: Model<TApi>, context: Context): ResponseInput {
	const messages: ResponseInput = [];
	const transformedMessages = transformMessages(context.messages, model);

	if (context.systemPrompt) {
		const role = model.reasoning ? "developer" : "system";
		messages.push({
			role,
			content: sanitizeSurrogates(context.systemPrompt),
		});
	}

	let msgIndex = 0;
	for (const msg of transformedMessages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				messages.push({
					role: "user",
					content: [{ type: "input_text", text: sanitizeSurrogates(msg.content) }],
				});
			} else {
				const content: ResponseInputContent[] = msg.content.map((item): ResponseInputContent => {
					if (item.type === "text") {
						return {
							type: "input_text",
							text: sanitizeSurrogates(item.text),
						} satisfies ResponseInputText;
					}
					return {
						type: "input_image",
						detail: "auto",
						image_url: `data:${item.mimeType};base64,${item.data}`,
					} satisfies ResponseInputImage;
				});

				const filteredContent = !model.input.includes("image")
					? content.filter((c) => c.type !== "input_image")
					: content;
				if (filteredContent.length === 0) continue;
				messages.push({
					role: "user",
					content: filteredContent,
				});
			}
		} else if (msg.role === "assistant") {
			const output: ResponseInput = [];

			for (const block of msg.content) {
				if (block.type === "thinking" && msg.stopReason !== "error") {
					if (block.thinkingSignature) {
						const parsed = JSON.parse(block.thinkingSignature) as unknown;
						if (isResponseReasoningItem(parsed)) {
							output.push(parsed);
						}
					}
				} else if (block.type === "text") {
					const textBlock = block as TextContent;
					let msgId = textBlock.textSignature;
					if (!msgId) {
						msgId = `msg_${msgIndex}`;
					} else if (msgId.length > 64) {
						msgId = `msg_${shortHash(msgId)}`;
					}
					output.push({
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: sanitizeSurrogates(textBlock.text), annotations: [] }],
						status: "completed",
						id: msgId,
					} satisfies ResponseOutputMessage);
				} else if (block.type === "toolCall" && msg.stopReason !== "error") {
					const toolCall = block as ToolCall;
					output.push({
						type: "function_call",
						id: toolCall.id.split("|")[1],
						call_id: toolCall.id.split("|")[0],
						name: toolCall.name,
						arguments: JSON.stringify(toolCall.arguments),
					});
				}
			}

			if (output.length === 0) continue;
			messages.push(...output);
		} else if (msg.role === "toolResult") {
			const textResult = msg.content
				.filter((c) => c.type === "text")
				.map((c) => c.text)
				.join("\n");
			const hasImages = msg.content.some((c) => c.type === "image");

			const hasText = textResult.length > 0;
			messages.push({
				type: "function_call_output",
				call_id: msg.toolCallId.split("|")[0],
				output: sanitizeSurrogates(hasText ? textResult : "(see attached image)"),
			});

			if (hasImages && model.input.includes("image")) {
				const contentParts: ResponseInputContent[] = [
					{
						type: "input_text",
						text: "Attached image(s) from tool result:",
					} satisfies ResponseInputText,
				];

				for (const block of msg.content) {
					if (block.type === "image") {
						contentParts.push({
							type: "input_image",
							detail: "auto",
							image_url: `data:${block.mimeType};base64,${block.data}`,
						} satisfies ResponseInputImage);
					}
				}

				messages.push({
					role: "user",
					content: contentParts,
				});
			}
		}
		msgIndex++;
	}

	return messages;
}

export function convertTools(tools: Tool[]): OpenAITool[] {
	return tools.map((tool) => ({
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters as unknown as Record<string, unknown>,
		strict: null,
	}));
}
