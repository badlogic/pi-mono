import { getModel } from "@mariozechner/pi-ai";
import type { AgentState, ThinkingLevel } from "@mariozechner/pi-web-ui";

export const APP_NAME = "Pi Console";
export const APP_TAGLINE = "Modular chat UI for local and cloud models";
export const STORAGE_DB_NAME = "pi-console";
export const STORAGE_DB_VERSION = 3;
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = "off";
export const DEFAULT_MODEL = getModel("google", "gemini-2.5-flash-lite-preview-06-17");
export const DEFAULT_SYSTEM_PROMPT = `You are a precise AI assistant.

Prefer short, direct answers. Use tools only when they improve accuracy or save time.
When the selected provider or model changes, adapt without changing behavior.`;

export function createDefaultAgentState(): Partial<AgentState> {
	return {
		systemPrompt: DEFAULT_SYSTEM_PROMPT,
		model: DEFAULT_MODEL,
		thinkingLevel: DEFAULT_THINKING_LEVEL,
		messages: [],
		tools: [],
	};
}
