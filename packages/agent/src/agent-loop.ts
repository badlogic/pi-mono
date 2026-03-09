/**
 * Agent loop that works with AgentMessage throughout.
 * Transforms to Message[] only at the LLM call boundary.
 */

import {
	type AssistantMessage,
	type Context,
	EventStream,
	type Message,
	streamSimple,
	type ToolResultMessage,
	validateToolArguments,
} from "@mariozechner/pi-ai";
import type {
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentTool,
	AgentToolResult,
	StreamFn,
} from "./types.js";

/**
 * Start an agent loop with a new prompt message.
 * The prompt is added to the context and events are emitted for it.
 */
export function agentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	const stream = createAgentStream();

	(async () => {
		const newMessages: AgentMessage[] = [...prompts];
		const currentContext: AgentContext = {
			...context,
			messages: [...context.messages, ...prompts],
		};

		stream.push({ type: "agent_start" });
		stream.push({ type: "turn_start" });
		for (const prompt of prompts) {
			stream.push({ type: "message_start", message: prompt });
			stream.push({ type: "message_end", message: prompt });
		}

		await runLoop(currentContext, newMessages, config, signal, stream, streamFn);
	})();

	return stream;
}

/**
 * Continue an agent loop from the current context without adding a new message.
 * Used for retries - context already has user message or tool results.
 *
 * **Important:** The last message in context must convert to a `user` or `toolResult` message
 * via `convertToLlm`. If it doesn't, the LLM provider will reject the request.
 * This cannot be validated here since `convertToLlm` is only called once per turn.
 */
export function agentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	signal?: AbortSignal,
	streamFn?: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	if (context.messages.length === 0) {
		throw new Error("Cannot continue: no messages in context");
	}

	if (context.messages[context.messages.length - 1].role === "assistant") {
		throw new Error("Cannot continue from message role: assistant");
	}

	const stream = createAgentStream();

	(async () => {
		const newMessages: AgentMessage[] = [];
		const currentContext: AgentContext = { ...context };

		stream.push({ type: "agent_start" });
		stream.push({ type: "turn_start" });

		await runLoop(currentContext, newMessages, config, signal, stream, streamFn);
	})();

	return stream;
}

function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
	return new EventStream<AgentEvent, AgentMessage[]>(
		(event: AgentEvent) => event.type === "agent_end",
		(event: AgentEvent) => (event.type === "agent_end" ? event.messages : []),
	);
}

/**
 * Main loop logic shared by agentLoop and agentLoopContinue.
 */
async function runLoop(
	currentContext: AgentContext,
	newMessages: AgentMessage[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	streamFn?: StreamFn,
): Promise<void> {
	let firstTurn = true;
	let hasRetriedDuplicateToolFailure = false;
	// Check for steering messages at start (user may have typed while waiting)
	let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

	// Outer loop: continues when queued follow-up messages arrive after agent would stop
	while (true) {
		let hasMoreToolCalls = true;
		let steeringAfterTools: AgentMessage[] | null = null;

		// Inner loop: process tool calls and steering messages
		while (hasMoreToolCalls || pendingMessages.length > 0) {
			if (!firstTurn) {
				stream.push({ type: "turn_start" });
			} else {
				firstTurn = false;
			}

			// Process pending messages (inject before next assistant response)
			if (pendingMessages.length > 0) {
				for (const message of pendingMessages) {
					stream.push({ type: "message_start", message });
					stream.push({ type: "message_end", message });
					currentContext.messages.push(message);
					newMessages.push(message);
				}
				pendingMessages = [];
			}

			// Stream assistant response
			const message = await streamAssistantResponse(currentContext, config, signal, stream, streamFn);
			newMessages.push(message);

			if (message.stopReason === "error" || message.stopReason === "aborted") {
				stream.push({ type: "turn_end", message, toolResults: [] });
				stream.push({ type: "agent_end", messages: newMessages });
				stream.end(newMessages);
				return;
			}

			// Check for tool calls
			const toolCalls = message.content.filter((c) => c.type === "toolCall");
			hasMoreToolCalls = toolCalls.length > 0;

			const toolResults: ToolResultMessage[] = [];
			let shouldInjectDuplicateToolFailureRepair = false;
			let shouldAbortDuplicateToolFailure = false;
			if (hasMoreToolCalls) {
				const toolExecution = await executeToolCalls(
					currentContext.tools,
					message,
					signal,
					stream,
					config.getSteeringMessages,
				);
				toolResults.push(...toolExecution.toolResults);
				steeringAfterTools = toolExecution.steeringMessages ?? null;

				if (isDuplicateFailingToolTurn(currentContext.messages, message, toolResults)) {
					if (hasRetriedDuplicateToolFailure) {
						shouldAbortDuplicateToolFailure = true;
					} else {
						shouldInjectDuplicateToolFailureRepair = true;
					}
				} else {
					hasRetriedDuplicateToolFailure = false;
				}

				for (const result of toolResults) {
					currentContext.messages.push(result);
					newMessages.push(result);
				}
			} else {
				hasRetriedDuplicateToolFailure = false;
			}

			stream.push({ type: "turn_end", message, toolResults });

			if (shouldAbortDuplicateToolFailure) {
				const errorMessage = createLoopErrorAssistantMessage(
					config.model,
					DUPLICATE_FAILING_TOOL_CALL_ERROR,
					DUPLICATE_FAILING_TOOL_CALL_ERROR,
				);
				currentContext.messages.push(errorMessage);
				newMessages.push(errorMessage);
				stream.push({ type: "message_start", message: errorMessage });
				stream.push({ type: "message_end", message: errorMessage });
				stream.push({ type: "agent_end", messages: newMessages });
				stream.end(newMessages);
				return;
			}

			// Get steering messages after turn completes
			if (steeringAfterTools && steeringAfterTools.length > 0) {
				pendingMessages = steeringAfterTools;
				steeringAfterTools = null;
			} else if (shouldInjectDuplicateToolFailureRepair) {
				pendingMessages = [buildDuplicateToolFailureRepairMessage()];
				hasRetriedDuplicateToolFailure = true;
			} else {
				pendingMessages = (await config.getSteeringMessages?.()) || [];
			}
		}

		// Agent would stop here. Check for follow-up messages.
		const followUpMessages = (await config.getFollowUpMessages?.()) || [];
		if (followUpMessages.length > 0) {
			// Set as pending so inner loop processes them
			pendingMessages = followUpMessages;
			continue;
		}

		// No more messages, exit
		break;
	}

	stream.push({ type: "agent_end", messages: newMessages });
	stream.end(newMessages);
}

/**
 * Stream an assistant response from the LLM.
 * This is where AgentMessage[] gets transformed to Message[] for the LLM.
 */
async function streamAssistantResponse(
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	streamFn?: StreamFn,
): Promise<AssistantMessage> {
	const streamFunction = streamFn || streamSimple;

	// Resolve API key (important for expiring tokens)
	const resolvedApiKey =
		(config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;

	let hasRetriedMalformedToolContract = false;
	let hasRetriedNoProgressOutput = false;
	let retryInstruction: Message | undefined;

	while (true) {
		// Apply context transform if configured (AgentMessage[] → AgentMessage[])
		let messages = context.messages;
		if (config.transformContext) {
			messages = await config.transformContext(messages, signal);
		}
		const previousAssistant = findLastAssistantMessage(messages);

		// Convert to LLM-compatible messages (AgentMessage[] → Message[])
		const llmMessages = await config.convertToLlm(messages);
		if (retryInstruction) {
			llmMessages.push(retryInstruction);
		}

		// Build LLM context
		const llmContext: Context = {
			systemPrompt: context.systemPrompt,
			messages: llmMessages,
			tools: context.tools,
		};

		const response = await streamFunction(config.model, llmContext, {
			...config,
			apiKey: resolvedApiKey,
			signal,
		});

		let partialMessage: AssistantMessage | null = null;
		let addedPartial = false;
		let shouldRetryAssistantResponse = false;

		for await (const event of response) {
			switch (event.type) {
				case "start":
					partialMessage = event.partial;
					context.messages.push(partialMessage);
					addedPartial = true;
					stream.push({ type: "message_start", message: { ...partialMessage } });
					break;

				case "text_start":
				case "text_delta":
				case "text_end":
				case "thinking_start":
				case "thinking_delta":
				case "thinking_end":
				case "toolcall_start":
				case "toolcall_delta":
				case "toolcall_end":
					if (partialMessage) {
						partialMessage = event.partial;
						context.messages[context.messages.length - 1] = partialMessage;
						stream.push({
							type: "message_update",
							assistantMessageEvent: event,
							message: { ...partialMessage },
						});
					}
					break;

				case "done":
				case "error": {
					let finalMessage = await response.result();
					if (
						event.type === "done" &&
						shouldRetryMalformedToolContract(finalMessage, context.tools, hasRetriedMalformedToolContract)
					) {
						// End this malformed message in UI, but don't keep it in conversation state.
						if (!addedPartial) {
							stream.push({ type: "message_start", message: { ...finalMessage } });
						}
						stream.push({ type: "message_end", message: finalMessage });
						if (addedPartial) {
							context.messages.pop();
						}

						retryInstruction = buildMalformedToolContractRepairMessage();
						hasRetriedMalformedToolContract = true;
						shouldRetryAssistantResponse = true;
						break;
					}

					if (
						event.type === "done" &&
						shouldRetryNoProgressOutput(finalMessage, previousAssistant, hasRetriedNoProgressOutput)
					) {
						if (!addedPartial) {
							stream.push({ type: "message_start", message: { ...finalMessage } });
						}
						stream.push({ type: "message_end", message: finalMessage });
						if (addedPartial) {
							context.messages.pop();
						}

						retryInstruction = buildNoProgressRepairMessage();
						hasRetriedNoProgressOutput = true;
						shouldRetryAssistantResponse = true;
						break;
					}

					if (
						event.type === "done" &&
						hasRetriedMalformedToolContract &&
						hasPseudoToolCallMarkup(finalMessage) &&
						!finalMessage.content.some((part) => part.type === "toolCall")
					) {
						finalMessage = toMalformedToolContractError(finalMessage);
					}

					if (
						event.type === "done" &&
						hasRetriedNoProgressOutput &&
						isNoProgressOutput(finalMessage, previousAssistant)
					) {
						finalMessage = toNoProgressOutputError(finalMessage);
					}

					if (addedPartial) {
						context.messages[context.messages.length - 1] = finalMessage;
					} else {
						context.messages.push(finalMessage);
					}
					if (!addedPartial) {
						stream.push({ type: "message_start", message: { ...finalMessage } });
					}
					stream.push({ type: "message_end", message: finalMessage });
					return finalMessage;
				}
			}
		}

		if (shouldRetryAssistantResponse) {
			continue;
		}

		return await response.result();
	}
}

const PSEUDO_TOOL_MARKUP_REGEX = /<(?:\/)?(?:tool_call|arg_key|arg_value)>/i;
const MALFORMED_TOOL_CONTRACT_ERROR =
	"Assistant emitted pseudo tool markup as text after retry. Use native tool/function calling instead of <tool_call>/<arg_key>/<arg_value> tags.";
const NO_PROGRESS_OUTPUT_ERROR =
	"Assistant repeated no-progress planning/status text after retry. Stop restating the same plan; take one concrete action or state the exact blocker once.";
const DUPLICATE_FAILING_TOOL_CALL_ERROR =
	"Assistant repeated the same failing tool call after retry. Stop retrying identical tool calls without changing inputs or strategy.";
const MIN_REPETITION_SEGMENT_LENGTH = 24;
const MIN_REPEATED_SEGMENT_OCCURRENCES = 3;
const MIN_PREVIOUS_MATCH_LENGTH = 120;

function hasPseudoToolCallMarkup(message: AssistantMessage): boolean {
	return message.content.some((part) => part.type === "text" && PSEUDO_TOOL_MARKUP_REGEX.test(part.text));
}

function shouldRetryMalformedToolContract(
	message: AssistantMessage,
	tools: AgentTool<any>[] | undefined,
	hasRetriedMalformedToolContract: boolean,
): boolean {
	if (hasRetriedMalformedToolContract) return false;
	if (!tools || tools.length === 0) return false;
	if (message.content.some((part) => part.type === "toolCall")) return false;
	return hasPseudoToolCallMarkup(message);
}

function buildMalformedToolContractRepairMessage(): Message {
	return {
		role: "user",
		content:
			"Formatting error: do not emit pseudo tool XML tags like <tool_call>, <arg_key>, or <arg_value> in text. If a tool is needed, emit a native tool call through the tool-calling channel only.",
		timestamp: Date.now(),
	};
}

function findLastAssistantMessage(messages: AgentMessage[]): AssistantMessage | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role === "assistant") {
			return message as AssistantMessage;
		}
	}
	return undefined;
}

function extractVisibleAssistantText(message: AssistantMessage | undefined): string {
	if (!message) return "";
	return message.content
		.filter((part): part is Extract<AssistantMessage["content"][number], { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function normalizeRepetitionSegment(text: string): string {
	return text
		.toLowerCase()
		.replace(/^\s*[-*+]\s+/, "")
		.replace(/^\s*\d+[.)]\s+/, "")
		.replace(/\s+/g, " ")
		.trim();
}

function collectRepetitionSegments(text: string): string[] {
	return text
		.split(/\n+/)
		.flatMap((line) => line.split(/(?<=[.!?])\s+/))
		.map((segment) => normalizeRepetitionSegment(segment))
		.filter((segment) => segment.length >= MIN_REPETITION_SEGMENT_LENGTH);
}

function hasInternalRepetition(text: string): boolean {
	const segments = collectRepetitionSegments(text);
	if (segments.length < MIN_REPEATED_SEGMENT_OCCURRENCES) return false;

	const counts = new Map<string, number>();
	for (const segment of segments) {
		counts.set(segment, (counts.get(segment) ?? 0) + 1);
	}

	const maxCount = Math.max(...counts.values());
	if (maxCount >= MIN_REPEATED_SEGMENT_OCCURRENCES) return true;

	const duplicateSegments = segments.length - counts.size;
	return segments.length >= 6 && duplicateSegments / segments.length >= 0.35;
}

function normalizedAssistantFingerprint(message: AssistantMessage | undefined): string | undefined {
	const text = extractVisibleAssistantText(message);
	if (text.length < MIN_PREVIOUS_MATCH_LENGTH) return undefined;
	return normalizeRepetitionSegment(text);
}

function isNoProgressOutput(message: AssistantMessage, previousAssistant: AssistantMessage | undefined): boolean {
	if (message.content.some((part) => part.type === "toolCall")) return false;

	const currentText = extractVisibleAssistantText(message);
	if (currentText.length === 0) return false;

	const currentFingerprint = normalizedAssistantFingerprint(message);
	const previousFingerprint = normalizedAssistantFingerprint(previousAssistant);
	if (
		currentFingerprint !== undefined &&
		previousFingerprint !== undefined &&
		currentFingerprint === previousFingerprint
	) {
		return true;
	}

	return previousAssistant !== undefined && hasInternalRepetition(currentText);
}

function shouldRetryNoProgressOutput(
	message: AssistantMessage,
	previousAssistant: AssistantMessage | undefined,
	hasRetriedNoProgressOutput: boolean,
): boolean {
	if (hasRetriedNoProgressOutput) return false;
	return isNoProgressOutput(message, previousAssistant);
}

function buildNoProgressRepairMessage(): Message {
	return {
		role: "user",
		content:
			"No-progress error: your previous response repeated the same planning or status text. Do not restate the plan. Take the next concrete tool action now, or state the exact blocker once in 1-2 sentences.",
		timestamp: Date.now(),
	};
}

function toMalformedToolContractError(message: AssistantMessage): AssistantMessage {
	const alreadyHasNotice = message.content.some(
		(part) => part.type === "text" && part.text.includes(MALFORMED_TOOL_CONTRACT_ERROR),
	);
	const content = alreadyHasNotice
		? message.content
		: [...message.content, { type: "text" as const, text: MALFORMED_TOOL_CONTRACT_ERROR }];
	return {
		...message,
		content,
		stopReason: "error",
		errorMessage: MALFORMED_TOOL_CONTRACT_ERROR,
	};
}

function toNoProgressOutputError(message: AssistantMessage): AssistantMessage {
	const alreadyHasNotice = message.content.some(
		(part) => part.type === "text" && part.text.includes(NO_PROGRESS_OUTPUT_ERROR),
	);
	const content = alreadyHasNotice
		? message.content
		: [...message.content, { type: "text" as const, text: NO_PROGRESS_OUTPUT_ERROR }];
	return {
		...message,
		content,
		stopReason: "error",
		errorMessage: NO_PROGRESS_OUTPUT_ERROR,
	};
}

type ToolTurnSignature = {
	toolCallSignatures: string[];
	toolResultSignatures: string[];
	hasError: boolean;
};

function normalizeComparisonText(text: string): string {
	return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function stableSerialize(value: unknown): string {
	if (value === null || value === undefined) return JSON.stringify(value);
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
	}
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
			left.localeCompare(right),
		);
		return `{${entries.map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableSerialize(nestedValue)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

function buildToolCallSignature(toolCall: Extract<AssistantMessage["content"][number], { type: "toolCall" }>): string {
	return `${toolCall.name}:${stableSerialize(toolCall.arguments ?? {})}`;
}

function buildToolResultSignature(result: ToolResultMessage): string {
	const textContent = result.content
		.filter(
			(block): block is Extract<ToolResultMessage["content"][number], { type: "text" }> => block.type === "text",
		)
		.map((block) => block.text)
		.join("\n");
	const imageCount = result.content.filter((block) => block.type === "image").length;
	return `${result.toolName}:${result.isError ? "error" : "ok"}:${imageCount}:${normalizeComparisonText(textContent)}`;
}

function buildToolTurnSignature(
	assistantMessage: AssistantMessage,
	toolResults: ToolResultMessage[],
): ToolTurnSignature | undefined {
	const toolCalls = assistantMessage.content.filter((part) => part.type === "toolCall");
	if (toolCalls.length === 0 || toolResults.length === 0) return undefined;
	return {
		toolCallSignatures: toolCalls.map(buildToolCallSignature),
		toolResultSignatures: toolResults.map(buildToolResultSignature),
		hasError: toolResults.some((result) => result.isError),
	};
}

function arraysEqual(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function findPreviousToolTurnSignature(messages: AgentMessage[]): ToolTurnSignature | undefined {
	const currentAssistantIndex = messages.length - 1;
	for (let index = currentAssistantIndex - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== "assistant") continue;

		const toolResults: ToolResultMessage[] = [];
		for (let resultIndex = index + 1; resultIndex < currentAssistantIndex; resultIndex++) {
			const candidate = messages[resultIndex];
			if (candidate.role === "toolResult") {
				toolResults.push(candidate);
				continue;
			}
			if (toolResults.length > 0) break;
		}

		const signature = buildToolTurnSignature(message as AssistantMessage, toolResults);
		if (signature) {
			return signature;
		}
	}
	return undefined;
}

function isDuplicateFailingToolTurn(
	messages: AgentMessage[],
	currentAssistantMessage: AssistantMessage,
	currentToolResults: ToolResultMessage[],
): boolean {
	const currentSignature = buildToolTurnSignature(currentAssistantMessage, currentToolResults);
	if (!currentSignature?.hasError) return false;

	const previousSignature = findPreviousToolTurnSignature(messages);
	if (!previousSignature?.hasError) return false;

	return (
		arraysEqual(currentSignature.toolCallSignatures, previousSignature.toolCallSignatures) &&
		arraysEqual(currentSignature.toolResultSignatures, previousSignature.toolResultSignatures)
	);
}

function buildDuplicateToolFailureRepairMessage(): Message {
	return {
		role: "user",
		content:
			"Repeated tool failure: you just retried the same tool call and got the same failure. Do not retry unchanged. Change the arguments, choose a different tool, or state the exact blocker once in 1-2 sentences.",
		timestamp: Date.now(),
	};
}

function createLoopErrorAssistantMessage(
	model: AgentLoopConfig["model"],
	errorMessage: string,
	noticeText: string,
): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: noticeText }],
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
		errorMessage,
		timestamp: Date.now(),
	};
}

function attachDurationToToolResult<TDetails>(
	result: AgentToolResult<TDetails>,
	durationMs: number,
): AgentToolResult<TDetails | { durationMs: number }> {
	const normalizedDurationMs = Math.max(0, durationMs);
	const details =
		result.details && typeof result.details === "object"
			? { ...(result.details as Record<string, unknown>), durationMs: normalizedDurationMs }
			: { durationMs: normalizedDurationMs };
	return {
		...result,
		details: details as TDetails | { durationMs: number },
	};
}

/**
 * Execute tool calls from an assistant message.
 */
async function executeToolCalls(
	tools: AgentTool<any>[] | undefined,
	assistantMessage: AssistantMessage,
	signal: AbortSignal | undefined,
	stream: EventStream<AgentEvent, AgentMessage[]>,
	getSteeringMessages?: AgentLoopConfig["getSteeringMessages"],
): Promise<{ toolResults: ToolResultMessage[]; steeringMessages?: AgentMessage[] }> {
	const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall");
	const results: ToolResultMessage[] = [];
	let steeringMessages: AgentMessage[] | undefined;

	for (let index = 0; index < toolCalls.length; index++) {
		const toolCall = toolCalls[index];
		const tool = tools?.find((t) => t.name === toolCall.name);

		stream.push({
			type: "tool_execution_start",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.arguments,
		});

		let result: AgentToolResult<any>;
		let isError = false;
		const toolStartTime = Date.now();

		try {
			if (!tool) throw new Error(`Tool ${toolCall.name} not found`);

			const validatedArgs = validateToolArguments(tool, toolCall);

			result = await tool.execute(toolCall.id, validatedArgs, signal, (partialResult) => {
				stream.push({
					type: "tool_execution_update",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					args: toolCall.arguments,
					partialResult,
				});
			});
		} catch (e) {
			result = {
				content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
				details: {},
			};
			isError = true;
		}
		result = attachDurationToToolResult(result, Date.now() - toolStartTime);

		stream.push({
			type: "tool_execution_end",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			result,
			isError,
		});

		const toolResultMessage: ToolResultMessage = {
			role: "toolResult",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			content: result.content,
			details: result.details,
			isError,
			timestamp: Date.now(),
		};

		results.push(toolResultMessage);
		stream.push({ type: "message_start", message: toolResultMessage });
		stream.push({ type: "message_end", message: toolResultMessage });

		// Check for steering messages - skip remaining tools if user interrupted
		if (getSteeringMessages) {
			const steering = await getSteeringMessages();
			if (steering.length > 0) {
				steeringMessages = steering;
				const remainingCalls = toolCalls.slice(index + 1);
				for (const skipped of remainingCalls) {
					results.push(skipToolCall(skipped, stream));
				}
				break;
			}
		}
	}

	return { toolResults: results, steeringMessages };
}

function skipToolCall(
	toolCall: Extract<AssistantMessage["content"][number], { type: "toolCall" }>,
	stream: EventStream<AgentEvent, AgentMessage[]>,
): ToolResultMessage {
	const result: AgentToolResult<any> = attachDurationToToolResult(
		{
			content: [{ type: "text", text: "Skipped due to queued user message." }],
			details: {},
		},
		0,
	);

	stream.push({
		type: "tool_execution_start",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		args: toolCall.arguments,
	});
	stream.push({
		type: "tool_execution_end",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		result,
		isError: true,
	});

	const toolResultMessage: ToolResultMessage = {
		role: "toolResult",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		content: result.content,
		details: {},
		isError: true,
		timestamp: Date.now(),
	};

	stream.push({ type: "message_start", message: toolResultMessage });
	stream.push({ type: "message_end", message: toolResultMessage });

	return toolResultMessage;
}
