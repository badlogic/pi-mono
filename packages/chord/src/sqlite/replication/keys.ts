/**
 * Object keys within one replica's prefix, and start markers.
 *
 * ```text
 * epochs/{epoch}/start                    start marker, JSON
 * epochs/{epoch}/segments/{fromSeq}       one segment, created only if absent
 * bases/{seq}-{epoch}                     one base
 * ```
 *
 * Numbers are decimal, zero-padded to 16 digits, so lexical order is numeric order; 16 digits hold every safe integer.
 * Keys are relative: the store decides the prefix, for example `orgs/{org}/users/{user}/sessions/{replicaId}/`.
 */

const DIGITS = 16;
const NUMBER = `(\\d{${DIGITS}})`;
const SEGMENT = new RegExp(`^epochs/${NUMBER}/segments/${NUMBER}$`);
const START = new RegExp(`^epochs/${NUMBER}/start$`);
const BASE = new RegExp(`^bases/${NUMBER}-${NUMBER}$`);

export type ObjectKey =
	| { readonly type: "segment"; readonly epoch: number; readonly fromSeq: number }
	| { readonly type: "base"; readonly seq: number; readonly epoch: number }
	| { readonly type: "start"; readonly epoch: number };

/** The first seq an epoch owns; its existence fences the epoch before it. Written only by the lease authority. */
export type StartMarker = { readonly version: 1; readonly epoch: number; readonly startSeq: number };

function pad(name: string, value: number, minimum: number): string {
	if (!Number.isSafeInteger(value) || value < minimum) {
		throw new Error(`${name} must be an integer of at least ${minimum}, got ${value}`);
	}
	return String(value).padStart(DIGITS, "0");
}

export function segmentKey(epoch: number, fromSeq: number): string {
	return `epochs/${pad("epoch", epoch, 1)}/segments/${pad("fromSeq", fromSeq, 1)}`;
}

export function baseKey(seq: number, epoch: number): string {
	return `bases/${pad("seq", seq, 0)}-${pad("epoch", epoch, 1)}`;
}

export function startMarkerKey(epoch: number): string {
	return `epochs/${pad("epoch", epoch, 1)}/start`;
}

/** Parse a key written by the functions above. Anything else, including unpadded numbers, is `undefined`. */
export function parseObjectKey(key: string): ObjectKey | undefined {
	const number = (text: string | undefined): number => Number(text);
	let match = SEGMENT.exec(key);
	if (match !== null) {
		const [epoch, fromSeq] = [number(match[1]), number(match[2])];
		return epoch >= 1 && fromSeq >= 1 && Number.isSafeInteger(fromSeq) && Number.isSafeInteger(epoch)
			? { type: "segment", epoch, fromSeq }
			: undefined;
	}
	match = BASE.exec(key);
	if (match !== null) {
		const [seq, epoch] = [number(match[1]), number(match[2])];
		return epoch >= 1 && Number.isSafeInteger(seq) && Number.isSafeInteger(epoch)
			? { type: "base", seq, epoch }
			: undefined;
	}
	match = START.exec(key);
	if (match !== null) {
		const epoch = number(match[1]);
		return epoch >= 1 && Number.isSafeInteger(epoch) ? { type: "start", epoch } : undefined;
	}
	return undefined;
}

export function encodeStartMarker(marker: StartMarker): Uint8Array {
	pad("epoch", marker.epoch, 1);
	pad("startSeq", marker.startSeq, 1);
	return new TextEncoder().encode(JSON.stringify({ version: 1, epoch: marker.epoch, startSeq: marker.startSeq }));
}

export function decodeStartMarker(bytes: Uint8Array): StartMarker {
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	} catch {
		throw new Error("Start marker is not valid JSON");
	}
	const marker = value as Partial<Record<keyof StartMarker, unknown>> | null;
	const valid = (field: unknown): field is number =>
		typeof field === "number" && Number.isSafeInteger(field) && field >= 1;
	if (typeof marker !== "object" || marker === null || marker.version !== 1) {
		throw new Error("Start marker has an unsupported version");
	}
	if (!valid(marker.epoch) || !valid(marker.startSeq)) throw new Error("Start marker has an invalid epoch or seq");
	return { version: 1, epoch: marker.epoch, startSeq: marker.startSeq };
}
