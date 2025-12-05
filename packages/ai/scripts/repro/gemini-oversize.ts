#!/usr/bin/env tsx

/**
 * Minimal offline repro for Gemini inlineData size handling.
 *
 * Shows how sanitizeImages drops oversize images and the note injected for the model.
 * No API call is made.
 *
 * Run:
 *   pnpm tsx packages/ai/scripts/repro/gemini-oversize.ts
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

	// Pad to exceed Gemini inlineData limit (~7MB per file)
	const targetBytes = 8 * 1024 * 1024;
	const padded = base + "A".repeat(targetBytes - Buffer.byteLength(base, "base64"));

	const images = [makeImage(base), makeImage(padded)];

	const { messages: sanitized, note } = sanitizeImages([makeMessage(images)], {
		providerLabel: "Gemini",
		maxBytes: 7 * 1024 * 1024,
	});

	console.log("Gemini oversize repro (offline)");
	console.log("Original images:", images.length);
	const remaining = Array.isArray(sanitized[0]?.content) ? sanitized[0].content.length : 0;
	console.log("Remaining images:", remaining);
	console.log("Note:", note ?? "<none>");
}

main();
