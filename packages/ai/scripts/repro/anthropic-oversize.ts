#!/usr/bin/env tsx

/**
 * Minimal offline repro for Anthropic image size/dimension handling.
 *
 * Shows how sanitizeImages drops oversize images and emits the note the model sees.
 * No API call is made.
 *
 * Run:
 *   pnpm tsx packages/ai/scripts/repro/anthropic-oversize.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeImages } from "../../src/utils/image-validation.js";
import type { ImageContent, Message } from "../../src/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function makeImage(data: string): ImageContent {
	return { type: "image", data, mimeType: "image/png" };
}

function makeMessage(images: ImageContent[]): Message {
	return { role: "user", content: images, timestamp: Date.now() };
}

function main() {
	const base = readFileSync(join(__dirname, "..", "..", "test", "data", "red-circle.png")).toString("base64");

	// Pad to exceed Anthropic's ~30MB per-image limit (we stay under 32MB request cap)
	const targetBytes = 31 * 1024 * 1024;
	const padded = base + "A".repeat(targetBytes - Buffer.byteLength(base, "base64"));

	// Also trigger the "many images" downscale rule by sending > threshold
	const images = [makeImage(base), makeImage(padded), makeImage(padded), makeImage(padded)];

	const { messages: sanitized, note } = sanitizeImages([makeMessage(images)], {
		providerLabel: "Anthropic",
		maxBytes: 30 * 1024 * 1024,
		maxDimension: 8000,
		manyImageLimit: { threshold: 20, maxDimension: 2000 },
		maxImages: 100,
	});

	console.log("Anthropic oversize repro (offline)");
	console.log("Original images:", images.length);
	const remaining = Array.isArray(sanitized[0]?.content) ? sanitized[0].content.length : 0;
	console.log("Remaining images:", remaining);
	console.log("Note:", note ?? "<none>");
}

main();
