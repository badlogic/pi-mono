import { LitElement, type TemplateResult } from "lit";

export abstract class ArtifactElement extends LitElement {
	public filename = "";

	protected override createRenderRoot(): HTMLElement | DocumentFragment {
		return this; // light DOM for shared styles
	}

	public abstract get content(): string;
	public abstract set content(value: string);

	abstract getHeaderButtons(): TemplateResult | HTMLElement;
}
