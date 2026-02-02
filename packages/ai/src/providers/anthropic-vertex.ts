/**
 * Anthropic provider for Google Cloud Vertex AI.
 *
 * Uses raw fetch + google-auth-library since the Anthropic SDK
 * doesn't support Vertex AI's URL structure.
 */

import { GoogleAuth } from "google-auth-library";
import { calculateCost } from "../models.js";
import type {
	Api,
	AssistantMessage,
	Context,
	Message,
	Model,
	SimpleStreamOptions,
	StreamFunction,
	StreamOptions,
	TextContent,
	ThinkingContent,
	ToolCall,
	ToolResultMessage,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { parseStreamingJson } from "../utils/json-parse.js";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.js";
import { convertContentBlocks, convertTools, mapStopReason, normalizeToolCallId } from "./anthropic-shared.js";
import { adjustMaxTokensForThinking, buildBaseOptions } from "./simple-options.js";
import { transformMessages } from "./transform-messages.js";

const ANTHROPIC_VERSION = "vertex-2023-10-16";

export interface AnthropicVertexOptions extends StreamOptions {
	thinkingEnabled?: boolean;
	thinkingBudgetTokens?: number;
	project?: string;
	location?: string;
	toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string };
}

/**
 * Resolve GCP project from options or environment.
 */
function resolveProject(options?: AnthropicVertexOptions): string {
	const project =
		options?.project ||
		process.env.ANTHROPIC_VERTEX_PROJECT_ID ||
		process.env.GOOGLE_CLOUD_PROJECT ||
		process.env.GCLOUD_PROJECT;
	if (!project) {
		throw new Error("Vertex AI requires a project ID. Set GOOGLE_CLOUD_PROJECT or pass project in options.");
	}
	return project;
}

/**
 * Resolve GCP location from options or environment.
 */
function resolveLocation(options?: AnthropicVertexOptions): string {
	return (
		options?.location || process.env.CLOUD_ML_REGION || process.env.GOOGLE_CLOUD_LOCATION || "global" // Default to global region for Anthropic models
	);
}

/**
 * Get access token using Application Default Credentials.
 */
async function getAccessToken(): Promise<string> {
	const auth = new GoogleAuth({
		scopes: ["https://www.googleapis.com/auth/cloud-platform"],
	});
	const client = await auth.getClient();
	const tokenResponse = await client.getAccessToken();
	if (!tokenResponse.token) {
		throw new Error(
			"Failed to get access token. Run 'gcloud auth application-default login' or set GOOGLE_APPLICATION_CREDENTIALS",
		);
	}
	return tokenResponse.token;
}

/**
 * Build the Vertex AI endpoint URL for Anthropic models.
 */
function buildVertexUrl(project: string, location: string, modelId: string): string {
	// Global region uses different base URL
	const baseUrl =
		location === "global" ? "https://aiplatform.googleapis.com" : `https://${location}-aiplatform.googleapis.com`;

	return `${baseUrl}/v1/projects/${project}/locations/${location}/publishers/anthropic/models/${modelId}:streamRawPredict`;
}

/**
 * Convert Pi messages to Anthropic message format for Vertex AI.
 */
function convertMessages(
	messages: Message[],
	model: Model<"anthropic-vertex">,
): Array<{ role: "user" | "assistant"; content: any }> {
	const params: Array<{ role: "user" | "assistant"; content: any }> = [];
	const transformedMessages = transformMessages(messages, model, normalizeToolCallId);

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
				const blocks = msg.content
					.filter((item) => {
						if (item.type === "text") return item.text.trim().length > 0;
						return true;
					})
					.map((item) => {
						if (item.type === "text") {
							return { type: "text", text: sanitizeSurrogates(item.text) };
						}
						return {
							type: "image",
							source: {
								type: "base64",
								media_type: item.mimeType,
								data: item.data,
							},
						};
					});

				// Filter images if model doesn't support them
				const filteredBlocks = model.input.includes("image") ? blocks : blocks.filter((b) => b.type !== "image");

				if (filteredBlocks.length > 0) {
					params.push({ role: "user", content: filteredBlocks });
				}
			}
		} else if (msg.role === "assistant") {
			const blocks: any[] = [];

			for (const block of msg.content) {
				if (block.type === "text") {
					if (block.text.trim().length === 0) continue;
					blocks.push({ type: "text", text: sanitizeSurrogates(block.text) });
				} else if (block.type === "thinking") {
					if (block.thinking.trim().length === 0) continue;
					// Convert thinking blocks - include signature if present
					if (block.thinkingSignature && block.thinkingSignature.trim().length > 0) {
						blocks.push({
							type: "thinking",
							thinking: sanitizeSurrogates(block.thinking),
							signature: block.thinkingSignature,
						});
					} else {
						// No signature - convert to plain text
						blocks.push({ type: "text", text: sanitizeSurrogates(block.thinking) });
					}
				} else if (block.type === "toolCall") {
					blocks.push({
						type: "tool_use",
						id: block.id,
						name: block.name,
						input: block.arguments ?? {},
					});
				}
			}

			if (blocks.length > 0) {
				params.push({ role: "assistant", content: blocks });
			}
		} else if (msg.role === "toolResult") {
			// Collect consecutive tool results
			const toolResults: any[] = [];
			toolResults.push({
				type: "tool_result",
				tool_use_id: msg.toolCallId,
				content: convertContentBlocks(msg.content),
				is_error: msg.isError,
			});

			let j = i + 1;
			while (j < transformedMessages.length && transformedMessages[j].role === "toolResult") {
				const nextMsg = transformedMessages[j] as ToolResultMessage;
				toolResults.push({
					type: "tool_result",
					tool_use_id: nextMsg.toolCallId,
					content: convertContentBlocks(nextMsg.content),
					is_error: nextMsg.isError,
				});
				j++;
			}
			i = j - 1;

			params.push({ role: "user", content: toolResults });
		}
	}

	return params;
}

/**
 * Build request body for Vertex AI Anthropic endpoint.
 */
function buildRequestBody(
	model: Model<"anthropic-vertex">,
	context: Context,
	options?: AnthropicVertexOptions,
): Record<string, any> {
	const body: Record<string, any> = {
		anthropic_version: ANTHROPIC_VERSION,
		max_tokens: options?.maxTokens || Math.floor(model.maxTokens / 3),
		messages: convertMessages(context.messages, model),
		stream: true,
	};

	if (context.systemPrompt) {
		body.system = sanitizeSurrogates(context.systemPrompt);
	}

	if (context.tools && context.tools.length > 0) {
		body.tools = convertTools(context.tools);
	}

	if (options?.temperature !== undefined) {
		body.temperature = options.temperature;
	}

	if (options?.thinkingEnabled && model.reasoning) {
		body.thinking = {
			type: "enabled",
			budget_tokens: options.thinkingBudgetTokens || 1024,
		};
	}

	if (options?.toolChoice) {
		if (typeof options.toolChoice === "string") {
			body.tool_choice = { type: options.toolChoice };
		} else {
			body.tool_choice = options.toolChoice;
		}
	}

	return body;
}

export const streamAnthropicVertex: StreamFunction<"anthropic-vertex", AnthropicVertexOptions> = (
	model: Model<"anthropic-vertex">,
	context: Context,
	options?: AnthropicVertexOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: "anthropic-vertex" as Api,
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
			const project = resolveProject(options);
			const location = resolveLocation(options);
			const accessToken = await getAccessToken();
			const url = buildVertexUrl(project, location, model.id);
			const body = buildRequestBody(model, context, options);

			options?.onPayload?.(body);

			const response = await fetch(url, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/json",
					...options?.headers,
				},
				body: JSON.stringify(body),
				signal: options?.signal,
			});

			if (!response.ok) {
				const text = await response.text();
				throw new Error(`Vertex AI error ${response.status}: ${text}`);
			}

			stream.push({ type: "start", partial: output });

			const reader = response.body?.getReader();
			if (!reader) throw new Error("No response body");

			const decoder = new TextDecoder();
			let buffer = "";

			type Block = (ThinkingContent | TextContent | (ToolCall & { partialJson: string })) & { index: number };
			const blocks = output.content as Block[];

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (!line.startsWith("data: ")) continue;
					const data = line.slice(6).trim();
					if (!data || data === "[DONE]") continue;

					try {
						const event = JSON.parse(data);

						if (event.type === "message_start") {
							output.usage.input = event.message?.usage?.input_tokens || 0;
							output.usage.output = event.message?.usage?.output_tokens || 0;
							output.usage.cacheRead = event.message?.usage?.cache_read_input_tokens || 0;
							output.usage.cacheWrite = event.message?.usage?.cache_creation_input_tokens || 0;
							output.usage.totalTokens =
								output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
							calculateCost(model, output.usage);
						} else if (event.type === "content_block_start") {
							if (event.content_block?.type === "text") {
								const block: Block = { type: "text", text: "", index: event.index };
								output.content.push(block);
								stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
							} else if (event.content_block?.type === "thinking") {
								const block: Block = {
									type: "thinking",
									thinking: "",
									thinkingSignature: "",
									index: event.index,
								};
								output.content.push(block);
								stream.push({
									type: "thinking_start",
									contentIndex: output.content.length - 1,
									partial: output,
								});
							} else if (event.content_block?.type === "tool_use") {
								const block: Block = {
									type: "toolCall",
									id: event.content_block.id,
									name: event.content_block.name,
									arguments: {},
									partialJson: "",
									index: event.index,
								};
								output.content.push(block);
								stream.push({
									type: "toolcall_start",
									contentIndex: output.content.length - 1,
									partial: output,
								});
							}
						} else if (event.type === "content_block_delta") {
							if (event.delta?.type === "text_delta") {
								const index = blocks.findIndex((b) => b.index === event.index);
								const block = blocks[index];
								if (block && block.type === "text") {
									block.text += event.delta.text;
									stream.push({
										type: "text_delta",
										contentIndex: index,
										delta: event.delta.text,
										partial: output,
									});
								}
							} else if (event.delta?.type === "thinking_delta") {
								const index = blocks.findIndex((b) => b.index === event.index);
								const block = blocks[index];
								if (block && block.type === "thinking") {
									block.thinking += event.delta.thinking;
									stream.push({
										type: "thinking_delta",
										contentIndex: index,
										delta: event.delta.thinking,
										partial: output,
									});
								}
							} else if (event.delta?.type === "input_json_delta") {
								const index = blocks.findIndex((b) => b.index === event.index);
								const block = blocks[index];
								if (block && block.type === "toolCall") {
									block.partialJson += event.delta.partial_json;
									block.arguments = parseStreamingJson(block.partialJson);
									stream.push({
										type: "toolcall_delta",
										contentIndex: index,
										delta: event.delta.partial_json,
										partial: output,
									});
								}
							} else if (event.delta?.type === "signature_delta") {
								const index = blocks.findIndex((b) => b.index === event.index);
								const block = blocks[index];
								if (block && block.type === "thinking") {
									block.thinkingSignature = block.thinkingSignature || "";
									block.thinkingSignature += event.delta.signature;
								}
							}
						} else if (event.type === "content_block_stop") {
							const index = blocks.findIndex((b) => b.index === event.index);
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
									block.arguments = parseStreamingJson(block.partialJson);
									delete (block as any).partialJson;
									stream.push({
										type: "toolcall_end",
										contentIndex: index,
										toolCall: block,
										partial: output,
									});
								}
							}
						} else if (event.type === "message_delta") {
							if (event.delta?.stop_reason) {
								output.stopReason = mapStopReason(event.delta.stop_reason);
							}
							if (event.usage?.input_tokens != null) {
								output.usage.input = event.usage.input_tokens;
							}
							if (event.usage?.output_tokens != null) {
								output.usage.output = event.usage.output_tokens;
							}
							if (event.usage?.cache_read_input_tokens != null) {
								output.usage.cacheRead = event.usage.cache_read_input_tokens;
							}
							if (event.usage?.cache_creation_input_tokens != null) {
								output.usage.cacheWrite = event.usage.cache_creation_input_tokens;
							}
							output.usage.totalTokens =
								output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
							calculateCost(model, output.usage);
						}
					} catch {
						// Skip malformed JSON
					}
				}
			}

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			stream.push({ type: "done", reason: output.stopReason as "stop" | "toolUse" | "length", message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) delete (block as any).index;
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

export const streamSimpleAnthropicVertex: StreamFunction<"anthropic-vertex", SimpleStreamOptions> = (
	model: Model<"anthropic-vertex">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const base = buildBaseOptions(model, options, "vertex-adc"); // Placeholder - uses ADC

	if (!options?.reasoning) {
		return streamAnthropicVertex(model, context, { ...base, thinkingEnabled: false });
	}

	const adjusted = adjustMaxTokensForThinking(
		base.maxTokens || 0,
		model.maxTokens,
		options.reasoning,
		options.thinkingBudgets,
	);

	return streamAnthropicVertex(model, context, {
		...base,
		maxTokens: adjusted.maxTokens,
		thinkingEnabled: true,
		thinkingBudgetTokens: adjusted.thinkingBudget,
	});
};
