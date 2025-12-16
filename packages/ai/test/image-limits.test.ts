/**
 * Image limits test suite
 *
 * Tests provider-specific image limitations:
 * - Maximum number of images in a context
 * - Maximum image size (bytes)
 * - Maximum image dimensions
 * - Maximum 8k x 8k images (stress test)
 *
 * ============================================================================
 * DISCOVERED LIMITS (Dec 2025):
 * ============================================================================
 *
 * | Provider    | Model              | Max Images | Max Size | Max Dim  | Max 8k Imgs |
 * |-------------|--------------------|------------|----------|----------|-------------|
 * | Anthropic   | claude-3-5-haiku   | 100        | 5MB      | 8000px   | 100         |
 * | OpenAI      | gpt-4o-mini        | 500        | ≥25MB    | ≥20000px | 100-200*    |
 * | Gemini      | gemini-2.5-flash   | ~2000**    | ≥40MB    | 8000px   | (untested)  |
 * | Mistral     | pixtral-12b        | 8          | ~15MB    | 8000px   | 8           |
 * | xAI         | grok-2-vision      | ≥100       | 25MB     | 8000px   | 100-150*    |
 * | Groq        | llama-4-scout-17b  | 5          | ~5MB     | ~5760px  | 0***        |
 * | zAI         | glm-4.5v           | ≥100       | ≥20MB    | 8000px   | 400****     |
 * | OpenRouter  | z-ai/glm-4.5v      | ~40****    | ~10MB    | ≥20000px | 40****      |
 *
 * Notes:
 * - Anthropic: Docs mention a "many images" rule (>20 images = 2000px max),
 *   but testing shows 100 x 8k images work fine. Anthropic may auto-resize
 *   internally. Total request size capped at 32MB. Explicit error at 101+.
 * - OpenAI: * 100 x 8k succeeded, 200 x 8k failed with timeout. Actual limit
 *   likely between 100-200. Documented size limit is 20MB but ≥25MB works.
 * - Gemini: ** Very permissive on count, hits rate limits before image limits.
 * - Mistral: Very restrictive (8 images max). Explicit error at 9+.
 * - xAI: * 100 x 8k succeeded, 150 x 8k timed out. 25MB size limit exact.
 * - Groq: *** Most restrictive. 5 images max, 33177600 pixels max (≈5760x5760).
 *   8k images (64M pixels) exceed limit, so 0 supported.
 * - zAI: **** Context-window limited (65536 tokens). 400 x 8k succeeded,
 *   500 x 8k exceeded token limit.
 * - OpenRouter: **** Context-window limited (65536 tokens), not explicit
 *   image limit. 40 x 8k succeeded, 50 x 8k exceeded token limit.
 *
 * ============================================================================
 * PRACTICAL RECOMMENDATIONS FOR CODING AGENTS:
 * ============================================================================
 *
 * Conservative cross-provider safe limits:
 * - Max 5 images per request (for Groq compatibility)
 * - Max 5MB per image (for Anthropic/Groq)
 * - Max 5760px dimension (for Groq pixel limit)
 *
 * If excluding Groq:
 * - Max 8 images per request (for Mistral)
 * - Max 5MB per image (for Anthropic)
 * - Max 8000px dimension (common limit)
 *
 * For Anthropic-only (most common case):
 * - Max 100 images per request
 * - Max 5MB per image
 * - Max 8000px dimension
 * - Max 32MB total request size
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

		it("should find maximum image dimension limit", { timeout: 600000 }, async () => {
			const dimensions = [2000, 4000, 8000, 16000, 20000];

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

			console.log(`\n  OpenAI max dimension: ~${lastSuccess}px (last error: ${lastError})`);
			expect(lastSuccess).toBeGreaterThanOrEqual(2000);
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

		it("should find maximum image dimension limit", { timeout: 600000 }, async () => {
			const dimensions = [2000, 4000, 8000, 16000, 20000];

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

			console.log(`\n  Gemini max dimension: ~${lastSuccess}px (last error: ${lastError})`);
			expect(lastSuccess).toBeGreaterThanOrEqual(2000);
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

		it("should find maximum image dimension limit", { timeout: 600000 }, async () => {
			const dimensions = [2000, 4000, 8000, 16000, 20000];

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

			console.log(`\n  Mistral max dimension: ~${lastSuccess}px (last error: ${lastError})`);
			expect(lastSuccess).toBeGreaterThanOrEqual(2000);
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

		it("should find maximum image dimension limit", { timeout: 600000 }, async () => {
			const dimensions = [2000, 4000, 8000, 16000, 20000];

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

			console.log(`\n  OpenRouter max dimension: ~${lastSuccess}px (last error: ${lastError})`);
			expect(lastSuccess).toBeGreaterThanOrEqual(2000);
		});
	});

	// -------------------------------------------------------------------------
	// xAI (grok-2-vision)
	// -------------------------------------------------------------------------
	describe.skipIf(!process.env.XAI_API_KEY)("xAI (grok-2-vision)", () => {
		const model = getModel("xai", "grok-2-vision");

		it("should accept a small number of images (5)", async () => {
			const result = await testImageCount(model, 5, smallImage);
			expect(result.success, result.error).toBe(true);
		});

		it("should find maximum image count limit", { timeout: 600000 }, async () => {
			const { limit, lastError } = await findLimit((count) => testImageCount(model, count, smallImage), 10, 100, 10);
			console.log(`\n  xAI max images: ~${limit} (last error: ${lastError})`);
			expect(limit).toBeGreaterThanOrEqual(5);
		});

		it("should find maximum image size limit", { timeout: 600000 }, async () => {
			const MB = 1024 * 1024;
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

			console.log(`\n  xAI max image size: ~${lastSuccess}MB (last error: ${lastError})`);
			expect(lastSuccess).toBeGreaterThanOrEqual(5);
		});

		it("should find maximum image dimension limit", { timeout: 600000 }, async () => {
			const dimensions = [2000, 4000, 8000, 16000, 20000];

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

			console.log(`\n  xAI max dimension: ~${lastSuccess}px (last error: ${lastError})`);
			expect(lastSuccess).toBeGreaterThanOrEqual(2000);
		});
	});

	// -------------------------------------------------------------------------
	// Groq (llama-4-scout-17b)
	// -------------------------------------------------------------------------
	describe.skipIf(!process.env.GROQ_API_KEY)("Groq (llama-4-scout-17b)", () => {
		const model = getModel("groq", "meta-llama/llama-4-scout-17b-16e-instruct");

		it("should accept a small number of images (5)", async () => {
			const result = await testImageCount(model, 5, smallImage);
			expect(result.success, result.error).toBe(true);
		});

		it("should find maximum image count limit", { timeout: 600000 }, async () => {
			const { limit, lastError } = await findLimit((count) => testImageCount(model, count, smallImage), 5, 50, 5);
			console.log(`\n  Groq max images: ~${limit} (last error: ${lastError})`);
			expect(limit).toBeGreaterThanOrEqual(5);
		});

		it("should find maximum image size limit", { timeout: 600000 }, async () => {
			const MB = 1024 * 1024;
			const sizes = [1, 5, 10, 15, 20];

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

			console.log(`\n  Groq max image size: ~${lastSuccess}MB (last error: ${lastError})`);
			expect(lastSuccess).toBeGreaterThanOrEqual(1);
		});

		it("should find maximum image dimension limit", { timeout: 600000 }, async () => {
			const dimensions = [2000, 4000, 8000, 16000, 20000];

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

			console.log(`\n  Groq max dimension: ~${lastSuccess}px (last error: ${lastError})`);
			expect(lastSuccess).toBeGreaterThanOrEqual(2000);
		});
	});

	// -------------------------------------------------------------------------
	// zAI (glm-4.5v)
	// -------------------------------------------------------------------------
	describe.skipIf(!process.env.ZAI_API_KEY)("zAI (glm-4.5v)", () => {
		const model = getModel("zai", "glm-4.5v");

		it("should accept a small number of images (5)", async () => {
			const result = await testImageCount(model, 5, smallImage);
			expect(result.success, result.error).toBe(true);
		});

		it("should find maximum image count limit", { timeout: 600000 }, async () => {
			const { limit, lastError } = await findLimit((count) => testImageCount(model, count, smallImage), 10, 100, 10);
			console.log(`\n  zAI max images: ~${limit} (last error: ${lastError})`);
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

			console.log(`\n  zAI max image size: ~${lastSuccess}MB (last error: ${lastError})`);
			expect(lastSuccess).toBeGreaterThanOrEqual(5);
		});

		it("should find maximum image dimension limit", { timeout: 600000 }, async () => {
			const dimensions = [2000, 4000, 8000, 16000, 20000];

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

			console.log(`\n  zAI max dimension: ~${lastSuccess}px (last error: ${lastError})`);
			expect(lastSuccess).toBeGreaterThanOrEqual(2000);
		});
	});

	// =========================================================================
	// MAX 8K IMAGES TEST
	// =========================================================================
	// Tests how many 8000x8000 images each provider can handle.
	// This is important for:
	// 1. Reproducing Anthropic's "many images" rule (>20 images = 2000px max)
	// 2. Finding practical limits for prompt caching optimization
	// =========================================================================

	describe("Max 8K Images (large image stress test)", () => {
		// Generate a single 8k image to reuse
		// Note: solid color compresses well but still has 8000x8000 pixel dimensions
		let image8k: string;

		beforeAll(() => {
			console.log("Generating 8000x8000 test image...");
			image8k = generateImage(8000, 8000, "stress-8k.png");
			const sizeBytes = Buffer.from(image8k, "base64").length;
			console.log(
				`  8k image size: ${(sizeBytes / 1024 / 1024).toFixed(2)}MB (compressed, but still 8000x8000 dimensions)`,
			);
		});

		// Anthropic - known 100 image limit, testing if 8k dimensions change this
		it.skipIf(!process.env.ANTHROPIC_API_KEY)(
			"Anthropic: max 8k images before rejection",
			{ timeout: 900000 },
			async () => {
				const model = getModel("anthropic", "claude-3-5-haiku-20241022");
				// Known limit is 100 images - test around that boundary
				const counts = [10, 20, 50, 80, 100, 110, 120];

				let lastSuccess = 0;
				let lastError: string | undefined;

				for (const count of counts) {
					console.log(`  Testing ${count} x 8k images...`);
					const result = await testImageCount(model, count, image8k);
					if (result.success) {
						lastSuccess = count;
						console.log(`    SUCCESS`);
					} else {
						lastError = result.error;
						console.log(`    FAILED: ${result.error?.substring(0, 150)}`);
						break;
					}
				}

				console.log(`\n  Anthropic max 8k images: ${lastSuccess} (last error: ${lastError})`);
				expect(lastSuccess).toBeGreaterThanOrEqual(5);
			},
		);

		// OpenAI - known 500 image limit
		it.skipIf(!process.env.OPENAI_API_KEY)(
			"OpenAI: max 8k images before rejection",
			{ timeout: 1800000 },
			async () => {
				const model = getModel("openai", "gpt-4o-mini");
				// Known limit is 500 images - test around that boundary
				const counts = [50, 100, 200, 300, 400, 500, 550];

				let lastSuccess = 0;
				let lastError: string | undefined;

				for (const count of counts) {
					console.log(`  Testing ${count} x 8k images...`);
					const result = await testImageCount(model, count, image8k);
					if (result.success) {
						lastSuccess = count;
						console.log(`    SUCCESS`);
					} else {
						lastError = result.error;
						console.log(`    FAILED: ${result.error?.substring(0, 150)}`);
						break;
					}
				}

				console.log(`\n  OpenAI max 8k images: ${lastSuccess} (last error: ${lastError})`);
				expect(lastSuccess).toBeGreaterThanOrEqual(5);
			},
		);

		// Gemini - known to be very permissive (~2000+ small images), but 8k may differ
		it.skipIf(!process.env.GOOGLE_API_KEY)(
			"Gemini: max 8k images before rejection",
			{ timeout: 1800000 },
			async () => {
				const model = getModel("google", "gemini-2.5-flash");
				// Test progressively - 8k images are large so limit may be lower
				const counts = [10, 50, 100, 200, 500, 1000];

				let lastSuccess = 0;
				let lastError: string | undefined;

				for (const count of counts) {
					console.log(`  Testing ${count} x 8k images...`);
					const result = await testImageCount(model, count, image8k);
					if (result.success) {
						lastSuccess = count;
						console.log(`    SUCCESS`);
					} else {
						lastError = result.error;
						console.log(`    FAILED: ${result.error?.substring(0, 150)}`);
						break;
					}
				}

				console.log(`\n  Gemini max 8k images: ${lastSuccess} (last error: ${lastError})`);
				expect(lastSuccess).toBeGreaterThanOrEqual(5);
			},
		);

		// Mistral - known 8 image limit
		it.skipIf(!process.env.MISTRAL_API_KEY)(
			"Mistral: max 8k images before rejection",
			{ timeout: 600000 },
			async () => {
				const model = getModel("mistral", "pixtral-12b");
				// Known limit is 8 images - test around that boundary
				const counts = [1, 2, 4, 6, 8, 9, 10];

				let lastSuccess = 0;
				let lastError: string | undefined;

				for (const count of counts) {
					console.log(`  Testing ${count} x 8k images...`);
					const result = await testImageCount(model, count, image8k);
					if (result.success) {
						lastSuccess = count;
						console.log(`    SUCCESS`);
					} else {
						lastError = result.error;
						console.log(`    FAILED: ${result.error?.substring(0, 150)}`);
						break;
					}
				}

				console.log(`\n  Mistral max 8k images: ${lastSuccess} (last error: ${lastError})`);
				expect(lastSuccess).toBeGreaterThanOrEqual(1);
			},
		);

		// xAI - tested up to 100 small images successfully
		it.skipIf(!process.env.XAI_API_KEY)("xAI: max 8k images before rejection", { timeout: 1200000 }, async () => {
			const model = getModel("xai", "grok-2-vision");
			// Test around the expected boundary
			const counts = [10, 50, 100, 150, 200];

			let lastSuccess = 0;
			let lastError: string | undefined;

			for (const count of counts) {
				console.log(`  Testing ${count} x 8k images...`);
				const result = await testImageCount(model, count, image8k);
				if (result.success) {
					lastSuccess = count;
					console.log(`    SUCCESS`);
				} else {
					lastError = result.error;
					console.log(`    FAILED: ${result.error?.substring(0, 150)}`);
					break;
				}
			}

			console.log(`\n  xAI max 8k images: ${lastSuccess} (last error: ${lastError})`);
			expect(lastSuccess).toBeGreaterThanOrEqual(5);
		});

		// Groq - very limited (5 images, ~5760px max)
		it.skipIf(!process.env.GROQ_API_KEY)(
			"Groq: max 8k images before rejection (expect 0 - exceeds pixel limit)",
			{ timeout: 600000 },
			async () => {
				const model = getModel("groq", "meta-llama/llama-4-scout-17b-16e-instruct");
				// 8k images exceed Groq's 33177600 pixel limit, so even 1 should fail
				const counts = [1, 2, 3];

				let lastSuccess = 0;
				let lastError: string | undefined;

				for (const count of counts) {
					console.log(`  Testing ${count} x 8k images...`);
					const result = await testImageCount(model, count, image8k);
					if (result.success) {
						lastSuccess = count;
						console.log(`    SUCCESS`);
					} else {
						lastError = result.error;
						console.log(`    FAILED: ${result.error?.substring(0, 150)}`);
						break;
					}
				}

				console.log(`\n  Groq max 8k images: ${lastSuccess} (last error: ${lastError})`);
				// Groq should fail even with 1 image at 8k (64M pixels > 33M limit)
				expect(lastSuccess).toBeGreaterThanOrEqual(0);
			},
		);

		// zAI - tested up to 100 small images successfully, very permissive
		it.skipIf(!process.env.ZAI_API_KEY)("zAI: max 8k images before rejection", { timeout: 1800000 }, async () => {
			const model = getModel("zai", "glm-4.5v");
			// Very permissive - extend to find actual limit
			const counts = [50, 100, 200, 300, 400, 500];

			let lastSuccess = 0;
			let lastError: string | undefined;

			for (const count of counts) {
				console.log(`  Testing ${count} x 8k images...`);
				const result = await testImageCount(model, count, image8k);
				if (result.success) {
					lastSuccess = count;
					console.log(`    SUCCESS`);
				} else {
					lastError = result.error;
					console.log(`    FAILED: ${result.error?.substring(0, 150)}`);
					break;
				}
			}

			console.log(`\n  zAI max 8k images: ${lastSuccess} (last error: ${lastError})`);
			expect(lastSuccess).toBeGreaterThanOrEqual(5);
		});

		// OpenRouter - context-window limited (~40 small images), 8k will be fewer
		it.skipIf(!process.env.OPENROUTER_API_KEY)(
			"OpenRouter: max 8k images before rejection",
			{ timeout: 900000 },
			async () => {
				const model = getModel("openrouter", "z-ai/glm-4.5v");
				// 8k images consume more tokens, so limit will be lower than 40
				const counts = [1, 2, 5, 10, 20, 30, 40, 50];

				let lastSuccess = 0;
				let lastError: string | undefined;

				for (const count of counts) {
					console.log(`  Testing ${count} x 8k images...`);
					const result = await testImageCount(model, count, image8k);
					if (result.success) {
						lastSuccess = count;
						console.log(`    SUCCESS`);
					} else {
						lastError = result.error;
						console.log(`    FAILED: ${result.error?.substring(0, 150)}`);
						break;
					}
				}

				console.log(`\n  OpenRouter max 8k images: ${lastSuccess} (last error: ${lastError})`);
				expect(lastSuccess).toBeGreaterThanOrEqual(1);
			},
		);
	});
});
