import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { type ExportResult, ExportResultCode } from "@opentelemetry/core";
import { DataPointType, type PushMetricExporter, type ResourceMetrics } from "@opentelemetry/sdk-metrics";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

const DATA_POINT_TYPE_NAMES: Record<number, string> = {
	[DataPointType.HISTOGRAM]: "HISTOGRAM",
	[DataPointType.EXPONENTIAL_HISTOGRAM]: "EXPONENTIAL_HISTOGRAM",
	[DataPointType.GAUGE]: "GAUGE",
	[DataPointType.SUM]: "SUM",
};

/** Converts an OpenTelemetry HrTime `[seconds, nanoseconds]` to a decimal nanosecond string without losing precision. */
function hrTimeToNano(time: readonly [number, number]): string {
	return `${time[0]}${time[1].toString().padStart(9, "0")}`;
}

function utcDay(time: readonly [number, number]): string {
	return new Date(time[0] * 1000).toISOString().slice(0, 10);
}

function appendLine(dir: string, file: string, line: string): void {
	mkdirSync(dir, { recursive: true });
	appendFileSync(join(dir, file), `${line}\n`, "utf8");
}

function spanToRecord(span: ReadableSpan): Record<string, unknown> {
	const context = span.spanContext();
	return {
		traceId: context.traceId,
		spanId: context.spanId,
		parentSpanId: span.parentSpanContext?.spanId ?? null,
		name: span.name,
		startTimeUnixNano: hrTimeToNano(span.startTime),
		endTimeUnixNano: hrTimeToNano(span.endTime),
		durationMs: span.duration[0] * 1000 + span.duration[1] / 1e6,
		attributes: span.attributes,
		events: span.events.map((event) => ({
			name: event.name,
			timeUnixNano: hrTimeToNano(event.time),
			attributes: event.attributes ?? {},
		})),
		status: span.status,
	};
}

/** Writes one JSON object per finished span to `spans-YYYY-MM-DD.jsonl`, grouped by UTC day. */
export class JsonlSpanExporter implements SpanExporter {
	private readonly dir: string;
	private stopped = false;

	constructor(dir: string) {
		this.dir = dir;
	}

	export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
		if (this.stopped) {
			resultCallback({ code: ExportResultCode.FAILED, error: new Error("JSONL span exporter is stopped") });
			return;
		}
		try {
			for (const span of spans) {
				const file = `spans-${utcDay(span.startTime)}.jsonl`;
				appendLine(this.dir, file, JSON.stringify(spanToRecord(span)));
			}
			resultCallback({ code: ExportResultCode.SUCCESS });
		} catch (error) {
			resultCallback({
				code: ExportResultCode.FAILED,
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}
	}

	async forceFlush(): Promise<void> {}

	async shutdown(): Promise<void> {
		this.stopped = true;
	}
}

/**
 * Writes one JSON line per metric collection to `metrics-YYYY-MM-DD.jsonl`.
 * Each line holds the full cumulative snapshot of every instrument at that moment.
 */
export class JsonlMetricExporter implements PushMetricExporter {
	private readonly dir: string;
	private stopped = false;

	constructor(dir: string) {
		this.dir = dir;
	}

	export(metrics: ResourceMetrics, resultCallback: (result: ExportResult) => void): void {
		if (this.stopped) {
			resultCallback({ code: ExportResultCode.FAILED, error: new Error("JSONL metric exporter is stopped") });
			return;
		}
		try {
			const now = new Date();
			const record = {
				timeUnixNano: `${now.getTime()}000000`,
				metrics: metrics.scopeMetrics.flatMap((scope) =>
					scope.metrics.map((metric) => ({
						name: metric.descriptor.name,
						unit: metric.descriptor.unit,
						description: metric.descriptor.description,
						type: DATA_POINT_TYPE_NAMES[metric.dataPointType] ?? String(metric.dataPointType),
						dataPoints: metric.dataPoints.map((point) => ({
							attributes: point.attributes,
							value: point.value,
						})),
					})),
				),
			};
			appendLine(this.dir, `metrics-${now.toISOString().slice(0, 10)}.jsonl`, JSON.stringify(record));
			resultCallback({ code: ExportResultCode.SUCCESS });
		} catch (error) {
			resultCallback({
				code: ExportResultCode.FAILED,
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}
	}

	async forceFlush(): Promise<void> {}

	async shutdown(): Promise<void> {
		this.stopped = true;
	}
}
