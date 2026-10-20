/**
 * Reading SQLite's write-ahead log (WAL) from outside SQLite.
 *
 * A WAL file is a 32-byte header followed by frames, each a 24-byte header plus one page. The last frame of a
 * transaction is its commit frame and records the database size in pages after the commit. Every frame carries the
 * header's two salts and a checksum that covers the header and every frame before it, so a reader can tell where the
 * valid log ends: at the first frame whose salts or checksum do not match. Frames past that point are either a
 * transaction still being written, a torn write, or leftovers from before the WAL was last restarted; SQLite
 * rewrites the file from the start after a checkpoint, with new salts, so old frames fail the salt check.
 *
 * `scanWal` reads forward from a known position and returns the committed transactions it found, as the newest version
 * of each page they wrote. It stops at the last valid commit frame, so a caller that remembers the returned `end`
 * position can call it again later and continue exactly where it stopped. It reads bytes it is given and never
 * touches files; the Node layer reads the WAL and passes the bytes in.
 *
 * Format reference: https://www.sqlite.org/fileformat2.html#walformat
 */

export const WAL_HEADER_BYTES = 32;
export const WAL_FRAME_HEADER_BYTES = 24;

const WAL_MAGIC = 0x377f0682;
const WAL_FORMAT_VERSION = 3007000;

/** The parsed header of a WAL file. */
export type WalHeader = {
	/** Checksums read the log as big-endian 32-bit words (magic `0x377f0683`) rather than little-endian ones. */
	readonly bigEndianChecksums: boolean;
	readonly pageSize: number;
	readonly checkpointSequence: number;
	readonly salt1: number;
	readonly salt2: number;
	readonly checksum1: number;
	readonly checksum2: number;
};

/**
 * A point in a WAL between frames: the file offset of the next frame and the cumulative checksum of everything before
 * it. A position is only meaningful together with the header (and so the salts) it was read under.
 */
export type WalPosition = {
	readonly offset: number;
	readonly checksum1: number;
	readonly checksum2: number;
};

/** What `scanWal` found between a start position and the last valid commit frame after it. */
export type WalScan = {
	/** Committed transactions found. 0 when nothing new was committed. */
	readonly transactions: number;
	/**
	 * The newest version of every page those transactions wrote, at most `dbPageCount`, by page number. Values are
	 * views into the bytes passed to `scanWal`.
	 */
	readonly pages: ReadonlyMap<number, Uint8Array>;
	/** Database size in pages after the last transaction, or 0 when there was none. */
	readonly dbPageCount: number;
	/** The position just after the last commit frame, or the start position when there was none. */
	readonly end: WalPosition;
};

/**
 * Parse a WAL header. Returns `undefined` when `bytes` is shorter than a header or the header is not valid (wrong
 * magic, version, page size or checksum), which is also how an empty or freshly truncated WAL looks.
 */
export function parseWalHeader(bytes: Uint8Array): WalHeader | undefined {
	if (bytes.length < WAL_HEADER_BYTES) return undefined;
	const view = new DataView(bytes.buffer, bytes.byteOffset, WAL_HEADER_BYTES);
	const magic = view.getUint32(0);
	if ((magic & ~1) !== WAL_MAGIC || view.getUint32(4) !== WAL_FORMAT_VERSION) return undefined;
	const pageSize = view.getUint32(8);
	if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0) return undefined;
	const bigEndianChecksums = (magic & 1) === 1;
	const [checksum1, checksum2] = walChecksum(bytes.subarray(0, 24), bigEndianChecksums, 0, 0);
	if (checksum1 !== view.getUint32(24) || checksum2 !== view.getUint32(28)) return undefined;
	return {
		bigEndianChecksums,
		pageSize,
		checkpointSequence: view.getUint32(12),
		salt1: view.getUint32(16),
		salt2: view.getUint32(20),
		checksum1,
		checksum2,
	};
}

/** The position of the first frame under `header`. */
export function walStart(header: WalHeader): WalPosition {
	return { offset: WAL_HEADER_BYTES, checksum1: header.checksum1, checksum2: header.checksum2 };
}

/**
 * Scan committed transactions from `from` to the last valid commit frame.
 *
 * `bytes` holds the WAL file from offset `from.offset` onwards, usually to its current end. Frames after the last
 * valid commit frame are ignored; a later scan from `end` reads them once their transaction has committed.
 *
 * Pages are kept by their newest version, and pages beyond the final database size are dropped, which is exactly how
 * SQLite itself reads the log: the newest frame of each page wins, and the size from the last commit applies.
 */
export function scanWal(header: WalHeader, bytes: Uint8Array, from: WalPosition): WalScan {
	const frameBytes = WAL_FRAME_HEADER_BYTES + header.pageSize;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const committed = new Map<number, Uint8Array>();
	const pending = new Map<number, Uint8Array>();
	let transactions = 0;
	let dbPageCount = 0;
	let end = from;
	let checksum1 = from.checksum1;
	let checksum2 = from.checksum2;

	for (let local = 0; local + frameBytes <= bytes.length; local += frameBytes) {
		const pageNo = view.getUint32(local);
		const commitSize = view.getUint32(local + 4);
		if (pageNo === 0 || view.getUint32(local + 8) !== header.salt1 || view.getUint32(local + 12) !== header.salt2) {
			break;
		}
		const page = bytes.subarray(local + WAL_FRAME_HEADER_BYTES, local + frameBytes);
		[checksum1, checksum2] = walChecksum(
			bytes.subarray(local, local + 8),
			header.bigEndianChecksums,
			checksum1,
			checksum2,
		);
		[checksum1, checksum2] = walChecksum(page, header.bigEndianChecksums, checksum1, checksum2);
		if (checksum1 !== view.getUint32(local + 16) || checksum2 !== view.getUint32(local + 20)) break;

		pending.set(pageNo, page);
		if (commitSize === 0) continue;
		for (const [number, data] of pending) committed.set(number, data);
		pending.clear();
		transactions++;
		dbPageCount = commitSize;
		end = { offset: from.offset + local + frameBytes, checksum1, checksum2 };
	}

	for (const pageNo of committed.keys()) {
		if (pageNo > dbPageCount) committed.delete(pageNo);
	}
	return { transactions, pages: committed, dbPageCount, end };
}

/**
 * SQLite's WAL checksum: Fibonacci-weighted sums over pairs of 32-bit words, continued from `s1` and `s2`. `bytes` must
 * be a multiple of 8 long, which headers, frame headers and pages all are.
 */
function walChecksum(bytes: Uint8Array, bigEndian: boolean, s1: number, s2: number): [number, number] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const littleEndian = !bigEndian;
	for (let offset = 0; offset < bytes.length; offset += 8) {
		s1 = (s1 + view.getUint32(offset, littleEndian) + s2) >>> 0;
		s2 = (s2 + view.getUint32(offset + 4, littleEndian) + s1) >>> 0;
	}
	return [s1, s2];
}
