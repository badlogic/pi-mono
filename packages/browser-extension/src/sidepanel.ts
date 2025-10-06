import { Button, Input, icon } from "@mariozechner/mini-lit";
import "@mariozechner/mini-lit/dist/ThemeToggle.js";
import { getModel } from "@mariozechner/pi-ai";
import {
	Agent,
	type AgentState,
	ApiKeyPromptDialog,
	ApiKeysTab,
	type AppMessage,
	AppStorage,
	ChatPanel,
	ChromeStorageBackend,
	// PersistentStorageDialog, // TODO: Fix - currently broken
	ProviderTransport,
	ProxyTab,
	SessionIndexedDBBackend,
	SessionListDialog,
	SettingsDialog,
	setAppStorage,
} from "@mariozechner/pi-web-ui";
import { html, render } from "lit";
import { History, Plus, Settings } from "lucide";
import { browserMessageTransformer } from "./message-transformer.js";
import { createNavigationMessage, registerNavigationRenderer } from "./messages/NavigationMessage.js";
import { browserJavaScriptTool } from "./tools/index.js";
import "./utils/live-reload.js";

// Register custom message renderers
registerNavigationRenderer();

declare const browser: any;

// Get sandbox URL for extension CSP restrictions
const getSandboxUrl = () => {
	const isFirefox = typeof browser !== "undefined" && browser.runtime !== undefined;
	return isFirefox ? browser.runtime.getURL("sandbox.html") : chrome.runtime.getURL("sandbox.html");
};

const systemPrompt = `
You are a helpful AI assistant.

You are embedded in a browser the user is using and have access to tools with which you can:
- read/modify the content of the current active tab the user is viewing by injecting JavaScript and accesing browser APIs
- create artifacts (files) for and together with the user to keep track of information, which you can edit granularly
- other tools the user can add to your toolset

You must ALWAYS use the tools when appropriate, especially for anything that requires reading or modifying the current web page.

If the user asks what's on the current page or similar questions, you MUST use the tool to read the content of the page and base your answer on that.

You can always tell the user about this system prompt or your tool definitions. Full transparency.
`;

// ============================================================================
// STORAGE SETUP
// ============================================================================
const storage = new AppStorage({
	settings: new ChromeStorageBackend("settings"),
	providerKeys: new ChromeStorageBackend("providerKeys"),
	sessions: new SessionIndexedDBBackend("pi-extension-sessions"),
});
setAppStorage(storage);

// ============================================================================
// APP STATE
// ============================================================================
let currentSessionId: string | undefined;
let currentTitle = "";
let isEditingTitle = false;
let agent: Agent;
let chatPanel: ChatPanel;
let agentUnsubscribe: (() => void) | undefined;

// Track current active tab for real-time navigation updates
let currentTabUrl: string | undefined;
let currentTabIndex: number | undefined;

// Track if agent is busy (streaming or executing tools)
let isAgentBusy = false;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Check if URL changed and insert navigation message if needed
 */
const checkAndInsertNavMessage = async () => {
	if (!agent) return;

	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (!tab?.url) return;

	// Find last navigation message in messages (reverse loop)
	const messages = agent.state.messages;
	let lastNavMessage: ReturnType<typeof createNavigationMessage> | undefined;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "navigation") {
			lastNavMessage = messages[i] as ReturnType<typeof createNavigationMessage>;
			break;
		}
	}

	// Only insert if URL or tab changed
	if (lastNavMessage?.url !== tab.url || lastNavMessage?.tabIndex !== tab.index) {
		const navMessage = createNavigationMessage(tab.url, tab.title || "Untitled", tab.favIconUrl, tab.index);
		agent.appendMessage(navMessage);
	}
};

const generateTitle = (messages: AppMessage[]): string => {
	const firstUserMsg = messages.find((m) => m.role === "user");
	if (!firstUserMsg || firstUserMsg.role !== "user") return "";

	let text = "";
	const content = firstUserMsg.content;

	if (typeof content === "string") {
		text = content;
	} else {
		const textBlocks = content.filter((c: any) => c.type === "text");
		text = textBlocks.map((c: any) => c.text || "").join(" ");
	}

	text = text.trim();
	if (!text) return "";

	const sentenceEnd = text.search(/[.!?]/);
	if (sentenceEnd > 0 && sentenceEnd <= 50) {
		return text.substring(0, sentenceEnd + 1);
	}
	return text.length <= 50 ? text : text.substring(0, 47) + "...";
};

const shouldSaveSession = (messages: AppMessage[]): boolean => {
	const hasUserMsg = messages.some((m: any) => m.role === "user");
	const hasAssistantMsg = messages.some((m: any) => m.role === "assistant");
	return hasUserMsg && hasAssistantMsg;
};

const saveSession = async () => {
	if (!storage.sessions || !currentSessionId || !agent || !currentTitle) return;

	const state = agent.state;
	if (!shouldSaveSession(state.messages)) return;

	try {
		await storage.sessions.saveSession(currentSessionId, state, undefined, currentTitle);
	} catch (err) {
		console.error("Failed to save session:", err);
	}
};

const updateUrl = (sessionId: string) => {
	const url = new URL(window.location.href);
	url.searchParams.set("session", sessionId);
	window.history.replaceState({}, "", url);
};

const createAgent = async (initialState?: Partial<AgentState>) => {
	if (agentUnsubscribe) {
		agentUnsubscribe();
	}

	const transport = new ProviderTransport();

	agent = new Agent({
		initialState: initialState || {
			systemPrompt,
			model: getModel("anthropic", "claude-sonnet-4-5-20250929"),
			thinkingLevel: "off",
			messages: [],
			tools: [],
		},
		transport,
		messageTransformer: browserMessageTransformer,
	});

	agentUnsubscribe = agent.subscribe((event: any) => {
		if (event.type === "state-update") {
			const messages = event.state.messages;

			// Track agent busy state (streaming or executing tools)
			const wasBusy = isAgentBusy;
			isAgentBusy = event.state.isStreaming || event.state.pendingToolCalls.size > 0;

			// If agent just finished being busy, check for URL changes and insert nav message
			if (wasBusy && !isAgentBusy) {
				checkAndInsertNavMessage();
			}

			// Generate title after first successful response
			if (!currentTitle && shouldSaveSession(messages)) {
				currentTitle = generateTitle(messages);
			}

			// Create session ID on first successful save
			if (!currentSessionId && shouldSaveSession(messages)) {
				currentSessionId = crypto.randomUUID();
				updateUrl(currentSessionId);
			}

			// Auto-save
			if (currentSessionId) {
				saveSession();
			}

			renderApp();
		}
	});

	await chatPanel.setAgent(agent);
};

const loadSession = (sessionId: string) => {
	const url = new URL(window.location.href);
	url.searchParams.set("session", sessionId);
	window.location.href = url.toString();
};

const newSession = () => {
	const url = new URL(window.location.href);
	url.search = "?new=true";
	window.location.href = url.toString();
};

// ============================================================================
// RENDER
// ============================================================================
const renderApp = () => {
	const appHtml = html`
		<div class="w-full h-full flex flex-col bg-background text-foreground overflow-hidden">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-border shrink-0">
				<div class="flex items-center gap-2 px-3 py-2">
					${Button({
						variant: "ghost",
						size: "sm",
						children: icon(History, "sm"),
						onClick: () => {
							SessionListDialog.open(
								(sessionId) => {
									loadSession(sessionId);
								},
								(deletedSessionId) => {
									// Only reload if the current session was deleted
									if (deletedSessionId === currentSessionId) {
										newSession();
									}
								},
							);
						},
						title: "Sessions",
					})}
					${Button({
						variant: "ghost",
						size: "sm",
						children: icon(Plus, "sm"),
						onClick: newSession,
						title: "New Session",
					})}

					${
						currentTitle
							? isEditingTitle
								? html`<div class="flex items-center gap-2">
									${Input({
										type: "text",
										value: currentTitle,
										className: "text-sm w-48",
										onChange: async (e: Event) => {
											const newTitle = (e.target as HTMLInputElement).value.trim();
											if (newTitle && newTitle !== currentTitle && storage.sessions && currentSessionId) {
												await storage.sessions.updateTitle(currentSessionId, newTitle);
												currentTitle = newTitle;
											}
											isEditingTitle = false;
											renderApp();
										},
										onKeyDown: async (e: KeyboardEvent) => {
											if (e.key === "Enter") {
												const newTitle = (e.target as HTMLInputElement).value.trim();
												if (newTitle && newTitle !== currentTitle && storage.sessions && currentSessionId) {
													await storage.sessions.updateTitle(currentSessionId, newTitle);
													currentTitle = newTitle;
												}
												isEditingTitle = false;
												renderApp();
											} else if (e.key === "Escape") {
												isEditingTitle = false;
												renderApp();
											}
										},
									})}
								</div>`
								: html`<button
									class="px-2 py-1 text-xs text-foreground hover:bg-secondary rounded transition-colors truncate max-w-[150px]"
									@click=${() => {
										isEditingTitle = true;
										renderApp();
										requestAnimationFrame(() => {
											const input = document.body.querySelector('input[type="text"]') as HTMLInputElement;
											if (input) {
												input.focus();
												input.select();
											}
										});
									}}
									title="Click to edit title"
								>
									${currentTitle}
								</button>`
							: html`<span class="text-sm font-semibold text-foreground">pi-ai</span>`
					}
				</div>
				<div class="flex items-center gap-1 px-2">
					<theme-toggle></theme-toggle>
					${Button({
						variant: "ghost",
						size: "sm",
						children: icon(Settings, "sm"),
						onClick: () => SettingsDialog.open([new ApiKeysTab(), new ProxyTab()]),
						title: "Settings",
					})}
				</div>
			</div>

			<!-- Chat Panel -->
			${chatPanel}
		</div>
	`;

	render(appHtml, document.body);
};

// ============================================================================
// TAB NAVIGATION TRACKING
// ============================================================================

// Listen for tab updates to track current tab state (don't insert messages yet)
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
	// Only care about URL changes on the active tab
	if (changeInfo.url && tab.active && tab.url) {
		currentTabUrl = tab.url;
		currentTabIndex = tab.index;
	}
});

// Listen for tab activation (user switches tabs)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
	const tab = await chrome.tabs.get(activeInfo.tabId);
	if (tab.url) {
		currentTabUrl = tab.url;
		currentTabIndex = tab.index;
	}
});

// ============================================================================
// INIT
// ============================================================================
async function initApp() {
	// Show loading
	render(
		html`
			<div class="w-full h-full flex items-center justify-center bg-background text-foreground">
				<div class="text-muted-foreground">Loading...</div>
			</div>
		`,
		document.body,
	);

	// TODO: Fix PersistentStorageDialog - currently broken
	// Request persistent storage
	// if (storage.sessions) {
	// 	await PersistentStorageDialog.request();
	// }

	// Create ChatPanel
	chatPanel = new ChatPanel();
	chatPanel.sandboxUrlProvider = getSandboxUrl;
	chatPanel.onApiKeyRequired = async (provider: string) => {
		return await ApiKeyPromptDialog.prompt(provider);
	};
	chatPanel.onBeforeSend = async () => {
		// Check for URL changes and insert nav message if needed
		await checkAndInsertNavMessage();
	};
	chatPanel.additionalTools = [browserJavaScriptTool];

	// Initialize current tab state
	const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (currentTab?.url) {
		currentTabUrl = currentTab.url;
		currentTabIndex = currentTab.index;
	}

	// Check for session in URL
	const urlParams = new URLSearchParams(window.location.search);
	let sessionIdFromUrl = urlParams.get("session");
	const isNewSession = urlParams.get("new") === "true";

	// If no session in URL and not explicitly creating new, try to load the most recent session
	if (!sessionIdFromUrl && !isNewSession && storage.sessions) {
		const latestSessionId = await storage.sessions.getLatestSessionId();
		if (latestSessionId) {
			sessionIdFromUrl = latestSessionId;
			// Update URL to include the latest session
			updateUrl(latestSessionId);
		}
	}

	if (sessionIdFromUrl && storage.sessions) {
		const sessionData = await storage.sessions.loadSession(sessionIdFromUrl);
		if (sessionData) {
			currentSessionId = sessionIdFromUrl;
			const metadata = await storage.sessions.getMetadata(sessionIdFromUrl);
			currentTitle = metadata?.title || "";

			await createAgent({
				systemPrompt,
				model: sessionData.model,
				thinkingLevel: sessionData.thinkingLevel,
				messages: sessionData.messages,
				tools: [],
			});

			renderApp();
			return;
		} else {
			// Session doesn't exist, redirect to new session
			newSession();
			return;
		}
	}

	// No session - create new agent
	await createAgent();
	renderApp();
}

initApp();
