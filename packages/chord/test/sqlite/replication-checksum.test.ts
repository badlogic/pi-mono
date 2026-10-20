import { describe, expect, it } from "vitest";
import {
	formatChecksum,
	hashPages,
	PageHashes,
	pageHash,
	parseChecksum,
} from "../../src/sqlite/replication/checksum.ts";

const PAGE = 512;
const page = (fill: number) => new Uint8Array(PAGE).fill(fill);

function image(fills: readonly number[]): Uint8Array {
	const bytes = new Uint8Array(fills.length * PAGE);
	for (const [index, fill] of fills.entries()) bytes.fill(fill, index * PAGE, (index + 1) * PAGE);
	return bytes;
}

describe("page hashes and database checksum", () => {
	it("hashes the page number together with the contents", async () => {
		const contents = page(7);
		expect(await pageHash(1, contents)).not.toBe(await pageHash(2, contents));
		expect(await pageHash(1, contents)).toBe(await pageHash(1, page(7)));
		// The first 8 bytes of SHA-256(u32be pageNo || page), read big-endian.
		const input = new Uint8Array([0, 0, 0, 1, ...contents]);
		const digest = new DataView(await crypto.subtle.digest("SHA-256", input));
		expect(await pageHash(1, contents)).toBe(digest.getBigUint64(0));
	});

	it("formats checksums as 16 hex digits", () => {
		expect(formatChecksum(0n)).toBe("0000000000000000");
		expect(formatChecksum(0xfedcba9876543210n)).toBe("fedcba9876543210");
		expect(parseChecksum("00000000000000ff")).toBe(255n);
		for (const invalid of ["ff", "FEDCBA9876543210", "0000000000000000 ", "zzzzzzzzzzzzzzzz"]) {
			expect(() => parseChecksum(invalid)).toThrow("Invalid database checksum");
		}
	});

	it("updates incrementally to the checksum of the whole database", async () => {
		const hashes = PageHashes.empty();
		expect(hashes.checksum).toBe(0n);
		hashes.apply(await hashPages(new Map([1, 2, 3, 4].map((pageNo) => [pageNo, page(pageNo)]))), 4);
		expect(hashes.checksum).toBe((await PageHashes.fromDatabase(image([1, 2, 3, 4]), PAGE)).checksum);

		// Change one page and grow by one.
		hashes.apply(
			await hashPages(
				new Map([
					[2, page(9)],
					[5, page(5)],
				]),
			),
			5,
		);
		expect(hashes.checksum).toBe((await PageHashes.fromDatabase(image([1, 9, 3, 4, 5]), PAGE)).checksum);

		// Shrink, changing a remaining page in the same step.
		hashes.apply(await hashPages(new Map([[1, page(8)]])), 2);
		expect(hashes.pageCount).toBe(2);
		expect(hashes.hash(3)).toBeUndefined();
		expect(hashes.checksum).toBe((await PageHashes.fromDatabase(image([8, 9]), PAGE)).checksum);

		// Grow again into slots that held hashes before the shrink.
		hashes.apply(
			await hashPages(
				new Map([
					[3, page(3)],
					[4, page(6)],
				]),
			),
			4,
		);
		expect(hashes.checksum).toBe((await PageHashes.fromDatabase(image([8, 9, 3, 6]), PAGE)).checksum);
	});

	it("refuses pages it cannot account for and stays unchanged", async () => {
		const hashes = await PageHashes.fromDatabase(image([1, 2]), PAGE);
		const before = hashes.checksum;
		await expect(async () => hashes.apply(await hashPages(new Map([[4, page(4)]])), 4)).rejects.toThrow(
			"Database grew to 4 pages without page 3",
		);
		await expect(async () => hashes.apply(await hashPages(new Map([[3, page(3)]])), 2)).rejects.toThrow(
			"Page 3 is outside a database of 2 pages",
		);
		expect(hashes.checksum).toBe(before);
		expect(hashes.pageCount).toBe(2);
	});

	it("round-trips the sidecar file", async () => {
		const hashes = await PageHashes.fromDatabase(image([1, 2, 3]), PAGE);
		const encoded = hashes.encode();
		expect(encoded.length).toBe(24);
		const view = new DataView(encoded.buffer);
		expect(view.getBigUint64(8, true)).toBe(hashes.hash(2));
		const decoded = PageHashes.decode(encoded);
		expect(decoded.checksum).toBe(hashes.checksum);
		expect(decoded.pageCount).toBe(3);
		expect(() => PageHashes.decode(new Uint8Array(7))).toThrow("not a multiple of 8");

		const copy = hashes.clone();
		copy.apply(new Map([[1, 1n]]), 1);
		expect(hashes.pageCount).toBe(3);
	});

	it("refuses a database that is not whole pages", async () => {
		await expect(PageHashes.fromDatabase(new Uint8Array(PAGE + 1), PAGE)).rejects.toThrow("whole number");
	});
});
