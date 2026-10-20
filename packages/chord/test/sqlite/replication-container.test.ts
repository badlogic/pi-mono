import { crc32 as zlibCrc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
	type ContainerHeaderInput,
	crc32,
	decodeContainer,
	decodeContainerHeader,
	encodeContainer,
	NO_COMPRESSION,
	ReplicationFormatError,
	validateHeader,
} from "../../src/sqlite/replication/container.ts";
import { ZSTD_COMPRESSION } from "../../src/sqlite/replication/zstd.ts";

const PAGE = 4096;

function sqliteLikePage(seed: number): Uint8Array {
	// Mostly structured text with some noise, roughly like a B-tree leaf of transcript rows.
	const text = new TextEncoder().encode(`{"role":"assistant","content":"row ${seed} `.repeat(200));
	const page = new Uint8Array(PAGE);
	page.set(text.subarray(0, PAGE));
	for (let index = 0; index < 64; index++) page[(index * 61 + seed) % PAGE] = (index * seed) & 0xff;
	return page;
}

const segment: ContainerHeaderInput = {
	version: 1,
	kind: "segment",
	replicaId: "82c89986-434b-4171-9c85-d1ee6a847a00",
	epoch: 2,
	fromSeq: 121,
	toSeq: 133,
	pageSize: PAGE,
	dbPageCount: 622,
	preChecksum: "9f3a0c71d2e45b80",
	postChecksum: "41b7e2a90c3d6f15",
};

const pages = new Map([
	[12, sqliteLikePage(12)],
	[1, sqliteLikePage(1)],
	[600, sqliteLikePage(600)],
]);

describe("segment and base container", () => {
	it("round-trips segments with and without compression", () => {
		for (const compression of [NO_COMPRESSION, ZSTD_COMPRESSION]) {
			const bytes = encodeContainer(segment, pages, compression);
			const decoded = decodeContainer(bytes);
			expect(decoded.header).toEqual({ ...segment, pageCount: 3, compression: compression.name });
			expect(decoded.index.map((entry) => entry.pageNo)).toEqual([1, 12, 600]);
			const restored = decoded.pages(compression);
			expect([...restored.keys()]).toEqual([1, 12, 600]);
			for (const [pageNo, page] of pages) expect(Buffer.from(restored.get(pageNo) ?? [])).toEqual(Buffer.from(page));
		}
		const compressed = encodeContainer(segment, pages, ZSTD_COMPRESSION);
		expect(compressed.length).toBeLessThan(encodeContainer(segment, pages, NO_COMPRESSION).length / 2);
	});

	it("encodes deterministically, with the header first and keys in a fixed order", () => {
		const reordered = { ...segment, postChecksum: segment.postChecksum, replicaId: segment.replicaId };
		const first = encodeContainer(segment, pages, ZSTD_COMPRESSION);
		const second = encodeContainer(reordered, new Map([...pages].reverse()), ZSTD_COMPRESSION);
		expect(Buffer.from(second)).toEqual(Buffer.from(first));
		const text = new TextDecoder().decode(first.subarray(0, 400));
		expect(text.startsWith("PISYNC01")).toBe(true);
		expect(text).toContain(
			'{"version":1,"kind":"segment","replicaId":"82c89986-434b-4171-9c85-d1ee6a847a00","epoch":2,"fromSeq":121,' +
				'"toSeq":133,"pageSize":4096,"dbPageCount":622,"preChecksum":"9f3a0c71d2e45b80",' +
				'"postChecksum":"41b7e2a90c3d6f15","pageCount":3,"compression":"zstd"}',
		);
	});

	it("reads the header from a prefix, as a store validating an upload would", () => {
		const bytes = encodeContainer(segment, pages, ZSTD_COMPRESSION);
		expect(decodeContainerHeader(bytes.subarray(0, 300))).toMatchObject({ kind: "segment", fromSeq: 121 });
		expect(() => decodeContainerHeader(bytes.subarray(0, 40))).toThrow("Container header is truncated");
		expect(() => decodeContainerHeader(new TextEncoder().encode("PK\u0003\u0004 not ours"))).toThrow(
			"Not a replication container",
		);
	});

	it("allows reading one page from the footer and index alone", () => {
		const bytes = encodeContainer(segment, pages, ZSTD_COMPRESSION);
		const view = new DataView(bytes.buffer);
		const indexOffset = Number(view.getBigUint64(bytes.length - 12, true));
		const index = bytes.subarray(indexOffset, bytes.length - 12);
		const entries = new DataView(index.buffer, index.byteOffset, index.byteLength);
		// Second entry: page 12.
		expect(entries.getUint32(16, true)).toBe(12);
		const offset = Number(entries.getBigUint64(20, true));
		const length = entries.getUint32(28, true);
		const page = ZSTD_COMPRESSION.decompress(bytes.subarray(offset, offset + length), PAGE);
		expect(Buffer.from(page)).toEqual(Buffer.from(sqliteLikePage(12)));
	});

	it("round-trips a base, which must hold every page", () => {
		const base: ContainerHeaderInput = {
			version: 1,
			kind: "base",
			replicaId: "r1",
			epoch: 1,
			seq: 0,
			pageSize: PAGE,
			dbPageCount: 3,
			checksum: "0000000000000abc",
		};
		const all = new Map([1, 2, 3].map((pageNo) => [pageNo, sqliteLikePage(pageNo)]));
		const decoded = decodeContainer(encodeContainer(base, all, ZSTD_COMPRESSION));
		expect(decoded.header).toEqual({ ...base, pageCount: 3, compression: "zstd" });
		expect(decoded.pages(ZSTD_COMPRESSION).size).toBe(3);

		all.delete(2);
		expect(() => encodeContainer({ ...base, dbPageCount: 3 }, all, NO_COMPRESSION)).toThrow(
			"A base must contain every page of the database",
		);
		expect(() => encodeContainer({ ...base, dbPageCount: 2 }, all, NO_COMPRESSION)).toThrow(
			"A base must contain every page from 1 to 2",
		);
	});

	it("rejects pages that do not fit the header", () => {
		expect(() => encodeContainer(segment, new Map([[1, new Uint8Array(100)]]), NO_COMPRESSION)).toThrow(
			"Page 1 is 100 bytes, not 4096",
		);
		expect(() => encodeContainer(segment, new Map([[623, sqliteLikePage(1)]]), NO_COMPRESSION)).toThrow(
			"Page 623 is outside a database of 622 pages",
		);
		expect(() => encodeContainer(segment, new Map(), NO_COMPRESSION)).toThrow("at least one page");
	});

	it("detects corruption and a mismatched compressor", () => {
		const bytes = encodeContainer(segment, pages, ZSTD_COMPRESSION);
		for (const position of [3, 30, 400, bytes.length - 20, bytes.length - 2]) {
			const corrupted = bytes.slice();
			corrupted[position] = (corrupted[position] ?? 0) ^ 1;
			expect(() => decodeContainer(corrupted)).toThrow(ReplicationFormatError);
		}
		expect(() => decodeContainer(bytes.subarray(0, bytes.length - 1))).toThrow("CRC");
		expect(() => decodeContainer(bytes).pages(NO_COMPRESSION)).toThrow("Container uses zstd, not none");
	});

	it("validates header fields", () => {
		const valid = { ...segment, pageCount: 1, compression: "none" };
		expect(validateHeader({ ...valid, unknownField: true })).toEqual(valid);
		const invalid: [Record<string, unknown>, string][] = [
			[{ ...valid, version: 2 }, "Unsupported container version 2"],
			[{ ...valid, kind: "snapshot" }, "Unknown container kind"],
			[{ ...valid, replicaId: "has/slash" }, "not a valid replica id"],
			[{ ...valid, replicaId: "" }, "not a valid replica id"],
			[{ ...valid, epoch: 0 }, "epoch must be an integer of at least 1"],
			[{ ...valid, fromSeq: 1.5 }, "fromSeq must be an integer"],
			[{ ...valid, toSeq: 120 }, "toSeq must be an integer of at least 121"],
			[{ ...valid, pageSize: 3000 }, "Invalid page size 3000"],
			[{ ...valid, pageSize: 131072 }, "Invalid page size 131072"],
			[{ ...valid, preChecksum: "ABCDEF0123456789" }, "preChecksum must be 16 lowercase hex digits"],
			[{ ...valid, compression: "gzip" }, "Unsupported page compression"],
			[{ ...valid, pageCount: 700 }, "more pages than the database"],
			[{ ...valid, toSeq: Number.MAX_SAFE_INTEGER + 2 }, "toSeq must be an integer"],
		];
		for (const [header, message] of invalid) {
			expect(() => validateHeader(header), message).toThrow(message);
		}
		expect(() => validateHeader(null)).toThrow("not an object");
		expect(() => validateHeader([])).toThrow("not an object");
	});

	it("computes the same CRC-32 as zlib", () => {
		for (const bytes of [new Uint8Array(), new TextEncoder().encode("PISYNC01"), sqliteLikePage(3)]) {
			expect(crc32(bytes)).toBe(zlibCrc32(bytes));
		}
	});
});
