import type { Context } from "@earendil-works/chord";
import {
	BACKGROUND_CONTEXT,
	createContextKey,
	withAbortSignal,
	withCancel,
	withContextValue,
} from "@earendil-works/chord/context";
import { applyImmutable } from "@earendil-works/chord/delta";
import { defineDoc } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vitest";
import { context, documentChanges, flush, openTestSession } from "./session-support.ts";

type State = { value: number; items: string[]; retained: { label: string } };

const StateDoc = defineDoc<State>({
	checkpointWhen: () => false,
	kind: "watch.state",
	version: 1,
	scope: "session",
	initial: () => ({ value: 0, items: ["a", "b"], retained: { label: "stable" } }),
});

type Deferred = { readonly promise: Promise<void>; readonly resolve: () => void };

function deferred(): Deferred {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function createState(): Promise<ReturnType<typeof openTestSession>> {
	const harness = openTestSession();
	await harness.session.commit((tx) => tx.doc(StateDoc).then(() => undefined), context);
	return harness;
}

describe("Session document watches", () => {
	it("never creates an absent document", async () => {
		const { session, storage } = openTestSession();
		const commits = storage.commits.length;
		expect(await session.watchDoc(StateDoc, context)).toBeUndefined();
		expect(storage.commits).toHaveLength(commits);
		expect(storage.mintCount).toBe(0);
	});

	it("keeps the acquisition revision until start and delivers exact committed frames", async () => {
		const { session, publications } = await createState();
		const watch = (await session.watchDoc(StateDoc, context))!;
		const initial = watch.value;
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 1;
		}, context);
		await flush();
		const firstPublished = documentChanges(publications.at(-1)!)[0]!;
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 2;
		}, context);
		await flush();
		const secondPublished = documentChanges(publications.at(-1)!)[0]!;
		expect(watch.value).toBe(initial);

		let inline = true;
		const deliveries: Array<{ value: Readonly<State> | null; ops: unknown }> = [];
		watch.start(async (value, ops) => {
			expect(inline).toBe(false);
			expect(watch.value).toBe(value);
			deliveries.push({ value, ops });
		});
		inline = false;
		expect(deliveries).toHaveLength(0);
		await flush();
		expect(deliveries.map(({ value }) => value?.value)).toEqual([1, 2]);
		expect(deliveries[0]!.value).toBe(firstPublished.value);
		expect(deliveries[0]!.ops).toBe(firstPublished.ops);
		expect(deliveries[1]!.value).toBe(secondPublished.value);
		expect(deliveries[1]!.ops).toBe(secondPublished.ops);
		expect(initial?.value).toBe(0);
		await watch.stop();
	});

	it("serializes callbacks and buffers exact frames committed while one is in flight", async () => {
		const { session } = await createState();
		const watch = (await session.watchDoc(StateDoc, context))!;
		const entered = deferred();
		const release = deferred();
		const values: number[] = [];
		let active = 0;
		let maxActive = 0;
		watch.start(async (value) => {
			active++;
			maxActive = Math.max(maxActive, active);
			values.push(value?.value ?? -1);
			if (values.length === 1) {
				entered.resolve();
				await release.promise;
			}
			active--;
		});
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 1;
		}, context);
		await entered.promise;
		for (let value = 2; value <= 20; value++) {
			await session.commit(async (tx) => {
				(await tx.doc(StateDoc)).value = value;
			}, context);
		}
		expect(values).toEqual([1]);
		release.resolve();
		await flush();
		expect(maxActive).toBe(1);
		expect(values).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
		await watch.stop();
	});

	it("allows a listener to initiate a later Session commit", async () => {
		const { session } = await createState();
		const watch = (await session.watchDoc(StateDoc, context))!;
		const completed = deferred();
		const values: number[] = [];
		watch.start(async (value) => {
			const current = value?.value ?? -1;
			values.push(current);
			if (current === 1) {
				await session.commit(async (tx) => {
					(await tx.doc(StateDoc)).value = 2;
				}, context);
			} else {
				completed.resolve();
			}
		});
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 1;
		}, context);
		await completed.promise;
		expect(values).toEqual([1, 2]);
		await watch.stop();
	});

	it("collapses 101 pending commits to one root replacement", async () => {
		const { session } = await createState();
		const watch = (await session.watchDoc(StateDoc, context))!;
		for (let value = 1; value <= 101; value++) {
			await session.commit(async (tx) => {
				(await tx.doc(StateDoc)).value = value;
			}, context);
		}
		const deliveries: Array<{ value: number; ops: unknown }> = [];
		watch.start(async (value, ops) => {
			deliveries.push({ value: value?.value ?? -1, ops });
		});
		await flush();
		expect(deliveries).toEqual([{ value: 101, ops: [["r", watch.value]] }]);
		await watch.stop();
	});

	it("never folds the in-flight frame into an overflow reset", async () => {
		const { session } = await createState();
		const watch = (await session.watchDoc(StateDoc, context))!;
		const entered = deferred();
		const release = deferred();
		const deliveries: Array<{ value: number; ops: unknown }> = [];
		watch.start(async (value, ops) => {
			deliveries.push({ value: value?.value ?? -1, ops });
			if (deliveries.length === 1) {
				entered.resolve();
				await release.promise;
			}
		});
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 1;
		}, context);
		await entered.promise;
		for (let value = 2; value <= 102; value++) {
			await session.commit(async (tx) => {
				(await tx.doc(StateDoc)).value = value;
			}, context);
		}
		release.resolve();
		await flush();
		expect(deliveries[0]!.value).toBe(1);
		expect(deliveries[1]).toEqual({ value: 102, ops: [["r", watch.value]] });
		expect(deliveries).toHaveLength(2);
		await watch.stop();
	});

	it("folds retirement into an overflow reset and then closes", async () => {
		const { session } = await createState();
		const watch = (await session.watchDoc(StateDoc, context))!;
		for (let value = 1; value <= 100; value++) {
			await session.commit(async (tx) => {
				(await tx.doc(StateDoc)).value = value;
			}, context);
		}
		await session.commit((tx) => tx.retireDoc(StateDoc), context);
		const deliveries: Array<{ value: Readonly<State> | null; ops: unknown }> = [];
		watch.start(async (value, ops) => {
			deliveries.push({ value, ops });
		});
		expect(await watch.closed).toEqual({ reason: "retired" });
		expect(deliveries).toEqual([{ value: null, ops: [["r", null]] }]);
	});

	it("delivers replayable structural no-op commits instead of suppressing them", async () => {
		const { session } = await createState();
		const watch = (await session.watchDoc(StateDoc, context))!;
		const initial = watch.value;
		await session.commit(async (tx) => {
			const state = await tx.doc(StateDoc);
			const first = state.items.shift()!;
			state.items.unshift(first);
		}, context);
		const newest = (await session.snapshot(StateDoc, context))!;
		expect(newest).not.toBe(initial);
		expect(newest).toEqual(initial);
		const batches: unknown[] = [];
		watch.start(async (value, ops) => {
			expect(value).toBe(newest);
			batches.push(ops);
		});
		await flush();
		expect(batches).toHaveLength(1);
		expect((batches[0] as readonly unknown[]).length).toBeGreaterThan(0);
		await watch.stop();
	});

	it("preserves commit Context values without inheriting producer cancellation", async () => {
		const { session } = await createState();
		const watch = (await session.watchDoc(StateDoc, context))!;
		const key = createContextKey<string>("watch-test");
		const parentController = new AbortController();
		const commitContext = withContextValue(
			key,
			"newest-commit",
			withAbortSignal(parentController.signal, BACKGROUND_CONTEXT),
		);
		const entered = deferred();
		const release = deferred();
		let deliveryContext: Context | undefined;
		watch.start(async (_value, _ops, delivered) => {
			deliveryContext = delivered;
			entered.resolve();
			await release.promise;
		});
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 1;
		}, commitContext);
		await entered.promise;
		expect(deliveryContext!.value(key)).toBe("newest-commit");
		expect(deliveryContext!.abortSignal).toBeUndefined();
		parentController.abort("caller finished");
		const stopped = watch.stop();
		expect(await stopped).toEqual({ reason: "stopped" });
		expect(deliveryContext!.abortSignal).toBeUndefined();
		release.resolve();
	});

	it("keeps earlier immutable revisions stable", async () => {
		const { session } = await createState();
		const watch = (await session.watchDoc(StateDoc, context))!;
		const initial = watch.value;
		let delivered: Readonly<State> | null | undefined;
		watch.start(async (value) => {
			delivered = value;
		});
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 1;
		}, context);
		await flush();
		expect(delivered).toBe(watch.value);
		expect(delivered).not.toBe(initial);
		expect(delivered?.retained).toBe(initial?.retained);
		expect(initial?.value).toBe(0);
		await watch.stop();
	});

	it("delivers retirement and does not follow recreation", async () => {
		const { session } = await createState();
		const oldWatch = (await session.watchDoc(StateDoc, context))!;
		const values: Array<Readonly<State> | null> = [];
		oldWatch.start(async (value) => {
			values.push(value);
		});
		await session.commit(async (tx) => {
			await tx.retireDoc(StateDoc);
			(await tx.doc(StateDoc)).value = 10;
		}, context);
		expect(await oldWatch.closed).toEqual({ reason: "retired" });
		expect(values).toEqual([null]);
		expect(oldWatch.value).toBeNull();

		const replacement = (await session.watchDoc(StateDoc, context))!;
		expect(replacement.value?.value).toBe(10);
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 11;
		}, context);
		await flush();
		expect(oldWatch.value).toBeNull();
		await replacement.stop();
	});

	it("Session close discards retirement buffered before start", async () => {
		const { session } = await createState();
		const watch = (await session.watchDoc(StateDoc, context))!;
		const baseline = watch.value;
		await session.commit((tx) => tx.retireDoc(StateDoc), context);
		await session.close(context);
		expect(await watch.closed).toEqual({ reason: "session_closed" });
		expect(watch.value).toBe(baseline);
		expect(() => watch.start(async () => undefined)).toThrow("stopped");
	});

	it("Session close discards retirement behind an in-flight callback", async () => {
		const { session } = await createState();
		const watch = (await session.watchDoc(StateDoc, context))!;
		const entered = deferred();
		const release = deferred();
		const values: Array<number | null> = [];
		watch.start(async (value) => {
			values.push(value?.value ?? null);
			entered.resolve();
			await release.promise;
		});
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 1;
		}, context);
		await entered.promise;
		await session.commit((tx) => tx.retireDoc(StateDoc), context);
		await session.close(context);
		expect(await watch.closed).toEqual({ reason: "session_closed" });
		release.resolve();
		await flush();
		expect(values).toEqual([1]);
	});

	it("supports idempotent stop and rejects repeated or late start", async () => {
		const { session } = await createState();
		const started = (await session.watchDoc(StateDoc, context))!;
		started.start(async () => undefined);
		expect(() => started.start(async () => undefined)).toThrow("already started");
		const first = started.stop();
		const second = started.stop();
		expect(second).toBe(first);
		expect(await first).toEqual({ reason: "stopped" });

		const stopped = (await session.watchDoc(StateDoc, context))!;
		await stopped.stop();
		expect(() => stopped.start(async () => undefined)).toThrow("stopped");
	});

	it("cancels acquisition without leaking a registered watch", async () => {
		const { session, storage } = await createState();
		await session.unloadDocuments();
		const gate = storage.holdFindDocument();
		const child = withCancel(context);
		const acquisition = session.watchDoc(StateDoc, child.context);
		await gate.entered;
		child.cancel(new Error("cancel acquisition"));
		gate.release();
		await expect(acquisition).rejects.toThrow("cancel acquisition");
		await session.close(context);
	});

	it("cancels future delivery without aborting an in-flight callback", async () => {
		const { session } = await createState();
		const child = withCancel(context);
		const watch = (await session.watchDoc(StateDoc, child.context))!;
		const entered = deferred();
		const release = deferred();
		let deliveryContext: Context | undefined;
		watch.start(async (_value, _ops, delivered) => {
			deliveryContext = delivered;
			entered.resolve();
			await release.promise;
		});
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 1;
		}, context);
		await entered.promise;
		child.cancel();
		expect(await watch.closed).toEqual({ reason: "cancelled" });
		expect(deliveryContext!.abortSignal).toBeUndefined();
		release.resolve();
	});

	it("Session close stops future delivery without joining an in-flight callback", async () => {
		const { session } = await createState();
		const watch = (await session.watchDoc(StateDoc, context))!;
		const entered = deferred();
		const release = deferred();
		let deliveryContext: Context | undefined;
		watch.start(async (_value, _ops, delivered) => {
			deliveryContext = delivered;
			entered.resolve();
			await release.promise;
		});
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 1;
		}, context);
		await entered.promise;
		await session.close(context);
		expect(deliveryContext!.abortSignal).toBeUndefined();
		expect(await watch.closed).toEqual({ reason: "session_closed" });
		release.resolve();
	});

	it("settles listener failure on only the affected watch", async () => {
		const { session } = await createState();
		const failed = (await session.watchDoc(StateDoc, context))!;
		const healthy = (await session.watchDoc(StateDoc, context))!;
		failed.start(async () => {
			throw new Error("listener failed");
		});
		let healthyCalls = 0;
		healthy.start(async () => {
			healthyCalls++;
		});
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 1;
		}, context);
		const end = await failed.closed;
		expect(end.reason).toBe("listener_error");
		if (end.reason === "listener_error") expect(end.error.message).toBe("listener failed");
		await flush();
		expect(healthyCalls).toBe(1);
		await healthy.stop();
	});

	it("hydrates migration without writing and observes the later exact edit", async () => {
		const Old = defineDoc<{ value: number }>({
			checkpointWhen: () => false,
			kind: "watch.migration",
			version: 1,
			scope: "session",
			initial: () => ({ value: 3 }),
		});
		const Current = defineDoc<{ value: number; migrated: boolean }>({
			checkpointWhen: () => false,
			kind: "watch.migration",
			version: 2,
			scope: "session",
			initial: () => ({ value: 0, migrated: false }),
			migrate: (value) => ({ value: value.value as number, migrated: true }),
		});
		const { session, storage } = openTestSession();
		await session.commit((tx) => tx.doc(Old).then(() => undefined), context);
		await session.unloadDocuments();
		const commits = storage.commits.length;
		const watch = (await session.watchDoc(Current, context))!;
		expect(watch.value).toEqual({ value: 3, migrated: true });
		expect(storage.commits).toHaveLength(commits);
		const values: number[] = [];
		watch.start(async (value) => {
			values.push(value?.value ?? -1);
		});
		await session.commit((tx) => tx.doc(Current).then(() => undefined), context);
		await flush();
		expect(values).toEqual([]);
		await session.commit(async (tx) => {
			(await tx.doc(Current)).value = 4;
		}, context);
		await flush();
		expect(values).toEqual([4]);
		await watch.stop();
	});

	it("can replay every delivered exact operation batch from the acquisition revision", async () => {
		const { session } = await createState();
		const watch = (await session.watchDoc(StateDoc, context))!;
		let replica: Readonly<State> | null = watch.value;
		watch.start(async (value, ops) => {
			replica = applyImmutable(replica, ops);
			expect(replica).toEqual(value);
		});
		await session.commit(async (tx) => {
			const state = await tx.doc(StateDoc);
			state.value = 3;
			state.items.splice(0, 1);
		}, context);
		await flush();
		expect(replica).toEqual(watch.value);
		await watch.stop();
	});

	it("continues after the tracker cache unloads", async () => {
		const { session, storage } = await createState();
		const watch = (await session.watchDoc(StateDoc, context))!;
		const baseline = watch.value;
		const reads = storage.documentReadCount;
		await session.unloadDocuments();
		const reloaded = await session.snapshot(StateDoc, context);
		expect(reloaded).toEqual(baseline);
		expect(reloaded).not.toBe(baseline);
		expect(storage.documentReadCount).toBeGreaterThan(reads);
		watch.start(async () => undefined);
		await session.commit(async (tx) => {
			(await tx.doc(StateDoc)).value = 7;
		}, context);
		await flush();
		expect(watch.value?.value).toBe(7);
		await watch.stop();
	});
});
