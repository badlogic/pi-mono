import { html } from "@mariozechner/mini-lit";
import { calculateTool, getCurrentTimeTool, getModel } from "@mariozechner/pi-ai";
import { LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "./AgentInterface.js";
import { AgentSession } from "./state/agent-session.js";
import { ArtifactsPanel } from "./tools/artifacts/index.js";
import { browserJavaScriptTool, createJavaScriptReplTool } from "./tools/index.js";
import { registerToolRenderer } from "./tools/renderer-registry.js";
import { getAuthToken } from "./utils/auth-token.js";

const BREAKPOINT = 800; // px - switch between overlay and side-by-side

@customElement("pi-chat-panel")
export class ChatPanel extends LitElement {
	@state() private session!: AgentSession;
	@state() private artifactsPanel!: ArtifactsPanel;
	@state() private hasArtifacts = false;
	@state() private artifactCount = 0;
	@state() private showArtifactsPanel = true;
	@state() private windowWidth = window.innerWidth;
	@property({ type: String }) systemPrompt = "You are a helpful AI assistant.";

	private resizeHandler = () => {
		this.windowWidth = window.innerWidth;
		this.requestUpdate();
	};

	createRenderRoot() {
		return this;
	}

	override async connectedCallback() {
		super.connectedCallback();

		// Listen to window resize
		window.addEventListener("resize", this.resizeHandler);

		// Ensure panel fills height and allows flex layout
		this.style.display = "flex";
		this.style.flexDirection = "column";
		this.style.height = "100%";
		this.style.minHeight = "0";

		// Create JavaScript REPL tool with attachments provider
		const javascriptReplTool = createJavaScriptReplTool();

		// Set up artifacts panel
		this.artifactsPanel = new ArtifactsPanel();
		registerToolRenderer("artifacts", this.artifactsPanel);

		// Attachments provider for both REPL and artifacts
		const getAttachments = () => {
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

		javascriptReplTool.attachmentsProvider = getAttachments;
		this.artifactsPanel.attachmentsProvider = getAttachments;

		this.artifactsPanel.onArtifactsChange = () => {
			const count = this.artifactsPanel.artifacts?.size ?? 0;
			const created = count > this.artifactCount;
			this.hasArtifacts = count > 0;
			this.artifactCount = count;

			// Auto-open when new artifacts are created
			if (this.hasArtifacts && created) {
				this.showArtifactsPanel = true;
			}
			this.requestUpdate();
		};

		this.artifactsPanel.onClose = () => {
			this.showArtifactsPanel = false;
			this.requestUpdate();
		};

		this.artifactsPanel.onOpen = () => {
			this.showArtifactsPanel = true;
			this.requestUpdate();
		};

		// Create agent session with default settings
		this.session = new AgentSession({
			initialState: {
				systemPrompt: this.systemPrompt,
				model: getModel("anthropic", "claude-3-5-haiku-20241022"),
				tools: [
					calculateTool,
					getCurrentTimeTool,
					browserJavaScriptTool,
					javascriptReplTool,
					this.artifactsPanel.tool,
				],
				thinkingLevel: "off",
			},
			authTokenProvider: async () => getAuthToken(),
			transportMode: "direct", // Use direct mode by default (API keys from KeyStore)
		});
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		window.removeEventListener("resize", this.resizeHandler);
	}

	// Expose method to toggle artifacts panel
	public toggleArtifactsPanel() {
		this.showArtifactsPanel = !this.showArtifactsPanel;
		this.requestUpdate();
	}

	// Check if artifacts panel is currently visible
	public get artifactsPanelVisible(): boolean {
		return this.showArtifactsPanel;
	}

	render() {
		if (!this.session) {
			return html`<div class="flex items-center justify-center h-full">
				<div class="text-muted-foreground">Loading...</div>
			</div>`;
		}

		const isMobile = this.windowWidth < BREAKPOINT;

		// Set panel modes: collapsed when not showing, overlay on mobile
		if (this.artifactsPanel) {
			this.artifactsPanel.collapsed = !this.showArtifactsPanel;
			this.artifactsPanel.overlay = isMobile;
		}

		// Compute layout widths for desktop side-by-side
		let chatWidth = "100%";
		let artifactsWidth = "0%";

		if (!isMobile && this.hasArtifacts && this.showArtifactsPanel) {
			chatWidth = "50%";
			artifactsWidth = "50%";
		}

		return html`
			<div class="relative w-full h-full overflow-hidden flex">
				<!-- Chat interface -->
				<div class="h-full ${isMobile ? "w-full" : ""}" style="${!isMobile ? `width: ${chatWidth};` : ""}">
					<agent-interface
						.session=${this.session}
						.enableAttachments=${true}
						.enableModelSelector=${true}
						.enableThinking=${true}
						.showThemeToggle=${false}
						.showDebugToggle=${false}
					></agent-interface>
				</div>

				<!-- Artifacts panel (desktop side-by-side) -->
				${
					!isMobile
						? html`<div class="h-full" style="${this.hasArtifacts && this.showArtifactsPanel ? `width: ${artifactsWidth};` : "width: 0;"}">
							${this.artifactsPanel}
						</div>`
						: ""
				}

				<!-- Mobile: artifacts panel always rendered (shows pill when collapsed) -->
				${isMobile ? html`<div class="absolute inset-0 pointer-events-none">${this.artifactsPanel}</div>` : ""}
			</div>
		`;
	}
}
