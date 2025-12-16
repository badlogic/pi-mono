/**
 * Image limits test suite
 *
 * Tests provider-specific image limitations:
 * - Maximum number of images in a context
 * - Maximum image size (bytes)
 * - Maximum image dimensions
 *
 * ============================================================================
 * DISCOVERED LIMITS (Dec 2025):
 * ============================================================================
 *
 * | Provider    | Model              | Max Images | Max Size | Max Dimension |
 * |-------------|--------------------|------------|----------|---------------|
 * | Anthropic   | claude-3-5-haiku   | 100        | 5MB      | 8000px        |
 * | OpenAI      | gpt-4o-mini        | 500        | ≥25MB    | (untested)    |
 * | Gemini      | gemini-2.5-flash   | ~2500      | ≥40MB    | (untested)    |
 * | Mistral     | pixtral-12b        | 8          | ~15MB    | (untested)    |
 * | OpenRouter  | z-ai/glm-4.5v      | ~40*       | ~15MB    | (untested)    |
 *
 * Notes:
 * - Anthropic: Also has a "many images" rule where >20 images reduces max
 *   dimension to 2000px. Total request size capped at 32MB.
 * - OpenAI: Documented limit is 20MB, but we observed ≥25MB working.
 * - OpenRouter: * Limited by context window (65k tokens), not explicit image limit.
 * - Gemini: Very permissive, hits internal errors around 2500-3000 images.
 * - Mistral: Very restrictive on image count (only 8 images allowed).
 *
 * ============================================================================
 */

import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { complete } from "../src/stream.js";
import type { Api, Context, ImageContent, Model, OptionsForApi, UserMessage } from "../src/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Temp directory for generated images
const TEMP_DIR = join(__dirname, ".temp-images");

/**
 * Generate a valid PNG image of specified dimensions using ImageMagick
 */
function generateImage(width: number, height: number, filename: string): string {
	const filepath = join(TEMP_DIR, filename);
	execSync(`magick -size ${width}x${height} xc:red "${filepath}"`, { stdio: "ignore" });
	const buffer = require("fs").readFileSync(filepath);
	return buffer.toString("base64");
}

/**
 * Generate a valid PNG image of approximately the specified size in bytes
 */
function generateImageWithSize(targetBytes: number, filename: string): string {
	const filepath = join(TEMP_DIR, filename);
	// Use uncompressed PNG to get predictable sizes
	// Each pixel is 3 bytes (RGB), plus PNG overhead (~100 bytes)
	// For a square image: side = sqrt(targetBytes / 3)
	const side = Math.ceil(Math.sqrt(targetBytes / 3));
	// Use noise pattern to prevent compression from shrinking the file
	execSync(`magick -size ${side}x${side} xc: +noise Random -depth 8 PNG24:"${filepath}"`, { stdio: "ignore" });

	// Check actual size and adjust if needed
	const stats = require("fs").statSync(filepath);
	if (stats.size < targetBytes * 0.8) {
		// If too small, increase dimensions
		const newSide = Math.ceil(side * Math.sqrt(targetBytes / stats.size));
		execSync(`magick -size ${newSide}x${newSide} xc: +noise Random -depth 8 PNG24:"${filepath}"`, {
			stdio: "ignore",
		});
	}

	const buffer = require("fs").readFileSync(filepath);
	return buffer.toString("base64");
}

/**
 * Create a user message with multiple images
 */
function createMultiImageMessage(imageCount: number, imageBase64: string): UserMessage {
	const content: (ImageContent | { type: "text"; text: string })[] = [
		{ type: "text", text: `I am sending you ${imageCount} images. Just reply with "received ${imageCount}".` },
	];

	for (let i = 0; i < imageCount; i++) {
		content.push({
			type: "image",
			data: imageBase64,
			mimeType: "image/png",
		});
	}

	return {
		role: "user",
		content,
		timestamp: Date.now(),
	};
}

/**
 * Test sending a specific number of images to a model
 */
async function testImageCount<TApi extends Api>(
	model: Model<TApi>,
	imageCount: number,
	imageBase64: string,
	options?: OptionsForApi<TApi>,
): Promise<{ success: boolean; error?: string }> {
	const context: Context = {
		messages: [createMultiImageMessage(imageCount, imageBase64)],
	};

	try {
		const response = await complete(model, context, options);
		if (response.stopReason === "error") {
			return { success: false, error: response.errorMessage };
		}
		return { success: true };
	} catch (e) {
		return { success: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * Test sending an image of a specific size
 */
async function testImageSize<TApi extends Api>(
	model: Model<TApi>,
	imageBase64: string,
	options?: OptionsForApi<TApi>,
): Promise<{ success: boolean; error?: string }> {
	const context: Context = {
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "I am sending you an image. Just reply with 'received'." },
					{ type: "image", data: imageBase64, mimeType: "image/png" },
				],
				timestamp: Date.now(),
			},
		],
	};

	try {
		const response = await complete(model, context, options);
		if (response.stopReason === "error") {
			return { success: false, error: response.errorMessage };
		}
		return { success: true };
	} catch (e) {
		return { success: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * Test sending an image with specific dimensions
 */
async function testImageDimensions<TApi extends Api>(
	model: Model<TApi>,
	imageBase64: string,
	options?: OptionsForApi<TApi>,
): Promise<{ success: boolean; error?: string }> {
	const context: Context = {
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "I am sending you an image. Just reply with 'received'." },
					{ type: "image", data: imageBase64, mimeType: "image/png" },
				],
				timestamp: Date.now(),
			},
		],
	};

	try {
		const response = await complete(model, context, options);
		if (response.stopReason === "error") {
			return { success: false, error: response.errorMessage };
		}
		return { success: true };
	} catch (e) {
		return { success: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * Find the maximum value that succeeds using linear search
 */
async function findLimit(
	testFn: (value: number) => Promise<{ success: boolean; error?: string }>,
	min: number,
	max: number,
	step: number,
): Promise<{ limit: number; lastError?: string }> {
	let lastSuccess = min;
	let lastError: string | undefined;

	for (let value = min; value <= max; value += step) {
		console.log(`  Testing value: ${value}...`);
		const result = await testFn(value);
		if (result.success) {
			lastSuccess = value;
			console.log(`    SUCCESS`);
		} else {
			lastError = result.error;
			console.log(`    FAILED: ${result.error?.substring(0, 100)}`);
			break;
		}
	}

	return { limit: lastSuccess, lastError };
}

// =============================================================================
// Provider-specific test suites
// =============================================================================

describe("Image Limits E2E Tests", () => {
	let smallImage: string; // 100x100 for count tests

	beforeAll(() => {
		// Create temp directory
		mkdirSync(TEMP_DIR, { recursive: true });

		// Generate small test image for count tests
		smallImage = generateImage(100, 100, "small.png");
	});

	afterAll(() => {
		// Clean up temp directory
		rmSync(TEMP_DIR, { recursive: true, force: true });
	});

	// -------------------------------------------------------------------------
	// Anthropic (claude-3-5-haiku-20241022)
	// Limits: 100 images, 5MB per image, 8000px max dimension
	// -------------------------------------------------------------------------
	describe.skipIf(!process.env.ANTHROPIC_API_KEY)("Anthropic (claude-3-5-haiku-20241022)", () => {
		const model = getModel("anthropic", "claude-3-5-haiku-20241022");

		it("should accept a small number of images (5)", async () => {
			const result = await testImageCount(model, 5, smallImage);
			expect(result.success, result.error).toBe(true);
		});

		it("should find maximum image count limit", { timeout: 600000 }, async () => {
			// Known limit: 100 images
			const { limit, lastError } = await findLimit((count) => testImageCount(model, count, smallImage), 20, 120, 20);
			console.log(`\n  Anthropic max images: ~${limit} (last error: ${lastError})`);
			expect(limit).toBeGreaterThanOrEqual(80);
			expect(limit).toBeLessThanOrEqual(100);
		});

		it("should find maximum image size limit", { timeout: 600000 }, async () => {
			const MB = 1024 * 1024;
			// Known limit: 5MB per image
			const sizes = [1, 2, 3, 4, 5, 6];

			let lastSuccess = 0;
			let lastError: string | undefined;

			for (const sizeMB of sizes) {
				console.log(`  Testing size: ${sizeMB}MB...`);
				const imageBase64 = generateImageWithSize(sizeMB * MB, `size-${sizeMB}mb.png`);
				const result = await testImageSize(model, imageBase64);
				if (result.success) {
					lastSuccess = sizeMB;
					console.log(`    SUCCESS`);
				} else {
					lastError = result.error;
					console.log(`    FAILED: ${result.error?.substring(0, 100)}`);
					break;
				}
			}

			console.log(`\n  Anthropic max image size: ~${lastSuccess}MB (last error: ${lastError})`);
			expect(lastSuccess).toBeGreaterThanOrEqual(1);
		});

		it("should find maximum image dimension limit", { timeout: 600000 }, async () => {
			// Known limit: 8000px
			const dimensions = [1000, 2000, 4000, 6000, 8000, 10000];

			let lastSuccess = 0;
			let lastError: string | undefined;

			for (const dim of dimensions) {
				console.log(`  Testing dimension: ${dim}x${dim}...`);
				const imageBase64 = generateImage(dim, dim, `dim-${dim}.png`);
				const result = await testImageDimensions(model, imageBase64);
				if (result.success) {
					lastSuccess = dim;
					console.log(`    SUCCESS`);
				} else {
					lastError = result.error;
					console.log(`    FAILED: ${result.error?.substring(0, 100)}`);
					break;
				}
			}

			console.log(`\n  Anthropic max dimension: ~${lastSuccess}px (last error: ${lastError})`);
			expect(lastSuccess).toBeGreaterThanOrEqual(6000);
			expect(lastSuccess).toBeLessThanOrEqual(8000);
		});
	});

	// -------------------------------------------------------------------------
	// OpenAI (gpt-4o-mini via openai-completions)
	// Limits: 500 images, ~20MB per image (documented)
	// -------------------------------------------------------------------------
	describe.skipIf(!process.env.OPENAI_API_KEY)("OpenAI (gpt-4o-mini)", () => {
		const model: Model<"openai-completions"> = { ...getModel("openai", "gpt-4o-mini"), api: "openai-completions" };

		it("should accept a small number of images (5)", async () => {
			const result = await testImageCount(model, 5, smallImage);
			expect(result.success, result.error).toBe(true);
		});

		it("should find maximum image count limit", { timeout: 600000 }, async () => {
			// Known limit: 500 images
			const { limit, lastError } = await findLimit(
				(count) => testImageCount(model, count, smallImage),
				100,
				600,
				100,
			);
			console.log(`\n  OpenAI max images: ~${limit} (last error: ${lastError})`);
			expect(limit).toBeGreaterThanOrEqual(400);
			expect(limit).toBeLessThanOrEqual(500);
		});

		it("should find maximum image size limit", { timeout: 600000 }, async () => {
			const MB = 1024 * 1024;
			// Documented limit: 20MB
			const sizes = [5, 10, 15, 20, 25];

			let lastSuccess = 0;
			let lastError: string | undefined;

			for (const sizeMB of sizes) {
				console.log(`  Testing size: ${sizeMB}MB...`);
				const imageBase64 = generateImageWithSize(sizeMB * MB, `size-${sizeMB}mb.png`);
				const result = await testImageSize(model, imageBase64);
				if (result.success) {
					lastSuccess = sizeMB;
					console.log(`    SUCCESS`);
				} else {
					lastError = result.error;
					console.log(`    FAILED: ${result.error?.substring(0, 100)}`);
					break;
				}
			}

			console.log(`\n  OpenAI max image size: ~${lastSuccess}MB (last error: ${lastError})`);
			expect(lastSuccess).toBeGreaterThanOrEqual(15);
		});
	});

	// -------------------------------------------------------------------------
	// Google Gemini (gemini-2.5-flash)
	// Limits: Very high (~2500 images), large size support
	// -------------------------------------------------------------------------
	describe.skipIf(!process.env.GEMINI_API_KEY)("Gemini (gemini-2.5-flash)", () => {
		const model = getModel("google", "gemini-2.5-flash");

		it("should accept a small number of images (5)", async () => {
			const result = await testImageCount(model, 5, smallImage);
			expect(result.success, result.error).toBe(true);
		});

		it("should find maximum image count limit", { timeout: 900000 }, async () => {
			// Known to work up to ~2500, hits errors around 3000
			const { limit, lastError } = await findLimit(
				(count) => testImageCount(model, count, smallImage),
				500,
				3000,
				500,
			);
			console.log(`\n  Gemini max images: ~${limit} (last error: ${lastError})`);
			expect(limit).toBeGreaterThanOrEqual(500);
		});

		it("should find maximum image size limit", { timeout: 600000 }, async () => {
			const MB = 1024 * 1024;
			// Very permissive, tested up to 60MB successfully
			const sizes = [10, 20, 30, 40];

			let lastSuccess = 0;
			let lastError: string | undefined;

			for (const sizeMB of sizes) {
				console.log(`  Testing size: ${sizeMB}MB...`);
				const imageBase64 = generateImageWithSize(sizeMB * MB, `size-${sizeMB}mb.png`);
				const result = await testImageSize(model, imageBase64);
				if (result.success) {
					lastSuccess = sizeMB;
					console.log(`    SUCCESS`);
				} else {
					lastError = result.error;
					console.log(`    FAILED: ${result.error?.substring(0, 100)}`);
					break;
				}
			}

			console.log(`\n  Gemini max image size: ~${lastSuccess}MB (last error: ${lastError})`);
			expect(lastSuccess).toBeGreaterThanOrEqual(20);
		});
	});

	// -------------------------------------------------------------------------
	// Mistral (pixtral-12b)
	// Limits: ~8 images, ~15MB per image
	// -------------------------------------------------------------------------
	describe.skipIf(!process.env.MISTRAL_API_KEY)("Mistral (pixtral-12b)", () => {
		const model = getModel("mistral", "pixtral-12b");

		it("should accept a small number of images (5)", async () => {
			const result = await testImageCount(model, 5, smallImage);
			expect(result.success, result.error).toBe(true);
		});

		it("should find maximum image count limit", { timeout: 600000 }, async () => {
			// Known to fail around 9 images
			const { limit, lastError } = await findLimit((count) => testImageCount(model, count, smallImage), 5, 15, 1);
			console.log(`\n  Mistral max images: ~${limit} (last error: ${lastError})`);
			expect(limit).toBeGreaterThanOrEqual(5);
		});

		it("should find maximum image size limit", { timeout: 600000 }, async () => {
			const MB = 1024 * 1024;
			const sizes = [5, 10, 15, 20];

			let lastSuccess = 0;
			let lastError: string | undefined;

			for (const sizeMB of sizes) {
				console.log(`  Testing size: ${sizeMB}MB...`);
				const imageBase64 = generateImageWithSize(sizeMB * MB, `size-${sizeMB}mb.png`);
				const result = await testImageSize(model, imageBase64);
				if (result.success) {
					lastSuccess = sizeMB;
					console.log(`    SUCCESS`);
				} else {
					lastError = result.error;
					console.log(`    FAILED: ${result.error?.substring(0, 100)}`);
					break;
				}
			}

			console.log(`\n  Mistral max image size: ~${lastSuccess}MB (last error: ${lastError})`);
			expect(lastSuccess).toBeGreaterThanOrEqual(5);
		});
	});

	// -------------------------------------------------------------------------
	// OpenRouter (z-ai/glm-4.5v)
	// Limits: Context-window limited (~45 images at 100x100), ~15MB per image
	// -------------------------------------------------------------------------
	describe.skipIf(!process.env.OPENROUTER_API_KEY)("OpenRouter (z-ai/glm-4.5v)", () => {
		const model = getModel("openrouter", "z-ai/glm-4.5v");

		it("should accept a small number of images (5)", async () => {
			const result = await testImageCount(model, 5, smallImage);
			expect(result.success, result.error).toBe(true);
		});

		it("should find maximum image count limit", { timeout: 600000 }, async () => {
			// Limited by context window, not explicit image limit
			const { limit, lastError } = await findLimit((count) => testImageCount(model, count, smallImage), 10, 60, 10);
			console.log(`\n  OpenRouter max images: ~${limit} (last error: ${lastError})`);
			expect(limit).toBeGreaterThanOrEqual(10);
		});

		it("should find maximum image size limit", { timeout: 600000 }, async () => {
			const MB = 1024 * 1024;
			const sizes = [5, 10, 15, 20];

			let lastSuccess = 0;
			let lastError: string | undefined;

			for (const sizeMB of sizes) {
				console.log(`  Testing size: ${sizeMB}MB...`);
				const imageBase64 = generateImageWithSize(sizeMB * MB, `size-${sizeMB}mb.png`);
				const result = await testImageSize(model, imageBase64);
				if (result.success) {
					lastSuccess = sizeMB;
					console.log(`    SUCCESS`);
				} else {
					lastError = result.error;
					console.log(`    FAILED: ${result.error?.substring(0, 100)}`);
					break;
				}
			}

			console.log(`\n  OpenRouter max image size: ~${lastSuccess}MB (last error: ${lastError})`);
			expect(lastSuccess).toBeGreaterThanOrEqual(5);
		});
	});
});
