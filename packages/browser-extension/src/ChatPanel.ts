import { html } from "@mariozechner/mini-lit";
import { calculateTool, getCurrentTimeTool, getModel } from "@mariozechner/pi-ai";
import { LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./AgentInterface.js";
import { AgentSession } from "./state/agent-session.js";
import { getAuthToken } from "./utils/auth-token.js";

@customElement("pi-chat-panel")
export class ChatPanel extends LitElement {
	@state() private session!: AgentSession;

	createRenderRoot() {
		return this;
	}

	override async connectedCallback() {
		super.connectedCallback();

		// Ensure panel fills height and allows flex layout
		this.style.display = "flex";
		this.style.flexDirection = "column";
		this.style.height = "100%";
		this.style.minHeight = "0";

		// Create agent session with default settings
		this.session = new AgentSession({
			initialState: {
				systemPrompt: "You are a helpful AI assistant.",
				model: getModel("anthropic", "claude-3-5-haiku-20241022"),
				tools: [calculateTool, getCurrentTimeTool],
				thinkingLevel: "off",
			},
			authTokenProvider: async () => getAuthToken(),
			transportMode: "direct", // Use direct mode by default (API keys from KeyStore)
		});
	}

	render() {
		if (!this.session) {
			return html`<div class="flex items-center justify-center h-full">
				<div class="text-muted-foreground">Loading...</div>
			</div>`;
		}

		return html`
			<agent-interface
				.session=${this.session}
				.enableAttachments=${true}
				.enableModelSelector=${true}
				.enableThinking=${true}
				.showThemeToggle=${false}
				.showDebugToggle=${false}
			></agent-interface>
		`;
	}
}
