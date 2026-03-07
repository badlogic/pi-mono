import type { AssistantMessage } from "@mariozechner/pi-ai";
import { type Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { describe, expect, test } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.js";

interface AssistantMessageComponentInternals {
	contentContainer: Container;
}

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function getContentChildren(component: AssistantMessageComponent) {
	return (component as unknown as AssistantMessageComponentInternals).contentContainer.children;
}

describe("AssistantMessageComponent streaming updates", () => {
	test("reuses a cheap Text component while streaming", () => {
		const component = new AssistantMessageComponent();
		component.setStreamingMode(true);
		component.updateContent(createAssistantMessage("Hello"));

		const initialChildren = getContentChildren(component);
		expect(initialChildren).toHaveLength(2);
		expect(initialChildren[0]).toBeInstanceOf(Spacer);
		expect(initialChildren[1]).toBeInstanceOf(Text);

		const initialTextComponent = initialChildren[1];

		component.updateContent(createAssistantMessage("Hello world"));

		const updatedChildren = getContentChildren(component);
		expect(updatedChildren[1]).toBe(initialTextComponent);
		expect(updatedChildren[1]).toBeInstanceOf(Text);
		expect(updatedChildren[1]).not.toBeInstanceOf(Markdown);
	});

	test("switches back to Markdown rendering after streaming ends", () => {
		const component = new AssistantMessageComponent();
		const message = createAssistantMessage("**Hello**");

		component.setStreamingMode(true);
		component.updateContent(message);
		expect(getContentChildren(component)[1]).toBeInstanceOf(Text);

		component.setStreamingMode(false);
		component.updateContent(message);

		const children = getContentChildren(component);
		expect(children).toHaveLength(2);
		expect(children[1]).toBeInstanceOf(Markdown);
	});
});
