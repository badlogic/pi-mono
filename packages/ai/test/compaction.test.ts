import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/stream.js", () => ({
	completeSimple: vi.fn(async () => ({
		role: "assistant",
		content: [{ type: "text", text: "mock summary" }],
		api: "openai-completions",
		provider: "openai",
		model: "stub",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	})) as any,
}));

import { ConversationCompactor } from "../src/agent/compaction/compactor.js";
import { COMPACT_BOUNDARY_TAG, COMPACT_SUMMARY_TAG } from "../src/agent/compaction/types.js";
import type { Message, Model } from "../src/types.js";

const stubModel: Model<any> = {
	id: "stub",
	name: "stub",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100,
	maxTokens: 32_000,
};

const makeUser = (text: string): Message => ({
	role: "user",
	content: [{ type: "text", text }],
	timestamp: Date.now(),
});

const makeAssistant = (text: string): Message => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "openai-completions",
	provider: "openai",
	model: "stub",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: Date.now(),
});

describe("ConversationCompactor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("compacts when over threshold and inserts boundary + summary", async () => {
		const compactor = new ConversationCompactor({ tailMessages: 1, triggerRatio: 0.1 });
		const messages: Message[] = [
			makeUser("hello"),
			makeAssistant("response one"),
			makeUser("another prompt that is quite long to inflate tokens"),
		];

		const res = await compactor.maybeCompact(messages, { model: stubModel, systemPrompt: "sys" });

		expect(res.compacted).toBe(true);
		expect(
			res.messages.some(
				(m) =>
					m.role === "assistant" &&
					m.content.some((c) => c.type === "text" && c.text.startsWith(COMPACT_BOUNDARY_TAG)),
			),
		).toBe(true);
		expect(
			res.messages.some(
				(m) =>
					m.role === "assistant" &&
					m.content.some((c) => c.type === "text" && c.text.includes(COMPACT_SUMMARY_TAG)),
			),
		).toBe(true);
		// tailMessages=1 ensures the last original message is preserved
		expect(res.messages[res.messages.length - 1]).toEqual(messages[messages.length - 1]);
	});

	it("skips compaction under threshold unless forced", async () => {
		const compactor = new ConversationCompactor({ triggerRatio: 0.8 });
		const messages: Message[] = [makeUser("short"), makeAssistant("short reply")];

		const auto = await compactor.maybeCompact(messages, { model: stubModel, systemPrompt: "sys" });
		expect(auto.compacted).toBe(false);

		const forced = await compactor.maybeCompact(messages, { model: stubModel, systemPrompt: "sys" }, { force: true });
		expect(forced.compacted).toBe(true);
	});
});
