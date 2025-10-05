import { Badge, html } from "@mariozechner/mini-lit";
import { type AgentTool, getModel } from "@mariozechner/pi-ai";
import { LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "./components/AgentInterface.js";
import { AgentSession, type AgentSessionState, type ThinkingLevel } from "./state/agent-session.js";
import { ArtifactsPanel } from "./tools/artifacts/index.js";
import { createJavaScriptReplTool } from "./tools/javascript-repl.js";
import { registerToolRenderer } from "./tools/renderer-registry.js";
import { getAuthToken } from "./utils/auth-token.js";
import { i18n } from "./utils/i18n.js";

const BREAKPOINT = 800; // px - switch between overlay and side-by-side

@customElement("pi-chat-panel")
export class ChatPanel extends LitElement {
	@state() private session!: AgentSession;
	@state() private artifactsPanel!: ArtifactsPanel;
	@state() private hasArtifacts = false;
	@state() private artifactCount = 0;
	@state() private showArtifactsPanel = false;
	@state() private windowWidth = window.innerWidth;
	@property({ type: String }) systemPrompt = "You are a helpful AI assistant.";
	@property({ type: Array }) additionalTools: AgentTool<any, any>[] = [];
	@property({ attribute: false }) sandboxUrlProvider?: () => string;
	@property({ attribute: false }) onApiKeyRequired?: (provider: string) => Promise<boolean>;

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
		if (this.sandboxUrlProvider) {
			javascriptReplTool.sandboxUrlProvider = this.sandboxUrlProvider;
		}

		// Set up artifacts panel
		this.artifactsPanel = new ArtifactsPanel();
		if (this.sandboxUrlProvider) {
			this.artifactsPanel.sandboxUrlProvider = this.sandboxUrlProvider;
		}
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

		const initialState = {
			systemPrompt: this.systemPrompt,
			model: getModel("anthropic", "claude-sonnet-4-5-20250929"),
			tools: [...this.additionalTools, javascriptReplTool, this.artifactsPanel.tool],
			thinkingLevel: "off" as ThinkingLevel,
			messages: [],
		} satisfies Partial<AgentSessionState>;
		// initialState = { ...initialState, ...(simpleHtml as any) };
		// initialState = { ...initialState, ...(longSession as any) };

		// Create agent session first so attachments provider works
		this.session = new AgentSession({
			initialState,
			authTokenProvider: async () => getAuthToken(),
			transportMode: "provider", // Use provider mode by default (API keys from storage, optional CORS proxy)
		});

		// Reconstruct artifacts panel from initial messages (session must exist first)
		await this.artifactsPanel.reconstructFromMessages(initialState.messages);
		this.hasArtifacts = this.artifactsPanel.artifacts.size > 0;
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

		// Set panel props
		if (this.artifactsPanel) {
			this.artifactsPanel.collapsed = !this.showArtifactsPanel;
			this.artifactsPanel.overlay = isMobile;
		}

		return html`
			<div class="relative w-full h-full overflow-hidden flex">
				<div class="h-full" style="${!isMobile && this.showArtifactsPanel && this.hasArtifacts ? "width: 50%;" : "width: 100%;"}">
						<agent-interface
							.session=${this.session}
							.enableAttachments=${true}
							.enableModelSelector=${true}
							.showThinkingSelector=${true}
							.showThemeToggle=${false}
							.showDebugToggle=${false}
							.onApiKeyRequired=${this.onApiKeyRequired}
						></agent-interface>
					</div>

					<!-- Floating pill when artifacts exist and panel is collapsed -->
					${
						this.hasArtifacts && !this.showArtifactsPanel
							? html`
								<button
									class="absolute z-30 top-4 left-1/2 -translate-x-1/2 pointer-events-auto"
									@click=${() => {
										this.showArtifactsPanel = true;
										this.requestUpdate();
									}}
									title=${i18n("Show artifacts")}
								>
									${Badge(html`
										<span class="inline-flex items-center gap-1">
											<span>${i18n("Artifacts")}</span>
											${
												this.artifactCount > 1
													? html`<span
														class="text-[10px] leading-none bg-primary-foreground/20 text-primary-foreground rounded px-1 font-mono tabular-nums"
														>${this.artifactCount}</span
													>`
													: ""
											}
										</span>
									`)}
								</button>
							`
							: ""
					}

				<div class="h-full ${isMobile ? "absolute inset-0 pointer-events-none" : ""}" style="${!isMobile ? (!this.hasArtifacts || !this.showArtifactsPanel ? "display: none;" : "width: 50%;") : ""}">
					${this.artifactsPanel}
				</div>
			</div>
		`;
	}
}
