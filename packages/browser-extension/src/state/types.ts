import type { AssistantMessage, Context } from "@mariozechner/pi-ai";

export interface DebugLogEntry {
	timestamp: string;
	request: { provider: string; model: string; context: Context };
	response?: AssistantMessage;
	error?: unknown;
	sseEvents: string[];
	ttft?: number;
	totalTime?: number;
}
