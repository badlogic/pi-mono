/**
 * Tests for request size management utilities.
 *
 * Tests countImages() and stripOldestImages() which handle the case where
 * accumulated image data in a session exceeds provider HTTP request size limits.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ImageContent, TextContent, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { countImages, stripOldestImages } from "../src/core/request-size.js";

// Helper to create a user message with text
function userText(text: string): UserMessage {
	return { role: "user", content: text, timestamp: Date.now() };
}

// Helper to create a user message with image content
function userWithImage(text: string, imageData = "base64data"): UserMessage {
	return {
		role: "user",
		content: [
			{ type: "text", text },
			{ type: "image", data: imageData, mimeType: "image/png" },
		],
		timestamp: Date.now(),
	};
}

// Helper to create a tool result with image content
function toolResultWithImage(imageData = "base64data"): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: "call_1",
		toolName: "read",
		content: [
			{ type: "text", text: "Read image.png [image/png]" },
			{ type: "image", data: imageData, mimeType: "image/png" },
		],
		isError: false,
		timestamp: Date.now(),
	};
}

// Helper to create a tool result with only text
function toolResultText(text: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: "call_1",
		toolName: "read",
		content: [{ type: "text", text }],
		isError: false,
		timestamp: Date.now(),
	};
}

// Helper to create an assistant message
function assistantMsg(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4",
		usage: {
			input: 100,
			output: 50,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 150,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("countImages", () => {
	it("should return 0 for empty messages", () => {
		expect(countImages([])).toBe(0);
	});

	it("should return 0 for text-only messages", () => {
		const messages: AgentMessage[] = [userText("hello"), assistantMsg("hi"), toolResultText("file content")];
		expect(countImages(messages)).toBe(0);
	});

	it("should count images in user messages", () => {
		const messages: AgentMessage[] = [userWithImage("look at this"), userWithImage("and this")];
		expect(countImages(messages)).toBe(2);
	});

	it("should count images in tool results", () => {
		const messages: AgentMessage[] = [toolResultWithImage(), toolResultWithImage(), toolResultWithImage()];
		expect(countImages(messages)).toBe(3);
	});

	it("should count images across mixed message types", () => {
		const messages: AgentMessage[] = [
			userWithImage("img 1"),
			assistantMsg("I see the image"),
			toolResultWithImage(),
			assistantMsg("And this one"),
			toolResultText("just text"),
			userWithImage("img 3"),
		];
		expect(countImages(messages)).toBe(3);
	});

	it("should not count images in assistant messages", () => {
		const messages: AgentMessage[] = [assistantMsg("no images here")];
		expect(countImages(messages)).toBe(0);
	});

	it("should handle user messages with string content", () => {
		const messages: AgentMessage[] = [userText("just a string")];
		expect(countImages(messages)).toBe(0);
	});
});

describe("stripOldestImages", () => {
	it("should return original messages when no images", () => {
		const messages: AgentMessage[] = [userText("hello"), assistantMsg("hi")];
		const result = stripOldestImages(messages);
		expect(result.strippedCount).toBe(0);
		expect(result.messages).toBe(messages); // Same reference
	});

	it("should strip half of images (rounded up) from oldest first", () => {
		const messages: AgentMessage[] = [
			toolResultWithImage("img1"), // oldest - should be stripped
			assistantMsg("response 1"),
			toolResultWithImage("img2"), // should be stripped
			assistantMsg("response 2"),
			toolResultWithImage("img3"), // should be kept
			assistantMsg("response 3"),
			toolResultWithImage("img4"), // should be kept
		];

		const result = stripOldestImages(messages);
		expect(result.strippedCount).toBe(2); // ceil(4/2) = 2

		// First two tool results should have images replaced
		const first = result.messages[0] as ToolResultMessage;
		expect(first.content).toHaveLength(2);
		expect(first.content[0].type).toBe("text");
		expect((first.content[0] as TextContent).text).toBe("Read image.png [image/png]");
		expect(first.content[1].type).toBe("text"); // was image, now text placeholder
		expect((first.content[1] as TextContent).text).toContain("image omitted");

		const third = result.messages[2] as ToolResultMessage;
		expect(third.content[1].type).toBe("text"); // also stripped
		expect((third.content[1] as TextContent).text).toContain("image omitted");

		// Last two should still have images
		const fifth = result.messages[4] as ToolResultMessage;
		expect(fifth.content[1].type).toBe("image");
		expect((fifth.content[1] as ImageContent).data).toBe("img3");

		const seventh = result.messages[6] as ToolResultMessage;
		expect(seventh.content[1].type).toBe("image");
		expect((seventh.content[1] as ImageContent).data).toBe("img4");
	});

	it("should strip 1 image when there are only 1 (ceil(1/2) = 1)", () => {
		const messages: AgentMessage[] = [toolResultWithImage("only_img")];

		const result = stripOldestImages(messages);
		expect(result.strippedCount).toBe(1);

		const msg = result.messages[0] as ToolResultMessage;
		expect(msg.content[1].type).toBe("text");
		expect((msg.content[1] as TextContent).text).toContain("image omitted");
	});

	it("should strip 2 images when there are 3 (ceil(3/2) = 2)", () => {
		const messages: AgentMessage[] = [
			toolResultWithImage("img1"),
			toolResultWithImage("img2"),
			toolResultWithImage("img3"),
		];

		const result = stripOldestImages(messages);
		expect(result.strippedCount).toBe(2);

		// First two stripped
		expect(((result.messages[0] as ToolResultMessage).content[1] as TextContent).text).toContain("image omitted");
		expect(((result.messages[1] as ToolResultMessage).content[1] as TextContent).text).toContain("image omitted");

		// Third kept
		expect((result.messages[2] as ToolResultMessage).content[1].type).toBe("image");
	});

	it("should not mutate original messages array", () => {
		const original: AgentMessage[] = [toolResultWithImage("img1"), toolResultWithImage("img2")];
		const originalContent = (original[0] as ToolResultMessage).content;

		stripOldestImages(original);

		// Original should be unchanged
		expect((original[0] as ToolResultMessage).content).toBe(originalContent);
		expect((original[0] as ToolResultMessage).content[1].type).toBe("image");
	});

	it("should preserve text content alongside stripped images", () => {
		const messages: AgentMessage[] = [
			{
				role: "toolResult",
				toolCallId: "call_1",
				toolName: "read",
				content: [
					{ type: "text", text: "Read screenshot.png [image/png]" },
					{ type: "text", text: "[Image: original 1920x1080, displayed at 1000x562]" },
					{ type: "image", data: "big_image_data", mimeType: "image/png" },
				],
				isError: false,
				timestamp: Date.now(),
			} satisfies ToolResultMessage,
		];

		const result = stripOldestImages(messages);
		expect(result.strippedCount).toBe(1);

		const msg = result.messages[0] as ToolResultMessage;
		expect(msg.content).toHaveLength(3);
		expect((msg.content[0] as TextContent).text).toBe("Read screenshot.png [image/png]");
		expect((msg.content[1] as TextContent).text).toBe("[Image: original 1920x1080, displayed at 1000x562]");
		expect(msg.content[2].type).toBe("text"); // replaced image
		expect((msg.content[2] as TextContent).text).toContain("image omitted");
	});

	it("should handle mixed user and tool result images", () => {
		const messages: AgentMessage[] = [
			userWithImage("user img 1"), // stripped (oldest)
			assistantMsg("ok"),
			toolResultWithImage("tool img"), // stripped
			assistantMsg("I see"),
			userWithImage("user img 2"), // kept (newest)
		];

		const result = stripOldestImages(messages);
		expect(result.strippedCount).toBe(2); // ceil(3/2) = 2

		// User image 1 stripped
		const first = result.messages[0] as UserMessage;
		expect((first.content as (TextContent | ImageContent)[])[1].type).toBe("text");

		// Tool result image stripped
		const third = result.messages[2] as ToolResultMessage;
		expect(third.content[1].type).toBe("text");

		// User image 2 kept
		const fifth = result.messages[4] as UserMessage;
		expect((fifth.content as (TextContent | ImageContent)[])[1].type).toBe("image");
	});

	it("should handle iterative stripping (simulating retry loop)", () => {
		const messages: AgentMessage[] = [
			toolResultWithImage("img1"),
			toolResultWithImage("img2"),
			toolResultWithImage("img3"),
			toolResultWithImage("img4"),
			toolResultWithImage("img5"),
			toolResultWithImage("img6"),
		];

		// First strip: 3 of 6
		const first = stripOldestImages(messages);
		expect(first.strippedCount).toBe(3);
		expect(countImages(first.messages)).toBe(3);

		// Second strip: 2 of 3
		const second = stripOldestImages(first.messages);
		expect(second.strippedCount).toBe(2);
		expect(countImages(second.messages)).toBe(1);

		// Third strip: 1 of 1
		const third = stripOldestImages(second.messages);
		expect(third.strippedCount).toBe(1);
		expect(countImages(third.messages)).toBe(0);

		// Fourth strip: nothing left
		const fourth = stripOldestImages(third.messages);
		expect(fourth.strippedCount).toBe(0);
	});

	it("should count and strip images in custom messages", () => {
		const customWithImage: AgentMessage = {
			role: "custom",
			customType: "artifact",
			content: [
				{ type: "text", text: "Generated image:" },
				{ type: "image", data: "custom_img_data", mimeType: "image/png" },
			],
			display: true,
			timestamp: Date.now(),
		};

		const messages: AgentMessage[] = [customWithImage, toolResultWithImage("tool_img")];

		expect(countImages(messages)).toBe(2);

		const result = stripOldestImages(messages);
		expect(result.strippedCount).toBe(1); // ceil(2/2) = 1, strips oldest (custom)

		// Custom message image should be stripped
		const custom = result.messages[0] as { role: "custom"; content: (TextContent | ImageContent)[] };
		expect(custom.content[0].type).toBe("text");
		expect((custom.content[0] as TextContent).text).toBe("Generated image:");
		expect(custom.content[1].type).toBe("text"); // replaced
		expect((custom.content[1] as TextContent).text).toContain("image omitted");

		// Tool result image should be kept
		const tool = result.messages[1] as ToolResultMessage;
		expect(tool.content[1].type).toBe("image");
	});

	it("should handle custom messages with string content (no images)", () => {
		const messages: AgentMessage[] = [
			{
				role: "custom",
				customType: "note",
				content: "just a string, no images",
				display: true,
				timestamp: Date.now(),
			},
		];

		expect(countImages(messages)).toBe(0);
		const result = stripOldestImages(messages);
		expect(result.strippedCount).toBe(0);
	});
});
