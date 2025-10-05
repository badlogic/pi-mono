import { html, type TemplateResult } from "@mariozechner/mini-lit";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { i18n } from "../../utils/i18n.js";
import type { ToolRenderer } from "../types.js";

export class DefaultRenderer implements ToolRenderer {
	renderParams(params: any, isStreaming?: boolean): TemplateResult {
		let text: string;
		let isJson = false;

		try {
			text = JSON.stringify(JSON.parse(params), null, 2);
			isJson = true;
		} catch {
			try {
				text = JSON.stringify(params, null, 2);
				isJson = true;
			} catch {
				text = String(params);
			}
		}

		if (isStreaming && (!text || text === "{}" || text === "null")) {
			return html`<div class="text-sm text-muted-foreground">${i18n("Preparing tool parameters...")}</div>`;
		}

		return html`<console-block .content=${text}></console-block>`;
	}

	renderResult(_params: any, result: ToolResultMessage): TemplateResult {
		// Just show the output field - that's what was sent to the LLM
		const text = result.output || i18n("(no output)");

		return html`<div class="text-sm text-muted-foreground whitespace-pre-wrap font-mono">${text}</div>`;
	}
}
