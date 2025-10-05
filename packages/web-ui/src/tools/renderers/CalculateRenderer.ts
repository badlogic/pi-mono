import { html, type TemplateResult } from "@mariozechner/mini-lit";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { i18n } from "../../utils/i18n.js";
import type { ToolRenderer } from "../types.js";

interface CalculateParams {
	expression: string;
}

// Calculate tool has undefined details (only uses output)
export class CalculateRenderer implements ToolRenderer<CalculateParams, undefined> {
	renderParams(params: CalculateParams, isStreaming?: boolean): TemplateResult {
		if (isStreaming && !params.expression) {
			return html`<div class="text-sm text-muted-foreground">${i18n("Writing expression...")}</div>`;
		}

		return html`
			<div class="text-sm text-muted-foreground">
				<span>${i18n("Calculating")}</span>
				<code class="mx-1 px-1.5 py-0.5 bg-muted rounded text-xs font-mono">${params.expression}</code>
			</div>
		`;
	}

	renderResult(_params: CalculateParams, result: ToolResultMessage<undefined>): TemplateResult {
		// Parse the output to make it look nicer
		const output = result.output || "";
		const isError = result.isError === true;

		if (isError) {
			return html`<div class="text-sm text-destructive">${output}</div>`;
		}

		// Try to split on = to show expression and result separately
		const parts = output.split(" = ");
		if (parts.length === 2) {
			return html`
				<div class="text-sm font-mono">
					<span class="text-muted-foreground">${parts[0]}</span>
					<span class="text-muted-foreground mx-1">=</span>
					<span class="text-foreground font-semibold">${parts[1]}</span>
				</div>
			`;
		}

		// Fallback to showing the whole output
		return html`<div class="text-sm font-mono text-foreground">${output}</div>`;
	}
}
