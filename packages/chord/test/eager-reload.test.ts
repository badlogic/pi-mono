import assert from "node:assert/strict";
import { Type } from "typebox";
import { onTestFinished, test } from "vitest";
import { HostImpl } from "../src/host.ts";
import {
	cell,
	defineRegistry,
	type Facet,
	isChordError,
	local,
	memoryLinkPair,
	method,
	resource,
	type Self,
} from "../src/index.ts";

const input = Type.Object({ key: Type.String() });
const flags = Type.Record(Type.String(), Type.Boolean());
const SwitchV1 = local("t.eager-switch", {
	version: 1,
	input,
	members: {
		enabled: Type.Boolean(),
		set: method(Type.Boolean(), Type.Null()),
	},
});
const SwitchV2 = local("t.eager-switch", {
	version: 2,
	input,
	members: {
		enabled: flags,
		set: method(Type.Object({ conversation: Type.Number(), enabled: Type.Boolean() }), Type.Null()),
	},
});
const SwitchV3 = local("t.eager-switch", {
	version: 3,
	input,
	members: {
		enabled: flags,
		update: method(Type.Object({ conversation: Type.Number(), enabled: Type.Boolean() }), Type.Null()),
	},
});
const Read = defineRegistry<() => unknown>("t.eager-switch-read");

function switchFacets(log: string[]) {
	const declareResource = (self: Self) =>
		self.resources({
			watch: resource({
				rev: 1,
				open: () => {
					log.push("open");
					return null;
				},
				close: () => {
					log.push("close");
				},
			}),
		});
	const v1: Facet = {
		name: "switch",
		setup: (api) =>
			api.serve(
				SwitchV1,
				(_input, _principal, self) => {
					declareResource(self);
					const state = self.state({ enabled: cell(Type.Boolean(), false) });
					self.register(Read, { current: () => state.enabled.value });
					return {
						enabled: state.enabled,
						set: (enabled, ctx) => {
							state.enabled.replace(ctx, enabled);
							return null;
						},
					};
				},
				{ eager: { input: { key: "custom" } } },
			),
	};
	const v2 = (valid: boolean): Facet => ({
		name: "switch",
		setup: (api) =>
			api.serve(
				SwitchV2,
				(_input, _principal, self) => {
					declareResource(self);
					const state = self.state({ enabled: cell(flags, {}) });
					self.register(Read, { current: () => state.enabled.value });
					return {
						enabled: state.enabled,
						set: ({ conversation, enabled }, ctx) => {
							state.enabled.change(ctx, (draft) => {
								draft[conversation] = enabled;
							});
							return null;
						},
					};
				},
				{
					eager: { input: { key: "custom" } },
					state: {
						version: 2,
						migrate: {
							enabled: (old, from) => {
								assert.equal(from, 1);
								return valid ? { 1: old as boolean } : "invalid migration";
							},
						},
					},
				},
			),
	});
	const v3: Facet = {
		name: "switch",
		setup: (api) =>
			api.serve(
				SwitchV3,
				(_input, _principal, self) => {
					declareResource(self);
					const state = self.state({ enabled: cell(flags, {}) });
					self.register(Read, { current: () => state.enabled.value });
					return {
						enabled: state.enabled,
						update: ({ conversation, enabled }, ctx) => {
							state.enabled.change(ctx, (draft) => {
								draft[conversation] = enabled;
							});
							return null;
						},
					};
				},
				{ eager: { input: { key: "custom" } }, state: { version: 2 } },
			),
	};
	return { v1, v2, v3 };
}

test("an eager hold follows contract bumps at commit without reopening its record or resources; failures retain the old hold", async () => {
	const errors: unknown[] = [];
	const host = new HostImpl({ dev: true, onError: (error) => errors.push(error) });
	onTestFinished(() => host.close());
	const log: string[] = [];
	const facets = switchFacets(log);
	await host.load([facets.v1]);
	const initial = host.eager.get(SwitchV1.name)!;
	const record = initial.record;
	const original = host.get(SwitchV1, { key: "custom" });
	await original.set(true);
	original.release();
	const epoch = host.epoch;
	await assert.rejects(host.reload([facets.v2(false)]), (error) => isChordError(error, "invalid"));
	assert.equal(host.epoch, epoch);
	assert.equal(host.eager.get(SwitchV1.name), initial);
	assert.equal(initial.status, "live");
	assert.equal(host.registry(Read).get("current")!(), true);
	const report = await host.reload([facets.v2(true)]);
	assert.equal(report.gated.length, 1);
	const updated = host.eager.get(SwitchV2.name)!;
	assert.equal(updated.contract, SwitchV2);
	assert.equal(updated.record, record);
	assert.equal(initial.status, "released");
	assert.equal(record?.holds.size, 1, "Attach the replacement before releasing the only old hold");
	assert.deepEqual(host.registry(Read).get("current")!(), { 1: true });
	const modern = host.get(SwitchV2, { key: "custom" });
	await modern.set({ conversation: 2, enabled: true });
	modern.release();
	assert.deepEqual((await host.reload([facets.v3])).gated, []);
	assert.equal(host.eager.get(SwitchV3.name)?.contract, SwitchV3);
	assert.equal(host.eager.get(SwitchV3.name)?.record, record);
	assert.equal(updated.status, "released");
	assert.deepEqual(host.registry(Read).get("current")!(), { 1: true, 2: true });
	await host.ready();
	assert.deepEqual(log, ["open"]);
	assert.deepEqual(errors, []);
	await host.close();
	assert.deepEqual(log, ["open", "close"]);
});

const ReadV1 = local("t.eager-read", {
	version: 1,
	input: Type.Object({}),
	members: { read: method(Type.Null(), Type.String()) },
});
const ReadV2 = local("t.eager-read", {
	version: 2,
	input: Type.Object({}),
	members: { fetch: method(Type.Null(), Type.String()) },
});
const readerV1: Facet = {
	name: "read",
	setup: (api) => api.serve(ReadV1, () => ({ read: () => "one" }), { eager: true }),
};
const readerV2 = (adapt = false): Facet => ({
	name: "read",
	setup: (api) =>
		api.serve(ReadV2, () => ({ fetch: () => "two" }), {
			eager: true,
			...(adapt ? { accepts: { 1: (current: Record<string, unknown>) => ({ read: current.fetch }) } } : {}),
		}),
});

test("external old-version consumers still refuse an eager upgrade without accepts, and keep their adapter when it is provided", async () => {
	const host = new HostImpl({
		onError: (error) => {
			throw error;
		},
	});
	onTestFinished(() => host.close());
	await host.load([readerV1]);
	const own = host.eager.get(ReadV1.name)!;
	const consumer = host.get(ReadV1, {});
	assert.equal(await consumer.read(null), "one");
	await assert.rejects(host.reload([readerV2()]), (error) => isChordError(error, "contract_mismatch"));
	assert.equal(host.eager.get(ReadV1.name), own);
	assert.equal(await consumer.read(null), "one");
	await host.reload([readerV2(true)]);
	assert.equal(host.eager.get(ReadV2.name)?.contract, ReadV2);
	assert.equal(await consumer.read(null), "two");
	assert.equal(consumer.contract, ReadV1, "Only the bootstrap hold is retokened");
	assert.equal(await host.get(ReadV2, {}).fetch(null), "two");
});

test("record-owned old-version holds still block an eager upgrade unless their consumer is replaced in the same batch", async () => {
	const host = new HostImpl({ onError: () => {} });
	onTestFinished(() => host.close());
	const Consumer = local("t.eager-consumer", {
		version: 1,
		input: Type.Object({}),
		members: { read: method(Type.Null(), Type.String()) },
	});
	const oldConsumer: Facet = {
		name: "consumer",
		setup: (api) =>
			api.serve(Consumer, (_input, _principal, self) => {
				const reader = self.get(ReadV1, {});
				return { read: (_args, ctx) => reader.read(null, ctx) };
			}),
	};
	const newConsumer: Facet = {
		name: "consumer",
		setup: (api) =>
			api.serve(Consumer, (_input, _principal, self) => {
				const reader = self.get(ReadV2, {});
				return { read: (_args, ctx) => reader.fetch(null, ctx) };
			}),
	};
	await host.load([readerV1, oldConsumer]);
	const consumer = host.get(Consumer, {});
	assert.equal(await consumer.read(null), "one");
	await assert.rejects(host.reload([readerV2()]), (error) => isChordError(error, "contract_mismatch"));
	assert.equal(await consumer.read(null), "one");
	await host.reload([readerV2(), newConsumer]);
	assert.equal(await consumer.read(null), "two");
	assert.equal(host.eager.get(ReadV2.name)?.contract, ReadV2);
});

test("a forgotten contract bump remains refused even when the only consumer is the host's eager hold", async () => {
	const host = new HostImpl({ onError: () => {} });
	onTestFinished(() => host.close());
	await host.load([readerV1]);
	const incompatible = local(ReadV1.name, {
		version: 1,
		input: Type.Object({}),
		members: { fetch: method(Type.Null(), Type.String()) },
	});
	await assert.rejects(
		host.reload([
			{ name: "read", setup: (api) => api.serve(incompatible, () => ({ fetch: () => "bad" }), { eager: true }) },
		]),
		(error) => isChordError(error, "contract_mismatch") && /without a version bump/.test(error.message),
	);
	assert.equal(host.eager.get(ReadV1.name)?.contract, ReadV1);
});

test("a cluster contract upgrade retokens server and worker eager holds only after unanimous preparation", async () => {
	const log: string[] = [];
	const facets = switchFacets(log);
	let valid = false;
	const server = new HostImpl({ onError: () => {} });
	const worker = new HostImpl({ name: "worker", onError: () => {}, loader: async () => [facets.v2(valid)] });
	onTestFinished(async () => {
		await worker.close();
		await server.close();
	});
	await server.load([facets.v1]);
	await worker.load([facets.v1]);
	const [down, up] = memoryLinkPair();
	server.accept(down, { kind: "host", name: "worker", principal: { worker: true } });
	worker.connect(up);
	await new Promise((resolve) => setImmediate(resolve));
	const serverOwn = server.eager.get(SwitchV1.name);
	const workerOwn = worker.eager.get(SwitchV1.name);
	await assert.rejects(server.reload([facets.v2(true)], { remote: { worker: ["switch"] } }), (error) =>
		isChordError(error, "invalid"),
	);
	assert.equal(server.eager.get(SwitchV1.name), serverOwn);
	assert.equal(worker.eager.get(SwitchV1.name), workerOwn);
	valid = true;
	await server.reload([facets.v2(true)], { remote: { worker: ["switch"] } });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(server.eager.get(SwitchV2.name)?.contract, SwitchV2);
	assert.equal(worker.eager.get(SwitchV2.name)?.contract, SwitchV2);
	assert.deepEqual(server.registry(Read).get("current")!(), { 1: false });
	assert.deepEqual(worker.registry(Read).get("current")!(), { 1: false });
	assert.equal(server.epoch, worker.epoch);
	assert.deepEqual(log, ["open", "open"]);
});
