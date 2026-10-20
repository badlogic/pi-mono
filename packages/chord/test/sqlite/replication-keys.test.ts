import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	baseKey,
	decodeStartMarker,
	encodeStartMarker,
	parseObjectKey,
	segmentKey,
	startMarkerKey,
} from "../../src/sqlite/replication/keys.ts";

describe("replication object keys", () => {
	it("zero-pads numbers so lexical order is numeric order", () => {
		expect(segmentKey(2, 121)).toBe("epochs/0000000000000002/segments/0000000000000121");
		expect(baseKey(0, 1)).toBe("bases/0000000000000000-0000000000000001");
		expect(startMarkerKey(8)).toBe("epochs/0000000000000008/start");
		const keys = [9, 10, 100, 2, Number.MAX_SAFE_INTEGER].map((seq) => segmentKey(1, seq));
		expect([...keys].sort()).toEqual([2, 9, 10, 100, Number.MAX_SAFE_INTEGER].map((seq) => segmentKey(1, seq)));
	});

	it("parses the keys it writes and nothing else", () => {
		expect(parseObjectKey(segmentKey(2, 121))).toEqual({ type: "segment", epoch: 2, fromSeq: 121 });
		expect(parseObjectKey(baseKey(120, 2))).toEqual({ type: "base", seq: 120, epoch: 2 });
		expect(parseObjectKey(startMarkerKey(3))).toEqual({ type: "start", epoch: 3 });
		for (const key of [
			"epochs/2/segments/121",
			"epochs/0000000000000000/start",
			"epochs/0000000000000001/segments/0000000000000000",
			"bases/0000000000000001-0000000000000000",
			"epochs/9999999999999999/start",
			"epochs/0000000000000001/start/extra",
			"other",
		]) {
			expect(parseObjectKey(key), key).toBeUndefined();
		}
	});

	it("refuses numbers a key cannot hold", () => {
		expect(() => segmentKey(0, 1)).toThrow("epoch must be an integer of at least 1");
		expect(() => segmentKey(1, 0)).toThrow("fromSeq must be an integer of at least 1");
		expect(() => baseKey(-1, 1)).toThrow("seq must be an integer of at least 0");
		expect(() => startMarkerKey(1.5)).toThrow("epoch must be an integer");
	});

	it("round-trips start markers", () => {
		const bytes = encodeStartMarker({ version: 1, epoch: 8, startSeq: 121 });
		expect(new TextDecoder().decode(bytes)).toBe('{"version":1,"epoch":8,"startSeq":121}');
		expect(decodeStartMarker(bytes)).toEqual({ version: 1, epoch: 8, startSeq: 121 });
		const invalid = ['{"version":2,"epoch":8,"startSeq":121}', '{"version":1,"epoch":0,"startSeq":1}', "null", "{"];
		for (const text of invalid) expect(() => decodeStartMarker(new TextEncoder().encode(text)), text).toThrow();
	});
});

describe("portable replication modules", () => {
	it("do not import Node modules", async () => {
		// The portable entry point runs in Workers and browsers; only the Node entry point may use node:*.
		const directory = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/sqlite/replication");
		const visited = new Set<string>();
		const violations: string[] = [];
		const visit = async (file: string): Promise<void> => {
			if (visited.has(file)) return;
			visited.add(file);
			const source = await readFile(file, "utf8");
			for (const [, specifier = ""] of source.matchAll(/(?:import|export)[^;]*?from\s*["']([^"']+)["']/gu)) {
				if (specifier.startsWith(".")) await visit(resolve(dirname(file), specifier));
				else violations.push(`${file}: ${specifier}`);
			}
		};
		await visit(resolve(directory, "index.ts"));
		expect(violations).toEqual([]);
		expect(visited.size).toBeGreaterThan(4);
	});
});
