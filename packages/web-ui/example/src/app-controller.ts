import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import { Agent, type AgentEvent } from "@mariozechner/pi-agent-core";
import {
	type AgentState,
	ApiKeyPromptDialog,
	ApiKeysTab,
	type AppStorage,
	ChatPanel,
	type CustomProvidersStore,
	createJavaScriptReplTool,
	ProvidersModelsTab,
	ProxyTab,
	type SessionData,
	SessionListDialog,
	SettingsDialog,
} from "@mariozechner/pi-web-ui";
import { render } from "lit";
import { createDefaultAgentState } from "./config.js";
import { countCustomProviders, ensureProviderPresets } from "./providers.js";
import { buildSessionRecord, generateSessionTitle, shouldPersistSession } from "./session-utils.js";
import { renderShell } from "./shell.js";

export class PiConsoleApp {
	private readonly chatPanel = new ChatPanel();
	private agent?: Agent;
	private unsubscribe?: () => void;
	private currentSessionId?: string;
	private currentTitle = "New chat";
	private customProviderCount = 0;

	constructor(
		private readonly host: HTMLElement,
		private readonly storage: AppStorage,
		private readonly customProviders: CustomProvidersStore,
	) {}

	async init(): Promise<void> {
		await ensureProviderPresets(this.customProviders);
		await this.refreshProviderCount();

		window.addEventListener("focus", () => {
			void this.refreshProviderCount();
		});

		render(this.renderLoading(), this.host);

		const sessionId = new URL(window.location.href).searchParams.get("session");
		if (sessionId && (await this.loadSession(sessionId))) {
			this.render();
			return;
		}

		await this.startNewSession();
	}

	private renderLoading() {
		return renderShell(
			{
				sessionTitle: "Loading",
				modelLabel: "Preparing workspace",
				customProviderCount: this.customProviderCount,
			},
			{
				newSession: () => undefined,
				openSessions: () => undefined,
				openProviders: () => undefined,
				openApiKeys: () => undefined,
				openProxy: () => undefined,
				openConnections: () => undefined,
				seedLocalProviders: () => undefined,
			},
			this.chatPanel,
		);
	}

	private async refreshProviderCount(): Promise<void> {
		this.customProviderCount = await countCustomProviders(this.customProviders);
		this.render();
	}

	private render(): void {
		render(
			renderShell(
				{
					sessionTitle: this.currentTitle,
					modelLabel: this.agent
						? `${this.agent.state.model.provider}/${this.agent.state.model.id}`
						: "No model selected",
					customProviderCount: this.customProviderCount,
				},
				{
					newSession: () => {
						void this.startNewSession();
					},
					openSessions: () => {
						this.openSessions();
					},
					openProviders: () => {
						this.openProviders();
					},
					openApiKeys: () => {
						this.openApiKeys();
					},
					openProxy: () => {
						this.openProxy();
					},
					openConnections: () => {
						this.openConnections();
					},
					seedLocalProviders: () => {
						void this.seedLocalProviders();
					},
				},
				this.chatPanel,
			),
			this.host,
		);
	}

	private async seedLocalProviders(): Promise<void> {
		await ensureProviderPresets(this.customProviders);
		await this.refreshProviderCount();
		this.openProviders();
	}

	private openSessions(): void {
		SessionListDialog.open(
			async (sessionId) => {
				await this.loadSession(sessionId);
				this.render();
			},
			(deletedSessionId) => {
				if (deletedSessionId === this.currentSessionId) {
					void this.startNewSession();
				}
			},
		);
	}

	private openProviders(): void {
		SettingsDialog.open([new ProvidersModelsTab()]);
	}

	private openApiKeys(): void {
		SettingsDialog.open([new ApiKeysTab()]);
	}

	private openProxy(): void {
		SettingsDialog.open([new ProxyTab()]);
	}

	private openConnections(): void {
		SettingsDialog.open([new ProvidersModelsTab(), new ApiKeysTab(), new ProxyTab()]);
	}

	private setUrlSession(sessionId?: string): void {
		const url = new URL(window.location.href);
		if (sessionId) {
			url.searchParams.set("session", sessionId);
		} else {
			url.searchParams.delete("session");
		}
		window.history.replaceState({}, "", url);
	}

	private handleAgentEvent = (event: AgentEvent): void => {
		if (event.type === "message_end" || event.type === "agent_end") {
			void this.persistSession();
		}
		this.render();
	};

	private async createAgent(initialState?: Partial<AgentState>): Promise<void> {
		this.unsubscribe?.();
		this.agent?.abort();

		this.agent = new Agent({
			initialState: initialState ?? createDefaultAgentState(),
		});

		this.agent.sessionId = this.currentSessionId;
		this.unsubscribe = this.agent.subscribe(this.handleAgentEvent);

		await this.chatPanel.setAgent(this.agent, {
			onApiKeyRequired: async (provider: string) => ApiKeyPromptDialog.prompt(provider),
			toolsFactory: (_agent, _agentInterface, _artifactsPanel, runtimeProvidersFactory) => {
				const replTool = createJavaScriptReplTool();
				replTool.runtimeProvidersFactory = runtimeProvidersFactory;
				return [replTool];
			},
		});
	}

	async startNewSession(): Promise<void> {
		this.currentSessionId = undefined;
		this.currentTitle = "New chat";
		this.setUrlSession(undefined);
		await this.createAgent();
		this.render();
	}

	async loadSession(sessionId: string): Promise<boolean> {
		const sessionData = await this.storage.sessions.get(sessionId);
		if (!sessionData) {
			return false;
		}

		this.currentSessionId = sessionId;
		this.currentTitle = sessionData.title || "Recovered chat";
		this.setUrlSession(sessionId);

		await this.createAgent({
			model: sessionData.model,
			thinkingLevel: sessionData.thinkingLevel,
			messages: sessionData.messages,
			tools: [],
		});

		return true;
	}

	private async persistSession(): Promise<void> {
		if (!this.agent) return;

		const state = this.agent.state;
		if (!shouldPersistSession(state.messages)) return;

		if (!this.currentSessionId) {
			this.currentSessionId = crypto.randomUUID();
			this.agent.sessionId = this.currentSessionId;
			this.setUrlSession(this.currentSessionId);
		}

		if (this.currentTitle === "New chat") {
			this.currentTitle = generateSessionTitle(state.messages);
		}

		const record = buildSessionRecord(this.currentSessionId, this.currentTitle, state);
		await this.storage.sessions.save(record.data as SessionData, record.metadata);
	}
}
