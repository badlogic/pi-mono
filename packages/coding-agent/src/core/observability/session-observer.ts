import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	type Attributes,
	type Context,
	type Counter,
	type Histogram,
	ROOT_CONTEXT,
	type Span,
	SpanStatusCode,
	trace,
} from "@opentelemetry/api";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import type { AgentSession, AgentSessionEvent } from "../agent-session.ts";
import type { ObservabilityConfig } from "./config.ts";
import { JsonlMetricExporter, JsonlSpanExporter } from "./exporters.ts";

const INSTRUMENTATION_NAME = "pi-coding-agent";
const METRIC_EXPORT_INTERVAL_MS = 10_000;
const MAX_CAPTURED_CHARS = 2_000;

export interface SessionObserver {
	dispose(): Promise<void>;
}

interface OpenTurn {
	span: Span;
	context: Context;
	startedAt: number;
	index: number;
}

interface OpenLlmRequest {
	span: Span;
	startedAt: number;
	firstTokenAt?: number;
}

interface OpenToolCall {
	span: Span;
	startedAt: number;
	name: string;
	argsBytes: number;
}

/** Shortens text and masks common secret shapes before it is written to a span. */
function redact(text: string): string {
	return text
		.replace(/\b(sk|pk|ghp|xox[abp])[-_][A-Za-z0-9_-]{12,}/g, "[REDACTED]")
		.replace(/(api[_-]?key|token|secret|password)(\s*[:=]\s*)\S+/gi, "$1$2[REDACTED]");
}

function captureText(text: string, mode: ObservabilityConfig["content"]): string | undefined {
	if (mode === "off") return undefined;
	const value = mode === "redacted" ? redact(text) : text;
	return mode === "redacted" && value.length > MAX_CAPTURED_CHARS ? `${value.slice(0, MAX_CAPTURED_CHARS)}…` : value;
}

function byteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

function assistantText(message: AssistantMessage): string {
	return message.content
		.map((block) => (block.type === "text" ? block.text : ""))
		.filter((text) => text.length > 0)
		.join("\n");
}

/**
 * Turns session events into OpenTelemetry spans and metrics. It only reads events; it does not
 * change the agent loop, so a failure here cannot change what the model sees.
 */
export function createSessionObserver(session: AgentSession, config: ObservabilityConfig): SessionObserver {
	const tracerProvider = new BasicTracerProvider({
		spanProcessors: [new SimpleSpanProcessor(new JsonlSpanExporter(config.dir))],
	});
	const meterProvider = new MeterProvider({
		readers: [
			new PeriodicExportingMetricReader({
				exporter: new JsonlMetricExporter(config.dir),
				exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
			}),
		],
	});
	const tracer = tracerProvider.getTracer(INSTRUMENTATION_NAME);
	const meter = meterProvider.getMeter(INSTRUMENTATION_NAME);

	const tokens: Counter = meter.createCounter("pi.llm.tokens", { unit: "{token}" });
	const llmRequests: Counter = meter.createCounter("pi.llm.requests");
	const llmTtft: Histogram = meter.createHistogram("pi.llm.ttft", { unit: "ms" });
	const llmDuration: Histogram = meter.createHistogram("pi.llm.duration", { unit: "ms" });
	const llmInputTokens: Histogram = meter.createHistogram("pi.llm.input_tokens", { unit: "{token}" });
	const toolCalls: Counter = meter.createCounter("pi.tool.calls");
	const toolDuration: Histogram = meter.createHistogram("pi.tool.duration", { unit: "ms" });
	const turnDuration: Histogram = meter.createHistogram("pi.turn.duration", { unit: "ms" });
	const runDuration: Histogram = meter.createHistogram("pi.run.duration", { unit: "ms" });
	const compactions: Counter = meter.createCounter("pi.compactions");
	const compactionTokensBefore: Histogram = meter.createHistogram("pi.compaction.tokens_before", {
		unit: "{token}",
	});
	const retries: Counter = meter.createCounter("pi.llm.retries");

	let runSpan: Span | undefined;
	let runContext: Context = ROOT_CONTEXT;
	let runStartedAt = 0;
	let turn: OpenTurn | undefined;
	let llm: OpenLlmRequest | undefined;
	let compactionSpan: Span | undefined;
	let compactionStartedAt = 0;
	const tools = new Map<string, OpenToolCall>();
	const content = config.content;

	const modelAttributes = (): Attributes => ({
		"pi.model.provider": session.model?.provider ?? "unknown",
		"pi.model.id": session.model?.id ?? "unknown",
	});

	const startRun = (): void => {
		runStartedAt = Date.now();
		runSpan = tracer.startSpan("session.run", {
			attributes: {
				"pi.session.id": session.sessionManager.getSessionId(),
				"pi.thinking_level": session.thinkingLevel,
				...modelAttributes(),
			},
		});
		runContext = trace.setSpan(ROOT_CONTEXT, runSpan);
	};

	const endRun = (messages: readonly { readonly role: string }[]): void => {
		const span = runSpan;
		if (!span) return;
		const assistantMessages = messages.filter((message): message is AssistantMessage => message.role === "assistant");
		const last = assistantMessages.at(-1);
		span.setAttributes({
			"pi.run.assistant_messages": assistantMessages.length,
			"pi.llm.stop_reason": last?.stopReason ?? "none",
		});
		span.setStatus({ code: last?.stopReason === "error" ? SpanStatusCode.ERROR : SpanStatusCode.OK });
		span.end();
		runDuration.record(Date.now() - runStartedAt, modelAttributes());
		runSpan = undefined;
		runContext = ROOT_CONTEXT;
	};

	const startTurn = (): void => {
		const index = (turn?.index ?? 0) + 1;
		const span = tracer.startSpan("turn", { attributes: { "pi.turn.index": index } }, runContext);
		turn = { span, context: trace.setSpan(runContext, span), startedAt: Date.now(), index };
	};

	const endTurn = (stopReason: string | undefined): void => {
		if (!turn) return;
		turn.span.setAttributes({ "pi.llm.stop_reason": stopReason ?? "unknown" });
		turn.span.end();
		turnDuration.record(Date.now() - turn.startedAt, modelAttributes());
		turn = undefined;
	};

	const startLlmRequest = (): void => {
		const parentContext = turn?.context ?? runContext;
		const span = tracer.startSpan("llm.request", { attributes: modelAttributes() }, parentContext);
		llm = { span, startedAt: Date.now() };
	};

	const finishLlmRequest = (message: AssistantMessage): void => {
		const request = llm;
		llm = undefined;
		const usage = message.usage;
		const attributes: Attributes = {
			"pi.model.provider": message.provider,
			"pi.model.id": message.model,
			"pi.llm.api": message.api,
			"pi.llm.stop_reason": message.stopReason,
			"pi.llm.input_tokens": usage.input,
			"pi.llm.output_tokens": usage.output,
			"pi.llm.cache_read_tokens": usage.cacheRead,
			"pi.llm.cache_write_tokens": usage.cacheWrite,
			"pi.llm.tool_calls": message.content.filter((block) => block.type === "toolCall").length,
		};
		const duration = request ? Date.now() - request.startedAt : undefined;
		const ttft = request?.firstTokenAt !== undefined ? request.firstTokenAt - request.startedAt : undefined;
		if (ttft !== undefined) attributes["pi.llm.ttft_ms"] = ttft;
		if (message.errorMessage) attributes["pi.llm.error"] = redact(message.errorMessage).slice(0, 500);
		if (request) {
			request.span.setAttributes(attributes);
			request.span.setStatus({
				code: message.stopReason === "error" ? SpanStatusCode.ERROR : SpanStatusCode.OK,
			});
			const text = captureText(assistantText(message), content);
			if (text !== undefined) request.span.addEvent("assistant.text", { text });
			request.span.end();
		}

		const byModel = { "pi.model.provider": message.provider, "pi.model.id": message.model };
		llmRequests.add(1, { ...byModel, "pi.llm.stop_reason": message.stopReason });
		tokens.add(usage.input, { ...byModel, "pi.token.type": "input" });
		tokens.add(usage.output, { ...byModel, "pi.token.type": "output" });
		tokens.add(usage.cacheRead, { ...byModel, "pi.token.type": "cache_read" });
		tokens.add(usage.cacheWrite, { ...byModel, "pi.token.type": "cache_write" });
		llmInputTokens.record(usage.input + usage.cacheRead + usage.cacheWrite, byModel);
		if (duration !== undefined) llmDuration.record(duration, byModel);
		if (ttft !== undefined) llmTtft.record(ttft, byModel);
	};

	const startTool = (toolCallId: string, toolName: string, args: unknown, parentToolCallId?: string): void => {
		const serialized = JSON.stringify(args ?? null) ?? "null";
		const parentContext = turn?.context ?? runContext;
		const attributes: Attributes = {
			"pi.tool.name": toolName,
			"pi.tool.call_id": toolCallId,
			"pi.tool.args_bytes": byteLength(serialized),
		};
		if (parentToolCallId) attributes["pi.tool.parent_call_id"] = parentToolCallId;
		const captured = captureText(serialized, content);
		if (captured !== undefined) attributes["pi.tool.args"] = captured;
		const span = tracer.startSpan(`tool.${toolName}`, { attributes }, parentContext);
		tools.set(toolCallId, { span, startedAt: Date.now(), name: toolName, argsBytes: byteLength(serialized) });
	};

	const finishTool = (toolCallId: string, result: unknown, isError: boolean, durationMs?: number): void => {
		const call = tools.get(toolCallId);
		tools.delete(toolCallId);
		const serialized = JSON.stringify(result ?? null) ?? "null";
		const duration = durationMs ?? (call ? Date.now() - call.startedAt : undefined);
		const toolName = call?.name ?? "unknown";
		if (call) {
			const attributes: Attributes = {
				"pi.tool.is_error": isError,
				"pi.tool.result_bytes": byteLength(serialized),
			};
			if (duration !== undefined) attributes["pi.tool.duration_ms"] = duration;
			const captured = captureText(serialized, content);
			if (captured !== undefined) attributes["pi.tool.result"] = captured;
			call.span.setAttributes(attributes);
			call.span.setStatus({ code: isError ? SpanStatusCode.ERROR : SpanStatusCode.OK });
			call.span.end();
		}
		toolCalls.add(1, { "pi.tool.name": toolName, "pi.tool.is_error": isError });
		if (duration !== undefined) toolDuration.record(duration, { "pi.tool.name": toolName });
	};

	const startCompaction = (reason: string): void => {
		compactionStartedAt = Date.now();
		compactionSpan = tracer.startSpan("compaction", { attributes: { "pi.compaction.reason": reason } }, runContext);
	};

	const endCompaction = (event: Extract<AgentSessionEvent, { type: "compaction_end" }>): void => {
		const outcome = event.aborted ? "aborted" : event.errorMessage ? "failed" : "completed";
		const tokensBefore = event.result?.tokensBefore;
		compactions.add(1, { "pi.compaction.reason": event.reason, "pi.compaction.outcome": outcome });
		if (tokensBefore !== undefined)
			compactionTokensBefore.record(tokensBefore, { "pi.compaction.reason": event.reason });
		if (!compactionSpan) return;
		compactionSpan.setAttributes({
			"pi.compaction.outcome": outcome,
			"pi.compaction.will_retry": event.willRetry,
			"pi.compaction.duration_ms": Date.now() - compactionStartedAt,
			...(tokensBefore !== undefined ? { "pi.compaction.tokens_before": tokensBefore } : {}),
			...(event.errorMessage ? { "pi.compaction.error": redact(event.errorMessage).slice(0, 500) } : {}),
		});
		compactionSpan.setStatus({ code: outcome === "completed" ? SpanStatusCode.OK : SpanStatusCode.ERROR });
		compactionSpan.end();
		compactionSpan = undefined;
	};

	const handle = (event: AgentSessionEvent): void => {
		switch (event.type) {
			case "agent_start":
				startRun();
				return;
			case "agent_end":
				endTurn(undefined);
				endRun(event.messages);
				return;
			case "turn_start":
				startTurn();
				return;
			case "turn_end":
				endTurn(event.message.role === "assistant" ? event.message.stopReason : undefined);
				return;
			case "message_start":
				if (event.message.role === "assistant") startLlmRequest();
				return;
			case "message_update": {
				const delta = event.assistantMessageEvent;
				if (
					llm &&
					llm.firstTokenAt === undefined &&
					(delta.type === "text_delta" || delta.type === "thinking_delta")
				) {
					llm.firstTokenAt = Date.now();
				}
				return;
			}
			case "message_end":
				if (event.message.role === "assistant") finishLlmRequest(event.message);
				return;
			case "tool_execution_start":
				startTool(event.toolCallId, event.toolName, event.args, event.parentToolCallId);
				return;
			case "tool_execution_end":
				finishTool(event.toolCallId, event.result, event.isError, event.durationMs);
				return;
			case "compaction_start":
				startCompaction(event.reason);
				return;
			case "compaction_end":
				endCompaction(event);
				return;
			case "auto_retry_start":
				retries.add(1, { "pi.llm.retry.attempt": event.attempt });
				return;
			default:
				return;
		}
	};

	const unsubscribe = session.subscribe((event) => {
		try {
			handle(event);
		} catch {
			// Observability must never break the session.
		}
	});

	return {
		async dispose(): Promise<void> {
			unsubscribe();
			await tracerProvider.forceFlush();
			await tracerProvider.shutdown();
			await meterProvider.forceFlush();
			await meterProvider.shutdown();
		},
	};
}
