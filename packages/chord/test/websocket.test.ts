import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { Type } from "typebox";
import { describe, it } from "vitest";
import { WebSocketServer } from "ws";
import {
	acceptWebSockets,
	cell,
	createHost,
	isChordError,
	method,
	remote,
	type WebSocketLike,
	webSocketLink,
} from "../src/index.ts";

const Board = remote("t.board", {
	version: 1,
	input: Type.Object({}),
	variants: {
		main: {
			state: { notes: Type.Array(Type.String()) },
			methods: { add: method(Type.String(), Type.Null()), who: method(Type.Null(), Type.Unknown()) },
		},
	},
});

describe("WebSocket links", () => {
	it("serves a browser-style client over a real socket, stamped by the authenticator", async () => {
		const server = createHost({ name: "server", onError: () => {} });
		server.serve(Board, (_input, principal, self) => {
			const state = self.state({ notes: cell(Type.Array(Type.String()), []) });
			return {
				kind: "main",
				notes: state.notes,
				add: (text, ctx) => {
					state.notes.change(ctx, (draft) => {
						draft.push(text);
					});
					return null;
				},
				who: () => principal,
			};
		});
		const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
		await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
		acceptWebSockets(wss as never, server, {
			principal: (request: IncomingMessage) => {
				const token = new URL(request.url ?? "/", "http://x").searchParams.get("token");
				return token === "ok" ? { guest: "web" } : undefined;
			},
		});
		const port = (wss.address() as { port: number }).port;
		const open = (token: string) =>
			createHost({
				name: "browser",
				kind: "client",
				upstream: webSocketLink(
					new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`) as unknown as WebSocketLike,
				),
				onError: () => {},
			});
		try {
			const browser = open("ok");
			const board = browser.get(Board, {}, { at: "server" });
			const seen: unknown[] = [];
			board.notes.subscribe((value) => seen.push(value));
			await board.add("hello");
			assert.deepEqual(await board.who(null), { guest: "web" });
			for (let i = 0; i < 50 && board.notes.value?.length !== 1; i++) await new Promise((r) => setTimeout(r, 5));
			assert.deepEqual(board.notes.value, ["hello"]);
			assert.deepEqual(seen.at(-1), ["hello"]);
			await browser.close();

			// WebSocket peers are always clients: one announcing itself as a host is cut off.
			const impostor = createHost({
				name: "session:S1",
				upstream: webSocketLink(new WebSocket(`ws://127.0.0.1:${port}/?token=ok`) as unknown as WebSocketLike),
				onError: () => {},
			});
			await assert.rejects(
				impostor.root((ctx) => impostor.get(Board, {}, { at: "server" }).add("x", ctx), {
					signal: AbortSignal.timeout(150),
				}),
				(error) => isChordError(error, "aborted"),
			);
			await impostor.close();

			const refused = open("bad");
			const denied = refused.get(Board, {}, { at: "server" });
			// The server closes unauthenticated sockets; calls wait for a reconnect until their ctx gives up.
			await assert.rejects(
				refused.root((ctx) => denied.add("x", ctx), { signal: AbortSignal.timeout(100) }),
				(error) => isChordError(error, "aborted"),
			);
			await refused.close();
		} finally {
			await new Promise<void>((resolve) => wss.close(() => resolve()));
		}
	});
});
