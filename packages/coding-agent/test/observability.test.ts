import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT_CONTEXT, trace } from "@opentelemetry/api";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readObservabilityConfig } from "../src/core/observability/config.ts";
import { JsonlSpanExporter } from "../src/core/observability/exporters.ts";

describe("readObservabilityConfig", () => {
	it("is disabled unless PI_OBSERVABILITY is set", () => {
		expect(readObservabilityConfig({}, "/agent").enabled).toBe(false);
		expect(readObservabilityConfig({ PI_OBSERVABILITY: "1" }, "/agent").enabled).toBe(true);
		expect(readObservabilityConfig({ PI_OBSERVABILITY: "TRUE" }, "/agent").enabled).toBe(true);
		expect(readObservabilityConfig({ PI_OBSERVABILITY: "0" }, "/agent").enabled).toBe(false);
	});

	it("defaults to the agent directory and to content capture off", () => {
		const config = readObservabilityConfig({ PI_OBSERVABILITY: "1" }, "/agent");
		expect(config.dir).toBe(join("/agent", "telemetry"));
		expect(config.content).toBe("off");
	});

	it("honors an explicit directory and falls back to off for unknown content modes", () => {
		const config = readObservabilityConfig(
			{ PI_OBSERVABILITY: "1", PI_OBSERVABILITY_DIR: "/tmp/spans", PI_OBSERVABILITY_CONTENT: "everything" },
			"/agent",
		);
		expect(config.dir).toBe("/tmp/spans");
		expect(config.content).toBe("off");
	});
});

describe("JsonlSpanExporter", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-observability-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("writes one JSON line per span with parent linkage and attributes", () => {
		const provider = new BasicTracerProvider({
			spanProcessors: [new SimpleSpanProcessor(new JsonlSpanExporter(dir))],
		});
		const tracer = provider.getTracer("test");

		const parent = tracer.startSpan("session.run", { attributes: { "pi.model.id": "model-a" } });
		const child = tracer.startSpan("turn", {}, trace.setSpan(ROOT_CONTEXT, parent));
		child.end();
		parent.end();

		const files = readdirSync(dir).filter((name) => name.startsWith("spans-"));
		expect(files).toHaveLength(1);
		const records = readFileSync(join(dir, files[0]), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(records).toHaveLength(2);

		const turn = records.find((record) => record.name === "turn");
		const run = records.find((record) => record.name === "session.run");
		expect(turn?.parentSpanId).toBe(run?.spanId);
		expect(run?.parentSpanId).toBeNull();
		expect(run?.attributes).toEqual({ "pi.model.id": "model-a" });
		expect(String(run?.startTimeUnixNano)).toMatch(/^\d{19}$/);
	});
});
