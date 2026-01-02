/**
 * Codex compatibility layer for ChatGPT OAuth users.
 *
 * When using OpenAI OAuth (ChatGPT Plus/Pro), the backend requires
 * the exact Codex CLI system prompt. This module provides that prompt.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the Codex prompt at module load time
let codexPrompt: string | undefined;

/**
 * Get the Codex CLI system prompt required for ChatGPT backend.
 * The ChatGPT backend validates that this exact prompt is used.
 */
export function getCodexPrompt(): string {
	if (!codexPrompt) {
		const promptPath = join(__dirname, "codex-prompt.md");
		codexPrompt = readFileSync(promptPath, "utf-8");
	}
	return codexPrompt;
}
