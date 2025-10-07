import { html, type TemplateResult } from "@mariozechner/mini-lit";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { i18n } from "../../utils/i18n.js";
import type { ToolRenderer } from "../types.js";

export class DefaultRenderer implements ToolRenderer {
	render(params: any | undefined, result: ToolResultMessage | undefined, isStreaming?: boolean): TemplateResult {
		// Show result if available
		if (result) {
			const text = result.output || i18n("(no output)");
			return html`<div class="text-sm text-muted-foreground whitespace-pre-wrap font-mono">${text}</div>`;
		}

		// Show params
		if (params) {
			let text: string;
			try {
				text = JSON.stringify(JSON.parse(params), null, 2);
			} catch {
				try {
					text = JSON.stringify(params, null, 2);
				} catch {
					text = String(params);
				}
			}

			if (isStreaming && (!text || text === "{}" || text === "null")) {
				return html`<div class="text-sm text-muted-foreground">${i18n("Preparing tool parameters...")}</div>`;
			}

			return html`<console-block .content=${text}></console-block>`;
		}

		// No params or result yet
		return html`<div class="text-sm text-muted-foreground">${i18n("Preparing tool...")}</div>`;
	}
}
