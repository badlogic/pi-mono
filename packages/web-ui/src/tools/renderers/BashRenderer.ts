import { html, type TemplateResult } from "@mariozechner/mini-lit";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { SquareTerminal } from "lucide";
import { i18n } from "../../utils/i18n.js";
import { renderHeader } from "../renderer-registry.js";
import type { ToolRenderer } from "../types.js";

interface BashParams {
	command: string;
}

// Bash tool has undefined details (only uses output)
export class BashRenderer implements ToolRenderer<BashParams, undefined> {
	render(params: BashParams | undefined, result: ToolResultMessage<undefined> | undefined): TemplateResult {
		const state = result ? (result.isError ? "error" : "complete") : "inprogress";

		// With result: show command + output
		if (result && params?.command) {
			const output = result.output || "";
			const combined = output ? `> ${params.command}\n\n${output}` : `> ${params.command}`;
			return html`
				<div class="space-y-3">
					${renderHeader(state, SquareTerminal, i18n("Running command..."))}
					<console-block .content=${combined} .variant=${result.isError ? "error" : "default"}></console-block>
				</div>
			`;
		}

		// Just params (streaming or waiting)
		if (params?.command) {
			return html`
				<div class="space-y-3">
					${renderHeader(state, SquareTerminal, i18n("Running command..."))}
					<console-block .content=${`> ${params.command}`}></console-block>
				</div>
			`;
		}

		// No params yet
		return renderHeader(state, SquareTerminal, i18n("Waiting for command..."));
	}
}
