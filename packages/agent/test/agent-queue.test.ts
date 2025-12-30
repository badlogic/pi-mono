import { getModel, type Message } from "@mariozechner/pi-ai";
import { beforeEach, describe, expect, it } from "vitest";
import { Agent } from "../src/index.js";

describe("Agent message queue", () => {
	let agent: Agent;

	beforeEach(() => {
		agent = new Agent({
			initialState: {
				model: getModel("google", "gemini-2.5-flash-lite-preview-06-17"),
				systemPrompt: "test",
				tools: [],
			},
		});
	});

	describe("updateQueuedUserMessageByTimestamp", () => {
		it("updates message with matching timestamp", () => {
			const timestamp = Date.now();
			agent.queueMessage({
				role: "user",
				content: [{ type: "text", text: "original" }],
				timestamp,
			});

			const success = agent.updateQueuedUserMessageByTimestamp(timestamp, "edited");
			expect(success).toBe(true);

			const queue = agent.getMessageQueue();
			expect(queue).toHaveLength(1);
			expect(queue[0].role).toBe("user");
			expect((queue[0] as Message).content).toEqual([{ type: "text", text: "edited" }]);
		});

		it("returns false for non-existent timestamp", () => {
			const success = agent.updateQueuedUserMessageByTimestamp(99999, "edited");
			expect(success).toBe(false);
		});

		it("ignores non-user messages with same timestamp", () => {
			const timestamp = Date.now();
			agent.queueMessage({
				role: "assistant",
				content: [{ type: "text", text: "original" }],
				timestamp,
			} as any);

			const success = agent.updateQueuedUserMessageByTimestamp(timestamp, "edited");
			expect(success).toBe(false);

			// Verify the message was not modified
			const queue = agent.getMessageQueue();
			expect(queue).toHaveLength(1);
			expect((queue[0] as Message).content).toEqual([{ type: "text", text: "original" }]);
		});

		it("preserves timestamp after update", () => {
			const timestamp = Date.now();
			agent.queueMessage({
				role: "user",
				content: [{ type: "text", text: "original" }],
				timestamp,
			});

			agent.updateQueuedUserMessageByTimestamp(timestamp, "edited");

			const queue = agent.getMessageQueue();
			expect(queue[0].timestamp).toBe(timestamp);
		});

		it("updates only the first matching message", () => {
			const timestamp = Date.now();
			agent.queueMessage({
				role: "user",
				content: [{ type: "text", text: "first" }],
				timestamp,
			});
			agent.queueMessage({
				role: "user",
				content: [{ type: "text", text: "second" }],
				timestamp: timestamp + 1,
			});

			const success = agent.updateQueuedUserMessageByTimestamp(timestamp, "updated first");
			expect(success).toBe(true);

			const queue = agent.getMessageQueue();
			expect(queue).toHaveLength(2);
			expect((queue[0] as Message).content).toEqual([{ type: "text", text: "updated first" }]);
			expect((queue[1] as Message).content).toEqual([{ type: "text", text: "second" }]);
		});
	});

	describe("removeQueuedUserMessageByTimestamp", () => {
		it("removes message with matching timestamp", () => {
			const timestamp = Date.now();
			agent.queueMessage({
				role: "user",
				content: [{ type: "text", text: "to delete" }],
				timestamp,
			});

			const success = agent.removeQueuedUserMessageByTimestamp(timestamp);
			expect(success).toBe(true);

			const queue = agent.getMessageQueue();
			expect(queue).toHaveLength(0);
		});

		it("returns false for non-existent timestamp", () => {
			const success = agent.removeQueuedUserMessageByTimestamp(99999);
			expect(success).toBe(false);
		});

		it("ignores non-user messages with same timestamp", () => {
			const timestamp = Date.now();
			agent.queueMessage({
				role: "assistant",
				content: [{ type: "text", text: "assistant msg" }],
				timestamp,
			} as any);

			const success = agent.removeQueuedUserMessageByTimestamp(timestamp);
			expect(success).toBe(false);

			const queue = agent.getMessageQueue();
			expect(queue).toHaveLength(1);
		});

		it("removes only the first matching message", () => {
			const timestamp1 = Date.now();
			const timestamp2 = timestamp1 + 1;
			agent.queueMessage({
				role: "user",
				content: [{ type: "text", text: "first" }],
				timestamp: timestamp1,
			});
			agent.queueMessage({
				role: "user",
				content: [{ type: "text", text: "second" }],
				timestamp: timestamp2,
			});

			const success = agent.removeQueuedUserMessageByTimestamp(timestamp1);
			expect(success).toBe(true);

			const queue = agent.getMessageQueue();
			expect(queue).toHaveLength(1);
			expect((queue[0] as Message).content).toEqual([{ type: "text", text: "second" }]);
		});

		it("removes middle message correctly", () => {
			const ts1 = Date.now();
			const ts2 = ts1 + 1;
			const ts3 = ts1 + 2;

			agent.queueMessage({
				role: "user",
				content: [{ type: "text", text: "first" }],
				timestamp: ts1,
			});
			agent.queueMessage({
				role: "user",
				content: [{ type: "text", text: "second" }],
				timestamp: ts2,
			});
			agent.queueMessage({
				role: "user",
				content: [{ type: "text", text: "third" }],
				timestamp: ts3,
			});

			const success = agent.removeQueuedUserMessageByTimestamp(ts2);
			expect(success).toBe(true);

			const queue = agent.getMessageQueue();
			expect(queue).toHaveLength(2);
			expect((queue[0] as Message).content).toEqual([{ type: "text", text: "first" }]);
			expect((queue[1] as Message).content).toEqual([{ type: "text", text: "third" }]);
		});
	});

	describe("queue operations integration", () => {
		it("can update and then remove the same message", () => {
			const timestamp = Date.now();
			agent.queueMessage({
				role: "user",
				content: [{ type: "text", text: "original" }],
				timestamp,
			});

			// Update first
			const updateSuccess = agent.updateQueuedUserMessageByTimestamp(timestamp, "updated");
			expect(updateSuccess).toBe(true);

			// Then remove
			const removeSuccess = agent.removeQueuedUserMessageByTimestamp(timestamp);
			expect(removeSuccess).toBe(true);

			expect(agent.getMessageQueue()).toHaveLength(0);
		});

		it("clearMessageQueue removes all messages", () => {
			agent.queueMessage({
				role: "user",
				content: [{ type: "text", text: "first" }],
				timestamp: Date.now(),
			});
			agent.queueMessage({
				role: "user",
				content: [{ type: "text", text: "second" }],
				timestamp: Date.now() + 1,
			});

			agent.clearMessageQueue();

			expect(agent.getMessageQueue()).toHaveLength(0);
		});
	});
});
