import { defineDoc, defineDocFamily } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vitest";
import { context, createConversation, documentChanges, flush, openTestSession } from "./session-support.ts";

type State = { value: number; retained: { label: string } };

const StateDoc = defineDoc<State>({
	kind: "state.state",
	version: 1,
	scope: "session",
	initial: () => ({ value: 0, retained: { label: "stable" } }),
});

const FamilyDoc = defineDocFamily<{ value: number }, string>({
	kind: "state.family",
	version: 1,
	family: true,
	scope: "session",
	initial: (seed) => ({ value: seed.length }),
});

async function createState(): Promise<ReturnType<typeof openTestSession>> {
	const harness = openTestSession();
	await harness.session.commit((tx) => tx.doc(StateDoc).then(() => undefined), context);
	await flush();
	return harness;
}

describe("Session document states", () => {
	it("never creates an absent document", async () => {
		const { session, storage } = openTestSession();
		const commits = storage.commits.length;
		expect(await session.documentState(StateDoc, context)).toBeUndefined();
		expect(await session.documentState(FamilyDoc, "missing", context)).toBeUndefined();
		expect(storage.commits).toHaveLength(commits);
		expect(storage.mintCount).toBe(0);
	});

	it("returns an immediately hydrated read-only state with contiguous Chord deliveries", async () => {
		const { session } = await createState();
		const baseline = (await session.snapshot(StateDoc, context))!;
		const state = (await session.documentState(StateDoc, context))!;
		const deliveries: Array<{ value: Readonly<State> | null; sequence: number }> = [];
		state.subscribe((value, _context, delivery) => deliveries.push({ value, sequence: delivery.sequence }));
		expect(state.value).toBe(baseline);

		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 1;
		}, context);
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 2;
		}, context);
		await flush();

		expect(deliveries.map(({ sequence }) => sequence)).toEqual([0, 1, 2]);
		expect(deliveries.map(({ value }) => value?.value)).toEqual([0, 1, 2]);
		expect(state.value).toBe(await session.snapshot(StateDoc, context));
		state.dispose();
	});

	it("creates independent disposable states for one incarnation", async () => {
		const { session } = await createState();
		const first = (await session.documentState(StateDoc, context))!;
		const second = (await session.documentState(StateDoc, context))!;
		expect(second).not.toBe(first);
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 1;
		}, context);
		await flush();
		expect(first.value?.value).toBe(1);
		expect(second.value?.value).toBe(1);

		first.dispose();
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 2;
		}, context);
		await flush();
		expect(first.value?.value).toBe(1);
		expect(second.value?.value).toBe(2);
		second.dispose();
	});

	it("shares exact committed value references with Chord", async () => {
		const { session, publications } = await createState();
		const state = (await session.documentState(StateDoc, context))!;
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 4;
		}, context);
		await flush();
		const published = documentChanges(publications.at(-1)!)[0]!;
		expect(state.value).toBe(published.value);
		expect(state.value?.retained).toBe((await session.snapshot(StateDoc, context))!.retained);
		state.dispose();
	});

	it("captures a late baseline without redelivering an already covered commit", async () => {
		const { session } = await createState();
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 1;
		}, context);
		const state = (await session.documentState(StateDoc, context))!;
		const deliveries: number[] = [];
		state.subscribe((_value, _context, delivery) => deliveries.push(delivery.sequence));
		await flush();
		expect(state.value?.value).toBe(1);
		expect(deliveries).toEqual([0]);
		state.dispose();
	});

	it("publishes null retirement and never follows a replacement incarnation", async () => {
		const { session } = await createState();
		const oldState = (await session.documentState(StateDoc, context))!;
		await session.commit(async (tx) => {
			await tx.retireDoc(StateDoc);
			(await tx.doc(StateDoc)).value = 10;
		}, context);
		await flush();
		expect(oldState.value).toBeNull();

		const replacement = (await session.documentState(StateDoc, context))!;
		expect(replacement.value?.value).toBe(10);
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 11;
		}, context);
		await flush();
		expect(oldState.value).toBeNull();
		expect(replacement.value?.value).toBe(11);
		oldState.dispose();
		replacement.dispose();
	});

	it("cold-loads a definition-free fork copy", async () => {
		const Copied = defineDoc<{ value: number }>({
			kind: "state.copied",
			version: 1,
			scope: "conversation",
			history: "latest",
			fork: "current",
			initial: () => ({ value: 0 }),
		});
		const { session, storage } = openTestSession();
		const parentId = await createConversation(session);
		const entry = await session.commit(async (tx) => {
			const created = await tx.appendEntry(parentId, { kind: "point" });
			(await tx.doc(Copied, parentId)).value = 7;
			return created;
		}, context);
		const childId = await session.commit(
			async (tx) => (await tx.forkConversation(parentId, entry.id, { ownership: { kind: "ownerless" } })).id,
			context,
		);
		const reads = storage.documentReadCount;
		const state = (await session.documentState(Copied, childId, context))!;
		expect(state.value).toEqual({ value: 7 });
		expect(storage.documentReadCount).toBeGreaterThan(reads);
		state.dispose();
	});

	it("hydrates a migrated tracker without writing and skips an equal version-base update", async () => {
		const Old = defineDoc<{ value: number }>({
			kind: "state.migration",
			version: 1,
			scope: "session",
			initial: () => ({ value: 3 }),
		});
		const Current = defineDoc<{ value: number; migrated: boolean }>({
			kind: "state.migration",
			version: 2,
			scope: "session",
			initial: () => ({ value: 0, migrated: false }),
			migrate: (value) => ({ value: value.value as number, migrated: true }),
		});
		const { session, storage } = openTestSession();
		await session.commit((tx) => tx.doc(Old).then(() => undefined), context);
		await session.unloadDocuments();
		const commits = storage.commits.length;
		const state = (await session.documentState(Current, context))!;
		expect(state.value).toEqual({ value: 3, migrated: true });
		expect(storage.commits).toHaveLength(commits);
		const baseline = state.value;

		await session.commit((tx) => tx.doc(Current).then(() => undefined), context);
		await flush();
		expect(storage.commits).toHaveLength(commits + 1);
		expect(state.value).toBe(baseline);
		await session.commit(async (tx) => {
			(await tx.doc(Current)).value = 4;
		}, context);
		await flush();
		expect(state.value).toEqual({ value: 4, migrated: true });
		state.dispose();
	});

	it("continues from exact committed values after the tracker cache unloads", async () => {
		const { session, storage } = await createState();
		const state = (await session.documentState(StateDoc, context))!;
		const baseline = state.value;
		const reads = storage.documentReadCount;
		await session.unloadDocuments();
		const reloaded = await session.snapshot(StateDoc, context);
		expect(reloaded).toEqual(baseline);
		expect(reloaded).not.toBe(baseline);
		expect(storage.documentReadCount).toBeGreaterThan(reads);
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 6;
		}, context);
		await flush();
		expect(state.value?.value).toBe(6);
		state.dispose();
	});

	it("exposes trusted shared immutable values without freezing", async () => {
		const { session } = await createState();
		const snapshot = (await session.snapshot(StateDoc, context))!;
		const state = (await session.documentState(StateDoc, context))!;
		expect(state.value).toBe(snapshot);
		expect(Object.isFrozen(state.value)).toBe(false);
		expect(Object.isFrozen(state.value!.retained)).toBe(false);
		state.dispose();
	});
});
