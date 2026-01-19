import type { ImageContent } from "@mariozechner/pi-ai";
import { describe, expect, test } from "vitest";
import {
	filterImagesByMarkers,
	findImageMarkerIds,
	type PendingClipboardImage,
	prepareImagesForSubmit,
	restoreImagesFromSession,
} from "../src/utils/clipboard-image-markers.js";

const createTestImage = (id: number): PendingClipboardImage => ({
	id,
	image: {
		type: "image",
		data: `base64data${id}`,
		mimeType: "image/png",
	},
	path: `/tmp/pi-clipboard-${id}.png`,
});

describe("findImageMarkerIds", () => {
	test("finds single marker", () => {
		const ids = findImageMarkerIds("test [image #1] here");
		expect(ids).toEqual(new Set([1]));
	});

	test("finds multiple markers", () => {
		const ids = findImageMarkerIds("compare [image #1] and [image #2]");
		expect(ids).toEqual(new Set([1, 2]));
	});

	test("finds markers with higher numbers", () => {
		const ids = findImageMarkerIds("[image #42] is the answer");
		expect(ids).toEqual(new Set([42]));
	});

	test("returns empty set when no markers", () => {
		const ids = findImageMarkerIds("no images here");
		expect(ids).toEqual(new Set());
	});

	test("is case insensitive", () => {
		const ids = findImageMarkerIds("[IMAGE #1] and [Image #2]");
		expect(ids).toEqual(new Set([1, 2]));
	});

	test("handles duplicate markers", () => {
		const ids = findImageMarkerIds("[image #1] same as [image #1]");
		expect(ids).toEqual(new Set([1]));
	});

	test("ignores malformed markers", () => {
		const ids = findImageMarkerIds("[image #] [image #abc] [image#1]");
		expect(ids).toEqual(new Set());
	});
});

describe("filterImagesByMarkers", () => {
	test("filters to only images with markers present", () => {
		const images = [createTestImage(1), createTestImage(2), createTestImage(3)];
		const filtered = filterImagesByMarkers(images, "show [image #1] and [image #3]");
		expect(filtered.map((i) => i.id)).toEqual([1, 3]);
	});

	test("returns empty array when no markers match", () => {
		const images = [createTestImage(1), createTestImage(2)];
		const filtered = filterImagesByMarkers(images, "no markers here");
		expect(filtered).toEqual([]);
	});

	test("returns empty array when images array is empty", () => {
		const filtered = filterImagesByMarkers([], "[image #1]");
		expect(filtered).toEqual([]);
	});

	test("handles markers for non-existent images", () => {
		const images = [createTestImage(1)];
		const filtered = filterImagesByMarkers(images, "[image #1] [image #99]");
		expect(filtered.map((i) => i.id)).toEqual([1]);
	});
});

describe("prepareImagesForSubmit", () => {
	test("returns images when model supports and markers present", () => {
		const images = [createTestImage(1), createTestImage(2)];
		const result = prepareImagesForSubmit(images, "describe [image #1]", true);

		expect(result.text).toBe("describe [image #1]");
		expect(result.images).toHaveLength(1);
		expect(result.images?.[0].data).toBe("base64data1");
	});

	test("returns all matching images", () => {
		const images = [createTestImage(1), createTestImage(2)];
		const result = prepareImagesForSubmit(images, "[image #1] vs [image #2]", true);

		expect(result.images).toHaveLength(2);
	});

	test("returns undefined images when model does not support", () => {
		const images = [createTestImage(1)];
		const result = prepareImagesForSubmit(images, "[image #1]", false);

		expect(result.text).toBe("[image #1]");
		expect(result.images).toBeUndefined();
	});

	test("returns undefined images when no markers in text", () => {
		const images = [createTestImage(1)];
		const result = prepareImagesForSubmit(images, "user deleted the marker", true);

		expect(result.images).toBeUndefined();
	});

	test("returns undefined images when pending array is empty", () => {
		const result = prepareImagesForSubmit([], "[image #1]", true);

		expect(result.images).toBeUndefined();
	});

	test("preserves original text", () => {
		const images = [createTestImage(1)];
		const originalText = "explain [image #1] please";
		const result = prepareImagesForSubmit(images, originalText, true);

		expect(result.text).toBe(originalText);
	});

	test("user can selectively remove images by deleting markers", () => {
		const images = [createTestImage(1), createTestImage(2), createTestImage(3)];

		// User had all three but deleted marker for #2
		const result = prepareImagesForSubmit(images, "compare [image #1] and [image #3]", true);

		expect(result.images).toHaveLength(2);
		expect(result.images?.map((i) => i.data)).toEqual(["base64data1", "base64data3"]);
	});
});

const createSessionImage = (id: number): ImageContent => ({
	type: "image",
	data: `base64data${id}`,
	mimeType: "image/png",
});

describe("restoreImagesFromSession", () => {
	test("restores single image with matching marker", () => {
		const sessionImages = [createSessionImage(1)];
		const result = restoreImagesFromSession(sessionImages, "describe [image #1]");

		expect(result.pendingImages).toHaveLength(1);
		expect(result.pendingImages[0].id).toBe(1);
		expect(result.pendingImages[0].image.data).toBe("base64data1");
		expect(result.pendingImages[0].path).toBe("(restored from session)");
		expect(result.maxId).toBe(1);
	});

	test("restores multiple images in order", () => {
		const sessionImages = [createSessionImage(1), createSessionImage(2)];
		const result = restoreImagesFromSession(sessionImages, "[image #1] and [image #2]");

		expect(result.pendingImages).toHaveLength(2);
		expect(result.pendingImages[0].id).toBe(1);
		expect(result.pendingImages[1].id).toBe(2);
		expect(result.maxId).toBe(2);
	});

	test("handles non-sequential marker IDs", () => {
		// If user deleted [image #2] before submitting, session has images for #1 and #3
		const sessionImages = [createSessionImage(1), createSessionImage(3)];
		const result = restoreImagesFromSession(sessionImages, "[image #1] and [image #3]");

		expect(result.pendingImages).toHaveLength(2);
		expect(result.pendingImages[0].id).toBe(1);
		expect(result.pendingImages[1].id).toBe(3);
		expect(result.maxId).toBe(3);
	});

	test("returns empty when no session images", () => {
		const result = restoreImagesFromSession([], "[image #1]");

		expect(result.pendingImages).toEqual([]);
		expect(result.maxId).toBe(0);
	});

	test("returns empty when no markers in text", () => {
		const sessionImages = [createSessionImage(1)];
		const result = restoreImagesFromSession(sessionImages, "no markers here");

		expect(result.pendingImages).toEqual([]);
		expect(result.maxId).toBe(0);
	});

	test("handles more markers than images gracefully", () => {
		// Edge case: text has markers but session has fewer images (shouldn't happen normally)
		const sessionImages = [createSessionImage(1)];
		const result = restoreImagesFromSession(sessionImages, "[image #1] [image #2] [image #3]");

		// Only restore what we have
		expect(result.pendingImages).toHaveLength(1);
		expect(result.pendingImages[0].id).toBe(1);
		expect(result.maxId).toBe(3); // maxId from markers
	});

	test("handles more images than markers gracefully", () => {
		// Edge case: session has more images than markers (shouldn't happen normally)
		const sessionImages = [createSessionImage(1), createSessionImage(2), createSessionImage(3)];
		const result = restoreImagesFromSession(sessionImages, "[image #1]");

		// Only restore what has markers
		expect(result.pendingImages).toHaveLength(1);
		expect(result.pendingImages[0].id).toBe(1);
		expect(result.maxId).toBe(1);
	});
});
