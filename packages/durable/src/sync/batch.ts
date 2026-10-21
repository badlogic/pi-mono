import type { LogRecord } from "../types.ts";
import { decodeLogLines, encodeLogLine, LogFormatError } from "./lines.ts";

/**
 * A batch as uploaded: the log records after one sequence as gzip-compressed JSON lines. gzip, because
 * `CompressionStream` offers it in Node, Workers, and browsers alike, and a browser viewer reads batches too.
 */
export async function encodeBatch(records: readonly LogRecord[]): Promise<Uint8Array> {
	return transform(new TextEncoder().encode(records.map(encodeLogLine).join("")), new CompressionStream("gzip"));
}

export async function decodeBatch(bytes: Uint8Array): Promise<LogRecord[]> {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(
		await transform(bytes, new DecompressionStream("gzip")),
	);
	const { records, torn } = decodeLogLines(text);
	if (torn > 0) throw new LogFormatError("Batch ends inside a log line");
	return records;
}

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
	const output = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
	return new Uint8Array(await new Response(output).arrayBuffer());
}
