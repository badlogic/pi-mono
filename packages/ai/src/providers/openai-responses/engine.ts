import { calculateCost } from "../../models.js";
import type { AssistantMessage, Model, StopReason, TextContent, ThinkingContent, ToolCall } from "../../types.js";
import type { AssistantMessageEventStream } from "../../utils/event-stream.js";
import { parseStreamingJson } from "../../utils/json-parse.js";

type ReasoningSummaryPartLike = {
	text: string;
	[key: string]: unknown;
};

type ResponsesReasoningItemLike = {
	type: "reasoning";
	summary?: ReasoningSummaryPartLike[];
	[key: string]: unknown;
};

type MessageContentPartLike =
	| { type: "output_text"; text: string; [key: string]: unknown }
	| { type: "refusal"; refusal: string; [key: string]: unknown };

type ResponsesOutputMessageLike = {
	type: "message";
	id: string;
	content: MessageContentPartLike[];
	[key: string]: unknown;
};

type ResponsesFunctionToolCallLike = {
	type: "function_call";
	id: string;
	call_id: string;
	name: string;
	arguments: string;
	[key: string]: unknown;
};

type ResponsesOutputItemLike = ResponsesReasoningItemLike | ResponsesOutputMessageLike | ResponsesFunctionToolCallLike;

export type CompletedResponseLike = {
	usage?: {
		input_tokens?: number;
		output_tokens?: number;
		total_tokens?: number;
		input_tokens_details?: { cached_tokens?: number };
	};
	status?: unknown;
	[key: string]: unknown;
};

export type ResponsesEngineEvent =
	| { type: "response.output_item.added"; item: ResponsesOutputItemLike }
	| { type: "response.reasoning_summary_part.added"; part: ReasoningSummaryPartLike }
	| { type: "response.reasoning_summary_text.delta"; delta: string }
	| { type: "response.reasoning_summary_part.done" }
	| { type: "response.content_part.added"; part: MessageContentPartLike }
	| { type: "response.output_text.delta"; delta: string }
	| { type: "response.refusal.delta"; delta: string }
	| { type: "response.function_call_arguments.delta"; delta: string }
	| { type: "response.output_item.done"; item: ResponsesOutputItemLike }
	| { type: "response.completed"; response?: CompletedResponseLike }
	| { type: "response.done"; response?: CompletedResponseLike }
	| { type: "response.failed" }
	| { type: "error"; code?: string; message?: string }
	| { type: string; [key: string]: unknown };

type ResponsesApi = "openai-responses" | "openai-codex-responses";

type ToolCallWithPartialJson = ToolCall & { partialJson: string };

type ConsumeResponsesEventsArgs<TStatus> = {
	events: AsyncIterable<ResponsesEngineEvent>;
	stream: AssistantMessageEventStream;
	output: AssistantMessage;
	model: Model<ResponsesApi>;
	mapStopReason: (status: TStatus) => StopReason;
};

function isOutputItemLike(value: unknown): value is ResponsesOutputItemLike {
	return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function ensureString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

export async function consumeResponsesEvents<TStatus>(args: ConsumeResponsesEventsArgs<TStatus>): Promise<void> {
	let currentItem: ResponsesOutputItemLike | null = null;
	let currentBlock: ThinkingContent | TextContent | ToolCallWithPartialJson | null = null;

	const blocks = args.output.content;
	const blockIndex = () => blocks.length - 1;

	for await (const rawEvent of args.events) {
		const eventType = rawEvent.type;

		if (eventType === "response.output_item.added") {
			const item = (rawEvent as { item?: unknown }).item;
			if (!isOutputItemLike(item)) continue;

			if (item.type === "reasoning") {
				currentItem = item;
				currentBlock = { type: "thinking", thinking: "" };
				args.output.content.push(currentBlock);
				args.stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: args.output });
			} else if (item.type === "message") {
				currentItem = item;
				currentBlock = { type: "text", text: "" };
				args.output.content.push(currentBlock);
				args.stream.push({ type: "text_start", contentIndex: blockIndex(), partial: args.output });
			} else if (item.type === "function_call") {
				currentItem = item;
				currentBlock = {
					type: "toolCall",
					id: `${item.call_id}|${item.id}`,
					name: item.name,
					arguments: {},
					partialJson: ensureString(item.arguments),
				};
				args.output.content.push(currentBlock);
				args.stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: args.output });
			}
			continue;
		}

		if (eventType === "response.reasoning_summary_part.added") {
			if (currentItem?.type === "reasoning") {
				const part = (rawEvent as { part?: unknown }).part;
				if (typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string") {
					currentItem.summary = currentItem.summary || [];
					currentItem.summary.push(part as ReasoningSummaryPartLike);
				}
			}
			continue;
		}

		if (eventType === "response.reasoning_summary_text.delta") {
			if (currentItem?.type === "reasoning" && currentBlock?.type === "thinking") {
				currentItem.summary = currentItem.summary || [];
				const lastPart = currentItem.summary[currentItem.summary.length - 1];
				if (lastPart) {
					const delta = ensureString((rawEvent as { delta?: unknown }).delta);
					currentBlock.thinking += delta;
					lastPart.text += delta;
					args.stream.push({
						type: "thinking_delta",
						contentIndex: blockIndex(),
						delta,
						partial: args.output,
					});
				}
			}
			continue;
		}

		if (eventType === "response.reasoning_summary_part.done") {
			if (currentItem?.type === "reasoning" && currentBlock?.type === "thinking") {
				currentItem.summary = currentItem.summary || [];
				const lastPart = currentItem.summary[currentItem.summary.length - 1];
				if (lastPart) {
					currentBlock.thinking += "\n\n";
					lastPart.text += "\n\n";
					args.stream.push({
						type: "thinking_delta",
						contentIndex: blockIndex(),
						delta: "\n\n",
						partial: args.output,
					});
				}
			}
			continue;
		}

		if (eventType === "response.content_part.added") {
			if (currentItem?.type === "message") {
				const part = (rawEvent as { part?: unknown }).part;
				if (typeof part === "object" && part !== null) {
					const partType = (part as { type?: unknown }).type;
					if (partType === "output_text" || partType === "refusal") {
						if (!Array.isArray(currentItem.content)) {
							currentItem.content = [];
						}
						currentItem.content.push(part as MessageContentPartLike);
					}
				}
			}
			continue;
		}

		if (eventType === "response.output_text.delta") {
			if (currentItem?.type === "message" && currentBlock?.type === "text") {
				if (!Array.isArray(currentItem.content)) {
					currentItem.content = [];
				}

				let lastPart = currentItem.content[currentItem.content.length - 1];
				if (!lastPart || lastPart.type !== "output_text") {
					lastPart = { type: "output_text", text: "" };
					currentItem.content.push(lastPart);
				}

				const delta = ensureString((rawEvent as { delta?: unknown }).delta);
				currentBlock.text += delta;
				lastPart.text += delta;
				args.stream.push({
					type: "text_delta",
					contentIndex: blockIndex(),
					delta,
					partial: args.output,
				});
			}
			continue;
		}

		if (eventType === "response.refusal.delta") {
			if (currentItem?.type === "message" && currentBlock?.type === "text") {
				if (!Array.isArray(currentItem.content)) {
					currentItem.content = [];
				}

				let lastPart = currentItem.content[currentItem.content.length - 1];
				if (!lastPart || lastPart.type !== "refusal") {
					lastPart = { type: "refusal", refusal: "" };
					currentItem.content.push(lastPart);
				}

				const delta = ensureString((rawEvent as { delta?: unknown }).delta);
				currentBlock.text += delta;
				lastPart.refusal += delta;
				args.stream.push({
					type: "text_delta",
					contentIndex: blockIndex(),
					delta,
					partial: args.output,
				});
			}
			continue;
		}

		if (eventType === "response.function_call_arguments.delta") {
			if (currentItem?.type === "function_call" && currentBlock?.type === "toolCall") {
				const delta = ensureString((rawEvent as { delta?: unknown }).delta);
				currentBlock.partialJson += delta;
				currentBlock.arguments = parseStreamingJson(currentBlock.partialJson);
				args.stream.push({
					type: "toolcall_delta",
					contentIndex: blockIndex(),
					delta,
					partial: args.output,
				});
			}
			continue;
		}

		if (eventType === "response.output_item.done") {
			const item = (rawEvent as { item?: unknown }).item;
			if (!isOutputItemLike(item)) continue;

			if (item.type === "reasoning" && currentBlock?.type === "thinking") {
				const summary = item.summary?.map((s) => s.text).join("\n\n") || "";
				currentBlock.thinking = summary;
				currentBlock.thinkingSignature = JSON.stringify(item);
				args.stream.push({
					type: "thinking_end",
					contentIndex: blockIndex(),
					content: currentBlock.thinking,
					partial: args.output,
				});
				currentBlock = null;
			} else if (item.type === "message" && currentBlock?.type === "text") {
				currentBlock.text = item.content.map((c) => (c.type === "output_text" ? c.text : c.refusal)).join("");
				currentBlock.textSignature = item.id;
				args.stream.push({
					type: "text_end",
					contentIndex: blockIndex(),
					content: currentBlock.text,
					partial: args.output,
				});
				currentBlock = null;
			} else if (item.type === "function_call") {
				const toolCall: ToolCall = {
					type: "toolCall",
					id: `${item.call_id}|${item.id}`,
					name: item.name,
					arguments: JSON.parse(item.arguments),
				};
				args.stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall, partial: args.output });
			}
			continue;
		}

		if (eventType === "response.completed" || eventType === "response.done") {
			const response = (rawEvent as { response?: unknown }).response as CompletedResponseLike | undefined;
			if (response?.usage) {
				const cachedTokens = response.usage.input_tokens_details?.cached_tokens || 0;
				args.output.usage = {
					input: (response.usage.input_tokens || 0) - cachedTokens,
					output: response.usage.output_tokens || 0,
					cacheRead: cachedTokens,
					cacheWrite: 0,
					totalTokens: response.usage.total_tokens || 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				};
			}
			calculateCost(args.model, args.output.usage);
			args.output.stopReason = args.mapStopReason(response?.status as TStatus);
			if (args.output.content.some((b) => b.type === "toolCall") && args.output.stopReason === "stop") {
				args.output.stopReason = "toolUse";
			}
			continue;
		}

		if (eventType === "error") {
			const code = ensureString((rawEvent as { code?: unknown }).code);
			const message = ensureString((rawEvent as { message?: unknown }).message) || "Unknown error";
			throw new Error(code ? `Error Code ${code}: ${message}` : message);
		}

		if (eventType === "response.failed") {
			throw new Error("Unknown error");
		}
	}
}
