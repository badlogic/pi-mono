/**
 * Tests for image processing utilities using wasm-vips.
 */

import { describe, expect, it } from "vitest";
import { convertToPng } from "../src/utils/image-convert.js";
import { formatDimensionNote, resizeImage } from "../src/utils/image-resize.js";
import { getVips } from "../src/utils/vips.js";

// Small 2x2 red PNG image (base64)
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAADklEQVQI12P4z8DAwMAAAA0BA/m5sb9AAAAAAElFTkSuQmCC";

// Small 2x2 blue JPEG image (base64)
const TINY_JPEG =
	"/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAB//2Q==";

// 100x100 gray PNG (generated with wasm-vips)
const MEDIUM_PNG_100x100 =
	"iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAtGVYSWZJSSoACAAAAAYAEgEDAAEAAAABAAAAGgEFAAEAAABWAAAAGwEFAAEAAABeAAAAKAEDAAEAAAACAAAAEwIDAAEAAAABAAAAaYcEAAEAAABmAAAAAAAAADhjAADoAwAAOGMAAOgDAAAGAACQBwAEAAAAMDIxMAGRBwAEAAAAAQIDAACgBwAEAAAAMDEwMAGgAwABAAAA//8AAAKgBAABAAAAZAAAAAOgBAABAAAAZAAAAAAAAAC1xMTxAAAA4klEQVR4nO3QoQEAAAiAME/3dF+QvmUSs7zNP8WswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKz9zzpHfptnWvrkoQAAAABJRU5ErkJggg==";

// 200x200 colored PNG (generated with wasm-vips)
const LARGE_PNG_200x200 =
	"iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAIAAAAiOjnJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAtGVYSWZJSSoACAAAAAYAEgEDAAEAAAABAAAAGgEFAAEAAABWAAAAGwEFAAEAAABeAAAAKAEDAAEAAAACAAAAEwIDAAEAAAABAAAAaYcEAAEAAABmAAAAAAAAADhjAADoAwAAOGMAAOgDAAAGAACQBwAEAAAAMDIxMAGRBwAEAAAAAQIDAACgBwAEAAAAMDEwMAGgAwABAAAA//8AAAKgBAABAAAAyAAAAAOgBAABAAAAyAAAAAAAAADqHRv+AAAD8UlEQVR4nO2UAQnAQACEFtZMy/SxVmJDdggmOOUu7hMtwNsZXG3aAnxwLoVVWKewiuD85V97LN8BixSW74BFCst3wCKF5TtgkcLyHbBIYfkOWKSwfAcsUli+AxYpLN8BixSW74BFCst3wCKF5TtgkcLyHbBIYfkOWKSwfAcsUli+AxYpLN8BixSW74BFCst3wCKF5TtgkcLyHbBIYfkOWKSwfAcsUli+AxYpLN8BixSW74BFCst3wCKF5TtgkcLyHbBIYfkOWKSwfAcsUli+AxYpLN8BixSW74BFCst3wCKF5TtgkcLyHbBIYfkOWKSwfAcsUli+AxYpLN8BixSW74BFCst3wCKF5TtgkcLyHbBIYfkOWKSwfAcsUli+AxYpLN8BixSW74BFCst3wCKF5TtgkcLyHbBIYfkOWKSwfAcsUli+AxYpLN8BixSW74BFCst3wCKF5TtgkcLyHbBIYfkOWKSwfAcsUli+AxYpLN8BixSW74BFCst3wCKF5TtgkcLyHbBIYfkOWKSwfAcsUli+AxYpLN8BixSW74BFCst3wCKF5TtgkcLyHbBIYfkOWKSwfAcsUli+AxYpLN8BixSW74BFCst3wCKF5TtgkcLyHbBIYfkOWKSwfAcsUli+AxYpLN8BixSW74BFCst3wCKF5TtgkcLyHbBIYfkOWKSwfAcsUli+AxYpLN8BixSW74BFCst3wCKF5TtgkcLyHbBIYfkOWKSwfAcsUli+AxYpLN/BJIXlO2CRwvIdsEhh+Q5YpLB8ByxSWL4DFiks3wGLFJbvgEUKy3fAIoXlO2CRwvIdsEhh+Q5YpLB8ByxSWL4DFiks3wGLFJbvgEUKy3fAIoXlO2CRwvIdsEhh+Q5YpLB8ByxSWL4DFiks3wGLFJbvgEUKy3fAIoXlO2CRwvIdsEhh+Q5YpLB8ByxSWL4DFiks3wGLFJbvgEUKy3fAIoXlO2CRwvIdsEhh+Q5YpLB8ByxSWL4DFiks3wGLFJbvgEUKy3fAIoXlO2CRwvIdsEhh+Q5YpLB8ByxSWL4DFiks3wGLFJbvgEUKy3fAIoXlO2CRwvIdsEhh+Q5YpLB8ByxSWL4DFiks3wGLFJbvgEUKy3fAIoXlO2CRwvIdsEhh+Q5YpLB8ByxSWL4DFiks3wGLFJbvgEUKy3fAIoXlO2CRwvIdsEhh+Q5YpLB8ByxSWL4DFiks3wGLFJbvgEUKy3fAIoXlO2CRwvIdsEhh+Q5YpLB8ByxSWL4DFiks3wGLFJbvgEUKy3fAIoXlO2CRwvIdsEhh+Q5YpLB8ByxSWL4DFiks3wGLFJbvgEUKy3fAIoXlO2CRwvIdsEhh+Q5Y5AHNA7iPx5BmcQAAAABJRU5ErkJggg==";

describe("wasm-vips initialization", () => {
	it("should initialize wasm-vips successfully", async () => {
		const vips = await getVips();
		expect(vips).not.toBeNull();
	});

	it("should return cached instance on subsequent calls", async () => {
		const vips1 = await getVips();
		const vips2 = await getVips();
		expect(vips1).toBe(vips2);
	});
});

describe("convertToPng", () => {
	it("should return original data for PNG input", async () => {
		const result = await convertToPng(TINY_PNG, "image/png");
		expect(result).not.toBeNull();
		expect(result!.data).toBe(TINY_PNG);
		expect(result!.mimeType).toBe("image/png");
	});

	it("should convert JPEG to PNG", async () => {
		const result = await convertToPng(TINY_JPEG, "image/jpeg");
		expect(result).not.toBeNull();
		expect(result!.mimeType).toBe("image/png");
		// Result should be valid base64
		expect(() => Buffer.from(result!.data, "base64")).not.toThrow();
		// PNG magic bytes
		const buffer = Buffer.from(result!.data, "base64");
		expect(buffer[0]).toBe(0x89);
		expect(buffer[1]).toBe(0x50); // 'P'
		expect(buffer[2]).toBe(0x4e); // 'N'
		expect(buffer[3]).toBe(0x47); // 'G'
	});
});

describe("resizeImage", () => {
	it("should return original image if within limits", async () => {
		const result = await resizeImage(
			{ type: "image", data: TINY_PNG, mimeType: "image/png" },
			{ maxWidth: 100, maxHeight: 100, maxBytes: 1024 * 1024 },
		);

		expect(result.wasResized).toBe(false);
		expect(result.data).toBe(TINY_PNG);
		expect(result.originalWidth).toBe(2);
		expect(result.originalHeight).toBe(2);
		expect(result.width).toBe(2);
		expect(result.height).toBe(2);
	});

	it("should resize image exceeding dimension limits", async () => {
		const result = await resizeImage(
			{ type: "image", data: MEDIUM_PNG_100x100, mimeType: "image/png" },
			{ maxWidth: 50, maxHeight: 50, maxBytes: 1024 * 1024 },
		);

		expect(result.wasResized).toBe(true);
		expect(result.originalWidth).toBe(100);
		expect(result.originalHeight).toBe(100);
		expect(result.width).toBeLessThanOrEqual(50);
		expect(result.height).toBeLessThanOrEqual(50);
	});

	it("should resize image exceeding byte limit", async () => {
		const originalBuffer = Buffer.from(LARGE_PNG_200x200, "base64");
		const originalSize = originalBuffer.length;

		// Set maxBytes to less than the original image size
		const result = await resizeImage(
			{ type: "image", data: LARGE_PNG_200x200, mimeType: "image/png" },
			{ maxWidth: 2000, maxHeight: 2000, maxBytes: Math.floor(originalSize / 2) },
		);

		// Should have tried to reduce size
		const resultBuffer = Buffer.from(result.data, "base64");
		expect(resultBuffer.length).toBeLessThan(originalSize);
	});

	it("should handle JPEG input", async () => {
		const result = await resizeImage(
			{ type: "image", data: TINY_JPEG, mimeType: "image/jpeg" },
			{ maxWidth: 100, maxHeight: 100, maxBytes: 1024 * 1024 },
		);

		expect(result.wasResized).toBe(false);
		expect(result.originalWidth).toBe(2);
		expect(result.originalHeight).toBe(2);
	});
});

describe("formatDimensionNote", () => {
	it("should return undefined for non-resized images", () => {
		const note = formatDimensionNote({
			data: "",
			mimeType: "image/png",
			originalWidth: 100,
			originalHeight: 100,
			width: 100,
			height: 100,
			wasResized: false,
		});
		expect(note).toBeUndefined();
	});

	it("should return formatted note for resized images", () => {
		const note = formatDimensionNote({
			data: "",
			mimeType: "image/png",
			originalWidth: 2000,
			originalHeight: 1000,
			width: 1000,
			height: 500,
			wasResized: true,
		});
		expect(note).toContain("original 2000x1000");
		expect(note).toContain("displayed at 1000x500");
		expect(note).toContain("2.00"); // scale factor
	});
});
