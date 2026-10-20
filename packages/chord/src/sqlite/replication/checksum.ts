/**
 * Page hashes and the whole-database checksum.
 *
 * A reader applying segments must know that each segment fits the database it has, and that the result is what the
 * writer had. Hashing the whole file after every flush would cost time proportional to the database, so the checksum
 * is built to update in time proportional to the change instead:
 *
 * - The hash of page `p` with contents `b` is the first 8 bytes of SHA-256 over `p` as a big-endian u32 followed by
 *   `b`, read as a big-endian u64. Including the page number means two pages with equal contents hash differently.
 * - The database checksum is the XOR of the hashes of pages `1..dbPageCount`. An empty database has checksum 0.
 * - When page `p` changes, XOR out its old hash and XOR in the new one. When the database shrinks, XOR out the pages
 *   that went away. Neither needs the old page contents, only the old hashes, which the writer keeps in a sidecar
 *   file of 8 bytes per page.
 *
 * The checksum catches accidents such as a missing segment, a segment applied to the wrong database or a page written
 * to the wrong offset. It is not a defence against a malicious writer: XOR of truncated hashes is easy to forge on
 * purpose. Stores authenticate writers instead.
 *
 * SHA-256 comes from Web Crypto, which Node, browsers and Workers all have, so this module stays portable.
 */

/** Hash one page. */
export async function pageHash(pageNo: number, page: Uint8Array): Promise<bigint> {
	const input = new Uint8Array(4 + page.length);
	new DataView(input.buffer).setUint32(0, pageNo);
	input.set(page, 4);
	const digest = await crypto.subtle.digest("SHA-256", input);
	return new DataView(digest).getBigUint64(0);
}

/** Hash several pages, keyed like the input. */
export async function hashPages(pages: ReadonlyMap<number, Uint8Array>): Promise<Map<number, bigint>> {
	const entries = [...pages];
	const hashes = await Promise.all(entries.map(([pageNo, page]) => pageHash(pageNo, page)));
	return new Map(entries.map(([pageNo], index) => [pageNo, hashes[index] ?? 0n]));
}

/** A checksum as written in headers: 16 lowercase hex digits. */
export function formatChecksum(checksum: bigint): string {
	return checksum.toString(16).padStart(16, "0");
}

/** Parse a checksum written by `formatChecksum`. */
export function parseChecksum(text: string): bigint {
	if (!/^[0-9a-f]{16}$/.test(text)) throw new Error(`Invalid database checksum ${JSON.stringify(text)}`);
	return BigInt(`0x${text}`);
}

/**
 * The hash of every page of one database, and their XOR. This is the writer's sidecar and a restoring reader's
 * running state; both update it from the pages of each segment they produce or apply.
 */
export class PageHashes {
	private hashes: BigUint64Array;
	private count: number;
	private xor: bigint;

	private constructor(hashes: BigUint64Array, count: number) {
		this.hashes = hashes;
		this.count = count;
		let xor = 0n;
		for (let index = 0; index < count; index++) xor ^= hashes[index] ?? 0n;
		this.xor = xor;
	}

	/** The hashes of an empty database. */
	static empty(): PageHashes {
		return new PageHashes(new BigUint64Array(0), 0);
	}

	/** Hash every page of a complete database file. */
	static async fromDatabase(bytes: Uint8Array, pageSize: number): Promise<PageHashes> {
		if (bytes.length % pageSize !== 0) {
			throw new Error(`Database of ${bytes.length} bytes is not a whole number of ${pageSize}-byte pages`);
		}
		const pages = new Map<number, Uint8Array>();
		for (let offset = 0; offset < bytes.length; offset += pageSize) {
			pages.set(offset / pageSize + 1, bytes.subarray(offset, offset + pageSize));
		}
		const hashes = PageHashes.empty();
		hashes.apply(await hashPages(pages), pages.size);
		return hashes;
	}

	/** Read a sidecar written by `encode`: one little-endian u64 per page, page `p` at offset `(p - 1) * 8`. */
	static decode(bytes: Uint8Array): PageHashes {
		if (bytes.length % 8 !== 0) throw new Error(`Page hash file of ${bytes.length} bytes is not a multiple of 8`);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const count = bytes.length / 8;
		const hashes = new BigUint64Array(count);
		for (let index = 0; index < count; index++) hashes[index] = view.getBigUint64(index * 8, true);
		return new PageHashes(hashes, count);
	}

	/** Database size in pages. */
	get pageCount(): number {
		return this.count;
	}

	/** The database checksum. */
	get checksum(): bigint {
		return this.xor;
	}

	/** The hash of page `pageNo`, or `undefined` beyond the database. */
	hash(pageNo: number): bigint | undefined {
		return pageNo >= 1 && pageNo <= this.count ? this.hashes[pageNo - 1] : undefined;
	}

	/**
	 * Apply the pages of one segment: set the hash of every changed page, then resize to `dbPageCount`. Pages past
	 * `dbPageCount` must not be present. When the database grows, every new page must be among `pages`; SQLite writes
	 * every page it adds, and a page this database has never seen has no known contents to hash. A violation throws
	 * and leaves the hashes unchanged.
	 */
	apply(pages: ReadonlyMap<number, bigint>, dbPageCount: number): void {
		if (!Number.isSafeInteger(dbPageCount) || dbPageCount < 0) throw new Error(`Invalid page count ${dbPageCount}`);
		for (const pageNo of pages.keys()) {
			if (!Number.isSafeInteger(pageNo) || pageNo < 1 || pageNo > dbPageCount) {
				throw new Error(`Page ${pageNo} is outside a database of ${dbPageCount} pages`);
			}
		}
		for (let pageNo = this.count + 1; pageNo <= dbPageCount; pageNo++) {
			if (!pages.has(pageNo)) {
				throw new Error(`Database grew to ${dbPageCount} pages without page ${pageNo}`);
			}
		}

		for (let pageNo = dbPageCount + 1; pageNo <= this.count; pageNo++) this.xor ^= this.hashes[pageNo - 1] ?? 0n;
		if (dbPageCount > this.hashes.length) {
			const grown = new BigUint64Array(Math.max(dbPageCount, this.hashes.length * 2));
			grown.set(this.hashes.subarray(0, this.count));
			this.hashes = grown;
		} else if (dbPageCount < this.count) {
			this.hashes.fill(0n, dbPageCount, this.count);
		}
		const previousCount = this.count;
		this.count = dbPageCount;
		for (const [pageNo, hash] of pages) {
			if (pageNo <= previousCount) this.xor ^= this.hashes[pageNo - 1] ?? 0n;
			this.hashes[pageNo - 1] = hash;
			this.xor ^= hash;
		}
	}

	/** Write the sidecar format read by `decode`. */
	encode(): Uint8Array {
		const bytes = new Uint8Array(this.count * 8);
		const view = new DataView(bytes.buffer);
		for (let index = 0; index < this.count; index++) view.setBigUint64(index * 8, this.hashes[index] ?? 0n, true);
		return bytes;
	}

	/** An independent copy. */
	clone(): PageHashes {
		return new PageHashes(this.hashes.slice(0, this.count), this.count);
	}
}
