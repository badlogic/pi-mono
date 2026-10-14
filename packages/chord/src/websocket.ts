import type { AcceptOptions } from "./connection.ts";
import type { Host } from "./host.ts";
import { type WebSocketLike, webSocketLink } from "./link.ts";
import type { Principal } from "./types.ts";

/** A WebSocket server (e.g. `ws`'s `WebSocketServer`), structurally: Chord does not depend on `ws`. */
export interface WebSocketServerLike<Request> {
	on(event: "connection", listener: (socket: WebSocketLike, request: Request) => void): unknown;
}

/** WebSocket peers are always accepted as clients: no roots, no code versions, no reload votes, not addressable. */
export interface WebSocketAcceptOptions<Request> extends Omit<AcceptOptions, "principal" | "kind" | "name"> {
	/** The authenticator: the principal of the connecting client, or undefined to refuse it. */
	principal(request: Request): Principal | undefined | Promise<Principal | undefined>;
}

/** Accepts every connection of `server` on `host` as a client link stamped with the authenticated principal. */
export function acceptWebSockets<Request>(
	server: WebSocketServerLike<Request>,
	host: Host,
	options: WebSocketAcceptOptions<Request>,
): void {
	server.on("connection", (socket, request) => {
		// Wrap at once so frames sent while authenticating are queued, not lost. Large payloads go out deflated; clients
		// may not send packed frames (a small message could inflate to anything).
		const link = webSocketLink(socket, { compress: true, acceptPacked: false });
		Promise.resolve(options.principal(request)).then(
			(principal) => {
				if (principal === undefined) link.close("unauthorized");
				else host.accept(link, { ...options, principal, kind: "client" });
			},
			() => link.close("authentication failed"),
		);
	});
}
