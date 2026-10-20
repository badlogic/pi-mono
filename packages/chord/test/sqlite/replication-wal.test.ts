import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	parseWalHeader,
	scanWal,
	WAL_FRAME_HEADER_BYTES,
	WAL_HEADER_BYTES,
	type WalHeader,
	type WalPosition,
	walStart,
} from "../../src/sqlite/replication/wal.ts";

/** Apply scanned pages to a database image the way a checkpoint does: newest page wins, then truncate. */
function applyPages(image: Uint8Array, pages: ReadonlyMap<number, Uint8Array>, pageSize: number, dbPageCount: number) {
	const result = new Uint8Array(dbPageCount * pageSize);
	result.set(image.subarray(0, Math.min(image.length, result.length)));
	for (const [pageNo, page] of pages) result.set(page, (pageNo - 1) * pageSize);
	return result;
}

function header(wal: Uint8Array): WalHeader {
	const parsed = parseWalHeader(wal);
	if (parsed === undefined) throw new Error("WAL has no valid header");
	return parsed;
}

function scanFrom(wal: Uint8Array, from: WalPosition) {
	return scanWal(header(wal), wal.subarray(from.offset), from);
}

/** A WAL built by hand, for byte orders and shapes SQLite on this machine does not produce. */
function syntheticWal(
	bigEndian: boolean,
	pageSize: number,
	frames: readonly { pageNo: number; commitSize: number; fill: number }[],
) {
	const checksum = (bytes: Uint8Array, s: [number, number]): [number, number] => {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		let [s1, s2] = s;
		for (let offset = 0; offset < bytes.length; offset += 8) {
			s1 = (s1 + view.getUint32(offset, !bigEndian) + s2) >>> 0;
			s2 = (s2 + view.getUint32(offset + 4, !bigEndian) + s1) >>> 0;
		}
		return [s1, s2];
	};
	const bytes = new Uint8Array(WAL_HEADER_BYTES + frames.length * (WAL_FRAME_HEADER_BYTES + pageSize));
	const view = new DataView(bytes.buffer);
	view.setUint32(0, bigEndian ? 0x377f0683 : 0x377f0682);
	view.setUint32(4, 3007000);
	view.setUint32(8, pageSize);
	view.setUint32(12, 7);
	view.setUint32(16, 0x11111111);
	view.setUint32(20, 0x22222222);
	let s = checksum(bytes.subarray(0, 24), [0, 0]);
	view.setUint32(24, s[0]);
	view.setUint32(28, s[1]);
	frames.forEach((frame, index) => {
		const offset = WAL_HEADER_BYTES + index * (WAL_FRAME_HEADER_BYTES + pageSize);
		view.setUint32(offset, frame.pageNo);
		view.setUint32(offset + 4, frame.commitSize);
		view.setUint32(offset + 8, 0x11111111);
		view.setUint32(offset + 12, 0x22222222);
		bytes.fill(frame.fill, offset + WAL_FRAME_HEADER_BYTES, offset + WAL_FRAME_HEADER_BYTES + pageSize);
		s = checksum(bytes.subarray(offset, offset + 8), s);
		s = checksum(bytes.subarray(offset + WAL_FRAME_HEADER_BYTES, offset + WAL_FRAME_HEADER_BYTES + pageSize), s);
		view.setUint32(offset + 16, s[0]);
		view.setUint32(offset + 20, s[1]);
	});
	return bytes;
}

describe("WAL reader", () => {
	let directory: string;
	let path: string;
	let database: DatabaseSync;

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "chord-wal-"));
		path = join(directory, "replica.sqlite");
		database = new DatabaseSync(path);
		database.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0");
		database.exec("CREATE TABLE rows (id INTEGER PRIMARY KEY, value BLOB)");
		database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
	});

	afterEach(() => {
		if (database.isOpen) database.close();
		rmSync(directory, { recursive: true, force: true });
	});

	const insert = (count: number, size = 300) => {
		database.exec("BEGIN");
		for (let row = 0; row < count; row++)
			database.prepare("INSERT INTO rows (value) VALUES (randomblob(?))").run(size);
		database.exec("COMMIT");
	};
	const readWal = () => new Uint8Array(readFileSync(`${path}-wal`));

	it("treats an empty or missing header as no WAL", () => {
		expect(parseWalHeader(new Uint8Array())).toBeUndefined();
		expect(parseWalHeader(new Uint8Array(32))).toBeUndefined();
		insert(1);
		const wal = readWal();
		expect(parseWalHeader(wal)).toMatchObject({ pageSize: 4096, bigEndianChecksums: false });
		const corrupted = wal.slice(0, 32);
		corrupted[17] = (corrupted[17] ?? 0) ^ 1;
		expect(parseWalHeader(corrupted)).toBeUndefined();
	});

	it("reproduces the checkpointed database from the pages it scans", () => {
		const before = new Uint8Array(readFileSync(path));
		insert(40);
		database.exec("UPDATE rows SET value = randomblob(900) WHERE id % 3 = 0");
		insert(5, 5000);
		database.exec("DELETE FROM rows WHERE id % 2 = 0");

		const wal = readWal();
		const parsed = header(wal);
		const scan = scanWal(parsed, wal.subarray(WAL_HEADER_BYTES), walStart(parsed));
		expect(scan.transactions).toBe(4);
		expect(scan.end.offset).toBe(wal.length);

		database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		const after = new Uint8Array(readFileSync(path));
		expect(scan.dbPageCount * parsed.pageSize).toBe(after.length);
		expect(Buffer.from(applyPages(before, scan.pages, parsed.pageSize, scan.dbPageCount))).toEqual(
			Buffer.from(after),
		);
	});

	it("drops pages beyond the final size when the database shrinks", () => {
		insert(30, 4000);
		database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		const before = new Uint8Array(readFileSync(path));
		database.exec("DELETE FROM rows; VACUUM");
		const wal = readWal();
		const scan = scanFrom(wal, walStart(header(wal)));
		expect(scan.dbPageCount * 4096).toBeLessThan(before.length);
		expect([...scan.pages.keys()].every((pageNo) => pageNo <= scan.dbPageCount)).toBe(true);
		database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
		expect(Buffer.from(applyPages(before, scan.pages, 4096, scan.dbPageCount))).toEqual(readFileSync(path));
	});

	it("continues from where the previous scan ended", () => {
		insert(3);
		insert(3);
		const first = readWal();
		const firstScan = scanFrom(first, walStart(header(first)));
		expect(firstScan.transactions).toBe(2);

		insert(3);
		const second = readWal();
		const secondScan = scanFrom(second, firstScan.end);
		expect(secondScan.transactions).toBe(1);
		expect(secondScan.end.offset).toBe(second.length);

		const nothing = scanFrom(second, secondScan.end);
		expect(nothing).toMatchObject({ transactions: 0, dbPageCount: 0, end: secondScan.end });
		expect(nothing.pages.size).toBe(0);
	});

	it("stops at the last valid commit frame before a torn or uncommitted tail", () => {
		insert(3);
		const committed = readWal().length;
		insert(20, 2000);
		const wal = readWal();
		const frameBytes = WAL_FRAME_HEADER_BYTES + 4096;
		const start = walStart(header(wal));

		// A transaction cut short: its frames without the commit frame, then half a frame.
		for (const length of [wal.length - frameBytes, wal.length - frameBytes / 2, committed + frameBytes]) {
			const scan = scanFrom(wal.subarray(0, length), start);
			expect(scan.transactions).toBe(1);
			expect(scan.end.offset).toBe(committed);
		}

		// A flipped byte in the second transaction's last page fails its checksum.
		const corrupted = wal.slice();
		const last = wal.length - 1;
		corrupted[last] = (corrupted[last] ?? 0) ^ 0xff;
		expect(scanFrom(corrupted, start).end.offset).toBe(committed);
	});

	it("ignores frames left over from before the WAL restarted", () => {
		insert(20, 2000);
		insert(20, 2000);
		const longWal = statSync(`${path}-wal`).size;
		database.exec("PRAGMA wal_checkpoint(RESTART)");
		insert(1);
		const wal = readWal();
		// SQLite rewrote the WAL from the start with new salts; the old frames are still in the file.
		expect(wal.length).toBe(longWal);
		const scan = scanFrom(wal, walStart(header(wal)));
		expect(scan.transactions).toBe(1);
		expect(scan.end.offset).toBeLessThan(wal.length);
	});

	it("validates big-endian and little-endian checksums", () => {
		const frames = [
			{ pageNo: 1, commitSize: 0, fill: 1 },
			{ pageNo: 2, commitSize: 2, fill: 2 },
			{ pageNo: 2, commitSize: 0, fill: 3 },
			{ pageNo: 3, commitSize: 3, fill: 4 },
			{ pageNo: 1, commitSize: 0, fill: 5 },
		];
		for (const bigEndian of [true, false]) {
			const wal = syntheticWal(bigEndian, 512, frames);
			const parsed = header(wal);
			expect(parsed).toMatchObject({ bigEndianChecksums: bigEndian, checkpointSequence: 7, pageSize: 512 });
			const scan = scanWal(parsed, wal.subarray(WAL_HEADER_BYTES), walStart(parsed));
			expect(scan.transactions).toBe(2);
			expect(scan.dbPageCount).toBe(3);
			expect([...scan.pages].map(([pageNo, page]) => [pageNo, page[0]])).toEqual([
				[1, 1],
				[2, 3],
				[3, 4],
			]);
		}
		// The same bytes read with the other byte order do not validate.
		const wal = syntheticWal(true, 512, frames);
		const view = new DataView(wal.buffer);
		view.setUint32(0, 0x377f0682);
		expect(parseWalHeader(wal)).toBeUndefined();
	});
});
