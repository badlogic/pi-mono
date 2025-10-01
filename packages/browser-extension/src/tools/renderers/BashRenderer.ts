import { html, type TemplateResult } from "@mariozechner/mini-lit";
import type { ToolResultMessage } from "@mariozechner/pi-ai";
import { i18n } from "../../utils/i18n.js";
import type { ToolRenderer } from "../types.js";

interface BashParams {
	command: string;
}

// Bash tool has undefined details (only uses output)
export class BashRenderer implements ToolRenderer<BashParams, undefined> {
	renderParams(params: BashParams, isStreaming?: boolean): TemplateResult {
		if (isStreaming && (!params.command || params.command.length === 0)) {
			return html`<div class="text-sm text-muted-foreground">${i18n("Writing command...")}</div>`;
		}

		return html`
			<div class="text-sm text-muted-foreground">
				<span>${i18n("Running command:")}</span>
				<code class="ml-1 px-1.5 py-0.5 bg-muted rounded text-xs font-mono">${params.command}</code>
			</div>
		`;
	}

	renderResult(_params: BashParams, result: ToolResultMessage<undefined>): TemplateResult {
		const output = result.output || "";
		const isError = result.isError === true;

		if (isError) {
			return html`
				<div class="text-sm">
					<div class="text-destructive font-medium mb-1">${i18n("Command failed:")}</div>
					<pre class="text-xs font-mono text-destructive bg-destructive/10 p-2 rounded overflow-x-auto">${output}</pre>
				</div>
			`;
		}

		// Display the command output
		return html`
			<div class="text-sm">
				<pre class="text-xs font-mono text-foreground bg-muted/50 p-2 rounded overflow-x-auto">${output}</pre>
			</div>
		`;
	}
}
