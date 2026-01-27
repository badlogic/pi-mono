/**
 * Demo: /copy format conversion.
 * Strips basic markdown markers before copying.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const MARKDOWN_MARKERS = /[`*_#>-]/g;

export default function (pi: ExtensionAPI) {
	pi.beforeCommand(
		"copy",
		{ id: "markdown-to-plain", label: "Markdown to Plain", transforms: ["text"] },
		async (data) => {
			const plainText = data.text.replace(MARKDOWN_MARKERS, "");
			return { data: { text: plainText } };
		},
	);
}
