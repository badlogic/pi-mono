import type { JsonValue } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { idFromNumber, seqFromNumber } from "../src/ids.ts";
import {
	type ConversationId,
	type DocumentCreate,
	type DocumentId,
	type DocumentPoint,
	type DocumentRecord,
	type EntryId,
	type LogRecord,
	type LogWrite,
	type ReplayableStorage,
	ROOT_CONVERSATION_ID,
	type Storage,
	type StorageWrite,
	type SubmissionId,
	type SubmissionRecord,
	type TaskId,
	type TaskRecord,
} from "../src/types.ts";

const context = BACKGROUND_CONTEXT;
type StoredTask = TaskRecord<JsonValue, JsonValue, JsonValue>;

export const conversationId = (id: number) => idFromNumber<ConversationId>(id);
export const entryId = (id: number) => idFromNumber<EntryId>(id);
export const taskId = (id: number) => idFromNumber<TaskId<JsonValue>>(id);
export const documentId = (id: number) => idFromNumber<DocumentId>(id);

export function task(id: number, status: "pending" | "running" | "terminal", phase = "work"): StoredTask {
	const base = {
		id: taskId(id),
		conversationId: ROOT_CONVERSATION_ID,
		kind: "test.task",
		version: 1,
		input: { id },
		background: false,
		abortRequested: false,
	};
	return status === "terminal"
		? { ...base, state: { status, outcome: { status: "completed", result: { phase } } } }
		: { ...base, state: { status, checkpoint: { phase } } };
}

function submission(id: number, status: "queued" | "placed", entry?: number): SubmissionRecord {
	return status === "queued"
		? { id: idFromNumber<SubmissionId>(id), conversationId: ROOT_CONVERSATION_ID, type: "input", status }
		: {
				id: idFromNumber<SubmissionId>(id),
				conversationId: ROOT_CONVERSATION_ID,
				type: "input",
				status,
				entry: entryId(entry!),
			};
}

export const entry = (id: number, conversation = ROOT_CONVERSATION_ID, extra: object = {}): LogWrite => ({
	type: "entry",
	value: { id: entryId(id), conversationId: conversation, kind: "message", data: { id }, ...extra },
});

export const sessionDoc = (id: number, kind = "test.session"): DocumentCreate => ({
	id: documentId(id),
	kind,
	scope: { kind: "session" },
});
export const rewindableDoc = (
	id: number,
	conversation = ROOT_CONVERSATION_ID,
	kind = "test.rewindable",
): DocumentCreate => ({
	id: documentId(id),
	kind,
	scope: { kind: "conversation", conversationId: conversation },
	history: "rewindable",
	fork: "asOf",
});
export const latestDoc = (id: number, conversation = ROOT_CONVERSATION_ID, kind = "test.latest"): DocumentCreate => ({
	id: documentId(id),
	kind,
	scope: { kind: "conversation", conversationId: conversation },
	history: "latest",
	fork: "current",
});

export const create = (record: DocumentCreate, value: Record<string, JsonValue>, version = 1): LogWrite => ({
	type: "document.create",
	record,
	content: { kind: "base", version, value },
});
export const delta = (id: number, path: string, value: JsonValue, version = 1): LogWrite => ({
	type: "document.change",
	id: documentId(id),
	content: { kind: "delta", version, ops: [["s", [path], value]] },
});
export const base = (id: number, value: Record<string, JsonValue>, version = 1): LogWrite => ({
	type: "document.change",
	id: documentId(id),
	content: { kind: "base", version, value },
});

/**
 * A history that exercises everything export has to preserve: reclaimed current-only content, rewindable history
 * across a version transition, task documents, fork copies, retire and recreate, an empty lifetime, upserted records,
 * and a head that no stamp records.
 */
export async function seed(storage: ReplayableStorage): Promise<void> {
	const batches: StorageWrite[][] = [
		[{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
		[
			entry(2),
			entry(3),
			{ type: "task", value: task(4, "pending") },
			{ type: "submission", value: submission(5, "queued") },
			create(sessionDoc(6), { n: 0 }),
			create(rewindableDoc(7), { a: 1 }),
		],
		[delta(6, "n", 1), delta(7, "b", 1), { type: "task", value: task(4, "running") }, entry(8)],
		[base(6, { n: 5 }), base(7, { a: 2 }, 2), { type: "submission", value: submission(5, "placed", 8) }],
		[
			create({ id: documentId(9), kind: "test.task-doc", scope: { kind: "task", taskId: taskId(4) } }, { t: 1 }),
			create(latestDoc(10), { x: 1 }),
		],
		[
			{
				type: "conversation",
				value: { id: conversationId(11), parent: { conversationId: ROOT_CONVERSATION_ID, at: entryId(8) } },
			},
			{
				type: "document.copy",
				record: rewindableDoc(12, conversationId(11)),
				source: { id: documentId(7), at: seqFromNumber(3) },
			},
			{
				type: "document.copy",
				record: latestDoc(13, conversationId(11)),
				source: { id: documentId(10), at: "current" },
			},
			entry(14, conversationId(11), { head: entryId(14) }),
		],
		[base(10, { x: 2 }), delta(7, "c", 1, 2)],
		[
			{ type: "task", value: task(4, "terminal") },
			delta(9, "t", 2),
			{ type: "document.retire", id: documentId(9) },
			delta(10, "y", 1),
		],
		[
			{ type: "document.retire", id: documentId(7) },
			create(rewindableDoc(15), { a: 3 }),
			create(latestDoc(16, ROOT_CONVERSATION_ID, "test.flash"), { gone: true }),
			{ type: "document.retire", id: documentId(16) },
			delta(13, "copied", true),
		],
		[{ type: "task", value: task(17, "pending") }],
	];
	for (const batch of batches) await storage.commit(batch, context);
}

type Reads = Record<string, unknown>;

/** Every read a Session can make, at every point of the history, as one comparable value. */
export async function reads(storage: Storage & Pick<ReplayableStorage, "head">): Promise<Reads> {
	const head = await storage.head(context);
	const out: Reads = { head };
	const conversations = (await storage.scanConversations({}, 1000, undefined, context)).items;
	out.conversations = conversations;
	for (const conversation of conversations) {
		const entries = (
			await storage.scanEntries({ conversationId: conversation.id, order: "ascending" }, 1000, undefined, context)
		).items;
		out[`entries:${conversation.id}`] = await Promise.all(entries.map((item) => storage.entry(item.id, context)));
		out[`head-marker:${conversation.id}`] = await storage.findLatestHeadMarker(conversation.id, undefined, context);
	}
	const tasks = (await storage.scanTasks({}, 1000, undefined, context)).items;
	out.tasks = tasks;
	out.submissions = (await storage.scanSubmissions({}, 1000, undefined, context)).items;
	out.submissionByStatus = (await storage.scanSubmissions({ status: "placed" }, 1000, undefined, context)).items;
	out.tasksByStatus = (await storage.scanTasks({ status: "terminal" }, 1000, undefined, context)).items;

	const scopes: DocumentRecord["scope"][] = [
		{ kind: "session" },
		...conversations.map((conversation) => ({ kind: "conversation" as const, conversationId: conversation.id })),
		...tasks.map((item) => ({ kind: "task" as const, taskId: item.id })),
	];
	const points: DocumentPoint[] = ["current"];
	for (let seq = 1; seq <= (head ?? 0); seq++) points.push(seqFromNumber(seq));
	for (const scope of scopes) {
		for (const at of points) {
			const documents = (await storage.scanDocuments({ scope, at }, 1000, undefined, context)).items;
			out[`documents:${JSON.stringify(scope)}:${at}`] = documents;
			for (const record of documents) {
				out[`document:${record.id}:${at}`] = await storage
					.document(record.id, at, context)
					.catch((error: unknown) => ({ rejected: error instanceof Error ? error.name : "unknown" }));
				const address = {
					kind: record.kind,
					scope: record.scope,
					...(record.key === undefined ? {} : { key: record.key }),
				};
				out[`find:${record.id}:${at}`] = await storage.findDocument(address, at, context);
			}
		}
	}
	out.nextId = await storage.mintId();
	return out;
}

export async function collect(log: AsyncIterable<LogRecord>): Promise<LogRecord[]> {
	const records: LogRecord[] = [];
	for await (const record of log) records.push(record);
	return records;
}
