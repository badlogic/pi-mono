import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("pi-chat-panel")
export class ChatPanel extends LitElement {
	createRenderRoot() {
		return this;
	}

	render() {
		return html`<h1>Hello world</h1>`;
	}
}
