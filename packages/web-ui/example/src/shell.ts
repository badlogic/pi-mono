import { html, type TemplateResult } from "lit";
import { APP_NAME, APP_TAGLINE } from "./config.js";

export interface ShellViewModel {
	sessionTitle: string;
	modelLabel: string;
	customProviderCount: number;
}

export interface ShellActions {
	newSession: () => void;
	openSessions: () => void;
	openProviders: () => void;
	openApiKeys: () => void;
	openProxy: () => void;
	openConnections: () => void;
	seedLocalProviders: () => void;
}

export function renderShell(
	viewModel: ShellViewModel,
	actions: ShellActions,
	chatPanel: TemplateResult | HTMLElement,
): TemplateResult {
	return html`
		<div class="app-shell">
			<aside class="app-rail">
				<div class="panel panel-brand">
					<div class="eyebrow">${APP_NAME}</div>
					<h1>${APP_TAGLINE}</h1>
					<p>
						A small provider-agnostic workspace built on pi-agent-core, pi-ai, and pi-web-ui.
					</p>
				</div>

				<div class="panel">
					<div class="panel-heading">Workspace</div>
					<div class="button-stack">
						<button class="action-button" @click=${actions.newSession}>New chat</button>
						<button class="action-button" @click=${actions.openSessions}>Session history</button>
					</div>
				</div>

				<div class="panel">
					<div class="panel-heading">Connections</div>
					<div class="button-stack">
						<button class="action-button" @click=${actions.openConnections}>All settings</button>
						<button class="action-button" @click=${actions.openProviders}>Providers and models</button>
						<button class="action-button" @click=${actions.openApiKeys}>API keys</button>
						<button class="action-button" @click=${actions.openProxy}>Proxy</button>
						<button class="action-button action-button-secondary" @click=${actions.seedLocalProviders}>
							Seed local runtimes
						</button>
					</div>
					<p class="panel-note">
						${viewModel.customProviderCount} custom provider${viewModel.customProviderCount === 1 ? "" : "s"} configured.
					</p>
				</div>

				<div class="panel panel-muted">
					<div class="panel-heading">Compatible backends</div>
					<ul class="hint-list">
						<li>OpenAI, Anthropic, Google through browser-stored API keys</li>
						<li>Ollama, vLLM, LM Studio, llama.cpp through custom providers</li>
						<li>OpenAI-compatible gateways through the providers tab</li>
					</ul>
				</div>
			</aside>

			<main class="app-main">
				<header class="app-header">
					<div>
						<div class="eyebrow">Current session</div>
						<h2>${viewModel.sessionTitle}</h2>
						<p class="model-label">${viewModel.modelLabel}</p>
					</div>
					<div class="header-actions">
						<theme-toggle></theme-toggle>
						<button class="action-button action-button-secondary" @click=${actions.openConnections}>
							Connections
						</button>
					</div>
				</header>

				<section class="chat-stage">${chatPanel}</section>
			</main>
		</div>
	`;
}
