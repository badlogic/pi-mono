import { html, icon, type TemplateResult } from "@mariozechner/mini-lit";
import { FileCode2 } from "lucide";
import type { ArtifactsPanel } from "./artifacts.js";

export function ArtifactPill(filename: string, artifactsPanel?: ArtifactsPanel): TemplateResult {
	const handleClick = () => {
		if (!artifactsPanel) return;
		// openArtifact will show the artifact and call onOpen() to open the panel if needed
		(artifactsPanel as any).openArtifact(filename);
	};

	return html`
		<div
			class="inline-flex items-center gap-2 px-2 py-1 text-xs bg-muted/50 border border-border rounded ${
				artifactsPanel ? "cursor-pointer hover:bg-muted transition-colors" : ""
			}"
			@click=${artifactsPanel ? handleClick : null}
		>
			${icon(FileCode2, "sm")}
			<span class="font-mono text-foreground">${filename}</span>
		</div>
	`;
}
