import type { ToolResultMessage } from "@mariozechner/pi-ai";
import type { TemplateResult } from "lit";

export interface ToolRenderer<TParams = any, TDetails = any> {
	render(
		params: TParams | undefined,
		result: ToolResultMessage<TDetails> | undefined,
		isStreaming?: boolean,
	): TemplateResult;
}
