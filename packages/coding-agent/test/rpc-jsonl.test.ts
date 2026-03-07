import { Readable } from "node:stream";
import { describe, expect, test } from "vitest";
import { attachLfLineReader, serializeRpcJsonLine } from "../src/modes/rpc/jsonl.js";

describe("RPC JSONL framing", () => {
	test("escapes U+2028 and U+2029 in serialized output", () => {
		const line = serializeRpcJsonLine({ text: "a\u2028b\u2029c" });

		expect(line).toContain("\\u2028");
		expect(line).toContain("\\u2029");
		expect(line).not.toContain("a\u2028b");
		expect(line.endsWith("\n")).toBe(true);

		const parsed = JSON.parse(line.trim()) as { text: string };
		expect(parsed.text).toBe("a\u2028b\u2029c");
	});

	test("splits on LF only and preserves U+2028 inside JSON payloads", async () => {
		const lines: string[] = [];
		const stream = Readable.from([serializeRpcJsonLine({ text: "a\u2028b" })]);

		const done = new Promise<void>((resolve) => {
			stream.on("end", resolve);
		});

		attachLfLineReader(stream, (line) => {
			lines.push(line);
		});

		await done;

		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0])).toEqual({ text: "a\u2028b" });
	});

	test("handles CRLF-delimited input", async () => {
		const lines: string[] = [];
		const stream = Readable.from([Buffer.from('{"a":1}\r\n{"b":2}\r\n')]);

		const done = new Promise<void>((resolve) => {
			stream.on("end", resolve);
		});

		attachLfLineReader(stream, (line) => {
			lines.push(line);
		});

		await done;

		expect(lines).toEqual(['{"a":1}', '{"b":2}']);
	});
});
