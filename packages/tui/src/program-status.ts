/**
 * Program Status Protocol (OSC 7501): a program tells the terminal whether it is idle, working,
 * blocked on the user, done, or failed. Root and hierarchical child records (via `id`) are supported.
 *
 * Spec: https://www.superlogical.com/rex/docs/build/program-status
 */

export interface ProgramStatus {
	/** `clear` removes the status instead of reporting one. */
	state: "idle" | "working" | "blocked" | "done" | "error" | "clear";
	/**
	 * Hierarchical record id (`segment("/"segment)*`, each segment `[A-Za-z0-9_.+-]{1,32}`,
	 * at most 8 levels / 128 bytes). Absent addresses the root record.
	 */
	id?: string;
	/** Stable program name, `[A-Za-z0-9_.+-]{1,32}`. Other values are omitted. */
	app?: string;
	/** What a blocked program waits for. Omitted for other states. */
	kind?: "permission" | "question" | "auth";
	/** One human-readable line. Control characters become spaces; longer text is cut to the spec limit. */
	message?: string;
}

/** Feature detection query. A supporting terminal replies with the same body. */
export const PROGRAM_STATUS_QUERY = "\x1b]7501;?\x1b\\";

/** The reply to {@link PROGRAM_STATUS_QUERY}. Later spec revisions may add pairs after the `?`. */
export function isProgramStatusReply(sequence: string): boolean {
	return /^\x1b\]7501;\?[^\x07\x1b]*(?:\x07|\x1b\\)$/.test(sequence);
}

const APP_PATTERN = /^[A-Za-z0-9_.+-]{1,32}$/;
const ID_SEGMENT = /^[A-Za-z0-9_.+-]{1,32}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]+/g;
/** Decoded `msg` limit. Its base64 encoding stays under the 2732-byte encoded limit. */
const MAX_MESSAGE_BYTES = 2048;
const MAX_ID_BYTES = 128;
const MAX_ID_DEPTH = 8;

/** True when `id` matches the OSC 7501 record-id grammar. */
export function isValidProgramStatusId(id: string): boolean {
	if (Buffer.byteLength(id, "utf8") > MAX_ID_BYTES) return false;
	const segments = id.split("/");
	if (segments.length === 0 || segments.length > MAX_ID_DEPTH) return false;
	return segments.every((segment) => ID_SEGMENT.test(segment));
}

function truncateUtf8(text: string, maxBytes: number): string {
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
	let bytes = 0;
	let end = 0;
	for (const char of text) {
		const size = Buffer.byteLength(char, "utf8");
		if (bytes + size > maxBytes) break;
		bytes += size;
		end += char.length;
	}
	return text.slice(0, end);
}

/** Encode a status report. Terminals discard reports whose text contains control characters, so they are replaced. */
export function formatProgramStatus(status: ProgramStatus): string {
	const pairs = [`state=${status.state}`];
	if (status.id !== undefined && isValidProgramStatusId(status.id)) pairs.push(`id=${status.id}`);
	if (status.app !== undefined && APP_PATTERN.test(status.app)) pairs.push(`app=${status.app}`);
	if (status.state === "blocked" && status.kind) pairs.push(`kind=${status.kind}`);
	const message = truncateUtf8((status.message ?? "").replace(CONTROL_CHARACTERS, " ").trim(), MAX_MESSAGE_BYTES);
	if (message) pairs.push(`msg=${Buffer.from(message, "utf8").toString("base64")}`);
	return `\x1b]7501;${pairs.join(":")}\x1b\\`;
}
