/**
 * Agent loop that works with AgentMessage throughout.
 * Transforms to Message[] only at the LLM call boundary.
 */

import {
	type AssistantMessage,
	type ClientIdentity,
	EventStream,
	getCurrentTools,
	getToolStateChanges,
	mergeClientIdentity,
	normalizeContext,
	PI_ATTRIBUTION,
	type SystemMessage,
	type ToolResultMessage,
	type ToolStateChanges,
	toToolDeclaration,
	validateToolArguments,
} from "@earendil-works/pi-ai";
import { getDefaultStreamFn } from "./stream-fn.ts";
import type {
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentTool,
	AgentToolCall,
	AgentToolCallOutcome,
	AgentToolResult,
	PrepareNextTurnContext,
	StreamFn,
} from "./types.ts";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

/**
 * Request identity of agent loops: pi-ai's defaults with provider attribution to pi. `AgentLoopConfig.identity`
 * overrides it field by field.
 */
export const DEFAULT_AGENT_IDENTITY: ClientIdentity = { attribution: PI_ATTRIBUTION };

/**
 * Start an agent loop with a new prompt message.
 * The prompt is added to the context and events are emitted for it.
 */
export function agentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	streamFn: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	const stream = createAgentStream();

	void runAgentLoop(
		prompts,
		context,
		config,
		async (event) => {
			stream.push(event);
		},
		signal,
		streamFn,
	).then((messages) => {
		stream.end(messages);
	});

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
	signal: AbortSignal | undefined,
	streamFn: StreamFn,
): EventStream<AgentEvent, AgentMessage[]> {
	if (context.messages.length === 0) {
		throw new Error("Cannot continue: no messages in context");
	}

	if (context.messages[context.messages.length - 1].role === "assistant") {
		throw new Error("Cannot continue from message role: assistant");
	}

	const stream = createAgentStream();

	void runAgentLoopContinue(
		context,
		config,
		async (event) => {
			stream.push(event);
		},
		signal,
		streamFn,
	).then((messages) => {
		stream.end(messages);
	});

	return stream;
}

export async function runAgentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal: AbortSignal | undefined,
	streamFn: StreamFn,
): Promise<AgentMessage[]> {
	const initialMessages = declareToolChanges(context, prompts);
	const newMessages: AgentMessage[] = [...initialMessages];
	const currentContext: AgentContext = {
		...context,
		messages: [...context.messages, ...initialMessages],
	};

	await emit({ type: "agent_start" });
	await emit({ type: "turn_start" });
	for (const message of initialMessages) {
		await emit({ type: "message_start", message });
		await emit({ type: "message_end", message });
	}

	await runLoop(currentContext, newMessages, config, signal, emit, streamFn ?? getDefaultStreamFn());
	return newMessages;
}

export async function runAgentLoopContinue(
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal: AbortSignal | undefined,
	streamFn: StreamFn,
): Promise<AgentMessage[]> {
	if (context.messages.length === 0) {
		throw new Error("Cannot continue: no messages in context");
	}

	if (context.messages[context.messages.length - 1].role === "assistant") {
		throw new Error("Cannot continue from message role: assistant");
	}

	const newMessages: AgentMessage[] = [];
	const currentContext: AgentContext = { ...context };

	await emit({ type: "agent_start" });
	await emit({ type: "turn_start" });

	await runLoop(currentContext, newMessages, config, signal, emit, streamFn ?? getDefaultStreamFn());
	return newMessages;
}

function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
	return new EventStream<AgentEvent, AgentMessage[]>(
		(event: AgentEvent) => event.type === "agent_end",
		(event: AgentEvent) => (event.type === "agent_end" ? event.messages : []),
	);
}

interface SingleTurnParams extends TurnModelCallParams {
	// A one-shot step leaves queued messages for the caller to admit.
	fetchNextPending: boolean;
}

interface SingleTurnOutcome {
	// True once agent_end has been emitted (an error/abort or a stop decision); the
	// caller must return without emitting agent_end again.
	done: boolean;
	hasMoreToolCalls: boolean;
	// The app asked for another provider request after this turn even if nothing else schedules one.
	continueRequested: boolean;
	context: AgentContext;
	config: AgentLoopConfig;
	pendingMessages: AgentMessage[];
	// What this turn produced, for the caller to hand to the next one as `previousTurn`. Absent
	// when the turn ended on an error or an abort, which is not a turn to prepare from.
	completedTurn?: PrepareNextTurnContext;
}

interface TurnModelCallParams {
	context: AgentContext;
	config: AgentLoopConfig;
	newMessages: AgentMessage[];
	pendingMessages: AgentMessage[];
	// The turn this one follows, when it follows one. Preparation belongs to the turn that comes
	// after, not to the one that just ended: it can be long-running (a compaction), and running it
	// at the end would make the last turn of a run pay for a turn nobody asked for and would hand
	// the stop decision a context it never saw.
	previousTurn?: PrepareNextTurnContext;
	emitTurnStart: boolean;
	signal: AbortSignal | undefined;
	emit: AgentEventSink;
	streamFunction: StreamFn;
}

interface TurnModelCallOutcome {
	message: AssistantMessage;
	/** The calls the model asked for, in the order it asked for them. */
	toolCalls: AgentToolCall[];
	/**
	 * The response ended the run on its own (an error or an abort), and agent_end has
	 * been emitted. Nothing may be dispatched and nothing may be sealed.
	 */
	ended: boolean;
	context: AgentContext;
	/** Preparation can replace the model or the thinking level, so the rest of the step uses this. */
	config: AgentLoopConfig;
}

interface TurnToolCallParams {
	context: AgentContext;
	/** The message that asked for this call. Its stop reason decides whether the call may run. */
	assistantMessage: AssistantMessage;
	toolCall: AgentToolCall;
	config: AgentLoopConfig;
	signal: AbortSignal | undefined;
	emit: AgentEventSink;
}

interface TurnToolCallOutcome {
	message: ToolResultMessage;
	/** The tool asked for the run to stop. A batch ends the turn only when every call does. */
	terminate: boolean;
}

interface SealTurnStepParams {
	context: AgentContext;
	config: AgentLoopConfig;
	newMessages: AgentMessage[];
	/** The message this step opened. */
	message: AssistantMessage;
	/** The step's settled calls, in the order the model asked for them. */
	toolCalls: ReadonlyArray<TurnToolCallOutcome>;
	fetchNextPending: boolean;
	signal: AbortSignal | undefined;
	emit: AgentEventSink;
}

/**
 * The model call of one step: inject any pending messages and stream a single assistant
 * response, stopping before the tools it asks for. The caller runs them.
 */
async function runTurnModelCall(params: TurnModelCallParams): Promise<TurnModelCallOutcome> {
	const { newMessages, signal, emit, streamFunction: streamFn } = params;
	let context = params.context;
	let config = params.config;
	let pendingMessages = params.pendingMessages;

	let preparedMessages: AgentMessage[] = [];
	if (params.previousTurn) {
		const nextTurnSnapshot = await config.prepareNextTurn?.(params.previousTurn);
		if (nextTurnSnapshot) {
			context = nextTurnSnapshot.context ?? context;
			preparedMessages = nextTurnSnapshot.messages ?? [];
			config = {
				...config,
				model: nextTurnSnapshot.model ?? config.model,
				reasoning:
					nextTurnSnapshot.thinkingLevel === undefined
						? config.reasoning
						: nextTurnSnapshot.thinkingLevel === "off"
							? undefined
							: nextTurnSnapshot.thinkingLevel,
			};
		}
		// Preparation can be long-running (for example, compaction). Pick up steering
		// queued while it ran. Only poll again if the earlier poll returned nothing;
		// otherwise one-at-a-time mode would deliver two messages in this turn.
		if (pendingMessages.length === 0) {
			pendingMessages = (await config.getSteeringMessages?.()) || [];
		}
	}

	if (params.emitTurnStart) {
		await emit({ type: "turn_start" });
	}

	// Process prepared and queued messages before the next assistant response.
	for (const message of declareToolChanges(context, [...preparedMessages, ...pendingMessages])) {
		await emit({ type: "message_start", message });
		await emit({ type: "message_end", message });
		context.messages.push(message);
		newMessages.push(message);
	}

	const requestUpdate = await config.prepareRequest?.(
		{
			context,
			model: config.model,
			thinkingLevel: config.reasoning ?? "off",
		},
		signal,
	);
	if (requestUpdate) {
		context = requestUpdate.context ?? context;
		config = {
			...config,
			model: requestUpdate.model ?? config.model,
			reasoning:
				requestUpdate.thinkingLevel === undefined
					? config.reasoning
					: requestUpdate.thinkingLevel === "off"
						? undefined
						: requestUpdate.thinkingLevel,
		};
	}

	const message = await streamAssistantResponse(context, config, signal, emit, streamFn);
	newMessages.push(message);

	if (message.stopReason === "error" || message.stopReason === "aborted") {
		await config.finishTurn?.({ message, toolResults: [], context, newMessages }, signal);
		await emit({ type: "turn_end", message, toolResults: [] });
		await emit({ type: "agent_end", messages: newMessages });
		return { message, toolCalls: [], ended: true, context, config };
	}

	return {
		message,
		toolCalls: message.content.filter((c) => c.type === "toolCall"),
		ended: false,
		context,
		config,
	};
}

/**
 * One recorded tool call, start to finish. It reports its result rather than entering it in
 * the transcript, because the results of a step go in together, in the order the model asked
 * for them, and a caller running calls concurrently settles them out of order.
 */
async function runTurnToolCall(params: TurnToolCallParams): Promise<TurnToolCallOutcome> {
	const { context, assistantMessage, toolCall, config, signal, emit } = params;

	await emit({
		type: "tool_execution_start",
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		args: toolCall.arguments,
	});

	// A "length" stop means the output was cut off by the token limit, so every tool call in
	// the message may carry truncated arguments. Fail it instead of executing a borked call.
	const finalized =
		assistantMessage.stopReason === "length"
			? truncatedToolCallOutcome(toolCall)
			: await settleToolCall(context, assistantMessage, toolCall, config, signal, emit);

	await emitToolExecutionEnd(finalized, emit);
	return toTurnToolCallOutcome(finalized);
}

/**
 * Close a step whose calls have settled: record their results, then decide whether the turn
 * keeps going. A step that ran no tools seals the same way.
 *
 * Results reach the transcript here, together and in the model's order, not as each call
 * ends. A run that dies part way through a batch therefore loses results that had settled,
 * and a resumed turn reports those calls as unknown outcomes rather than their results.
 */
async function sealTurnStep(params: SealTurnStepParams): Promise<SingleTurnOutcome> {
	const { newMessages, signal, emit, message } = params;
	const currentContext = params.context;
	const config = params.config;

	const toolResults: ToolResultMessage[] = [];
	for (const call of params.toolCalls) {
		toolResults.push(call.message);
		await emitToolResultMessage(call.message, emit);
		currentContext.messages.push(call.message);
		newMessages.push(call.message);
	}
	const hasMoreToolCalls = params.toolCalls.length > 0 && !shouldTerminateToolBatch(params.toolCalls);

	const completedTurn = {
		message,
		toolResults,
		context: currentContext,
		newMessages,
	};
	const decision = await config.finishTurn?.(completedTurn, signal);
	await emit({ type: "turn_end", message, toolResults });

	if (decision?.action === "end") {
		await emit({ type: "agent_end", messages: newMessages });
		return {
			done: true,
			hasMoreToolCalls,
			continueRequested: false,
			context: currentContext,
			config,
			pendingMessages: [],
			completedTurn,
		};
	}

	const steering = params.fetchNextPending ? await config.getSteeringMessages?.() : undefined;
	return {
		done: false,
		hasMoreToolCalls,
		continueRequested: decision?.action === "continue",
		context: currentContext,
		config,
		pendingMessages: steering || [],
		completedTurn,
	};
}

/**
 * One iteration of the agent loop: inject any pending messages, stream a single
 * assistant response, run the tools it requests, and report whether the loop
 * should keep going.
 *
 * Three pieces, each of which stands on its own: the model call, one tool call, the seal.
 */
async function runSingleTurn(params: SingleTurnParams): Promise<SingleTurnOutcome> {
	const modelCall = await runTurnModelCall(params);
	if (modelCall.ended) {
		return {
			done: true,
			hasMoreToolCalls: false,
			continueRequested: false,
			context: modelCall.context,
			config: modelCall.config,
			pendingMessages: [],
		};
	}

	// The model call's config, not the one handed in: preparing the turn can have replaced the
	// model or the thinking level, and the rest of the step belongs to the turn that ran.
	const toolCalls = await dispatchToolCalls(
		modelCall.context,
		modelCall.message,
		modelCall.toolCalls,
		modelCall.config,
		params.signal,
		params.emit,
	);

	return sealTurnStep({
		context: modelCall.context,
		config: modelCall.config,
		newMessages: params.newMessages,
		message: modelCall.message,
		toolCalls,
		fetchNextPending: params.fetchNextPending,
		signal: params.signal,
		emit: params.emit,
	});
}

/**
 * Main loop logic shared by agentLoop and agentLoopContinue.
 */
async function runLoop(
	initialContext: AgentContext,
	newMessages: AgentMessage[],
	initialConfig: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	streamFunction: StreamFn,
): Promise<void> {
	let currentContext = initialContext;
	let config = initialConfig;
	let lastCompletedTurn: PrepareNextTurnContext | undefined;
	let explicitContinuation = false;
	// The run entry point already emitted turn_start for the first one.
	let firstTurn = true;
	// Check for steering messages at start (user may have typed while waiting)
	let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

	// Outer loop: continues when queued follow-up messages arrive after agent would stop
	while (true) {
		let hasMoreToolCalls = true;

		// Inner loop: process tool calls and steering messages
		while (hasMoreToolCalls || pendingMessages.length > 0) {
			const outcome = await runSingleTurn({
				context: currentContext,
				config,
				newMessages,
				pendingMessages,
				previousTurn: lastCompletedTurn,
				emitTurnStart: !firstTurn,
				fetchNextPending: true,
				signal,
				emit,
				streamFunction,
			});
			firstTurn = false;
			if (outcome.done) {
				return;
			}
			lastCompletedTurn = outcome.completedTurn;
			hasMoreToolCalls = outcome.hasMoreToolCalls;
			currentContext = outcome.context;
			config = outcome.config;
			pendingMessages = outcome.pendingMessages;
			explicitContinuation = outcome.continueRequested && !hasMoreToolCalls && pendingMessages.length === 0;
		}

		// Agent would stop here. Check for follow-up messages.
		const followUpMessages = (await config.getFollowUpMessages?.()) || [];
		if (followUpMessages.length > 0) {
			// Set as pending so inner loop processes them
			explicitContinuation = false;
			pendingMessages = followUpMessages;
			continue;
		}

		// No natural request was selected, so fulfill the continuation decision with one context-only turn.
		if (explicitContinuation) {
			explicitContinuation = false;
			continue;
		}

		// No more messages, exit
		break;
	}

	await emit({ type: "agent_end", messages: newMessages });
}

/**
 * Declare tool loadout changes to the model.
 *
 * `context.tools` is what the runtime can execute; the transcript's system messages declare
 * what the model may call. Before each request the difference becomes `toolsAdded` and
 * `toolsRemoved` on a system message. When a pending system message exists, its tool fields
 * are treated as intent and replaced with the delta between the committed transcript and
 * the executable set, so replay always yields exactly `context.tools`. Otherwise a new
 * system message is inserted before the first non-system pending message.
 */
function declareToolChanges(context: AgentContext, pendingMessages: AgentMessage[]): AgentMessage[] {
	let systemIndex = -1;
	for (let i = pendingMessages.length - 1; i >= 0; i--) {
		if (pendingMessages[i].role === "system") {
			systemIndex = i;
			break;
		}
	}
	const pending = pendingMessages[systemIndex] as SystemMessage | undefined;
	const baseline = pending
		? pendingMessages.map((message, index) =>
				index === systemIndex ? withToolChanges(pending, NO_CHANGES) : message,
			)
		: pendingMessages;
	const changes = getToolStateChanges(
		getCurrentTools([...context.messages, ...baseline]),
		(context.tools ?? []).map(toToolDeclaration),
	);
	const unchanged = changes.toolsAdded.length === 0 && changes.toolsRemoved.length === 0;

	if (pending) {
		// Keep the caller's message object when it already declares no tool changes.
		if (unchanged && !pending.toolsAdded?.length && !pending.toolsRemoved?.length) return pendingMessages;
		return baseline.map((message, index) => (index === systemIndex ? withToolChanges(pending, changes) : message));
	}
	if (unchanged) return pendingMessages;
	const update = withToolChanges({ role: "system", content: "", timestamp: Date.now() }, changes);
	const insertIndex = pendingMessages.findIndex((message) => message.role !== "system");
	const index = insertIndex === -1 ? pendingMessages.length : insertIndex;
	return [...pendingMessages.slice(0, index), update, ...pendingMessages.slice(index)];
}

const NO_CHANGES: ToolStateChanges = { toolsAdded: [], toolsRemoved: [] };

/** Copy a system message with its tool fields replaced by `changes`; empty lists omit the field. */
function withToolChanges(message: SystemMessage, { toolsAdded, toolsRemoved }: ToolStateChanges): SystemMessage {
	const { toolsAdded: _added, toolsRemoved: _removed, ...rest } = message;
	return {
		...rest,
		...(toolsAdded.length > 0 ? { toolsAdded } : {}),
		...(toolsRemoved.length > 0 ? { toolsRemoved } : {}),
	};
}

/**
 * Stream an assistant response from the LLM.
 * This is where AgentMessage[] gets transformed to Message[] for the LLM.
 */
async function streamAssistantResponse(
	context: AgentContext,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
	streamFunction: StreamFn,
): Promise<AssistantMessage> {
	// Apply context transform if configured (AgentMessage[] → AgentMessage[])
	let messages = context.messages;
	if (config.transformContext) {
		messages = await config.transformContext(messages, signal);
	}

	// Convert to LLM-compatible messages (AgentMessage[] → Message[])
	const llmMessages = await config.convertToLlm(messages);

	const llmContext = normalizeContext({ messages: llmMessages });

	// Resolve API key (important for expiring tokens)
	const resolvedApiKey =
		(config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;

	const response = await streamFunction(config.model, llmContext, {
		...config,
		apiKey: resolvedApiKey,
		identity: mergeClientIdentity(DEFAULT_AGENT_IDENTITY, config.identity),
		signal,
	});
	// Record the requested level, whichever stream function answered.
	const result = async () => Object.assign(await response.result(), { thinkingLevel: config.reasoning ?? "off" });

	let partialMessage: AssistantMessage | null = null;
	let addedPartial = false;

	for await (const event of response) {
		switch (event.type) {
			case "start":
				partialMessage = event.partial;
				context.messages.push(partialMessage);
				addedPartial = true;
				await emit({ type: "message_start", message: { ...partialMessage } });
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
					await emit({
						type: "message_update",
						assistantMessageEvent: event,
						message: { ...partialMessage },
					});
				}
				break;

			case "done":
			case "error": {
				const finalMessage = await result();
				if (addedPartial) {
					context.messages[context.messages.length - 1] = finalMessage;
				} else {
					context.messages.push(finalMessage);
				}
				if (!addedPartial) {
					await emit({ type: "message_start", message: { ...finalMessage } });
				}
				await emit({ type: "message_end", message: finalMessage });
				return finalMessage;
			}
		}
	}

	const finalMessage = await result();
	if (addedPartial) {
		context.messages[context.messages.length - 1] = finalMessage;
	} else {
		context.messages.push(finalMessage);
		await emit({ type: "message_start", message: { ...finalMessage } });
	}
	await emit({ type: "message_end", message: finalMessage });
	return finalMessage;
}

/**
 * The result a call gets when the response that asked for it was cut off by the output
 * token limit. Streamed tool-call arguments are finalized with a best-effort JSON salvage
 * parser, so a truncated message can yield tool calls whose arguments parse and validate but
 * are silently incomplete. None of them are safe to execute; report each as an error so the
 * model can re-issue it.
 */
function truncatedToolCallOutcome(toolCall: AgentToolCall): FinalizedToolCallOutcome {
	return {
		toolCall,
		result: createErrorToolResult(
			`Tool call "${toolCall.name}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments.`,
		),
		isError: true,
	};
}

/** Prepare, run and finalize one call, without deciding anything about the batch it is in. */
async function settleToolCall(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCall: AgentToolCall,
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<FinalizedToolCallOutcome> {
	const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);
	if (preparation.kind === "immediate") {
		return { toolCall, result: preparation.result, isError: preparation.isError };
	}
	const executed = await executePreparedToolCall(preparation, signal, emitToolExecutionUpdate(toolCall, emit));
	return finalizeExecutedToolCall(currentContext, assistantMessage, preparation, executed, config, signal);
}

function toTurnToolCallOutcome(finalized: FinalizedToolCallOutcome): TurnToolCallOutcome {
	return {
		message: createToolResultMessage(finalized),
		terminate: finalized.result.terminate === true,
	};
}

/**
 * Run the calls of one step and report them in the order the model asked for them.
 */
async function dispatchToolCalls(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCalls: AgentToolCall[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<TurnToolCallOutcome[]> {
	if (toolCalls.length === 0) {
		return [];
	}
	if (mustRunToolCallsInOrder(currentContext, config, assistantMessage, toolCalls)) {
		return dispatchToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit);
	}
	return dispatchToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit);
}

/** Whether the calls of one step have to run one at a time. */
function mustRunToolCallsInOrder(
	context: AgentContext,
	config: AgentLoopConfig,
	assistantMessage: AssistantMessage,
	toolCalls: ReadonlyArray<AgentToolCall>,
): boolean {
	// A truncated response runs nothing, so there is no execution to overlap.
	if (assistantMessage.stopReason === "length" || config.toolExecution === "sequential") {
		return true;
	}
	return toolCalls.some((tc) => context.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential");
}

async function dispatchToolCallsSequential(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCalls: AgentToolCall[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<TurnToolCallOutcome[]> {
	const outcomes: TurnToolCallOutcome[] = [];

	for (const toolCall of toolCalls) {
		outcomes.push(
			await runTurnToolCall({ context: currentContext, assistantMessage, toolCall, config, signal, emit }),
		);
		// An abort leaves the rest of the batch unsettled on purpose: the calls are still in the
		// transcript, and settling them here would answer for tools that never ran. A truncated
		// response runs no tool, so each of its calls gets its failure regardless.
		if (signal?.aborted && assistantMessage.stopReason !== "length") {
			break;
		}
	}

	return outcomes;
}

async function dispatchToolCallsParallel(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCalls: AgentToolCall[],
	config: AgentLoopConfig,
	signal: AbortSignal | undefined,
	emit: AgentEventSink,
): Promise<TurnToolCallOutcome[]> {
	const finalizedCalls: FinalizedToolCallEntry[] = [];

	// Preparation stays in the model's order, because a permission ask is a preparation and
	// asking about four tools at once is not a question anyone can answer. Only execution overlaps.
	for (const toolCall of toolCalls) {
		await emit({
			type: "tool_execution_start",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.arguments,
		});

		const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);
		if (preparation.kind === "immediate") {
			const finalized = {
				toolCall,
				result: preparation.result,
				isError: preparation.isError,
			} satisfies FinalizedToolCallOutcome;
			await emitToolExecutionEnd(finalized, emit);
			finalizedCalls.push(finalized);
			if (signal?.aborted) {
				break;
			}
			continue;
		}

		finalizedCalls.push(async () => {
			if (signal?.aborted) {
				const finalized = {
					toolCall,
					result: createErrorToolResult("Operation aborted"),
					isError: true,
				} satisfies FinalizedToolCallOutcome;
				await emitToolExecutionEnd(finalized, emit);
				return finalized;
			}
			const executed = await executePreparedToolCall(preparation, signal, emitToolExecutionUpdate(toolCall, emit));
			const finalized = await finalizeExecutedToolCall(
				currentContext,
				assistantMessage,
				preparation,
				executed,
				config,
				signal,
			);
			await emitToolExecutionEnd(finalized, emit);
			return finalized;
		});
		if (signal?.aborted) {
			break;
		}
	}

	const orderedFinalizedCalls = await Promise.all(
		finalizedCalls.map((entry) => (typeof entry === "function" ? entry() : Promise.resolve(entry))),
	);
	return orderedFinalizedCalls.map(toTurnToolCallOutcome);
}

type PreparedToolCall = {
	kind: "prepared";
	toolCall: AgentToolCall;
	tool: AgentTool<any>;
	args: unknown;
};

type ImmediateToolCallOutcome = {
	kind: "immediate";
	result: AgentToolResult<any>;
	isError: boolean;
};

type ExecutedToolCallOutcome = {
	result: AgentToolResult<any>;
	isError: boolean;
	durationMs: number;
};

type FinalizedToolCallOutcome = AgentToolCallOutcome;

/** The `beforeToolCall` and `afterToolCall` hooks of {@link AgentLoopConfig}. */
export type ToolCallHooks = Pick<AgentLoopConfig, "beforeToolCall" | "afterToolCall">;

type ToolUpdateSink = (partialResult: AgentToolResult<any>) => Promise<void> | void;

type FinalizedToolCallEntry = FinalizedToolCallOutcome | (() => Promise<FinalizedToolCallOutcome>);

function shouldTerminateToolBatch(calls: ReadonlyArray<{ terminate: boolean }>): boolean {
	return calls.length > 0 && calls.every((call) => call.terminate);
}

function prepareToolCallArguments(tool: AgentTool<any>, toolCall: AgentToolCall): AgentToolCall {
	if (!tool.prepareArguments) {
		return toolCall;
	}
	const preparedArguments = tool.prepareArguments(toolCall.arguments);
	if (preparedArguments === toolCall.arguments) {
		return toolCall;
	}
	return {
		...toolCall,
		arguments: preparedArguments as Record<string, any>,
	};
}

async function prepareToolCall(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	toolCall: AgentToolCall,
	config: ToolCallHooks,
	signal: AbortSignal | undefined,
	tools: readonly AgentTool<any>[] = currentContext.tools ?? [],
): Promise<PreparedToolCall | ImmediateToolCallOutcome> {
	const tool = tools.find((t) => t.name === toolCall.name);
	if (!tool) {
		return {
			kind: "immediate",
			result: createErrorToolResult(`Tool ${toolCall.name} not found`),
			isError: true,
		};
	}

	try {
		const preparedToolCall = prepareToolCallArguments(tool, toolCall);
		const validatedArgs = validateToolArguments(tool, preparedToolCall);
		if (config.beforeToolCall) {
			const beforeResult = await config.beforeToolCall(
				{
					assistantMessage,
					toolCall,
					args: validatedArgs,
					context: currentContext,
				},
				signal,
			);
			if (signal?.aborted) {
				return {
					kind: "immediate",
					result: createErrorToolResult("Operation aborted"),
					isError: true,
				};
			}
			if (beforeResult?.block) {
				const result = createErrorToolResult(beforeResult.reason || "Tool execution was blocked");
				if (beforeResult.terminate === true) {
					result.terminate = true;
				}
				return {
					kind: "immediate",
					result,
					isError: true,
				};
			}
		}
		if (signal?.aborted) {
			return {
				kind: "immediate",
				result: createErrorToolResult("Operation aborted"),
				isError: true,
			};
		}
		return {
			kind: "prepared",
			toolCall,
			tool,
			args: validatedArgs,
		};
	} catch (error) {
		return {
			kind: "immediate",
			result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
			isError: true,
		};
	}
}

function emitToolExecutionUpdate(toolCall: AgentToolCall, emit: AgentEventSink): ToolUpdateSink {
	return (partialResult) =>
		emit({
			type: "tool_execution_update",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			args: toolCall.arguments,
			partialResult,
		});
}

/** Options for {@link runToolCall}. */
export interface RunToolCallOptions extends ToolCallHooks {
	/** Tools the call resolves against. */
	tools: readonly AgentTool<any>[];
	/** Passed to the hooks as the message that issued the call. */
	assistantMessage: AssistantMessage;
	/** Passed to the hooks as the current agent context. */
	context: AgentContext;
	signal?: AbortSignal;
	onUpdate?: ToolUpdateSink;
}

/**
 * Run one tool call through the same steps as a model-issued call: argument preparation, schema
 * validation, `beforeToolCall`, execution, and `afterToolCall`. Emits no events and adds no
 * messages. Tools that call other tools use this so the hooks (for example permission checks)
 * apply to those calls too.
 *
 * Never rejects for tool failures: unknown tools, validation errors, blocked calls, and thrown
 * errors come back as `isError: true`.
 */
export async function runToolCall(toolCall: AgentToolCall, options: RunToolCallOptions): Promise<AgentToolCallOutcome> {
	const { assistantMessage, context, signal } = options;
	const preparation = await prepareToolCall(context, assistantMessage, toolCall, options, signal, options.tools);
	if (preparation.kind === "immediate") {
		return { toolCall, result: preparation.result, isError: preparation.isError };
	}
	const executed = await executePreparedToolCall(preparation, signal, options.onUpdate ?? (() => {}));
	return finalizeExecutedToolCall(context, assistantMessage, preparation, executed, options, signal);
}

async function executePreparedToolCall(
	prepared: PreparedToolCall,
	signal: AbortSignal | undefined,
	onUpdate: ToolUpdateSink,
): Promise<ExecutedToolCallOutcome> {
	const updateEvents: Promise<void>[] = [];
	let acceptingUpdates = true;
	const startedAt = performance.now();
	const elapsed = () => Math.round(performance.now() - startedAt);

	try {
		const result = await prepared.tool.execute(
			prepared.toolCall.id,
			prepared.args as never,
			signal,
			(partialResult) => {
				if (!acceptingUpdates) return;
				updateEvents.push(Promise.resolve(onUpdate(partialResult)));
			},
		);
		const durationMs = elapsed();
		acceptingUpdates = false;
		await Promise.all(updateEvents);
		return { result, isError: result.isError === true, durationMs };
	} catch (error) {
		const durationMs = elapsed();
		acceptingUpdates = false;
		await Promise.all(updateEvents);
		return {
			result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
			isError: true,
			durationMs,
		};
	} finally {
		acceptingUpdates = false;
	}
}

async function finalizeExecutedToolCall(
	currentContext: AgentContext,
	assistantMessage: AssistantMessage,
	prepared: PreparedToolCall,
	executed: ExecutedToolCallOutcome,
	config: ToolCallHooks,
	signal: AbortSignal | undefined,
): Promise<FinalizedToolCallOutcome> {
	let result = executed.result;
	let isError = executed.isError;

	if (config.afterToolCall) {
		try {
			const afterResult = await config.afterToolCall(
				{
					assistantMessage,
					toolCall: prepared.toolCall,
					args: prepared.args,
					result,
					isError,
					context: currentContext,
				},
				signal,
			);
			if (afterResult) {
				// Structured content not replaced along with the content may no longer match it.
				const structuredContent =
					afterResult.structuredContent ?? (afterResult.content ? undefined : result.structuredContent);
				result = {
					...result,
					content: afterResult.content ?? result.content,
					details: afterResult.details ?? result.details,
					usage: afterResult.usage ?? result.usage,
					terminate: afterResult.terminate ?? result.terminate,
				};
				if (structuredContent === undefined) delete result.structuredContent;
				else result.structuredContent = structuredContent;
				isError = afterResult.isError ?? isError;
			}
		} catch (error) {
			result = createErrorToolResult(error instanceof Error ? error.message : String(error));
			isError = true;
		}
	}

	return {
		toolCall: prepared.toolCall,
		result,
		isError,
		durationMs: executed.durationMs,
	};
}

function createErrorToolResult(message: string): AgentToolResult<any> {
	return {
		content: [{ type: "text", text: message }],
		details: {},
	};
}

async function emitToolExecutionEnd(finalized: FinalizedToolCallOutcome, emit: AgentEventSink): Promise<void> {
	await emit({
		type: "tool_execution_end",
		toolCallId: finalized.toolCall.id,
		toolName: finalized.toolCall.name,
		result: finalized.result,
		isError: finalized.isError,
		...(finalized.durationMs === undefined ? {} : { durationMs: finalized.durationMs }),
	});
}

function createToolResultMessage(finalized: FinalizedToolCallOutcome): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: finalized.toolCall.id,
		toolName: finalized.toolCall.name,
		// Untyped tools (JS extensions) can return results without content; normalize
		// so the null never enters session history or provider payloads.
		content: finalized.result.content ?? [],
		details: finalized.result.details,
		usage: finalized.result.usage,
		isError: finalized.isError,
		...(finalized.durationMs === undefined ? {} : { durationMs: finalized.durationMs }),
		timestamp: Date.now(),
	};
}

async function emitToolResultMessage(toolResultMessage: ToolResultMessage, emit: AgentEventSink): Promise<void> {
	await emit({ type: "message_start", message: toolResultMessage });
	await emit({ type: "message_end", message: toolResultMessage });
}
