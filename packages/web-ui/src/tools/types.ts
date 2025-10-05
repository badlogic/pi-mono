import type { ToolResultMessage } from "@mariozechner/pi-ai";
import type { TemplateResult } from "lit";

export interface ToolRenderer<TParams = any, TDetails = any> {
	renderParams(params: TParams, isStreaming?: boolean): TemplateResult;
	renderResult(params: TParams, result: ToolResultMessage<TDetails>): TemplateResult;
}
