/**
 * Input Transform Example - demonstrates the `input` event for intercepting user input.
 *
 * Start pi with this extension:
 *   pi -e ./examples/extensions/input-transform.ts
 *
 * Then type these inside pi:
 *   ?quick What is TypeScript?  → "Respond briefly: What is TypeScript?"
 *   ping                        → "pong" (instant, no LLM)
 *   time                        → current time (instant, no LLM)
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("input", async (event, _ctx) => {
		// Transform: ?quick prefix for brief responses
		if (event.text.startsWith("?quick ")) {
			const query = event.text.slice(7).trim();
			return query
				? { action: "transform", text: `Respond briefly in 1-2 sentences: ${query}` }
				: { action: "handled", response: "Usage: ?quick <question>" };
		}

		// Handle: instant responses without LLM
		if (event.text.toLowerCase() === "ping") return { action: "handled", response: "pong" };
		if (event.text.toLowerCase() === "time") return { action: "handled", response: new Date().toLocaleString() };

		// Source-based routing example
		if (event.source === "rpc" && event.text === "__health__") {
			return { action: "handled", response: "ok" };
		}

		return { action: "continue" };
	});
}
