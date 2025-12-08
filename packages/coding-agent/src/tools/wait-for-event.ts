import type { AgentTool } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { ENV_SESSION_ID } from "../config.js";
import type { EventReceiver } from "../control-channel.js";

const waitForEventSchema = Type.Object({
	timeout_ms: Type.Optional(
		Type.Number({
			description: "Timeout in milliseconds (default: 60000, i.e., 60 seconds)",
			default: 60000,
		}),
	),
	description: Type.Optional(
		Type.String({
			description: "Optional description of what event you are waiting for (for logging purposes)",
		}),
	),
});

/**
 * Create a wait_for_event tool bound to a specific EventReceiver.
 * This tool allows the agent to pause and wait for external events sent via `pi --send-event`.
 * When an event arrives, it is automatically injected as a user message - this tool just
 * blocks until that happens (or times out).
 */
export function createWaitForEventTool(eventReceiver: EventReceiver | null): AgentTool<typeof waitForEventSchema> {
	return {
		name: "wait_for_event",
		label: "wait for event",
		description: `Wait for an external event to be sent to this session. External processes can send events using 'pi --session $${ENV_SESSION_ID} --send-event '{"type":"example"}''. When an event arrives, it will be automatically injected as a user message. This tool blocks until an event arrives or the timeout expires. Use this when you need to pause execution and wait for external input.`,
		parameters: waitForEventSchema,
		execute: async (
			_toolCallId: string,
			{ timeout_ms = 60000, description }: { timeout_ms?: number; description?: string },
			signal?: AbortSignal,
		) => {
			if (!eventReceiver) {
				return {
					content: [
						{
							type: "text",
							text: "Event receiver not available. The session may not have been started with event support.",
						},
					],
					details: { error: "no_event_receiver" },
				};
			}

			// Create a promise that resolves when aborted
			const abortPromise = new Promise<null>((resolve) => {
				if (signal?.aborted) {
					resolve(null);
					return;
				}
				signal?.addEventListener("abort", () => resolve(null), { once: true });
			});

			// Race between event arrival and abort
			const event = await Promise.race([eventReceiver.waitForEvent(timeout_ms), abortPromise]);

			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "Wait for event was aborted." }],
					details: { aborted: true },
				};
			}

			if (event === null) {
				const descPart = description ? ` (waiting for: ${description})` : "";
				return {
					content: [
						{
							type: "text",
							text: `Timeout: No event received within ${timeout_ms}ms${descPart}.`,
						},
					],
					details: { timeout: true, timeout_ms },
				};
			}

			// Event arrived - it will be injected as a user message by the event callback
			return {
				content: [
					{
						type: "text",
						text: "Event received. The event content has been injected as a user message.",
					},
				],
				details: {
					eventId: event.id,
					timestamp: event.timestamp,
				},
			};
		},
	};
}
