import { html } from "@mariozechner/mini-lit";
import { calculateTool, getCurrentTimeTool, getModel } from "@mariozechner/pi-ai";
import { LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import "./AgentInterface.js";
import { AgentSession } from "./state/agent-session.js";
import { browserJavaScriptTool, createJavaScriptReplTool } from "./tools/index.js";
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

		// Create JavaScript REPL tool with attachments provider
		const javascriptReplTool = createJavaScriptReplTool();

		// Create agent session with default settings
		this.session = new AgentSession({
			initialState: {
				systemPrompt: "You are a helpful AI assistant.",
				model: getModel("anthropic", "claude-3-5-haiku-20241022"),
				tools: [calculateTool, getCurrentTimeTool, browserJavaScriptTool, javascriptReplTool],
				thinkingLevel: "off",
			},
			authTokenProvider: async () => getAuthToken(),
			transportMode: "direct", // Use direct mode by default (API keys from KeyStore)
		});

		// Wire up attachments provider for JavaScript REPL tool
		// We'll need to get attachments from the AgentInterface
		javascriptReplTool.attachmentsProvider = () => {
			// Get all attachments from conversation messages
			const attachments: any[] = [];
			for (const message of this.session.state.messages) {
				if (message.role === "user") {
					const content = Array.isArray(message.content) ? message.content : [message.content];
					for (const block of content) {
						if (typeof block !== "string" && block.type === "image") {
							attachments.push({
								id: `image-${attachments.length}`,
								fileName: "image.png",
								mimeType: block.mimeType || "image/png",
								size: 0,
								content: block.data,
							});
						}
					}
				}
			}
			return attachments;
		};
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
