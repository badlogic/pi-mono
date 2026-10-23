import type { Context } from "@earendil-works/chord";
import type { AssistantMessage, Message, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import { idFromNumber } from "../ids.ts";
import type { SessionImpl } from "../session/session.ts";
import type { ContextEdit, ConversationId, Cursor, EntryId, EntryQuery, EntryRecord, Storage } from "../types.ts";
import type { ContextView } from "./types.ts";

const SCAN_PAGE_SIZE = 256;
const EXCLUDED_STOP_REASONS: ReadonlySet<AssistantMessage["stopReason"]> = new Set(["aborted", "error", "deferred"]);
const MISSING_RESULT_TEXT = "Tool result unavailable: history ends before this call completed.";

/** Head marker and newest visible entry that fix one committed context range. */
export type ContextBounds = {
	readonly head: (EntryRecord & { readonly head: EntryId }) | undefined;
	readonly tail: EntryId;
};

/**
 * Capture the bounds of the current context, or of the context cut off at the visible entry `at`, with two O(1)
 * reads. Run this on the Session line; entries at or below the tail are immutable, so `deriveContext()` can then scan
 * them off the line.
 */
export async function captureContextBounds(
	storage: Storage,
	conversationId: ConversationId,
	context: Context,
	at?: EntryId,
): Promise<ContextBounds | undefined> {
	let tail: EntryId | undefined;
	if (at === undefined) {
		tail = (await storage.scanEntries({ conversationId }, 1, undefined, context)).items[0]?.id;
		if (tail === undefined) return undefined;
	} else {
		if ((await storage.entry(conversationId, at, context)) === undefined) {
			throw new Error(`Entry ${at} is not visible from conversation ${conversationId}`);
		}
		tail = at;
	}
	return { head: await storage.findLatestHeadMarker(conversationId, tail, context), tail };
}

/**
 * One context read: the visible entries it scanned, from the head marker's head, or transcript start, through
 * `bounds.tail`, oldest first, and the view derived from them. Entries at or below the tail never change, so a later
 * read with the same head marker extends both.
 */
export type ContextRange = {
	readonly bounds: ContextBounds;
	readonly entries: readonly EntryRecord[];
	readonly view: ContextView;
	/** Targets of the edits in `entries`. */
	readonly edited: ReadonlySet<EntryId>;
	/**
	 * `view.messages` from the contributed messages before the last assistant message. Tool results are ordered within
	 * the messages up to the next assistant message, so later entries cannot change these.
	 */
	readonly settled: readonly Message[];
	/** Contributed messages from the last assistant message on, before tool result ordering. */
	readonly open: readonly Message[];
};

/**
 * `readContext()` that reuses `previous`, an earlier range of the same conversation: with the same head marker, only
 * entries after its tail are scanned. Returns the view and the range to pass to the next read. A range outlives the
 * read, so its entries are frozen like `MemoryStorage` records, and the returned view has its own arrays.
 */
export async function readContextFrom(
	session: SessionImpl,
	storage: Storage,
	conversationId: ConversationId,
	context: Context,
	at: EntryId | undefined,
	previous: ContextRange | undefined,
): Promise<{ readonly view: ContextView; readonly range: ContextRange | undefined }> {
	const bounds = await session.readOnLine(() => captureContextBounds(storage, conversationId, context, at));
	if (bounds === undefined) return { view: emptyView(), range: undefined };
	freezeJson(bounds.head);
	let range: ContextRange;
	if (previous === undefined || previous.bounds.head?.id !== bounds.head?.id) {
		range = deriveRange(bounds, freezeJson(await scanRange(storage, conversationId, rangeQuery(bounds), context)));
	} else if (bounds.tail === previous.bounds.tail) {
		range = previous;
	} else if (bounds.tail < previous.bounds.tail) {
		range = deriveRange(
			bounds,
			previous.entries.filter((entry) => entry.id <= bounds.tail),
		);
	} else {
		const minEntryId = idFromNumber<EntryId>(previous.bounds.tail + 1);
		const added = await scanRange(storage, conversationId, { minEntryId, maxEntryId: bounds.tail }, context);
		range = extendRange(previous, bounds, freezeJson(added));
	}
	const { view } = range;
	return {
		view: {
			...view,
			entries: [...view.entries],
			contributions: [...view.contributions],
			messages: [...view.messages],
		},
		range,
	};
}

/** Committed context of one conversation: bounds captured on the Session line, entries derived off it. */
export async function readContext(
	session: SessionImpl,
	storage: Storage,
	conversationId: ConversationId,
	context: Context,
	at?: EntryId,
): Promise<ContextView> {
	const bounds = await session.readOnLine(() => captureContextBounds(storage, conversationId, context, at));
	return deriveContext(storage, conversationId, bounds, context);
}

/**
 * Derive the active transcript and model context of one conversation within captured bounds.
 *
 * H = newest visible head marker; the range runs from `H.head` (or transcript start) through the tail. Per target,
 * the newest edit in the range wins. Context entries are H followed by the range's non-head entries.
 */
export async function deriveContext(
	storage: Storage,
	conversationId: ConversationId,
	bounds: ContextBounds | undefined,
	context: Context,
): Promise<ContextView> {
	if (bounds === undefined) return emptyView();
	return deriveRange(bounds, await scanRange(storage, conversationId, rangeQuery(bounds), context)).view;
}

function emptyView(): ContextView {
	return { head: undefined, entries: [], contributions: [], messages: [] };
}

/** Derive the context view from the entries scanned within `bounds`. */
function deriveRange(bounds: ContextBounds, entries: readonly EntryRecord[]): ContextRange {
	const edits = new Map<EntryId, ContextEdit>();
	// Edits of every entry in the range count, including older head markers that `selectActive()` drops.
	for (const entry of entries) for (const edit of entry.edits ?? []) edits.set(edit.target, edit);
	const active = selectActive(bounds.head, entries);
	const contributions = active.map((entry) => contribute(entry, edits.get(entry.id)));
	const { settled, open } = settle([], contributions.flat());
	const messages = leadWithSystem([...settled, ...orderToolResults(open)]);
	const view = { head: bounds.head, entries: active, contributions, messages };
	return { bounds, entries, view, edited: new Set(edits.keys()), settled, open };
}

/**
 * `previous` extended by the entries `added` after its tail under the same head marker: only their contributions and
 * the open messages are derived. An added edit can change an earlier entry, so it derives the whole range again.
 */
function extendRange(previous: ContextRange, bounds: ContextBounds, added: readonly EntryRecord[]): ContextRange {
	const entries = [...previous.entries, ...added];
	if (added.some((entry) => entry.edits !== undefined || entry.head !== undefined || previous.edited.has(entry.id))) {
		return deriveRange(bounds, entries);
	}
	const contributions = added.map((entry) => contribute(entry, undefined));
	const { settled, open } = settle(previous.settled, [...previous.open, ...contributions.flat()]);
	const view = {
		head: bounds.head,
		entries: [...previous.view.entries, ...added],
		contributions: [...previous.view.contributions, ...contributions],
		messages: leadWithSystem([...settled, ...orderToolResults(open)]),
	};
	return { bounds, entries, view, edited: previous.edited, settled, open };
}

/**
 * Move a system message that only user messages precede to the front. A run's input is committed before generation
 * renders the system prompt, so a transcript, or the range after a compaction or reset, starts with user messages
 * followed by the baseline system message. Providers treat only a leading system message as the initial prompt and tool
 * set; without it, a later tool change rewrites the request's tool list and invalidates the whole prompt cache.
 */
function leadWithSystem(messages: Message[]): Message[] {
	const index = messages.findIndex((message) => message.role !== "user");
	if (index <= 0 || messages[index]!.role !== "system") return messages;
	return [messages[index]!, ...messages.slice(0, index), ...messages.slice(index + 1)];
}

/** One active entry's model messages after its edit and excluded stop reasons, before tool result ordering. */
function contribute(entry: EntryRecord, edit: ContextEdit | undefined): readonly Message[] {
	if (edit?.action === "omit") return Object.freeze([]);
	const contributed = edit?.action === "replace" ? edit.messages : (entry.model ?? []);
	return Object.freeze(
		contributed.filter((message) => message.role !== "assistant" || !EXCLUDED_STOP_REASONS.has(message.stopReason)),
	);
}

/** Objects `freezeJson()` froze with everything in them. `Object.isFrozen()` holds for shallow freezes too. */
const deeplyFrozen = new WeakSet<object>();

/** Freeze a JSON value and everything in it. */
function freezeJson<T>(value: T): T {
	if (value === null || typeof value !== "object" || deeplyFrozen.has(value)) return value;
	for (const child of Object.values(value)) freezeJson(child);
	Object.freeze(value);
	deeplyFrozen.add(value);
	return value;
}

/**
 * Move the ordered messages before the last assistant message of `open` to `settled`. `orderToolResults()` of a
 * sequence equals the concatenation over its parts when each later part starts with an assistant message.
 */
function settle(
	settled: readonly Message[],
	open: readonly Message[],
): { readonly settled: readonly Message[]; readonly open: readonly Message[] } {
	const last = open.findLastIndex((message) => message.role === "assistant");
	if (last <= 0) return { settled, open };
	return { settled: [...settled, ...orderToolResults(open.slice(0, last))], open: open.slice(last) };
}

/** The raw active entries within captured bounds, without deriving model context. */
export async function activeEntries(
	storage: Storage,
	conversationId: ConversationId,
	bounds: ContextBounds | undefined,
	context: Context,
): Promise<readonly EntryRecord[]> {
	if (bounds === undefined) return [];
	return selectActive(bounds.head, await scanRange(storage, conversationId, rangeQuery(bounds), context));
}

/** The visible range of `bounds`: from the head marker's head, or transcript start, through the tail. */
function rangeQuery(bounds: ContextBounds): Omit<EntryQuery, "conversationId"> {
	const head = bounds.head;
	return head === undefined ? { maxEntryId: bounds.tail } : { minEntryId: head.head, maxEntryId: bounds.tail };
}

/** Visible entries within `range`, oldest first. */
async function scanRange(
	storage: Storage,
	conversationId: ConversationId,
	range: Omit<EntryQuery, "conversationId">,
	context: Context,
): Promise<EntryRecord[]> {
	const entries: EntryRecord[] = [];
	let cursor: Cursor | undefined;
	do {
		const page = await storage.scanEntries({ conversationId, ...range }, SCAN_PAGE_SIZE, cursor, context);
		entries.push(...page.items);
		cursor = page.next;
	} while (cursor !== undefined);
	return entries.reverse();
}

/** The head marker followed by the range's non-head entries, or the whole range without a marker. */
function selectActive(head: ContextBounds["head"], range: readonly EntryRecord[]): readonly EntryRecord[] {
	return head === undefined ? range : [head, ...range.filter((entry) => entry.head === undefined)];
}

/**
 * Place each assistant's tool results directly after it in call order. Results are taken from the messages before
 * the next assistant; a missing result is synthesized and unmatched results are dropped.
 */
export function orderToolResults(messages: readonly Message[]): Message[] {
	const ordered: Message[] = [];
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index]!;
		if (message.role === "toolResult") continue;
		ordered.push(message);
		if (message.role !== "assistant") continue;
		const calls = message.content.filter((content): content is ToolCall => content.type === "toolCall");
		if (calls.length === 0) continue;
		const results = new Map<string, number>();
		for (let next = index + 1; next < messages.length && messages[next]!.role !== "assistant"; next++) {
			const candidate = messages[next]!;
			if (candidate.role === "toolResult" && !results.has(candidate.toolCallId)) {
				results.set(candidate.toolCallId, next);
			}
		}
		for (const call of calls) {
			const resultIndex = results.get(call.id);
			ordered.push(resultIndex === undefined ? missingResult(call, message.timestamp) : messages[resultIndex]!);
		}
	}
	return ordered;
}

function missingResult(call: ToolCall, timestamp: number): ToolResultMessage {
	return freezeJson({
		role: "toolResult",
		toolCallId: call.id,
		toolName: call.name,
		content: [{ type: "text", text: MISSING_RESULT_TEXT }],
		isError: true,
		details: { reason: "missing_result" },
		timestamp,
	});
}
