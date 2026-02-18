import type { EnergyUsage, Usage } from "./types.js";

/**
 * A single telemetry record emitted after each model call.
 * This is the contract consumed by the benchmark runner (EPIC 3).
 * Output format: one JSON object per line (JSONL).
 */
export interface TelemetryRecord {
	task_id: string;
	run_id: string;
	step_id: string;
	model: string;
	provider: string;
	tokens: { input: number; output: number; total: number };
	latency_ms: number;
	energy_joules: number;
	energy_kwh: number;
	timestamp: number;
}

/**
 * Options for creating a telemetry record from a completed model call.
 */
export interface TelemetryInput {
	task_id: string;
	run_id: string;
	step_id: string;
	model: string;
	provider: string;
	usage: Usage;
	energy?: EnergyUsage;
	latency_ms: number;
	timestamp?: number;
}

/**
 * Build a TelemetryRecord from a completed model call.
 */
export function buildTelemetryRecord(input: TelemetryInput): TelemetryRecord {
	return {
		task_id: input.task_id,
		run_id: input.run_id,
		step_id: input.step_id,
		model: input.model,
		provider: input.provider,
		tokens: {
			input: input.usage.input,
			output: input.usage.output,
			total: input.usage.totalTokens,
		},
		latency_ms: input.latency_ms,
		energy_joules: input.energy?.energy_joules ?? 0,
		energy_kwh: input.energy?.energy_kwh ?? 0,
		timestamp: input.timestamp ?? Date.now(),
	};
}

/**
 * Serialize a TelemetryRecord to a single JSONL line (no trailing newline).
 */
export function serializeTelemetryRecord(record: TelemetryRecord): string {
	return JSON.stringify(record);
}

/**
 * Parse a single JSONL line into a TelemetryRecord.
 * Throws if the line is not valid JSON or is missing required fields.
 */
export function parseTelemetryRecord(line: string): TelemetryRecord {
	const obj = JSON.parse(line);
	if (
		typeof obj.task_id !== "string" ||
		typeof obj.run_id !== "string" ||
		typeof obj.step_id !== "string" ||
		typeof obj.model !== "string" ||
		typeof obj.provider !== "string" ||
		typeof obj.tokens?.input !== "number" ||
		typeof obj.tokens?.output !== "number" ||
		typeof obj.tokens?.total !== "number" ||
		typeof obj.latency_ms !== "number" ||
		typeof obj.energy_joules !== "number" ||
		typeof obj.energy_kwh !== "number" ||
		typeof obj.timestamp !== "number"
	) {
		throw new Error("Invalid TelemetryRecord: missing or invalid fields");
	}
	return obj as TelemetryRecord;
}

/**
 * Append a TelemetryRecord to an array of JSONL lines.
 * Returns the updated array.
 */
export function appendTelemetryLine(lines: string[], record: TelemetryRecord): string[] {
	lines.push(serializeTelemetryRecord(record));
	return lines;
}

/**
 * Parse multiple JSONL lines into TelemetryRecords.
 * Skips empty lines.
 */
export function parseTelemetryLines(content: string): TelemetryRecord[] {
	return content
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map(parseTelemetryRecord);
}
