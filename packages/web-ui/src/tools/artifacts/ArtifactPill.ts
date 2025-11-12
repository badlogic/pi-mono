import { icon } from "@mariozechner/mini-lit";
import { html, type TemplateResult } from "lit";
import { FileCode2 } from "lucide";
import type { ArtifactsPanel } from "./artifacts.js";

export function ArtifactPill(filename: string, artifactsPanel?: ArtifactsPanel): TemplateResult {
	const handleClick = (e: Event) => {
		if (!artifactsPanel) return;
		e.preventDefault();
		e.stopPropagation();
		// openArtifact will show the artifact and call onOpen() to open the panel if needed
		artifactsPanel.openArtifact(filename);
	};

	return html`
		<span
			class="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-muted/50 border border-border rounded ${
				artifactsPanel ? "cursor-pointer hover:bg-muted transition-colors" : ""
			}"
			@click=${artifactsPanel ? handleClick : null}
		>
			${icon(FileCode2, "sm")}
			<span class="text-foreground">${filename}</span>
		</span>
	`;
}
