/**
 * The encoding shared by segments and bases.
 *
 * A segment holds the newest version of every page changed by a run of transactions; a base holds every page of the
 * database at one seq. Both are immutable objects that a store keeps and readers apply to a database file, and both
 * use one container:
 *
 * ```text
 * offset  size  field
 * 0       8     magic: ASCII "PISYNC01"
 * 8       4     headerLength: u32, at most 65536
 * 12      n     header: UTF-8 JSON
 * 12+n    ...   page blobs, one per page, in ascending page number order
 * ...     16*k  page index: k entries of { pageNo: u32, offset: u64, length: u32 }
 * end-12  8     indexOffset: u64
 * end-4   4     crc32: IEEE CRC-32 of every byte before this field
 * ```
 *
 * All integers are little-endian, `k` is the header's `pageCount`, and index offsets are file offsets. The header comes
 * first so that a store can validate an upload from its first bytes; the index comes last so that a reader can fetch
 * one page with a suffix range request for the footer, one for the index and one for the page. Pages are compressed
 * one at a time for the same reason.
 *
 * Encoding is deterministic: the same header and pages produce the same bytes with the same compressor. A writer that
 * crashes after spooling a segment but before recording it re-encodes the same frames on restart, and the store
 * recognizes the repeated upload by its content hash. Headers therefore carry no timestamps, and keys are written in
 * a fixed order.
 *
 * This module does not compress. Callers pass a `PageCompression`; `NO_COMPRESSION` is built in, and the Node entry
 * point provides zstd from `node:zlib`. Reading headers and indexes never needs the compressor, so a Worker can
 * validate uploads without zstd.
 */

const MAGIC = new TextEncoder().encode("PISYNC01");
const MAGIC_BYTES = 8;
const PREFIX_BYTES = MAGIC_BYTES + 4;
const MAX_HEADER_BYTES = 65536;
const INDEX_ENTRY_BYTES = 16;
const FOOTER_BYTES = 12;

/** Largest encoded segment. A flush that would produce more becomes a base. */
export const MAX_SEGMENT_BYTES = 32 * 1024 * 1024;

/** How page blobs are stored. */
export interface PageCompression {
	readonly name: "zstd" | "none";
	compress(page: Uint8Array): Uint8Array;
	decompress(blob: Uint8Array, pageSize: number): Uint8Array;
}

/** Pages stored as they are. */
export const NO_COMPRESSION: PageCompression = {
	name: "none",
	compress: (page) => page,
	decompress: (blob) => blob,
};

type CommonHeader = {
	readonly version: 1;
	readonly replicaId: string;
	readonly epoch: number;
	readonly pageSize: number;
	readonly dbPageCount: number;
	readonly pageCount: number;
	readonly compression: "zstd" | "none";
};

/** The newest version of every page changed by transactions `fromSeq..toSeq`. Checksums are 16 hex digits. */
export type SegmentHeader = CommonHeader & {
	readonly kind: "segment";
	readonly fromSeq: number;
	readonly toSeq: number;
	readonly preChecksum: string;
	readonly postChecksum: string;
};

/** Every page of the database at `seq`. */
export type BaseHeader = CommonHeader & {
	readonly kind: "base";
	readonly seq: number;
	readonly checksum: string;
};

export type ContainerHeader = SegmentHeader | BaseHeader;

/** A header before encoding: `pageCount` and `compression` follow from the pages and the compressor. */
export type ContainerHeaderInput =
	| Omit<SegmentHeader, "pageCount" | "compression">
	| Omit<BaseHeader, "pageCount" | "compression">;

/** Where one page's blob lies in an encoded container. */
export type PageIndexEntry = { readonly pageNo: number; readonly offset: number; readonly length: number };

/** A container read from its complete bytes. */
export type DecodedContainer = {
	readonly header: ContainerHeader;
	readonly index: readonly PageIndexEntry[];
	/** Decompress every page, by page number. Throws if `compression` does not match the header. */
	pages(compression: PageCompression): Map<number, Uint8Array>;
};

/** Thrown for bytes that are not a valid container. */
export class ReplicationFormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ReplicationFormatError";
	}
}

/** Encode a segment or base. Pages may be given in any order; each must be exactly `pageSize` bytes. */
export function encodeContainer(
	input: ContainerHeaderInput,
	pages: ReadonlyMap<number, Uint8Array>,
	compression: PageCompression,
): Uint8Array {
	const header = validateHeader({ ...input, pageCount: pages.size, compression: compression.name });
	const pageNumbers = [...pages.keys()].sort((a, b) => a - b);
	if (header.kind === "base" && pageNumbers.some((pageNo, index) => pageNo !== index + 1)) {
		throw new ReplicationFormatError(`A base must contain every page from 1 to ${header.dbPageCount}`);
	}
	const blobs: Uint8Array[] = [];
	for (const pageNo of pageNumbers) {
		const page = pages.get(pageNo);
		if (page?.length !== header.pageSize) {
			throw new ReplicationFormatError(`Page ${pageNo} is ${page?.length} bytes, not ${header.pageSize}`);
		}
		if (pageNo > header.dbPageCount) {
			throw new ReplicationFormatError(`Page ${pageNo} is outside a database of ${header.dbPageCount} pages`);
		}
		blobs.push(compression.compress(page));
	}

	const headerBytes = new TextEncoder().encode(JSON.stringify(canonicalHeader(header)));
	if (headerBytes.length > MAX_HEADER_BYTES) throw new ReplicationFormatError("Container header is too large");
	const blobBytes = blobs.reduce((total, blob) => total + blob.length, 0);
	const indexOffset = PREFIX_BYTES + headerBytes.length + blobBytes;
	const total = indexOffset + pageNumbers.length * INDEX_ENTRY_BYTES + FOOTER_BYTES;
	const bytes = new Uint8Array(total);
	const view = new DataView(bytes.buffer);
	bytes.set(MAGIC, 0);
	view.setUint32(MAGIC_BYTES, headerBytes.length, true);
	bytes.set(headerBytes, PREFIX_BYTES);

	let offset = PREFIX_BYTES + headerBytes.length;
	let entry = indexOffset;
	pageNumbers.forEach((pageNo, index) => {
		const blob = blobs[index] ?? new Uint8Array();
		bytes.set(blob, offset);
		view.setUint32(entry, pageNo, true);
		view.setBigUint64(entry + 4, BigInt(offset), true);
		view.setUint32(entry + 12, blob.length, true);
		offset += blob.length;
		entry += INDEX_ENTRY_BYTES;
	});
	view.setBigUint64(total - FOOTER_BYTES, BigInt(indexOffset), true);
	view.setUint32(total - 4, crc32(bytes.subarray(0, total - 4)), true);
	return bytes;
}

/**
 * Read and validate the header from the first bytes of a container. `prefix` may be the whole object or just its
 * beginning; it must contain at least the magic, the length and the header. This is what a store uses to validate an
 * upload before accepting it.
 */
export function decodeContainerHeader(prefix: Uint8Array): ContainerHeader {
	if (prefix.length < PREFIX_BYTES || !MAGIC.every((byte, index) => prefix[index] === byte)) {
		throw new ReplicationFormatError("Not a replication container");
	}
	const headerLength = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getUint32(MAGIC_BYTES, true);
	if (headerLength > MAX_HEADER_BYTES) throw new ReplicationFormatError("Container header is too large");
	if (prefix.length < PREFIX_BYTES + headerLength) throw new ReplicationFormatError("Container header is truncated");
	let json: unknown;
	try {
		json = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(prefix.subarray(PREFIX_BYTES, PREFIX_BYTES + headerLength)),
		);
	} catch {
		throw new ReplicationFormatError("Container header is not valid JSON");
	}
	return validateHeader(json);
}

/** Decode a complete container, checking its CRC, header and index. Pages are decompressed on request. */
export function decodeContainer(bytes: Uint8Array): DecodedContainer {
	if (bytes.length < PREFIX_BYTES + FOOTER_BYTES) throw new ReplicationFormatError("Container is truncated");
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (crc32(bytes.subarray(0, bytes.length - 4)) !== view.getUint32(bytes.length - 4, true)) {
		throw new ReplicationFormatError("Container CRC does not match");
	}
	const header = decodeContainerHeader(bytes);
	const blobsStart = PREFIX_BYTES + view.getUint32(MAGIC_BYTES, true);
	const indexOffset = Number(view.getBigUint64(bytes.length - FOOTER_BYTES, true));
	const index = decodeIndex(bytes, indexOffset, bytes.length - FOOTER_BYTES, header.pageCount, blobsStart);
	if (header.kind === "base" && index.some((entry, position) => entry.pageNo !== position + 1)) {
		throw new ReplicationFormatError(`A base must contain every page from 1 to ${header.dbPageCount}`);
	}
	if (index.some((entry) => entry.pageNo > header.dbPageCount)) {
		throw new ReplicationFormatError("Container has a page outside the database");
	}
	return {
		header,
		index,
		pages(compression) {
			if (compression.name !== header.compression) {
				throw new ReplicationFormatError(`Container uses ${header.compression}, not ${compression.name}`);
			}
			const pages = new Map<number, Uint8Array>();
			for (const entry of index) {
				const page = compression.decompress(
					bytes.subarray(entry.offset, entry.offset + entry.length),
					header.pageSize,
				);
				if (page.length !== header.pageSize) {
					throw new ReplicationFormatError(`Page ${entry.pageNo} decompressed to ${page.length} bytes`);
				}
				pages.set(entry.pageNo, page);
			}
			return pages;
		},
	};
}

function decodeIndex(
	bytes: Uint8Array,
	indexOffset: number,
	indexEnd: number,
	pageCount: number,
	blobsStart: number,
): PageIndexEntry[] {
	if (indexOffset < blobsStart || indexEnd - indexOffset !== pageCount * INDEX_ENTRY_BYTES) {
		throw new ReplicationFormatError("Container index does not match its page count");
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const index: PageIndexEntry[] = [];
	let expectedOffset = blobsStart;
	for (let entry = indexOffset; entry < indexEnd; entry += INDEX_ENTRY_BYTES) {
		const pageNo = view.getUint32(entry, true);
		const offset = Number(view.getBigUint64(entry + 4, true));
		const length = view.getUint32(entry + 12, true);
		const previous = index.at(-1);
		if (pageNo === 0 || (previous !== undefined && pageNo <= previous.pageNo)) {
			throw new ReplicationFormatError("Container index is not in ascending page order");
		}
		if (offset !== expectedOffset || length === 0) {
			throw new ReplicationFormatError("Container index does not describe contiguous page blobs");
		}
		expectedOffset = offset + length;
		index.push({ pageNo, offset, length });
	}
	if (expectedOffset !== indexOffset) throw new ReplicationFormatError("Container page blobs do not end at the index");
	return index;
}

function canonicalHeader(header: ContainerHeader): Record<string, unknown> {
	const common = { version: header.version, kind: header.kind, replicaId: header.replicaId, epoch: header.epoch };
	const sizes = { pageSize: header.pageSize, dbPageCount: header.dbPageCount };
	const tail = { pageCount: header.pageCount, compression: header.compression };
	return header.kind === "segment"
		? {
				...common,
				fromSeq: header.fromSeq,
				toSeq: header.toSeq,
				...sizes,
				preChecksum: header.preChecksum,
				postChecksum: header.postChecksum,
				...tail,
			}
		: { ...common, seq: header.seq, ...sizes, checksum: header.checksum, ...tail };
}

const REPLICA_ID = /^[A-Za-z0-9._-]{1,128}$/;
const CHECKSUM = /^[0-9a-f]{16}$/;

/** Check a parsed header against the format rules. Unknown fields are ignored and dropped. */
export function validateHeader(value: unknown): ContainerHeader {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ReplicationFormatError("Container header is not an object");
	}
	const field = (name: string): unknown => (value as Record<string, unknown>)[name];
	const integer = (name: string, minimum: number): number => {
		const number = field(name);
		if (typeof number !== "number" || !Number.isSafeInteger(number) || number < minimum) {
			throw new ReplicationFormatError(`Container header field ${name} must be an integer of at least ${minimum}`);
		}
		return number;
	};
	const checksum = (name: string): string => {
		const text = field(name);
		if (typeof text !== "string" || !CHECKSUM.test(text)) {
			throw new ReplicationFormatError(`Container header field ${name} must be 16 lowercase hex digits`);
		}
		return text;
	};

	if (field("version") !== 1) throw new ReplicationFormatError(`Unsupported container version ${field("version")}`);
	const replicaId = field("replicaId");
	if (typeof replicaId !== "string" || !REPLICA_ID.test(replicaId)) {
		throw new ReplicationFormatError("Container header field replicaId is not a valid replica id");
	}
	const compression = field("compression");
	if (compression !== "zstd" && compression !== "none") {
		throw new ReplicationFormatError(`Unsupported page compression ${JSON.stringify(compression)}`);
	}
	const pageSize = integer("pageSize", 512);
	if (pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0) {
		throw new ReplicationFormatError(`Invalid page size ${pageSize}`);
	}
	const common: CommonHeader = {
		version: 1,
		replicaId,
		epoch: integer("epoch", 1),
		pageSize,
		dbPageCount: integer("dbPageCount", 0),
		pageCount: integer("pageCount", 0),
		compression,
	};
	if (common.pageCount > common.dbPageCount) {
		throw new ReplicationFormatError("Container has more pages than the database");
	}

	const kind = field("kind");
	if (kind === "segment") {
		const fromSeq = integer("fromSeq", 1);
		const toSeq = integer("toSeq", fromSeq);
		if (common.pageCount < 1) throw new ReplicationFormatError("A segment must contain at least one page");
		return {
			...common,
			kind,
			fromSeq,
			toSeq,
			preChecksum: checksum("preChecksum"),
			postChecksum: checksum("postChecksum"),
		};
	}
	if (kind === "base") {
		if (common.pageCount !== common.dbPageCount) {
			throw new ReplicationFormatError("A base must contain every page of the database");
		}
		return { ...common, kind, seq: integer("seq", 0), checksum: checksum("checksum") };
	}
	throw new ReplicationFormatError(`Unknown container kind ${JSON.stringify(kind)}`);
}

let crcTable: Uint32Array | undefined;

/** IEEE CRC-32, as in zlib. */
export function crc32(bytes: Uint8Array): number {
	if (crcTable === undefined) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}
