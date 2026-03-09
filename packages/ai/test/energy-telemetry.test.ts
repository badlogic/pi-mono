import { describe, expect, it } from "vitest";
import type { TelemetryInput, TelemetryRecord } from "../src/energy-types.js";
import {
	appendTelemetryLine,
	buildTelemetryRecord,
	parseTelemetryLines,
	parseTelemetryRecord,
	serializeTelemetryRecord,
} from "../src/energy-types.js";
import type { EnergyUsage, Usage } from "../src/types.js";

function makeUsage(overrides?: Partial<Usage>): Usage {
	return {
		input: 100,
		output: 50,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 150,
		cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
		...overrides,
	};
}

function makeEnergy(overrides?: Partial<EnergyUsage>): EnergyUsage {
	return {
		energy_joules: 0.42,
		energy_kwh: 0.000000116667,
		duration_seconds: 1.5,
		...overrides,
	};
}

function makeInput(overrides?: Partial<TelemetryInput>): TelemetryInput {
	return {
		task_id: "task-001",
		run_id: "run-abc",
		step_id: "step-1",
		model: "openai/gpt-oss-20b",
		provider: "neuralwatt",
		usage: makeUsage(),
		energy: makeEnergy(),
		latency_ms: 1500,
		timestamp: 1700000000000,
		...overrides,
	};
}

describe("telemetry schema", () => {
	describe("buildTelemetryRecord", () => {
		it("should build a complete record from input", () => {
			const record = buildTelemetryRecord(makeInput());
			expect(record.task_id).toBe("task-001");
			expect(record.run_id).toBe("run-abc");
			expect(record.step_id).toBe("step-1");
			expect(record.model).toBe("openai/gpt-oss-20b");
			expect(record.provider).toBe("neuralwatt");
			expect(record.tokens.input).toBe(100);
			expect(record.tokens.output).toBe(50);
			expect(record.tokens.total).toBe(150);
			expect(record.latency_ms).toBe(1500);
			expect(record.energy_joules).toBe(0.42);
			expect(record.energy_kwh).toBe(0.000000116667);
			expect(record.timestamp).toBe(1700000000000);
		});

		it("should default energy to 0 when not provided", () => {
			const record = buildTelemetryRecord(makeInput({ energy: undefined }));
			expect(record.energy_joules).toBe(0);
			expect(record.energy_kwh).toBe(0);
		});

		it("should use Date.now() when timestamp not provided", () => {
			const before = Date.now();
			const record = buildTelemetryRecord(makeInput({ timestamp: undefined }));
			const after = Date.now();
			expect(record.timestamp).toBeGreaterThanOrEqual(before);
			expect(record.timestamp).toBeLessThanOrEqual(after);
		});
	});

	describe("serializeTelemetryRecord", () => {
		it("should serialize to a single JSON line", () => {
			const record = buildTelemetryRecord(makeInput());
			const line = serializeTelemetryRecord(record);
			expect(line).not.toContain("\n");
			const parsed = JSON.parse(line);
			expect(parsed.task_id).toBe("task-001");
			expect(parsed.tokens.input).toBe(100);
		});
	});

	describe("parseTelemetryRecord", () => {
		it("should round-trip through serialize/parse", () => {
			const original = buildTelemetryRecord(makeInput());
			const line = serializeTelemetryRecord(original);
			const parsed = parseTelemetryRecord(line);
			expect(parsed).toEqual(original);
		});

		it("should throw on invalid JSON", () => {
			expect(() => parseTelemetryRecord("not-json")).toThrow();
		});

		it("should throw on missing required fields", () => {
			expect(() => parseTelemetryRecord(JSON.stringify({ task_id: "x" }))).toThrow("Invalid TelemetryRecord");
		});

		it("should throw on wrong field types", () => {
			const bad = {
				task_id: "x",
				run_id: "y",
				step_id: "z",
				model: "m",
				provider: "p",
				tokens: { input: "not-number", output: 0, total: 0 },
				latency_ms: 0,
				energy_joules: 0,
				energy_kwh: 0,
				timestamp: 0,
			};
			expect(() => parseTelemetryRecord(JSON.stringify(bad))).toThrow("Invalid TelemetryRecord");
		});
	});

	describe("appendTelemetryLine", () => {
		it("should append serialized records to an array", () => {
			const lines: string[] = [];
			const r1 = buildTelemetryRecord(makeInput({ step_id: "step-1" }));
			const r2 = buildTelemetryRecord(makeInput({ step_id: "step-2" }));
			appendTelemetryLine(lines, r1);
			appendTelemetryLine(lines, r2);
			expect(lines.length).toBe(2);
			expect(JSON.parse(lines[0]).step_id).toBe("step-1");
			expect(JSON.parse(lines[1]).step_id).toBe("step-2");
		});
	});

	describe("parseTelemetryLines", () => {
		it("should parse JSONL content into records", () => {
			const r1 = buildTelemetryRecord(makeInput({ step_id: "step-1" }));
			const r2 = buildTelemetryRecord(makeInput({ step_id: "step-2" }));
			const content = [serializeTelemetryRecord(r1), serializeTelemetryRecord(r2)].join("\n");
			const records = parseTelemetryLines(content);
			expect(records.length).toBe(2);
			expect(records[0].step_id).toBe("step-1");
			expect(records[1].step_id).toBe("step-2");
		});

		it("should skip empty lines", () => {
			const r1 = buildTelemetryRecord(makeInput());
			const content = `\n${serializeTelemetryRecord(r1)}\n\n`;
			const records = parseTelemetryLines(content);
			expect(records.length).toBe(1);
		});

		it("should handle empty string", () => {
			const records = parseTelemetryLines("");
			expect(records.length).toBe(0);
		});
	});

	describe("schema contract", () => {
		it("should have all fields required by the benchmark runner", () => {
			const record = buildTelemetryRecord(makeInput());
			const requiredFields: (keyof TelemetryRecord)[] = [
				"task_id",
				"run_id",
				"step_id",
				"model",
				"provider",
				"tokens",
				"latency_ms",
				"energy_joules",
				"energy_kwh",
				"timestamp",
			];
			for (const field of requiredFields) {
				expect(record).toHaveProperty(field);
			}
		});

		it("should have tokens sub-fields", () => {
			const record = buildTelemetryRecord(makeInput());
			expect(record.tokens).toHaveProperty("input");
			expect(record.tokens).toHaveProperty("output");
			expect(record.tokens).toHaveProperty("total");
		});
	});
});
