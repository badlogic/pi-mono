import { CLAUDE_CODE_IDENTITY } from "./providers/anthropic.js";
import { buildAntigravitySystemInstruction } from "./providers/google-gemini-cli.js";
import { buildCodexPiBridge, buildCodexSystemPrompt, getCodexInstructions } from "./providers/openai-codex/index.js";
import type { Api, Model, Tool } from "./types.js";

export interface SystemPromptEstimateOptions {
	model?: Model<Api>;
	systemPrompt: string;
	tools?: Tool[];
	isAnthropicOAuth?: boolean;
}

export function getSystemPromptEstimateParts(options: SystemPromptEstimateOptions): string[] {
	const { model, systemPrompt, tools, isAnthropicOAuth } = options;
	const promptText = systemPrompt ?? "";
	if (!model) {
		return promptText.length > 0 ? [promptText] : [];
	}

	if (model.api === "openai-codex-responses") {
		const codexPrompt = buildCodexSystemPrompt({
			codexInstructions: getCodexInstructions(),
			bridgeText: buildCodexPiBridge(tools ?? []),
			userSystemPrompt: promptText,
		});
		return [codexPrompt.instructions, ...codexPrompt.developerMessages].filter((part) => part.length > 0);
	}

	if (model.provider === "google-antigravity") {
		const antigravityPrompt = buildAntigravitySystemInstruction(promptText);
		return antigravityPrompt.length > 0 ? [antigravityPrompt] : [];
	}

	const parts: string[] = [];
	if (model.provider === "anthropic" && isAnthropicOAuth) {
		parts.push(CLAUDE_CODE_IDENTITY);
	}
	if (promptText.length > 0) {
		parts.push(promptText);
	}

	return parts;
}
