import { html, type TemplateResult } from "@mariozechner/mini-lit";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { i18n } from "../../utils/i18n.js";
import type { ToolRenderer } from "../types.js";

interface GetCurrentTimeParams {
	timezone?: string;
}

// GetCurrentTime tool has undefined details (only uses output)
export class GetCurrentTimeRenderer implements ToolRenderer<GetCurrentTimeParams, undefined> {
	renderParams(params: GetCurrentTimeParams, isStreaming?: boolean): TemplateResult {
		if (params.timezone) {
			return html`
				<div class="text-sm text-muted-foreground">
					<span>${i18n("Getting current time in")}</span>
					<code class="mx-1 px-1.5 py-0.5 bg-muted rounded text-xs font-mono">${params.timezone}</code>
				</div>
			`;
		}
		return html`
			<div class="text-sm text-muted-foreground">
				<span>${i18n("Getting current date and time")}${isStreaming ? "..." : ""}</span>
			</div>
		`;
	}

	renderResult(_params: GetCurrentTimeParams, result: ToolResultMessage<undefined>): TemplateResult {
		const output = result.output || "";
		const isError = result.isError === true;

		if (isError) {
			return html`<div class="text-sm text-destructive">${output}</div>`;
		}

		// Display the date/time result
		return html`<div class="text-sm font-mono text-foreground">${output}</div>`;
	}
}
