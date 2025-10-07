import { html, type TemplateResult } from "@mariozechner/mini-lit";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { Calculator } from "lucide";
import { i18n } from "../../utils/i18n.js";
import { renderHeader } from "../renderer-registry.js";
import type { ToolRenderer } from "../types.js";

interface CalculateParams {
	expression: string;
}

// Calculate tool has undefined details (only uses output)
export class CalculateRenderer implements ToolRenderer<CalculateParams, undefined> {
	render(params: CalculateParams | undefined, result: ToolResultMessage<undefined> | undefined): TemplateResult {
		const state = result ? (result.isError ? "error" : "complete") : "inprogress";

		// Full params + full result
		if (result && params?.expression) {
			const output = result.output || "";

			// Error: show expression in header, error below
			if (result.isError) {
				return html`
					<div class="space-y-3">
						${renderHeader(state, Calculator, params.expression)}
						<div class="text-sm text-destructive">${output}</div>
					</div>
				`;
			}

			// Success: show expression = result in header
			return renderHeader(state, Calculator, `${params.expression} = ${output}`);
		}

		// Full params, no result: just show header with expression in it
		if (params?.expression) {
			return renderHeader(state, Calculator, `${i18n("Calculating")} ${params.expression}`);
		}

		// Partial params (empty expression), no result
		if (params && !params.expression) {
			return renderHeader(state, Calculator, i18n("Writing expression..."));
		}

		// No params, no result
		return renderHeader(state, Calculator, i18n("Waiting for expression..."));
	}
}
