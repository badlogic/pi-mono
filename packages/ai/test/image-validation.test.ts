import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ImageContent, Message } from "../src/types.js";
import { sanitizeImages } from "../src/utils/image-validation.js";

const redPngBase64 = readFileSync(join(__dirname, "data", "red-circle.png")).toString("base64");

function makeImage(data: string): ImageContent {
	return { type: "image", data, mimeType: "image/png" };
}

function makeMessageWithImages(images: ImageContent[]): Message {
	return { role: "user", content: images, timestamp: 0 };
}

describe("sanitizeImages", () => {
	it("removes images over byte limit and reports a note", () => {
		const small = makeImage(redPngBase64);
		const bigBuffer = Buffer.alloc(2 * 1024 * 1024); // ~2MB decoded
		const big = makeImage(bigBuffer.toString("base64"));

		const { messages, note } = sanitizeImages([makeMessageWithImages([small]), makeMessageWithImages([big])], {
			providerLabel: "Test",
			maxBytes: 1 * 1024 * 1024,
		});

		// The oversize image should be dropped, leaving only the first message
		expect(messages).toHaveLength(1);
		expect(note).toContain("over size limit");
		expect(note).toContain("1 image");
	});

	it("removes images over dimension limit", () => {
		const { messages, note } = sanitizeImages([makeMessageWithImages([makeImage(redPngBase64)])], {
			providerLabel: "Test",
			maxDimension: 50,
		});

		expect(messages).toHaveLength(0);
		expect(note).toContain("dimension limit (50px)");
	});

	it("applies many-image downscale rule when over threshold", () => {
		const imgs = Array.from({ length: 3 }, () => makeImage(redPngBase64));

		const { messages, note } = sanitizeImages([makeMessageWithImages(imgs)], {
			providerLabel: "Test",
			manyImageLimit: { threshold: 2, maxDimension: 50 },
		});

		expect(messages).toHaveLength(0);
		expect(note).toContain("over 50px when >2 images");
		expect(note).toContain("3 images");
	});

	it("enforces maxImages cap", () => {
		const imgs = Array.from({ length: 5 }, () => makeImage(redPngBase64));

		const { messages, note } = sanitizeImages([makeMessageWithImages(imgs)], {
			providerLabel: "Test",
			maxImages: 3,
		});

		const remaining = messages[0]?.content as ImageContent[];
		expect(remaining).toHaveLength(3);
		expect(note).toContain("dropped to stay within 3 images");
		expect(note).toContain("2 images");
	});

	it("drops empty messages after image removal", () => {
		const { messages, note } = sanitizeImages([makeMessageWithImages([makeImage(redPngBase64)])], {
			providerLabel: "Test",
			maxBytes: 1,
		});

		expect(messages).toHaveLength(0);
		expect(note).toBeDefined();
	});

	it("keeps images at the byte limit boundary", () => {
		const limit = 1 * 1024 * 1024; // 1MB
		const buffer = Buffer.alloc(limit - 1024); // just under limit
		const near = makeImage(buffer.toString("base64"));

		const { messages, note } = sanitizeImages([makeMessageWithImages([near])], {
			providerLabel: "Test",
			maxBytes: limit,
		});

		expect(messages).toHaveLength(1);
		const remaining = messages[0]?.content as ImageContent[];
		expect(remaining).toHaveLength(1);
		expect(note).toBeUndefined();
	});

	it("returns no note when nothing is removed", () => {
		const { messages, note } = sanitizeImages([makeMessageWithImages([makeImage(redPngBase64)])], {
			providerLabel: "Test",
			maxBytes: 10 * 1024 * 1024,
		});

		expect(messages).toHaveLength(1);
		expect(note).toBeUndefined();
	});
});
