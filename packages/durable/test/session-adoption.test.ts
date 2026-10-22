import type { Context } from "@earendil-works/chord";
import { defineDoc, MemoryStorage, type Seq, type StorageWrite } from "@earendil-works/pi-durable";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionImpl } from "../src/session/session.ts";
import { Transaction } from "../src/session/transaction.ts";
import { context } from "./session-support.ts";

const CounterDoc = defineDoc<{ count: number }>({
	checkpointWhen: () => false,
	kind: "adoption.counter",
	version: 1,
	scope: "session",
	initial: () => ({ count: 0 }),
});

/** Memory storage whose next commit, once durable, misbehaves as `fault` says. */
class FaultyStorage extends MemoryStorage {
	fault: "reject_after_adopt" | "skip_adopt" | undefined;
	readonly order: string[] = [];

	override async commit(writes: readonly StorageWrite[], adopt: (seq: Seq) => void, callContext: Context) {
		const fault = this.fault;
		this.fault = undefined;
		if (fault === "skip_adopt") return super.commit(writes, () => {}, callContext);
		const seq = await super.commit(
			writes,
			(committed) => {
				this.order.push("adopt");
				adopt(committed);
				this.order.push("adopted");
			},
			callContext,
		);
		this.order.push("resolve");
		if (fault === "reject_after_adopt") throw new Error("reclaim failed");
		return seq;
	}
}

function open() {
	const storage = new FaultyStorage();
	const session = new SessionImpl(storage);
	return { storage, session };
}

const bump = (session: SessionImpl) =>
	session.commit(async (tx) => {
		(await tx.doc(CounterDoc)).count++;
	}, context);

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Session adoption inside Storage.commit()", () => {
	it("adopts synchronously inside the commit, before Storage resolves", async () => {
		const { storage, session } = open();
		const adopt = vi.spyOn(Transaction.prototype, "adopt");
		await bump(session);
		expect(storage.order).toEqual(["adopt", "adopted", "resolve"]);
		expect(adopt).toHaveBeenCalledTimes(1);
		expect(await session.snapshot(CounterDoc, context)).toEqual({ count: 1 });
		await session.close(context);
	});

	it("fails the Session without discarding when Storage rejects after adoption", async () => {
		const { storage, session } = open();
		await bump(session);
		const discard = vi.spyOn(Transaction.prototype, "discard");
		storage.fault = "reject_after_adopt";
		await expect(bump(session)).rejects.toThrow("reclaim failed");
		expect(discard).not.toHaveBeenCalled();
		expect(await session.closed).toMatchObject({ reason: "failed", error: new Error("reclaim failed") });
	});

	it("discards the staged changes when Storage rejects before adoption", async () => {
		const storage = new MemoryStorage();
		const session = new SessionImpl(storage);
		await bump(session);
		const discard = vi.spyOn(Transaction.prototype, "discard");
		vi.spyOn(storage, "commit").mockRejectedValueOnce(new Error("disk full"));
		await expect(bump(session)).rejects.toThrow("disk full");
		expect(discard).toHaveBeenCalledTimes(1);
		expect(await session.closed).toMatchObject({ reason: "failed" });
	});

	it("fails the Session with its own adoption error, which never reaches Storage", async () => {
		const { storage, session } = open();
		await bump(session);
		const failure = new Error("adoption failed");
		vi.spyOn(Transaction.prototype, "adopt").mockImplementationOnce(() => {
			throw failure;
		});
		await expect(bump(session)).rejects.toBe(failure);
		// Storage saw a normal adoption and resolved.
		expect(storage.order.slice(-3)).toEqual(["adopt", "adopted", "resolve"]);
		expect(await session.closed).toEqual({ reason: "failed", error: failure });
	});

	it("fails the Session when Storage resolves without adopting", async () => {
		const { storage, session } = open();
		storage.fault = "skip_adopt";
		await expect(bump(session)).rejects.toThrow("without adopting");
		expect(await session.closed).toMatchObject({ reason: "failed" });
	});
});
