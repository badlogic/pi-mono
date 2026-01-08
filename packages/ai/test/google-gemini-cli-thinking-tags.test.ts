import { describe, expect, it } from "vitest";
import { splitThinkingTags, type ThinkingTagState } from "../src/providers/google-gemini-cli.js";

describe("google-gemini-cli thinking tag parsing", () => {
	it("splits tagged content in a single chunk", () => {
		const state: ThinkingTagState = { inThinking: false, pending: "" };
		const segments = splitThinkingTags("<thinking>alpha</thinking>beta", state);
		expect(segments).toEqual([
			{ text: "alpha", isThinking: true },
			{ text: "beta", isThinking: false },
		]);
		expect(state).toEqual({ inThinking: false, pending: "" });
	});

	it("handles tags split across chunks", () => {
		const state: ThinkingTagState = { inThinking: false, pending: "" };
		const first = splitThinkingTags("<think", state);
		expect(first).toEqual([]);
		expect(state).toEqual({ inThinking: false, pending: "<think" });

		const second = splitThinkingTags("ing>alpha</thinking>beta", state);
		expect(second).toEqual([
			{ text: "alpha", isThinking: true },
			{ text: "beta", isThinking: false },
		]);
		expect(state).toEqual({ inThinking: false, pending: "" });
	});

	it("keeps thinking state across chunks", () => {
		const state: ThinkingTagState = { inThinking: false, pending: "" };
		const first = splitThinkingTags("<thinking>alpha", state);
		expect(first).toEqual([{ text: "alpha", isThinking: true }]);
		expect(state).toEqual({ inThinking: true, pending: "" });

		const second = splitThinkingTags("beta</thinking>gamma", state);
		expect(second).toEqual([
			{ text: "beta", isThinking: true },
			{ text: "gamma", isThinking: false },
		]);
		expect(state).toEqual({ inThinking: false, pending: "" });
	});
});
