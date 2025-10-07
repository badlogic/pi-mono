import { html, type TemplateResult } from "@mariozechner/mini-lit";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { Clock } from "lucide";
import { i18n } from "../../utils/i18n.js";
import { renderHeader } from "../renderer-registry.js";
import type { ToolRenderer } from "../types.js";

interface GetCurrentTimeParams {
	timezone?: string;
}

// GetCurrentTime tool has undefined details (only uses output)
export class GetCurrentTimeRenderer implements ToolRenderer<GetCurrentTimeParams, undefined> {
	render(params: GetCurrentTimeParams | undefined, result: ToolResultMessage<undefined> | undefined): TemplateResult {
		const state = result ? (result.isError ? "error" : "complete") : "inprogress";

		// Full params + full result
		if (result && params) {
			const output = result.output || "";
			const headerText = params.timezone
				? `${i18n("Getting current time in")} ${params.timezone}`
				: i18n("Getting current date and time");

			// Error: show header, error below
			if (result.isError) {
				return html`
					<div class="space-y-3">
						${renderHeader(state, Clock, headerText)}
						<div class="text-sm text-destructive">${output}</div>
					</div>
				`;
			}

			// Success: show time in header
			return renderHeader(state, Clock, `${headerText}: ${output}`);
		}

		// Full result, no params
		if (result) {
			const output = result.output || "";

			// Error: show header, error below
			if (result.isError) {
				return html`
					<div class="space-y-3">
						${renderHeader(state, Clock, i18n("Getting current date and time"))}
						<div class="text-sm text-destructive">${output}</div>
					</div>
				`;
			}

			// Success: show time in header
			return renderHeader(state, Clock, `${i18n("Getting current date and time")}: ${output}`);
		}

		// Full params, no result: show timezone info in header
		if (params?.timezone) {
			return renderHeader(state, Clock, `${i18n("Getting current time in")} ${params.timezone}`);
		}

		// Partial params (no timezone) or empty params, no result
		if (params) {
			return renderHeader(state, Clock, i18n("Getting current date and time"));
		}

		// No params, no result
		return renderHeader(state, Clock, i18n("Getting time..."));
	}
}
