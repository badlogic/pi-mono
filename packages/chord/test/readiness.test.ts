import assert from "node:assert/strict";
import { Type } from "typebox";
import { describe, it } from "vitest";
import {
	createHost,
	defineRegistry,
	type FacetApi,
	forbidden,
	isChordError,
	local,
	memoryLinkPair,
	remote,
	resource,
} from "../src/index.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const unexpectedError = (error: unknown) => assert.fail(String(error));
const Eager = local("ready.eager", { version: 1, input: Type.Object({}) });
const Lazy = local("ready.lazy", { version: 1, input: Type.Object({}) });

// Startup must not report ready while an eager object has failed.
describe("host: eager readiness", () => {
	for (const operation of ["install", "load"] as const) {
		it(`${operation} awaits resource activation and registration, leaving lazy objects lazy`, async () => {
			const host = createHost({ onError: unexpectedError });
			const entries = defineRegistry<string>("ready.entries");
			let opened = () => {};
			let lazyRuns = 0;
			let settled = false;
			const facet = {
				name: "ready",
				setup({ serve }: FacetApi) {
					serve(
						Eager,
						(_input, _principal, self) => {
							self.resources({
								r: resource({
									rev: 1,
									open: () =>
										new Promise<void>((resolve) => {
											opened = resolve;
										}),
								}),
							});
							self.register(entries, { eager: "live" });
							return {};
						},
						{ eager: true },
					);
					serve(Lazy, () => {
						lazyRuns++;
						return {};
					});
				},
			};
			try {
				const loading = operation === "install" ? host.install(facet) : host.load([facet]);
				void loading.then(() => {
					settled = true;
				});
				await tick();
				assert.equal(settled, false);
				assert.equal(host.registry(entries).get("eager"), undefined);
				opened();
				await loading;
				assert.equal(host.registry(entries).get("eager"), "live");
				assert.equal(lazyRuns, 0);
			} finally {
				await host.close();
			}
		});

		for (const failure of ["factory", "dependency", "resource"] as const) {
			it(`${operation} rejects eager ${failure} failure with the activation error`, async () => {
				const errors: unknown[] = [];
				const host = createHost({ onError: (error) => errors.push(error) });
				const cause = forbidden(`${failure} failed`);
				const facet = {
					name: "bad",
					setup({ serve }: FacetApi) {
						serve(Lazy, () => {
							throw cause;
						});
						serve(
							Eager,
							(_input, _principal, self) => {
								if (failure === "factory") throw cause;
								if (failure === "dependency") self.get(Lazy, {});
								if (failure === "resource")
									self.resources({
										r: resource({
											rev: 1,
											open: () => {
												throw cause;
											},
										}),
									});
								return {};
							},
							{ eager: true },
						);
					},
				};
				try {
					await assert.rejects(
						operation === "install" ? host.install(facet) : host.load([facet]),
						(error) => error === cause,
					);
					await assert.rejects(host.ready(), (error) => error === cause);
					assert.deepEqual(errors, [cause]);
				} finally {
					await host.close();
				}
			});
		}
	}

	it("load installs every facet before awaiting eager consumers", async () => {
		const host = createHost({ onError: unexpectedError });
		try {
			await host.load([
				{
					name: "consumer",
					setup: ({ serve }) =>
						serve(
							Eager,
							(_input, _principal, self) => {
								self.get(Lazy, {});
								return {};
							},
							{ eager: true },
						),
				},
				{ name: "provider", setup: ({ serve }) => serve(Lazy, () => ({})) },
			]);
			assert.equal(host.get(Eager, {}).status, "live");
		} finally {
			await host.close();
		}
	});

	it("missing eager dependencies reject load instead of only reaching onError", async () => {
		const host = createHost({ onError: () => {} });
		try {
			await assert.rejects(
				host.load([
					{
						name: "missing",
						setup: ({ serve }) =>
							serve(
								Eager,
								(_i, _p, self) => {
									self.get(Lazy, {});
									return {};
								},
								{ eager: true },
							),
					},
				]),
				(error) => isChordError(error, "unavailable") && error.reason === "unknown_type",
			);
		} finally {
			await host.close();
		}
	});

	it("ready includes direct eager serves and their configured inputs, but not later serves", async () => {
		const host = createHost({ onError: () => {} });
		const WithInput = local("ready.input", { version: 1, input: Type.Object({ id: Type.String() }) });
		let input: unknown;
		try {
			host.serve(
				WithInput,
				(value) => {
					input = value;
					return {};
				},
				{ eager: { input: { id: "bootstrap" } } },
			);
			const first = host.ready();
			host.serve(
				Eager,
				() => {
					throw forbidden("later");
				},
				{ eager: true },
			);
			await first;
			assert.deepEqual(input, { id: "bootstrap" });
			await assert.rejects(host.ready(), /later/);
		} finally {
			await host.close();
		}
	});

	for (const operation of ["install", "load"] as const) {
		it(`${operation} can defer eager readiness until the parent admits the worker`, { timeout: 2000 }, async () => {
			const server = createHost({ name: "server", onError: unexpectedError });
			const [parent, upstream] = memoryLinkPair();
			const worker = createHost({ name: "worker", upstream, onError: unexpectedError });
			const Status = remote("ready.status", { version: 1, input: Type.Object({}), variants: { default: {} } });
			server.serve(Status, () => ({ kind: "default" }));
			let bootstrap = false;
			let reported = false;
			const facet = {
				name: "worker",
				setup({ serve }: FacetApi) {
					serve(
						Lazy,
						() => {
							bootstrap = true;
							return {};
						},
						{ eager: true },
					);
					serve(
						Eager,
						(_input, _principal, self) => {
							const status = self.get(Status, {}, { at: "server" });
							self.resources({
								r: resource({
									rev: 1,
									deps: [status],
									open: () => {
										reported = true;
									},
								}),
							});
							return {};
						},
						{ eager: true },
					);
				},
			};
			try {
				await (operation === "install"
					? worker.install(facet, { awaitEager: false })
					: worker.load([facet], { awaitEager: false }));
				await worker.get(Lazy, {}).ready;
				assert.equal(bootstrap, true);
				let settled = false;
				const ready = worker.ready().then(() => {
					settled = true;
				});
				await tick();
				assert.equal(settled, false);
				assert.equal(reported, false);
				// Control-ready announcement allows the parent to accept the queued upstream holds.
				server.accept(parent, { kind: "host", name: "worker", principal: { host: "worker" } });
				await ready;
				assert.equal(reported, true);
			} finally {
				await worker.close();
				await server.close();
			}
		});
	}
});
