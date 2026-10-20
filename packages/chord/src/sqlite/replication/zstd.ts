import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import type { PageCompression } from "./container.ts";

/** Higher levels gain under one point on p2 sessions and cost several times the CPU. */
const LEVEL = 3;

/** Per-page zstd from `node:zlib` (Node 22.15 and later). Node only. */
export const ZSTD_COMPRESSION: PageCompression = {
	name: "zstd",
	compress: (page) => zstdCompressSync(page, { params: { [constants.ZSTD_c_compressionLevel]: LEVEL } }),
	decompress: (blob, pageSize) => zstdDecompressSync(blob, { maxOutputLength: pageSize }),
};
