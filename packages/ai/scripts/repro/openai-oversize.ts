#!/usr/bin/env tsx

/**
 * Minimal offline repro for OpenAI image size handling.
 *
 * Prints how sanitizeImages drops oversize images and the user-facing note
 * we inject into the conversation. No API call is made.
 *
 * Run:
 *   pnpm tsx packages/ai/scripts/repro/openai-oversize.ts
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

function oversize(base64: string, maxBytes: number): string {
	const target = Math.ceil(1.7 * maxBytes); // ensure we exceed the provider cap even after base64 overhead
	const current = Buffer.byteLength(base64, "base64");
	const pad = Math.max(0, target - current);
	return base64 + "A".repeat(pad);
}

function main() {
	const base = readFileSync(join(__dirname, "..", "..", "test", "data", "red-circle.png")).toString("base64");

	const padded = oversize(base, 20 * 1024 * 1024);

	const messages = [makeMessage([makeImage(base), makeImage(padded)])];

	const { messages: sanitized, note } = sanitizeImages(messages, {
		providerLabel: "OpenAI",
		maxBytes: 20 * 1024 * 1024,
	});

	console.log("OpenAI oversize repro (offline)");
	console.log("Original images:", 2);
	console.log("Remaining images:", Array.isArray(sanitized[0]?.content) ? sanitized[0].content.length : 0);
	console.log("Note:", note ?? "<none>");
}

main();
