import type { ContentBlockParam, MessageParam } from "@anthropic-ai/sdk/resources/messages.js";
import { BedrockRuntimeClient, InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";
import { calculateCost } from "../models.js";
import type {
	Api,
	AssistantMessage,
	Context,
	ImageContent,
	Message,
	Model,
	StopReason,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
	ToolResultMessage,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { parseStreamingJson } from "../utils/json-parse.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import { transformMessages } from "./transorm-messages.js";

const BEDROCK_ANTHROPIC_VERSION = "bedrock-2023-05-31";

export interface BedrockOptions extends StreamOptions {
	region?: string;
	thinkingEnabled?: boolean;
	thinkingBudgetTokens?: number;
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
}

type BedrockUsage = {
	input_tokens?: number;
	output_tokens?: number;
	cache_read_input_tokens?: number;
	cache_creation_input_tokens?: number;
};

type BedrockContentBlock =
	| { type: "text"; text: string }
	| { type: "thinking"; thinking: string; signature?: string }
	| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

type BedrockContentDelta =
	| { type: "text_delta"; text: string }
	| { type: "thinking_delta"; thinking: string }
	| { type: "input_json_delta"; partial_json: string }
	| { type: "signature_delta"; signature: string };

type BedrockStreamEvent = {
	type: string;
	[key: string]: unknown;
};

type BedrockResponseEvent = {
	chunk?: { bytes?: Uint8Array };
};

export const streamAnthropicBedrock: StreamFunction<"anthropic-bedrock"> = (
	model: Model<"anthropic-bedrock">,
	context: Context,
	options?: BedrockOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "anthropic-bedrock" as Api,
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
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			const region = resolveRegion(model, options);
			const endpoint = resolveEndpoint(model.baseUrl);
			const client = new BedrockRuntimeClient({ region, ...(endpoint ? { endpoint } : {}) });
			const params = buildParams(model, context, options);
			const command = new InvokeModelWithResponseStreamCommand({
				modelId: model.id,
				contentType: "application/json",
				accept: "application/json",
				body: JSON.stringify(params),
			});

			const response = await client.send(command, { abortSignal: options?.signal });
			stream.push({ type: "start", partial: output });

			type Block = (ThinkingContent | TextContent | (ToolCall & { partialJson: string })) & { index: number };
			const blocks = output.content as Block[];
			const decoder = new TextDecoder();
			let buffer = "";

			const updateUsage = (usage?: BedrockUsage): void => {
				output.usage.input = usage?.input_tokens || 0;
				output.usage.output = usage?.output_tokens || 0;
				output.usage.cacheRead = usage?.cache_read_input_tokens || 0;
				output.usage.cacheWrite = usage?.cache_creation_input_tokens || 0;
				output.usage.totalTokens =
					output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
				calculateCost(model, output.usage);
			};

			const handleEvent = (event: BedrockStreamEvent): void => {
				if (event.type === "message_start") {
					const message = event as { message?: { usage?: BedrockUsage } };
					updateUsage(message.message?.usage);
					return;
				}

				if (event.type === "content_block_start") {
					const start = event as { index?: number; content_block?: BedrockContentBlock };
					const blockIndex = start.index ?? 0;
					const contentBlock = start.content_block;
					if (!contentBlock) return;

					if (contentBlock.type === "text") {
						const block: Block = {
							type: "text",
							text: "",
							index: blockIndex,
						};
						output.content.push(block);
						stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
					} else if (contentBlock.type === "thinking") {
						const block: Block = {
							type: "thinking",
							thinking: "",
							thinkingSignature: "",
							index: blockIndex,
						};
						output.content.push(block);
						stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
					} else if (contentBlock.type === "tool_use") {
						const block: Block = {
							type: "toolCall",
							id: contentBlock.id,
							name: contentBlock.name,
							arguments: contentBlock.input as Record<string, any>,
							partialJson: "",
							index: blockIndex,
						};
						output.content.push(block);
						stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
					}
					return;
				}

				if (event.type === "content_block_delta") {
					const deltaEvent = event as { index?: number; delta?: BedrockContentDelta };
					const blockIndex = deltaEvent.index ?? 0;
					const delta = deltaEvent.delta;
					if (!delta) return;

					if (delta.type === "text_delta") {
						const index = blocks.findIndex((b) => b.index === blockIndex);
						const block = blocks[index];
						if (block && block.type === "text") {
							block.text += delta.text;
							stream.push({
								type: "text_delta",
								contentIndex: index,
								delta: delta.text,
								partial: output,
							});
						}
					} else if (delta.type === "thinking_delta") {
						const index = blocks.findIndex((b) => b.index === blockIndex);
						const block = blocks[index];
						if (block && block.type === "thinking") {
							block.thinking += delta.thinking;
							stream.push({
								type: "thinking_delta",
								contentIndex: index,
								delta: delta.thinking,
								partial: output,
							});
						}
					} else if (delta.type === "input_json_delta") {
						const index = blocks.findIndex((b) => b.index === blockIndex);
						const block = blocks[index];
						if (block && block.type === "toolCall") {
							block.partialJson += delta.partial_json;
							block.arguments = parseStreamingJson<Record<string, unknown>>(block.partialJson) as Record<
								string,
								any
							>;
							stream.push({
								type: "toolcall_delta",
								contentIndex: index,
								delta: delta.partial_json,
								partial: output,
							});
						}
					} else if (delta.type === "signature_delta") {
						const index = blocks.findIndex((b) => b.index === blockIndex);
						const block = blocks[index];
						if (block && block.type === "thinking") {
							block.thinkingSignature = block.thinkingSignature || "";
							block.thinkingSignature += delta.signature;
						}
					}
					return;
				}

				if (event.type === "content_block_stop") {
					const stop = event as { index?: number };
					const blockIndex = stop.index ?? 0;
					const index = blocks.findIndex((b) => b.index === blockIndex);
					const block = blocks[index];
					if (block) {
						delete (block as any).index;
						if (block.type === "text") {
							stream.push({
								type: "text_end",
								contentIndex: index,
								content: block.text,
								partial: output,
							});
						} else if (block.type === "thinking") {
							stream.push({
								type: "thinking_end",
								contentIndex: index,
								content: block.thinking,
								partial: output,
							});
						} else if (block.type === "toolCall") {
							block.arguments = parseStreamingJson<Record<string, unknown>>(block.partialJson) as Record<
								string,
								any
							>;
							delete (block as any).partialJson;
							stream.push({
								type: "toolcall_end",
								contentIndex: index,
								toolCall: block,
								partial: output,
							});
						}
					}
					return;
				}

				if (event.type === "message_delta") {
					const delta = event as { delta?: { stop_reason?: string }; usage?: BedrockUsage };
					if (delta.delta?.stop_reason) {
						output.stopReason = mapStopReason(delta.delta.stop_reason);
					}
					updateUsage(delta.usage);
				}
			};

			const body = response.body ?? [];
			for await (const event of body as AsyncIterable<BedrockResponseEvent>) {
				if (options?.signal?.aborted) {
					throw new Error("Request was aborted");
				}

				const bytes = event.chunk?.bytes;
				if (!bytes) continue;

				const text = decoder.decode(bytes, { stream: true });
				const parsed = parseBedrockEvents(buffer, text);
				buffer = parsed.buffer;
				for (const evt of parsed.events) {
					handleEvent(evt);
				}
			}

			const remainingEvents = parseRemainingEvents(buffer);
			for (const evt of remainingEvents) {
				handleEvent(evt);
			}

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unkown error ocurred");
			}

			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) delete (block as any).index;
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

function parseBedrockEvents(buffer: string, text: string): { events: BedrockStreamEvent[]; buffer: string } {
	const combined = buffer + text;
	const lines = combined.split(/\r?\n/);
	if (lines.length === 1) {
		const trimmed = combined.trim();
		if (trimmed.length === 0) {
			return { events: [], buffer: "" };
		}
		try {
			return { events: [JSON.parse(trimmed) as BedrockStreamEvent], buffer: "" };
		} catch {
			return { events: [], buffer: combined };
		}
	}

	const tail = lines.pop() ?? "";
	const events: BedrockStreamEvent[] = [];
	for (const line of lines) {
		const evt = safeParseEvent(line);
		if (evt) events.push(evt);
	}
	return { events, buffer: tail };
}

function parseRemainingEvents(buffer: string): BedrockStreamEvent[] {
	const trimmed = buffer.trim();
	if (trimmed.length === 0) return [];
	const direct = safeParseEvent(trimmed);
	if (direct) return [direct];
	const events: BedrockStreamEvent[] = [];
	for (const line of trimmed.split(/\r?\n/)) {
		const evt = safeParseEvent(line);
		if (evt) events.push(evt);
	}
	return events;
}

function safeParseEvent(line: string): BedrockStreamEvent | null {
	const trimmed = line.trim();
	if (trimmed.length === 0) return null;
	try {
		return JSON.parse(trimmed) as BedrockStreamEvent;
	} catch {
		return null;
	}
}

function resolveEndpoint(baseUrl: string): string | undefined {
	if (!baseUrl) return undefined;
	if (baseUrl.startsWith("http://") || baseUrl.startsWith("https://")) {
		return baseUrl;
	}
	return undefined;
}

function parseRegionFromEndpoint(baseUrl: string): string | undefined {
	try {
		const url = new URL(baseUrl);
		const match = url.hostname.match(/bedrock-runtime[.-]([a-z0-9-]+)\.amazonaws\.com$/);
		return match?.[1];
	} catch {
		return undefined;
	}
}

function resolveRegion(model: Model<"anthropic-bedrock">, options?: BedrockOptions): string {
	if (options?.region) return options.region;
	const envRegion = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
	if (envRegion) return envRegion;
	const regionFromEndpoint = parseRegionFromEndpoint(model.baseUrl);
	if (regionFromEndpoint) return regionFromEndpoint;
	throw new Error(
		"AWS region is required for Bedrock. Provide BedrockOptions.region, set AWS_REGION, or use a bedrock endpoint in baseUrl.",
	);
}

function buildParams(
	model: Model<"anthropic-bedrock">,
	context: Context,
	options?: BedrockOptions,
): Record<string, unknown> {
	const params: Record<string, unknown> = {
		anthropic_version: BEDROCK_ANTHROPIC_VERSION,
		messages: convertMessages(context.messages, model),
		max_tokens: options?.maxTokens || (model.maxTokens / 3) | 0,
	};

	if (context.systemPrompt) {
		params.system = [
			{
				type: "text",
				text: sanitizeSurrogates(context.systemPrompt),
			},
		];
	}

	if (options?.temperature !== undefined) {
		params.temperature = options.temperature;
	}

	if (context.tools) {
		params.tools = convertTools(context.tools);
	}

	if (options?.thinkingEnabled && model.reasoning) {
		params.thinking = {
			type: "enabled",
			budget_tokens: options.thinkingBudgetTokens || 1024,
		};
	}

	if (options?.toolChoice) {
		if (typeof options.toolChoice === "string") {
			params.tool_choice = { type: options.toolChoice };
		} else {
			params.tool_choice = options.toolChoice;
		}
	}

	return params;
}

function convertContentBlocks(content: (TextContent | ImageContent)[]):
	| string
	| Array<
			| { type: "text"; text: string }
			| {
					type: "image";
					source: {
						type: "base64";
						media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
						data: string;
					};
			  }
	  > {
	const hasImages = content.some((c) => c.type === "image");
	if (!hasImages) {
		return sanitizeSurrogates(content.map((c) => (c as TextContent).text).join("\n"));
	}

	const blocks = content.map((block) => {
		if (block.type === "text") {
			return {
				type: "text" as const,
				text: sanitizeSurrogates(block.text),
			};
		}
		return {
			type: "image" as const,
			source: {
				type: "base64" as const,
				media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
				data: block.data,
			},
		};
	});

	const hasText = blocks.some((b) => b.type === "text");
	if (!hasText) {
		blocks.unshift({
			type: "text" as const,
			text: "(see attached image)",
		});
	}

	return blocks;
}

function sanitizeToolCallId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function convertMessages(messages: Message[], model: Model<"anthropic-bedrock">): MessageParam[] {
	const params: MessageParam[] = [];
	const transformedMessages = transformMessages(messages, model);

	for (let i = 0; i < transformedMessages.length; i++) {
		const msg = transformedMessages[i];

		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				if (msg.content.trim().length > 0) {
					params.push({
						role: "user",
						content: sanitizeSurrogates(msg.content),
					});
				}
			} else {
				const blocks: ContentBlockParam[] = msg.content.map((item) => {
					if (item.type === "text") {
						return {
							type: "text",
							text: sanitizeSurrogates(item.text),
						};
					}
					return {
						type: "image",
						source: {
							type: "base64",
							media_type: item.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
							data: item.data,
						},
					};
				});
				let filteredBlocks = !model?.input.includes("image") ? blocks.filter((b) => b.type !== "image") : blocks;
				filteredBlocks = filteredBlocks.filter((b) => (b.type === "text" ? b.text.trim().length > 0 : true));
				if (filteredBlocks.length === 0) continue;
				params.push({
					role: "user",
					content: filteredBlocks,
				});
			}
		} else if (msg.role === "assistant") {
			const blocks: ContentBlockParam[] = [];

			for (const block of msg.content) {
				if (block.type === "text") {
					if (block.text.trim().length === 0) continue;
					blocks.push({
						type: "text",
						text: sanitizeSurrogates(block.text),
					});
				} else if (block.type === "thinking") {
					if (block.thinking.trim().length === 0) continue;
					if (!block.thinkingSignature || block.thinkingSignature.trim().length === 0) {
						blocks.push({
							type: "text",
							text: sanitizeSurrogates(block.thinking),
						});
					} else {
						blocks.push({
							type: "thinking",
							thinking: sanitizeSurrogates(block.thinking),
							signature: block.thinkingSignature,
						});
					}
				} else if (block.type === "toolCall") {
					blocks.push({
						type: "tool_use",
						id: sanitizeToolCallId(block.id),
						name: block.name,
						input: block.arguments,
					});
				}
			}
			if (blocks.length === 0) continue;
			params.push({
				role: "assistant",
				content: blocks,
			});
		} else if (msg.role === "toolResult") {
			const toolResults: ContentBlockParam[] = [];
			toolResults.push({
				type: "tool_result",
				tool_use_id: sanitizeToolCallId(msg.toolCallId),
				content: convertContentBlocks(msg.content),
				is_error: msg.isError,
			});

			let j = i + 1;
			while (j < transformedMessages.length && transformedMessages[j].role === "toolResult") {
				const nextMsg = transformedMessages[j] as ToolResultMessage;
				toolResults.push({
					type: "tool_result",
					tool_use_id: sanitizeToolCallId(nextMsg.toolCallId),
					content: convertContentBlocks(nextMsg.content),
					is_error: nextMsg.isError,
				});
				j++;
			}

			i = j - 1;

			params.push({
				role: "user",
				content: toolResults,
			});
		}
	}

	return params;
}

function convertTools(
	tools: Tool[],
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
	if (!tools) return [];

	return tools.map((tool) => {
		const jsonSchema = tool.parameters as Record<string, unknown>;

		return {
			name: tool.name,
			description: tool.description,
			input_schema: {
				type: "object",
				properties: (jsonSchema as { properties?: Record<string, unknown> }).properties || {},
				required: (jsonSchema as { required?: string[] }).required || [],
			},
		};
	});
}

function mapStopReason(reason: string): StopReason {
	switch (reason) {
		case "end_turn":
			return "stop";
		case "max_tokens":
			return "length";
		case "tool_use":
			return "toolUse";
		case "refusal":
			return "error";
		case "pause_turn":
		case "stop_sequence":
			return "stop";
		default:
			return "stop";
	}
}
