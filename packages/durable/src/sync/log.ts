import { seqFromNumber } from "../ids.ts";
import type { DocumentId, LogRecord, LogWrite } from "../types.ts";

/** Version of the log line envelope. It changes when a `LogWrite` variant is added, removed, or changes shape. */
export const LOG_VERSION = 1;

/**
 * A committed record as the local outbox keeps it. `currentOnly` lists the documents this record changes or retires
 * without creating them whose history is current-only, which compaction needs and the writes alone do not say.
 * Created documents describe themselves.
 */
export type OutboxRecord = LogRecord & {
	readonly currentOnly?: readonly DocumentId[];
};

type LogLine = {
	readonly v: typeof LOG_VERSION;
	readonly seq: number;
	readonly writes: readonly LogWrite[];
	readonly currentOnly?: readonly DocumentId[];
};

export class LogFormatError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "LogFormatError";
	}
}

/** One JSON line, terminated by a newline. */
export function encodeLogLine(record: OutboxRecord): string {
	const line: LogLine = {
		v: LOG_VERSION,
		seq: record.seq,
		writes: record.writes,
		...(record.currentOnly === undefined || record.currentOnly.length === 0
			? {}
			: { currentOnly: record.currentOnly }),
	};
	return `${JSON.stringify(line)}\n`;
}

/**
 * Decode JSON lines. A last line without its newline is a torn append and is returned as `torn` instead of a
 * record; anything else that does not decode is an error. A line of an unknown version is an error too: an older pi
 * must not replay writes it does not understand.
 */
export function decodeLogLines(text: string): { readonly records: OutboxRecord[]; readonly torn: number } {
	const records: OutboxRecord[] = [];
	let start = 0;
	let previous = 0;
	while (start < text.length) {
		const end = text.indexOf("\n", start);
		if (end === -1) return { records, torn: text.length - start };
		const record = decodeLine(text.slice(start, end), records.length + 1);
		if (record.seq <= previous)
			throw new LogFormatError(`Log line ${records.length + 1} does not increase the sequence`);
		previous = record.seq;
		records.push(record);
		start = end + 1;
	}
	return { records, torn: 0 };
}

function decodeLine(text: string, number: number): OutboxRecord {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new LogFormatError(`Log line ${number} is not JSON`, { cause: error });
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new LogFormatError(`Log line ${number} is not an object`);
	}
	const line = value as Partial<LogLine> & { readonly v?: unknown };
	if (line.v !== LOG_VERSION) throw new LogFormatError(`Log line ${number} has unknown version ${String(line.v)}`);
	if (typeof line.seq !== "number" || !Number.isSafeInteger(line.seq) || line.seq < 1) {
		throw new LogFormatError(`Log line ${number} has no valid sequence`);
	}
	if (!Array.isArray(line.writes)) throw new LogFormatError(`Log line ${number} has no writes`);
	for (const write of line.writes as readonly { readonly type?: unknown }[]) {
		if (!LOG_WRITE_TYPES.has(write?.type)) {
			throw new LogFormatError(`Log line ${number} has a write of unknown type ${String(write?.type)}`);
		}
	}
	return {
		seq: seqFromNumber(line.seq),
		writes: line.writes,
		...(line.currentOnly === undefined ? {} : { currentOnly: line.currentOnly }),
	};
}

const LOG_WRITE_TYPES: ReadonlySet<unknown> = new Set<LogWrite["type"]>([
	"conversation",
	"entry",
	"task",
	"submission",
	"document.create",
	"document.change",
	"document.retire",
]);
