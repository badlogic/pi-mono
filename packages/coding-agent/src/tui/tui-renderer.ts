import * as fs from "node:fs";
import * as path from "node:path";
import type { Agent, AgentEvent, AgentState, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message, Model } from "@mariozechner/pi-ai";
import type { SlashCommand } from "@mariozechner/pi-tui";
import {
	CombinedAutocompleteProvider,
	Container,
	Input,
	Loader,
	Markdown,
	ProcessTerminal,
	Spacer,
	Text,
	TruncatedText,
	TUI,
	visibleWidth,
} from "@mariozechner/pi-tui";
import { exec, spawn } from "child_process";
import { getChangelogPath, parseChangelog } from "../changelog.js";
import { copyToClipboard } from "../clipboard.js";
import { calculateContextTokens, compact, shouldCompact } from "../compaction.js";
import { APP_NAME, getDebugLogPath, getModelsPath, getOAuthPath } from "../config.js";
import { exportSessionToHtml } from "../export-html.js";
import { getApiKeyForModel, getAvailableModels, invalidateOAuthCache } from "../model-config.js";
import { listOAuthProviders, login, logout, type SupportedOAuthProvider } from "../oauth/index.js";
import {
	getLatestCompactionEntry,
	loadSessionFromEntries,
	type SessionManager,
	SUMMARY_PREFIX,
	SUMMARY_SUFFIX,
} from "../session-manager.js";
import type { SettingsManager } from "../settings-manager.js";
import { getShellConfig } from "../shell-config.js";
import { expandSlashCommand, type FileSlashCommand, loadSlashCommands } from "../slash-commands.js";
import { getEditorTheme, getMarkdownTheme, onThemeChange, setTheme, theme } from "../theme/theme.js";
import { AssistantMessageComponent } from "./assistant-message.js";
import { CompactionComponent } from "./compaction.js";
import { CustomEditor } from "./custom-editor.js";
import { DynamicBorder } from "./dynamic-border.js";
import { FooterComponent } from "./footer.js";
import { ModelSelectorComponent } from "./model-selector.js";
import { OAuthSelectorComponent } from "./oauth-selector.js";
import { QueueModeSelectorComponent } from "./queue-mode-selector.js";
import { ThemeSelectorComponent } from "./theme-selector.js";
import { ThinkingSelectorComponent } from "./thinking-selector.js";
import { ToolExecutionComponent } from "./tool-execution.js";
import { UserMessageComponent } from "./user-message.js";
import { UserMessageSelectorComponent } from "./user-message-selector.js";

/**
 * TUI renderer for the coding agent
 */
export class TuiRenderer {
	private ui: TUI;
	private chatContainer: Container;
	private pendingMessagesContainer: Container;
	private statusContainer: Container;
	private editor: CustomEditor;
	private editorContainer: Container; // Container to swap between editor and selector
	private footer: FooterComponent;
	private agent: Agent;
	private sessionManager: SessionManager;
	private settingsManager: SettingsManager;
	private version: string;
	private isInitialized = false;
	private onInputCallback?: (text: string) => void;
	private loadingAnimation: Loader | null = null;

	private lastSigintTime = 0;
	private changelogMarkdown: string | null = null;
	private newVersion: string | null = null;

	// Message queueing
	private queuedMessages: string[] = [];

	// Streaming message tracking
	private streamingComponent: AssistantMessageComponent | null = null;

	// Tool execution tracking: toolCallId -> component
	private pendingTools = new Map<string, ToolExecutionComponent>();

	// Thinking level selector
	private thinkingSelector: ThinkingSelectorComponent | null = null;

	// Queue mode selector
	private queueModeSelector: QueueModeSelectorComponent | null = null;

	// Theme selector
	private themeSelector: ThemeSelectorComponent | null = null;

	// Model selector
	private modelSelector: ModelSelectorComponent | null = null;

	// User message selector (for branching)
	private userMessageSelector: UserMessageSelectorComponent | null = null;

	// OAuth selector
	private oauthSelector: any | null = null;

	// Track if this is the first user message (to skip spacer)
	private isFirstUserMessage = true;

	// Model scope for quick cycling
	private scopedModels: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }> = [];

	// Tool output expansion state
	private toolOutputExpanded = false;

	// Agent subscription unsubscribe function
	private unsubscribe?: () => void;

	// File-based slash commands
	private fileCommands: FileSlashCommand[] = [];

	// Track if editor is in bash mode (text starts with !)
	private isBashMode = false;

	// Track running bash command process for cancellation
	private bashProcess: ReturnType<typeof spawn> | null = null;

	constructor(
		agent: Agent,
		sessionManager: SessionManager,
		settingsManager: SettingsManager,
		version: string,
		changelogMarkdown: string | null = null,
		newVersion: string | null = null,
		scopedModels: Array<{ model: Model<any>; thinkingLevel: ThinkingLevel }> = [],
		fdPath: string | null = null,
	) {
		this.agent = agent;
		this.sessionManager = sessionManager;
		this.settingsManager = settingsManager;
		this.version = version;
		this.newVersion = newVersion;
		this.changelogMarkdown = changelogMarkdown;
		this.scopedModels = scopedModels;
		this.ui = new TUI(new ProcessTerminal());
		this.chatContainer = new Container();
		this.pendingMessagesContainer = new Container();
		this.statusContainer = new Container();
		this.editor = new CustomEditor(getEditorTheme());
		this.editorContainer = new Container(); // Container to hold editor or selector
		this.editorContainer.addChild(this.editor); // Start with editor
		this.footer = new FooterComponent(agent.state);
		this.footer.setAutoCompactEnabled(this.settingsManager.getCompactionEnabled());

		// Define slash commands
		const thinkingCommand: SlashCommand = {
			name: "thinking",
			description: "Select reasoning level (opens selector UI)",
		};

		const modelCommand: SlashCommand = {
			name: "model",
			description: "Select model (opens selector UI)",
		};

		const exportCommand: SlashCommand = {
			name: "export",
			description: "Export session to HTML file",
		};

		const copyCommand: SlashCommand = {
			name: "copy",
			description: "Copy last agent message to clipboard",
		};

		const sessionCommand: SlashCommand = {
			name: "session",
			description: "Show session info and stats",
		};

		const changelogCommand: SlashCommand = {
			name: "changelog",
			description: "Show changelog entries",
		};

		const branchCommand: SlashCommand = {
			name: "branch",
			description: "Create a new branch from a previous message",
		};

		const loginCommand: SlashCommand = {
			name: "login",
			description: "Login with OAuth provider",
		};

		const logoutCommand: SlashCommand = {
			name: "logout",
			description: "Logout from OAuth provider",
		};

		const queueCommand: SlashCommand = {
			name: "queue",
			description: "Select message queue mode (opens selector UI)",
		};

		const themeCommand: SlashCommand = {
			name: "theme",
			description: "Select color theme (opens selector UI)",
		};

		const clearCommand: SlashCommand = {
			name: "clear",
			description: "Clear context and start a fresh session",
		};

		const compactCommand: SlashCommand = {
			name: "compact",
			description: "Manually compact the session context",
		};

		const autocompactCommand: SlashCommand = {
			name: "autocompact",
			description: "Toggle automatic context compaction",
		};

		// Load file-based slash commands
		this.fileCommands = loadSlashCommands();

		// Convert file commands to SlashCommand format
		const fileSlashCommands: SlashCommand[] = this.fileCommands.map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
		}));

		// Setup autocomplete for file paths and slash commands
		const autocompleteProvider = new CombinedAutocompleteProvider(
			[
				thinkingCommand,
				modelCommand,
				themeCommand,
				exportCommand,
				copyCommand,
				sessionCommand,
				changelogCommand,
				branchCommand,
				loginCommand,
				logoutCommand,
				queueCommand,
				clearCommand,
				compactCommand,
				autocompactCommand,
				...fileSlashCommands,
			],
			process.cwd(),
			fdPath,
		);
		this.editor.setAutocompleteProvider(autocompleteProvider);
	}

	async init(): Promise<void> {
		if (this.isInitialized) return;

		// Add header with logo and instructions
		const logo = theme.bold(theme.fg("accent", APP_NAME)) + theme.fg("dim", ` v${this.version}`);
		const instructions =
			theme.fg("dim", "esc") +
			theme.fg("muted", " to interrupt") +
			"\n" +
			theme.fg("dim", "ctrl+c") +
			theme.fg("muted", " to clear") +
			"\n" +
			theme.fg("dim", "ctrl+c twice") +
			theme.fg("muted", " to exit") +
			"\n" +
			theme.fg("dim", "ctrl+k") +
			theme.fg("muted", " to delete line") +
			"\n" +
			theme.fg("dim", "shift+tab") +
			theme.fg("muted", " to cycle thinking") +
			"\n" +
			theme.fg("dim", "ctrl+p") +
			theme.fg("muted", " to cycle models") +
			"\n" +
			theme.fg("dim", "ctrl+o") +
			theme.fg("muted", " to expand tools") +
			"\n" +
			theme.fg("dim", "/") +
			theme.fg("muted", " for commands") +
			"\n" +
			theme.fg("dim", "!") +
			theme.fg("muted", " to run bash") +
			"\n" +
			theme.fg("dim", "drop files") +
			theme.fg("muted", " to attach");
		const header = new Text(logo + "\n" + instructions, 1, 0);

		// Setup UI layout
		this.ui.addChild(new Spacer(1));
		this.ui.addChild(header);
		this.ui.addChild(new Spacer(1));

		// Add new version notification if available
		if (this.newVersion) {
			this.ui.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
			this.ui.addChild(
				new Text(
					theme.bold(theme.fg("warning", "Update Available")) +
						"\n" +
						theme.fg("muted", `New version ${this.newVersion} is available. Run: `) +
						theme.fg("accent", "npm install -g @mariozechner/pi-coding-agent"),
					1,
					0,
				),
			);
			this.ui.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		}

		// Add changelog if provided
		if (this.changelogMarkdown) {
			this.ui.addChild(new DynamicBorder());
			this.ui.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
			this.ui.addChild(new Spacer(1));
			this.ui.addChild(new Markdown(this.changelogMarkdown.trim(), 1, 0, getMarkdownTheme()));
			this.ui.addChild(new Spacer(1));
			this.ui.addChild(new DynamicBorder());
		}

		this.ui.addChild(this.chatContainer);
		this.ui.addChild(this.pendingMessagesContainer);
		this.ui.addChild(this.statusContainer);
		this.ui.addChild(new Spacer(1));
		this.ui.addChild(this.editorContainer); // Use container that can hold editor or selector
		this.ui.addChild(this.footer);
		this.ui.setFocus(this.editor);

		// Set up custom key handlers on the editor
		this.editor.onEscape = () => {
			// Intercept Escape key when processing
			if (this.loadingAnimation) {
				// Get all queued messages
				const queuedText = this.queuedMessages.join("\n\n");

				// Get current editor text
				const currentText = this.editor.getText();

				// Combine: queued messages + current editor text
				const combinedText = [queuedText, currentText].filter((t) => t.trim()).join("\n\n");

				// Put back in editor
				this.editor.setText(combinedText);

				// Clear queued messages
				this.queuedMessages = [];
				this.updatePendingMessagesDisplay();

				// Clear agent's queue too
				this.agent.clearMessageQueue();

				// Abort
				this.agent.abort();
			} else if (this.bashProcess) {
				// Kill running bash command
				if (this.bashProcess.pid) {
					killProcessTree(this.bashProcess.pid);
				}
				this.bashProcess = null;
			} else if (this.isBashMode) {
				// Cancel bash mode and clear editor
				this.editor.setText("");
				this.isBashMode = false;
				this.updateEditorBorderColor();
			}
		};

		this.editor.onCtrlC = () => {
			this.handleCtrlC();
		};

		this.editor.onShiftTab = () => {
			this.cycleThinkingLevel();
		};

		this.editor.onCtrlP = () => {
			this.cycleModel();
		};

		this.editor.onCtrlO = () => {
			this.toggleToolOutputExpansion();
		};

		// Handle editor text changes for bash mode detection
		this.editor.onChange = (text: string) => {
			const wasBashMode = this.isBashMode;
			this.isBashMode = text.trimStart().startsWith("!");
			if (wasBashMode !== this.isBashMode) {
				this.updateEditorBorderColor();
			}
		};

		// Handle editor submission
		this.editor.onSubmit = async (text: string) => {
			text = text.trim();
			if (!text) return;

			// Check for /thinking command
			if (text === "/thinking") {
				// Show thinking level selector
				this.showThinkingSelector();
				this.editor.setText("");
				return;
			}

			// Check for /model command
			if (text === "/model") {
				// Show model selector
				this.showModelSelector();
				this.editor.setText("");
				return;
			}

			// Check for /export command
			if (text.startsWith("/export")) {
				this.handleExportCommand(text);
				this.editor.setText("");
				return;
			}

			// Check for /copy command
			if (text === "/copy") {
				this.handleCopyCommand();
				this.editor.setText("");
				return;
			}

			// Check for /session command
			if (text === "/session") {
				this.handleSessionCommand();
				this.editor.setText("");
				return;
			}

			// Check for /changelog command
			if (text === "/changelog") {
				this.handleChangelogCommand();
				this.editor.setText("");
				return;
			}

			// Check for /branch command
			if (text === "/branch") {
				this.showUserMessageSelector();
				this.editor.setText("");
				return;
			}

			// Check for /login command
			if (text === "/login") {
				this.showOAuthSelector("login");
				this.editor.setText("");
				return;
			}

			// Check for /logout command
			if (text === "/logout") {
				this.showOAuthSelector("logout");
				this.editor.setText("");
				return;
			}

			// Check for /queue command
			if (text === "/queue") {
				this.showQueueModeSelector();
				this.editor.setText("");
				return;
			}

			// Check for /theme command
			if (text === "/theme") {
				this.showThemeSelector();
				this.editor.setText("");
				return;
			}

			// Check for /clear command
			if (text === "/clear") {
				this.handleClearCommand();
				this.editor.setText("");
				return;
			}

			// Check for /compact command
			if (text === "/compact" || text.startsWith("/compact ")) {
				const customInstructions = text.startsWith("/compact ") ? text.slice(9).trim() : undefined;
				this.handleCompactCommand(customInstructions);
				this.editor.setText("");
				return;
			}

			// Check for /autocompact command
			if (text === "/autocompact") {
				this.handleAutocompactCommand();
				this.editor.setText("");
				return;
			}

			// Check for /debug command
			if (text === "/debug") {
				this.handleDebugCommand();
				this.editor.setText("");
				return;
			}

			// Check for bash command (!<command>)
			if (text.startsWith("!")) {
				const command = text.slice(1).trim();
				if (command) {
					this.handleBashCommand(command);
					this.editor.setText("");
					// Reset bash mode since editor is now empty
					this.isBashMode = false;
					this.updateEditorBorderColor();
					return;
				}
			}

			// Check for file-based slash commands
			text = expandSlashCommand(text, this.fileCommands);

			// Normal message submission - validate model and API key first
			const currentModel = this.agent.state.model;
			if (!currentModel) {
				this.showError(
					"No model selected.\n\n" +
						"Set an API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)\n" +
						`or create ${getModelsPath()}\n\n` +
						"Then use /model to select a model.",
				);
				return;
			}

			// Validate API key (async)
			const apiKey = await getApiKeyForModel(currentModel);
			if (!apiKey) {
				this.showError(
					`No API key found for ${currentModel.provider}.\n\n` +
						`Set the appropriate environment variable or update ${getModelsPath()}`,
				);
				this.editor.setText(text);
				return;
			}

			// Check if agent is currently streaming
			if (this.agent.state.isStreaming) {
				// Queue the message instead of submitting
				this.queuedMessages.push(text);

				// Queue in agent
				await this.agent.queueMessage({
					role: "user",
					content: [{ type: "text", text }],
					timestamp: Date.now(),
				});

				// Update pending messages display
				this.updatePendingMessagesDisplay();

				// Clear editor
				this.editor.setText("");
				this.ui.requestRender();
				return;
			}

			// All good, proceed with submission
			if (this.onInputCallback) {
				this.onInputCallback(text);
			}
		};

		// Start the UI
		this.ui.start();
		this.isInitialized = true;

		// Subscribe to agent events for UI updates and session saving
		this.subscribeToAgent();

		// Set up theme file watcher for live reload
		onThemeChange(() => {
			this.ui.invalidate();
			this.updateEditorBorderColor();
			this.ui.requestRender();
		});

		// Set up git branch watcher
		this.footer.watchBranch(() => {
			this.ui.requestRender();
		});
	}

	private subscribeToAgent(): void {
		this.unsubscribe = this.agent.subscribe(async (event) => {
			// Handle UI updates
			await this.handleEvent(event, this.agent.state);

			// Save messages to session
			if (event.type === "message_end") {
				this.sessionManager.saveMessage(event.message);

				// Check if we should initialize session now (after first user+assistant exchange)
				if (this.sessionManager.shouldInitializeSession(this.agent.state.messages)) {
					this.sessionManager.startSession(this.agent.state);
				}

				// Check for auto-compaction after assistant messages
				if (event.message.role === "assistant") {
					await this.checkAutoCompaction();
				}
			}
		});
	}

	private async checkAutoCompaction(): Promise<void> {
		const settings = this.settingsManager.getCompactionSettings();
		if (!settings.enabled) return;

		// Get last non-aborted assistant message from agent state
		const messages = this.agent.state.messages;
		let lastAssistant: AssistantMessage | null = null;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === "assistant") {
				const assistantMsg = msg as AssistantMessage;
				if (assistantMsg.stopReason !== "aborted") {
					lastAssistant = assistantMsg;
					break;
				}
			}
		}
		if (!lastAssistant) return;

		const contextTokens = calculateContextTokens(lastAssistant.usage);
		const contextWindow = this.agent.state.model.contextWindow;

		if (!shouldCompact(contextTokens, contextWindow, settings)) return;

		// Trigger auto-compaction
		await this.executeCompaction(undefined, true);
	}

	private async handleEvent(event: AgentEvent, state: AgentState): Promise<void> {
		if (!this.isInitialized) {
			await this.init();
		}

		// Update footer with current stats
		this.footer.updateState(state);

		switch (event.type) {
			case "agent_start":
				// Show loading animation
				// Note: Don't disable submit - we handle queuing in onSubmit callback
				// Stop old loader before clearing
				if (this.loadingAnimation) {
					this.loadingAnimation.stop();
				}
				this.statusContainer.clear();
				this.loadingAnimation = new Loader(
					this.ui,
					(spinner) => theme.fg("accent", spinner),
					(text) => theme.fg("muted", text),
					"Working... (esc to interrupt)",
				);
				this.statusContainer.addChild(this.loadingAnimation);
				this.ui.requestRender();
				break;

			case "message_start":
				if (event.message.role === "user") {
					// Check if this is a queued message
					const userMsg = event.message;
					const textBlocks =
						typeof userMsg.content === "string"
							? [{ type: "text", text: userMsg.content }]
							: userMsg.content.filter((c) => c.type === "text");
					const messageText = textBlocks.map((c) => c.text).join("");

					const queuedIndex = this.queuedMessages.indexOf(messageText);
					if (queuedIndex !== -1) {
						// Remove from queued messages
						this.queuedMessages.splice(queuedIndex, 1);
						this.updatePendingMessagesDisplay();
					}

					// Show user message immediately and clear editor
					this.addMessageToChat(event.message);
					this.editor.setText("");
					this.ui.requestRender();
				} else if (event.message.role === "assistant") {
					// Create assistant component for streaming
					this.streamingComponent = new AssistantMessageComponent();
					this.chatContainer.addChild(this.streamingComponent);
					this.streamingComponent.updateContent(event.message as AssistantMessage);
					this.ui.requestRender();
				}
				break;

			case "message_update":
				// Update streaming component
				if (this.streamingComponent && event.message.role === "assistant") {
					const assistantMsg = event.message as AssistantMessage;
					this.streamingComponent.updateContent(assistantMsg);

					// Create tool execution components as soon as we see tool calls
					for (const content of assistantMsg.content) {
						if (content.type === "toolCall") {
							// Only create if we haven't created it yet
							if (!this.pendingTools.has(content.id)) {
								this.chatContainer.addChild(new Text("", 0, 0));
								const component = new ToolExecutionComponent(content.name, content.arguments);
								this.chatContainer.addChild(component);
								this.pendingTools.set(content.id, component);
							} else {
								// Update existing component with latest arguments as they stream
								const component = this.pendingTools.get(content.id);
								if (component) {
									component.updateArgs(content.arguments);
								}
							}
						}
					}

					this.ui.requestRender();
				}
				break;

			case "message_end":
				// Skip user messages (already shown in message_start)
				if (event.message.role === "user") {
					break;
				}
				if (this.streamingComponent && event.message.role === "assistant") {
					const assistantMsg = event.message as AssistantMessage;

					// Update streaming component with final message (includes stopReason)
					this.streamingComponent.updateContent(assistantMsg);

					// If message was aborted or errored, mark all pending tool components as failed
					if (assistantMsg.stopReason === "aborted" || assistantMsg.stopReason === "error") {
						const errorMessage =
							assistantMsg.stopReason === "aborted" ? "Operation aborted" : assistantMsg.errorMessage || "Error";
						for (const [toolCallId, component] of this.pendingTools.entries()) {
							component.updateResult({
								content: [{ type: "text", text: errorMessage }],
								isError: true,
							});
						}
						this.pendingTools.clear();
					}

					// Keep the streaming component - it's now the final assistant message
					this.streamingComponent = null;

					// Invalidate footer cache to refresh git branch (in case agent executed git commands)
					this.footer.invalidate();
				}
				this.ui.requestRender();
				break;

			case "tool_execution_start": {
				// Component should already exist from message_update, but create if missing
				if (!this.pendingTools.has(event.toolCallId)) {
					const component = new ToolExecutionComponent(event.toolName, event.args);
					this.chatContainer.addChild(component);
					this.pendingTools.set(event.toolCallId, component);
					this.ui.requestRender();
				}
				break;
			}

			case "tool_execution_end": {
				// Update the existing tool component with the result
				const component = this.pendingTools.get(event.toolCallId);
				if (component) {
					// Convert result to the format expected by updateResult
					const resultData =
						typeof event.result === "string"
							? {
									content: [{ type: "text" as const, text: event.result }],
									details: undefined,
									isError: event.isError,
								}
							: {
									content: event.result.content,
									details: event.result.details,
									isError: event.isError,
								};
					component.updateResult(resultData);
					this.pendingTools.delete(event.toolCallId);
					this.ui.requestRender();
				}
				break;
			}

			case "agent_end":
				// Stop loading animation
				if (this.loadingAnimation) {
					this.loadingAnimation.stop();
					this.loadingAnimation = null;
					this.statusContainer.clear();
				}
				if (this.streamingComponent) {
					this.chatContainer.removeChild(this.streamingComponent);
					this.streamingComponent = null;
				}
				this.pendingTools.clear();
				// Note: Don't need to re-enable submit - we never disable it
				this.ui.requestRender();
				break;
		}
	}

	private addMessageToChat(message: Message): void {
		if (message.role === "user") {
			const userMsg = message;
			// Extract text content from content blocks
			const textBlocks =
				typeof userMsg.content === "string"
					? [{ type: "text", text: userMsg.content }]
					: userMsg.content.filter((c) => c.type === "text");
			const textContent = textBlocks.map((c) => c.text).join("");
			if (textContent) {
				const userComponent = new UserMessageComponent(textContent, this.isFirstUserMessage);
				this.chatContainer.addChild(userComponent);
				this.isFirstUserMessage = false;
			}
		} else if (message.role === "assistant") {
			const assistantMsg = message;

			// Add assistant message component
			const assistantComponent = new AssistantMessageComponent(assistantMsg);
			this.chatContainer.addChild(assistantComponent);
		}
		// Note: tool calls and results are now handled via tool_execution_start/end events
	}

	renderInitialMessages(state: AgentState): void {
		// Render all existing messages (for --continue mode)
		// Reset first user message flag for initial render
		this.isFirstUserMessage = true;

		// Update footer with loaded state
		this.footer.updateState(state);

		// Update editor border color based on current thinking level
		this.updateEditorBorderColor();

		// Get compaction info if any
		const compactionEntry = getLatestCompactionEntry(this.sessionManager.loadEntries());

		// Render messages
		for (let i = 0; i < state.messages.length; i++) {
			const message = state.messages[i];

			if (message.role === "user") {
				const userMsg = message;
				const textBlocks =
					typeof userMsg.content === "string"
						? [{ type: "text", text: userMsg.content }]
						: userMsg.content.filter((c) => c.type === "text");
				const textContent = textBlocks.map((c) => c.text).join("");
				if (textContent) {
					// Check if this is a compaction summary message
					if (textContent.startsWith(SUMMARY_PREFIX) && compactionEntry) {
						const summary = textContent.slice(SUMMARY_PREFIX.length, -SUMMARY_SUFFIX.length);
						const component = new CompactionComponent(compactionEntry.tokensBefore, summary);
						component.setExpanded(this.toolOutputExpanded);
						this.chatContainer.addChild(component);
					} else {
						const userComponent = new UserMessageComponent(textContent, this.isFirstUserMessage);
						this.chatContainer.addChild(userComponent);
						this.isFirstUserMessage = false;
					}
				}
			} else if (message.role === "assistant") {
				const assistantMsg = message as AssistantMessage;
				const assistantComponent = new AssistantMessageComponent(assistantMsg);
				this.chatContainer.addChild(assistantComponent);

				// Create tool execution components for any tool calls
				for (const content of assistantMsg.content) {
					if (content.type === "toolCall") {
						const component = new ToolExecutionComponent(content.name, content.arguments);
						this.chatContainer.addChild(component);

						// If message was aborted/errored, immediately mark tool as failed
						if (assistantMsg.stopReason === "aborted" || assistantMsg.stopReason === "error") {
							const errorMessage =
								assistantMsg.stopReason === "aborted"
									? "Operation aborted"
									: assistantMsg.errorMessage || "Error";
							component.updateResult({
								content: [{ type: "text", text: errorMessage }],
								isError: true,
							});
						} else {
							// Store in map so we can update with results later
							this.pendingTools.set(content.id, component);
						}
					}
				}
			} else if (message.role === "toolResult") {
				// Update existing tool execution component with results				;
				const component = this.pendingTools.get(message.toolCallId);
				if (component) {
					component.updateResult({
						content: message.content,
						details: message.details,
						isError: message.isError,
					});
					// Remove from pending map since it's complete
					this.pendingTools.delete(message.toolCallId);
				}
			}
		}
		// Clear pending tools after rendering initial messages
		this.pendingTools.clear();
		this.ui.requestRender();
	}

	async getUserInput(): Promise<string> {
		return new Promise((resolve) => {
			this.onInputCallback = (text: string) => {
				this.onInputCallback = undefined;
				resolve(text);
			};
		});
	}

	private rebuildChatFromMessages(): void {
		// Reset state and re-render messages from agent state
		this.isFirstUserMessage = true;
		this.pendingTools.clear();

		// Get compaction info if any
		const compactionEntry = getLatestCompactionEntry(this.sessionManager.loadEntries());

		for (const message of this.agent.state.messages) {
			if (message.role === "user") {
				const userMsg = message;
				const textBlocks =
					typeof userMsg.content === "string"
						? [{ type: "text", text: userMsg.content }]
						: userMsg.content.filter((c) => c.type === "text");
				const textContent = textBlocks.map((c) => c.text).join("");
				if (textContent) {
					// Check if this is a compaction summary message
					if (textContent.startsWith(SUMMARY_PREFIX) && compactionEntry) {
						const summary = textContent.slice(SUMMARY_PREFIX.length, -SUMMARY_SUFFIX.length);
						const component = new CompactionComponent(compactionEntry.tokensBefore, summary);
						component.setExpanded(this.toolOutputExpanded);
						this.chatContainer.addChild(component);
					} else {
						const userComponent = new UserMessageComponent(textContent, this.isFirstUserMessage);
						this.chatContainer.addChild(userComponent);
						this.isFirstUserMessage = false;
					}
				}
			} else if (message.role === "assistant") {
				const assistantMsg = message;
				const assistantComponent = new AssistantMessageComponent(assistantMsg);
				this.chatContainer.addChild(assistantComponent);

				for (const content of assistantMsg.content) {
					if (content.type === "toolCall") {
						const component = new ToolExecutionComponent(content.name, content.arguments);
						this.chatContainer.addChild(component);
						this.pendingTools.set(content.id, component);
					}
				}
			} else if (message.role === "toolResult") {
				const component = this.pendingTools.get(message.toolCallId);
				if (component) {
					component.updateResult({
						content: message.content,
						details: message.details,
						isError: message.isError,
					});
					this.pendingTools.delete(message.toolCallId);
				}
			}
		}

		this.pendingTools.clear();
		this.ui.requestRender();
	}

	private handleCtrlC(): void {
		// Handle Ctrl+C double-press logic
		const now = Date.now();
		const timeSinceLastCtrlC = now - this.lastSigintTime;

		if (timeSinceLastCtrlC < 500) {
			// Second Ctrl+C within 500ms - exit
			this.stop();
			process.exit(0);
		} else {
			// First Ctrl+C - clear the editor
			this.clearEditor();
			this.lastSigintTime = now;
		}
	}

	private updateEditorBorderColor(): void {
		if (this.isBashMode) {
			this.editor.borderColor = theme.getBashModeBorderColor();
		} else {
			const level = this.agent.state.thinkingLevel || "off";
			this.editor.borderColor = theme.getThinkingBorderColor(level);
		}
		this.ui.requestRender();
	}

	private cycleThinkingLevel(): void {
		// Only cycle if model supports thinking
		if (!this.agent.state.model?.reasoning) {
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(new Text(theme.fg("dim", "Current model does not support thinking"), 1, 0));
			this.ui.requestRender();
			return;
		}

		const levels: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];
		const currentLevel = this.agent.state.thinkingLevel || "off";
		const currentIndex = levels.indexOf(currentLevel);
		const nextIndex = (currentIndex + 1) % levels.length;
		const nextLevel = levels[nextIndex];

		// Apply the new thinking level
		this.agent.setThinkingLevel(nextLevel);

		// Save thinking level change to session and settings
		this.sessionManager.saveThinkingLevelChange(nextLevel);
		this.settingsManager.setDefaultThinkingLevel(nextLevel);

		// Update border color
		this.updateEditorBorderColor();

		// Show brief notification
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("dim", `Thinking level: ${nextLevel}`), 1, 0));
		this.ui.requestRender();
	}

	private async cycleModel(): Promise<void> {
		// Use scoped models if available, otherwise all available models
		if (this.scopedModels.length > 0) {
			// Use scoped models with thinking levels
			if (this.scopedModels.length === 1) {
				this.chatContainer.addChild(new Spacer(1));
				this.chatContainer.addChild(new Text(theme.fg("dim", "Only one model in scope"), 1, 0));
				this.ui.requestRender();
				return;
			}

			const currentModel = this.agent.state.model;
			let currentIndex = this.scopedModels.findIndex(
				(sm) => sm.model.id === currentModel?.id && sm.model.provider === currentModel?.provider,
			);

			// If current model not in scope, start from first
			if (currentIndex === -1) {
				currentIndex = 0;
			}

			const nextIndex = (currentIndex + 1) % this.scopedModels.length;
			const nextEntry = this.scopedModels[nextIndex];
			const nextModel = nextEntry.model;
			const nextThinking = nextEntry.thinkingLevel;

			// Validate API key
			const apiKey = await getApiKeyForModel(nextModel);
			if (!apiKey) {
				this.showError(`No API key for ${nextModel.provider}/${nextModel.id}`);
				return;
			}

			// Switch model
			this.agent.setModel(nextModel);

			// Save model change to session and settings
			this.sessionManager.saveModelChange(nextModel.provider, nextModel.id);
			this.settingsManager.setDefaultModelAndProvider(nextModel.provider, nextModel.id);

			// Apply thinking level (silently use "off" if model doesn't support thinking)
			const effectiveThinking = nextModel.reasoning ? nextThinking : "off";
			this.agent.setThinkingLevel(effectiveThinking);
			this.sessionManager.saveThinkingLevelChange(effectiveThinking);
			this.settingsManager.setDefaultThinkingLevel(effectiveThinking);
			this.updateEditorBorderColor();

			// Show notification
			this.chatContainer.addChild(new Spacer(1));
			const thinkingStr = nextModel.reasoning && nextThinking !== "off" ? ` (thinking: ${nextThinking})` : "";
			this.chatContainer.addChild(
				new Text(theme.fg("dim", `Switched to ${nextModel.name || nextModel.id}${thinkingStr}`), 1, 0),
			);
			this.ui.requestRender();
		} else {
			// Fallback to all available models (no thinking level changes)
			const { models: availableModels, error } = await getAvailableModels();
			if (error) {
				this.showError(`Failed to load models: ${error}`);
				return;
			}

			if (availableModels.length === 0) {
				this.showError("No models available to cycle");
				return;
			}

			if (availableModels.length === 1) {
				this.chatContainer.addChild(new Spacer(1));
				this.chatContainer.addChild(new Text(theme.fg("dim", "Only one model available"), 1, 0));
				this.ui.requestRender();
				return;
			}

			const currentModel = this.agent.state.model;
			let currentIndex = availableModels.findIndex(
				(m) => m.id === currentModel?.id && m.provider === currentModel?.provider,
			);

			// If current model not in scope, start from first
			if (currentIndex === -1) {
				currentIndex = 0;
			}

			const nextIndex = (currentIndex + 1) % availableModels.length;
			const nextModel = availableModels[nextIndex];

			// Validate API key
			const apiKey = await getApiKeyForModel(nextModel);
			if (!apiKey) {
				this.showError(`No API key for ${nextModel.provider}/${nextModel.id}`);
				return;
			}

			// Switch model
			this.agent.setModel(nextModel);

			// Save model change to session and settings
			this.sessionManager.saveModelChange(nextModel.provider, nextModel.id);
			this.settingsManager.setDefaultModelAndProvider(nextModel.provider, nextModel.id);

			// Show notification
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(new Text(theme.fg("dim", `Switched to ${nextModel.name || nextModel.id}`), 1, 0));
			this.ui.requestRender();
		}
	}

	private toggleToolOutputExpansion(): void {
		this.toolOutputExpanded = !this.toolOutputExpanded;

		// Update all tool execution and compaction components
		for (const child of this.chatContainer.children) {
			if (child instanceof ToolExecutionComponent) {
				child.setExpanded(this.toolOutputExpanded);
			} else if (child instanceof CompactionComponent) {
				child.setExpanded(this.toolOutputExpanded);
			}
		}

		this.ui.requestRender();
	}

	clearEditor(): void {
		this.editor.setText("");
		this.ui.requestRender();
	}

	showError(errorMessage: string): void {
		// Show error message in the chat
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("error", `Error: ${errorMessage}`), 1, 0));
		this.ui.requestRender();
	}

	showWarning(warningMessage: string): void {
		// Show warning message in the chat
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0));
		this.ui.requestRender();
	}

	private showSuccess(message: string, detail?: string): void {
		this.chatContainer.addChild(new Spacer(1));
		const text = detail
			? `${theme.fg("success", message)}\n${theme.fg("muted", detail)}`
			: theme.fg("success", message);
		this.chatContainer.addChild(new Text(text, 1, 1));
		this.ui.requestRender();
	}

	private showThinkingSelector(): void {
		// Create thinking selector with current level
		this.thinkingSelector = new ThinkingSelectorComponent(
			this.agent.state.thinkingLevel,
			(level) => {
				// Apply the selected thinking level
				this.agent.setThinkingLevel(level);

				// Save thinking level change to session and settings
				this.sessionManager.saveThinkingLevelChange(level);
				this.settingsManager.setDefaultThinkingLevel(level);

				// Update border color
				this.updateEditorBorderColor();

				// Show confirmation message with proper spacing
				this.chatContainer.addChild(new Spacer(1));
				const confirmText = new Text(theme.fg("dim", `Thinking level: ${level}`), 1, 0);
				this.chatContainer.addChild(confirmText);

				// Hide selector and show editor again
				this.hideThinkingSelector();
				this.ui.requestRender();
			},
			() => {
				// Just hide the selector
				this.hideThinkingSelector();
				this.ui.requestRender();
			},
		);

		// Replace editor with selector
		this.editorContainer.clear();
		this.editorContainer.addChild(this.thinkingSelector);
		this.ui.setFocus(this.thinkingSelector.getSelectList());
		this.ui.requestRender();
	}

	private hideThinkingSelector(): void {
		// Replace selector with editor in the container
		this.editorContainer.clear();
		this.editorContainer.addChild(this.editor);
		this.thinkingSelector = null;
		this.ui.setFocus(this.editor);
	}

	private showQueueModeSelector(): void {
		// Create queue mode selector with current mode
		this.queueModeSelector = new QueueModeSelectorComponent(
			this.agent.getQueueMode(),
			(mode) => {
				// Apply the selected queue mode
				this.agent.setQueueMode(mode);

				// Save queue mode to settings
				this.settingsManager.setQueueMode(mode);

				// Show confirmation message with proper spacing
				this.chatContainer.addChild(new Spacer(1));
				const confirmText = new Text(theme.fg("dim", `Queue mode: ${mode}`), 1, 0);
				this.chatContainer.addChild(confirmText);

				// Hide selector and show editor again
				this.hideQueueModeSelector();
				this.ui.requestRender();
			},
			() => {
				// Just hide the selector
				this.hideQueueModeSelector();
				this.ui.requestRender();
			},
		);

		// Replace editor with selector
		this.editorContainer.clear();
		this.editorContainer.addChild(this.queueModeSelector);
		this.ui.setFocus(this.queueModeSelector.getSelectList());
		this.ui.requestRender();
	}

	private hideQueueModeSelector(): void {
		// Replace selector with editor in the container
		this.editorContainer.clear();
		this.editorContainer.addChild(this.editor);
		this.queueModeSelector = null;
		this.ui.setFocus(this.editor);
	}

	private showThemeSelector(): void {
		// Get current theme from settings
		const currentTheme = this.settingsManager.getTheme() || "dark";

		// Create theme selector
		this.themeSelector = new ThemeSelectorComponent(
			currentTheme,
			(themeName) => {
				// Apply the selected theme
				const result = setTheme(themeName);

				// Save theme to settings
				this.settingsManager.setTheme(themeName);

				// Invalidate all components to clear cached rendering
				this.ui.invalidate();

				// Show confirmation or error message
				this.chatContainer.addChild(new Spacer(1));
				if (result.success) {
					const confirmText = new Text(theme.fg("dim", `Theme: ${themeName}`), 1, 0);
					this.chatContainer.addChild(confirmText);
				} else {
					const errorText = new Text(
						theme.fg("error", `Failed to load theme "${themeName}": ${result.error}\nFell back to dark theme.`),
						1,
						0,
					);
					this.chatContainer.addChild(errorText);
				}

				// Hide selector and show editor again
				this.hideThemeSelector();
				this.ui.requestRender();
			},
			() => {
				// Just hide the selector
				this.hideThemeSelector();
				this.ui.requestRender();
			},
			(themeName) => {
				// Preview theme on selection change
				const result = setTheme(themeName);
				if (result.success) {
					this.ui.invalidate();
					this.ui.requestRender();
				}
				// If failed, theme already fell back to dark, just don't re-render
			},
		);

		// Replace editor with selector
		this.editorContainer.clear();
		this.editorContainer.addChild(this.themeSelector);
		this.ui.setFocus(this.themeSelector.getSelectList());
		this.ui.requestRender();
	}

	private hideThemeSelector(): void {
		// Replace selector with editor in the container
		this.editorContainer.clear();
		this.editorContainer.addChild(this.editor);
		this.themeSelector = null;
		this.ui.setFocus(this.editor);
	}

	private showModelSelector(): void {
		// Create model selector with current model
		this.modelSelector = new ModelSelectorComponent(
			this.ui,
			this.agent.state.model,
			this.settingsManager,
			(model) => {
				// Apply the selected model
				this.agent.setModel(model);

				// Save model change to session
				this.sessionManager.saveModelChange(model.provider, model.id);

				// Show confirmation message with proper spacing
				this.chatContainer.addChild(new Spacer(1));
				const confirmText = new Text(theme.fg("dim", `Model: ${model.id}`), 1, 0);
				this.chatContainer.addChild(confirmText);

				// Hide selector and show editor again
				this.hideModelSelector();
				this.ui.requestRender();
			},
			() => {
				// Just hide the selector
				this.hideModelSelector();
				this.ui.requestRender();
			},
		);

		// Replace editor with selector
		this.editorContainer.clear();
		this.editorContainer.addChild(this.modelSelector);
		this.ui.setFocus(this.modelSelector);
		this.ui.requestRender();
	}

	private hideModelSelector(): void {
		// Replace selector with editor in the container
		this.editorContainer.clear();
		this.editorContainer.addChild(this.editor);
		this.modelSelector = null;
		this.ui.setFocus(this.editor);
	}

	private showUserMessageSelector(): void {
		// Read from session file directly to see ALL historical user messages
		// (including those before compaction events)
		const entries = this.sessionManager.loadEntries();
		const userMessages: Array<{ index: number; text: string }> = [];

		const getUserMessageText = (content: string | Array<{ type: string; text?: string }>): string => {
			if (typeof content === "string") return content;
			if (Array.isArray(content)) {
				return content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("");
			}
			return "";
		};

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];
			if (entry.type !== "message") continue;
			if (entry.message.role !== "user") continue;

			const textContent = getUserMessageText(entry.message.content);
			if (textContent) {
				userMessages.push({ index: i, text: textContent });
			}
		}

		// Don't show selector if there are no messages or only one message
		if (userMessages.length <= 1) {
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(new Text(theme.fg("dim", "No messages to branch from"), 1, 0));
			this.ui.requestRender();
			return;
		}

		// Create user message selector
		this.userMessageSelector = new UserMessageSelectorComponent(
			userMessages,
			(entryIndex) => {
				// Get the selected user message text to put in the editor
				const selectedEntry = entries[entryIndex];
				if (selectedEntry.type !== "message") return;
				if (selectedEntry.message.role !== "user") return;

				const selectedText = getUserMessageText(selectedEntry.message.content);

				// Create a branched session by copying entries up to (but not including) the selected entry
				const newSessionFile = this.sessionManager.createBranchedSessionFromEntries(entries, entryIndex);

				// Set the new session file as active
				this.sessionManager.setSessionFile(newSessionFile);

				// Reload the session
				const loaded = loadSessionFromEntries(this.sessionManager.loadEntries());
				this.agent.replaceMessages(loaded.messages);

				// Clear and re-render the chat
				this.chatContainer.clear();
				this.isFirstUserMessage = true;
				this.renderInitialMessages(this.agent.state);

				// Show confirmation message
				this.chatContainer.addChild(new Spacer(1));
				this.chatContainer.addChild(new Text(theme.fg("dim", "Branched to new session"), 1, 0));

				// Put the selected message in the editor
				this.editor.setText(selectedText);

				// Hide selector and show editor again
				this.hideUserMessageSelector();
				this.ui.requestRender();
			},
			() => {
				// Just hide the selector
				this.hideUserMessageSelector();
				this.ui.requestRender();
			},
		);

		// Replace editor with selector
		this.editorContainer.clear();
		this.editorContainer.addChild(this.userMessageSelector);
		this.ui.setFocus(this.userMessageSelector.getMessageList());
		this.ui.requestRender();
	}

	private hideUserMessageSelector(): void {
		// Replace selector with editor in the container
		this.editorContainer.clear();
		this.editorContainer.addChild(this.editor);
		this.userMessageSelector = null;
		this.ui.setFocus(this.editor);
	}

	private async showOAuthSelector(mode: "login" | "logout"): Promise<void> {
		// For logout mode, filter to only show logged-in providers
		let providersToShow: string[] = [];
		if (mode === "logout") {
			const loggedInProviders = listOAuthProviders();
			if (loggedInProviders.length === 0) {
				this.chatContainer.addChild(new Spacer(1));
				this.chatContainer.addChild(
					new Text(theme.fg("dim", "No OAuth providers logged in. Use /login first."), 1, 0),
				);
				this.ui.requestRender();
				return;
			}
			providersToShow = loggedInProviders;
		}

		// Create OAuth selector
		this.oauthSelector = new OAuthSelectorComponent(
			mode,
			async (providerId: string) => {
				// Hide selector first
				this.hideOAuthSelector();

				if (mode === "login") {
					// Handle login
					this.chatContainer.addChild(new Spacer(1));
					this.chatContainer.addChild(new Text(theme.fg("dim", `Logging in to ${providerId}...`), 1, 0));
					this.ui.requestRender();

					try {
						await login(
							providerId as SupportedOAuthProvider,
							(url: string) => {
								// Show auth URL to user
								this.chatContainer.addChild(new Spacer(1));
								this.chatContainer.addChild(new Text(theme.fg("accent", "Opening browser to:"), 1, 0));
								this.chatContainer.addChild(new Text(theme.fg("accent", url), 1, 0));
								this.chatContainer.addChild(new Spacer(1));
								this.chatContainer.addChild(
									new Text(theme.fg("warning", "Paste the authorization code below:"), 1, 0),
								);
								this.ui.requestRender();

								// Open URL in browser
								const openCmd =
									process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
								exec(`${openCmd} "${url}"`);
							},
							async () => {
								// Prompt for code with a simple Input
								return new Promise<string>((resolve) => {
									const codeInput = new Input();
									codeInput.onSubmit = () => {
										const code = codeInput.getValue();
										// Restore editor
										this.editorContainer.clear();
										this.editorContainer.addChild(this.editor);
										this.ui.setFocus(this.editor);
										resolve(code);
									};

									this.editorContainer.clear();
									this.editorContainer.addChild(codeInput);
									this.ui.setFocus(codeInput);
									this.ui.requestRender();
								});
							},
						);

						// Success - invalidate OAuth cache so footer updates
						invalidateOAuthCache();
						this.chatContainer.addChild(new Spacer(1));
						this.chatContainer.addChild(
							new Text(theme.fg("success", `✓ Successfully logged in to ${providerId}`), 1, 0),
						);
						this.chatContainer.addChild(new Text(theme.fg("dim", `Tokens saved to ${getOAuthPath()}`), 1, 0));
						this.ui.requestRender();
					} catch (error: any) {
						this.showError(`Login failed: ${error.message}`);
					}
				} else {
					// Handle logout
					try {
						await logout(providerId as SupportedOAuthProvider);

						// Invalidate OAuth cache so footer updates
						invalidateOAuthCache();
						this.chatContainer.addChild(new Spacer(1));
						this.chatContainer.addChild(
							new Text(theme.fg("success", `✓ Successfully logged out of ${providerId}`), 1, 0),
						);
						this.chatContainer.addChild(
							new Text(theme.fg("dim", `Credentials removed from ${getOAuthPath()}`), 1, 0),
						);
						this.ui.requestRender();
					} catch (error: any) {
						this.showError(`Logout failed: ${error.message}`);
					}
				}
			},
			() => {
				// Cancel - just hide the selector
				this.hideOAuthSelector();
				this.ui.requestRender();
			},
		);

		// Replace editor with selector
		this.editorContainer.clear();
		this.editorContainer.addChild(this.oauthSelector);
		this.ui.setFocus(this.oauthSelector);
		this.ui.requestRender();
	}

	private hideOAuthSelector(): void {
		// Replace selector with editor in the container
		this.editorContainer.clear();
		this.editorContainer.addChild(this.editor);
		this.oauthSelector = null;
		this.ui.setFocus(this.editor);
	}

	private handleExportCommand(text: string): void {
		// Parse optional filename from command: /export [filename]
		const parts = text.split(/\s+/);
		const outputPath = parts.length > 1 ? parts[1] : undefined;

		try {
			// Export session to HTML
			const filePath = exportSessionToHtml(this.sessionManager, this.agent.state, outputPath);

			// Show success message in chat - matching thinking level style
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(new Text(theme.fg("dim", `Session exported to: ${filePath}`), 1, 0));
			this.ui.requestRender();
		} catch (error: any) {
			// Show error message in chat
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(
				new Text(theme.fg("error", `Failed to export session: ${error.message || "Unknown error"}`), 1, 0),
			);
			this.ui.requestRender();
		}
	}

	private handleCopyCommand(): void {
		// Find the last assistant message
		const lastAssistantMessage = this.agent.state.messages
			.slice()
			.reverse()
			.find((m) => m.role === "assistant");

		if (!lastAssistantMessage) {
			this.showError("No agent messages to copy yet.");
			return;
		}

		// Extract raw text content from all text blocks
		let textContent = "";

		for (const content of lastAssistantMessage.content) {
			if (content.type === "text") {
				textContent += content.text;
			}
		}

		if (!textContent.trim()) {
			this.showError("Last agent message contains no text content.");
			return;
		}

		// Copy to clipboard using cross-platform compatible method
		try {
			copyToClipboard(textContent);
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
			return;
		}

		// Show confirmation message
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("dim", "Copied last agent message to clipboard"), 1, 0));
		this.ui.requestRender();
	}

	private handleSessionCommand(): void {
		// Get session info
		const sessionFile = this.sessionManager.getSessionFile();
		const state = this.agent.state;

		// Count messages
		const userMessages = state.messages.filter((m) => m.role === "user").length;
		const assistantMessages = state.messages.filter((m) => m.role === "assistant").length;
		const toolResults = state.messages.filter((m) => m.role === "toolResult").length;
		const totalMessages = state.messages.length;

		// Count tool calls from assistant messages
		let toolCalls = 0;
		for (const message of state.messages) {
			if (message.role === "assistant") {
				const assistantMsg = message as AssistantMessage;
				toolCalls += assistantMsg.content.filter((c) => c.type === "toolCall").length;
			}
		}

		// Calculate cumulative usage from all assistant messages (same as footer)
		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;

		for (const message of state.messages) {
			if (message.role === "assistant") {
				const assistantMsg = message as AssistantMessage;
				totalInput += assistantMsg.usage.input;
				totalOutput += assistantMsg.usage.output;
				totalCacheRead += assistantMsg.usage.cacheRead;
				totalCacheWrite += assistantMsg.usage.cacheWrite;
				totalCost += assistantMsg.usage.cost.total;
			}
		}

		const totalTokens = totalInput + totalOutput + totalCacheRead + totalCacheWrite;

		// Build info text
		let info = `${theme.bold("Session Info")}\n\n`;
		info += `${theme.fg("dim", "File:")} ${sessionFile}\n`;
		info += `${theme.fg("dim", "ID:")} ${this.sessionManager.getSessionId()}\n\n`;
		info += `${theme.bold("Messages")}\n`;
		info += `${theme.fg("dim", "User:")} ${userMessages}\n`;
		info += `${theme.fg("dim", "Assistant:")} ${assistantMessages}\n`;
		info += `${theme.fg("dim", "Tool Calls:")} ${toolCalls}\n`;
		info += `${theme.fg("dim", "Tool Results:")} ${toolResults}\n`;
		info += `${theme.fg("dim", "Total:")} ${totalMessages}\n\n`;
		info += `${theme.bold("Tokens")}\n`;
		info += `${theme.fg("dim", "Input:")} ${totalInput.toLocaleString()}\n`;
		info += `${theme.fg("dim", "Output:")} ${totalOutput.toLocaleString()}\n`;
		if (totalCacheRead > 0) {
			info += `${theme.fg("dim", "Cache Read:")} ${totalCacheRead.toLocaleString()}\n`;
		}
		if (totalCacheWrite > 0) {
			info += `${theme.fg("dim", "Cache Write:")} ${totalCacheWrite.toLocaleString()}\n`;
		}
		info += `${theme.fg("dim", "Total:")} ${totalTokens.toLocaleString()}\n`;

		if (totalCost > 0) {
			info += `\n${theme.bold("Cost")}\n`;
			info += `${theme.fg("dim", "Total:")} ${totalCost.toFixed(4)}`;
		}

		// Show info in chat
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(info, 1, 0));
		this.ui.requestRender();
	}

	private handleChangelogCommand(): void {
		const changelogPath = getChangelogPath();
		const allEntries = parseChangelog(changelogPath);

		// Show all entries in reverse order (oldest first, newest last)
		const changelogMarkdown =
			allEntries.length > 0
				? allEntries
						.reverse()
						.map((e) => e.content)
						.join("\n\n")
				: "No changelog entries found.";

		// Display in chat
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder());
		this.ui.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
		this.ui.addChild(new Spacer(1));
		this.chatContainer.addChild(new Markdown(changelogMarkdown, 1, 1, getMarkdownTheme()));
		this.chatContainer.addChild(new DynamicBorder());
		this.ui.requestRender();
	}

	private async handleClearCommand(): Promise<void> {
		// Unsubscribe first to prevent processing abort events
		this.unsubscribe?.();

		// Abort and wait for completion
		this.agent.abort();
		await this.agent.waitForIdle();

		// Stop loading animation
		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = null;
		}
		this.statusContainer.clear();

		// Reset agent and session
		this.agent.reset();
		this.sessionManager.reset();

		// Resubscribe to agent
		this.subscribeToAgent();

		// Clear UI state
		this.chatContainer.clear();
		this.pendingMessagesContainer.clear();
		this.queuedMessages = [];
		this.streamingComponent = null;
		this.pendingTools.clear();
		this.isFirstUserMessage = true;

		// Show confirmation
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(
			new Text(theme.fg("accent", "✓ Context cleared") + "\n" + theme.fg("muted", "Started fresh session"), 1, 1),
		);

		this.ui.requestRender();
	}

	private handleDebugCommand(): void {
		// Force a render and capture all lines with their widths
		const width = this.ui.terminal.columns;
		const allLines = this.ui.render(width);

		const debugLogPath = getDebugLogPath();
		const debugData = [
			`Debug output at ${new Date().toISOString()}`,
			`Terminal width: ${width}`,
			`Total lines: ${allLines.length}`,
			"",
			"=== All rendered lines with visible widths ===",
			...allLines.map((line, idx) => {
				const vw = visibleWidth(line);
				const escaped = JSON.stringify(line);
				return `[${idx}] (w=${vw}) ${escaped}`;
			}),
			"",
		].join("\n");

		fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
		fs.writeFileSync(debugLogPath, debugData);

		// Show confirmation
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(
			new Text(theme.fg("accent", "✓ Debug log written") + "\n" + theme.fg("muted", debugLogPath), 1, 1),
		);

		this.ui.requestRender();
	}

	private async handleBashCommand(command: string): Promise<void> {
		try {
			// Execute bash command
			const { stdout, stderr } = await this.executeBashCommand(command);

			// Build the message text, format like a user would naturally share command output
			let messageText = `Ran \`${command}\`\n`;
			const output = [stdout, stderr].filter(Boolean).join("\n");
			if (output) {
				messageText += "```\n" + output + "\n```";
			} else {
				messageText += "(no output)";
			}

			// Create user message
			const userMessage = {
				role: "user" as const,
				content: [{ type: "text" as const, text: messageText }],
				timestamp: Date.now(),
			};

			// Add to agent state (don't trigger LLM call)
			this.agent.appendMessage(userMessage);

			// Save to session
			this.sessionManager.saveMessage(userMessage);

			// Render in chat
			this.addMessageToChat(userMessage);

			// Update UI
			this.ui.requestRender();
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			this.showError(`Failed to execute bash command: ${errorMessage}`);
		}
	}

	private executeBashCommand(command: string): Promise<{ stdout: string; stderr: string }> {
		return new Promise((resolve, reject) => {
			const { shell, args } = getShellConfig();
			const child = spawn(shell, [...args, command], {
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			});

			// Track process for cancellation
			this.bashProcess = child;

			let stdout = "";
			let stderr = "";

			if (child.stdout) {
				child.stdout.on("data", (data: Buffer) => {
					stdout += data.toString();
					// Limit buffer size to 2MB
					if (stdout.length > 2 * 1024 * 1024) {
						stdout = stdout.slice(0, 2 * 1024 * 1024);
					}
				});
			}

			if (child.stderr) {
				child.stderr.on("data", (data: Buffer) => {
					stderr += data.toString();
					// Limit buffer size to 1MB
					if (stderr.length > 1 * 1024 * 1024) {
						stderr = stderr.slice(0, 1 * 1024 * 1024);
					}
				});
			}

			// 30 second timeout
			const timeoutHandle = setTimeout(() => {
				if (child.pid) {
					killProcessTree(child.pid);
				}
				reject(new Error("Command execution timeout (30s)"));
			}, 30000);

			child.on("close", (code: number | null) => {
				clearTimeout(timeoutHandle);
				this.bashProcess = null;

				// Check if killed (code is null when process is killed)
				if (code === null) {
					reject(new Error("Command cancelled"));
					return;
				}

				// Trim trailing newlines from output
				stdout = stdout.replace(/\n+$/, "");
				stderr = stderr.replace(/\n+$/, "");

				// Don't reject on non-zero exit as we want to show the error in stderr
				if (code !== 0 && !stderr) {
					stderr = `Command exited with code ${code}`;
				}

				resolve({ stdout, stderr });
			});

			child.on("error", (err) => {
				clearTimeout(timeoutHandle);
				this.bashProcess = null;
				reject(err);
			});
		});
	}

	private compactionAbortController: AbortController | null = null;

	/**
	 * Shared logic to execute context compaction.
	 * Handles aborting agent, showing loader, performing compaction, updating session/UI.
	 */
	private async executeCompaction(customInstructions?: string, isAuto = false): Promise<void> {
		// Unsubscribe first to prevent processing events during compaction
		this.unsubscribe?.();

		// Abort and wait for completion
		this.agent.abort();
		await this.agent.waitForIdle();

		// Stop loading animation
		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = null;
		}
		this.statusContainer.clear();

		// Create abort controller for compaction
		this.compactionAbortController = new AbortController();

		// Set up escape handler during compaction
		const originalOnEscape = this.editor.onEscape;
		this.editor.onEscape = () => {
			if (this.compactionAbortController) {
				this.compactionAbortController.abort();
			}
		};

		// Show compacting status with loader
		this.chatContainer.addChild(new Spacer(1));
		const label = isAuto ? "Auto-compacting context... (esc to cancel)" : "Compacting context... (esc to cancel)";
		const compactingLoader = new Loader(
			this.ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			label,
		);
		this.statusContainer.addChild(compactingLoader);
		this.ui.requestRender();

		try {
			// Get API key for current model
			const apiKey = await getApiKeyForModel(this.agent.state.model);
			if (!apiKey) {
				throw new Error(`No API key for ${this.agent.state.model.provider}`);
			}

			// Perform compaction with abort signal
			const entries = this.sessionManager.loadEntries();
			const settings = this.settingsManager.getCompactionSettings();
			const compactionEntry = await compact(
				entries,
				this.agent.state.model,
				settings,
				apiKey,
				this.compactionAbortController.signal,
				customInstructions,
			);

			// Check if aborted after compact returned
			if (this.compactionAbortController.signal.aborted) {
				throw new Error("Compaction cancelled");
			}

			// Save compaction to session
			this.sessionManager.saveCompaction(compactionEntry);

			// Reload session
			const loaded = loadSessionFromEntries(this.sessionManager.loadEntries());
			this.agent.replaceMessages(loaded.messages);

			// Rebuild UI
			this.chatContainer.clear();
			this.rebuildChatFromMessages();

			// Add compaction component at current position so user can see/expand the summary
			const compactionComponent = new CompactionComponent(compactionEntry.tokensBefore, compactionEntry.summary);
			compactionComponent.setExpanded(this.toolOutputExpanded);
			this.chatContainer.addChild(compactionComponent);

			// Update footer with new state (fixes context % display)
			this.footer.updateState(this.agent.state);

			// Show success message
			const successTitle = isAuto ? "✓ Context auto-compacted" : "✓ Context compacted";
			this.showSuccess(successTitle, `Reduced from ${compactionEntry.tokensBefore.toLocaleString()} tokens`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message === "Compaction cancelled" || (error instanceof Error && error.name === "AbortError")) {
				this.showError("Compaction cancelled");
			} else {
				this.showError(`Compaction failed: ${message}`);
			}
		} finally {
			// Clean up
			compactingLoader.stop();
			this.statusContainer.clear();
			this.compactionAbortController = null;
			this.editor.onEscape = originalOnEscape;
		}

		// Resubscribe to agent
		this.subscribeToAgent();
	}

	private async handleCompactCommand(customInstructions?: string): Promise<void> {
		// Check if there are any messages to compact
		const entries = this.sessionManager.loadEntries();
		const messageCount = entries.filter((e) => e.type === "message").length;

		if (messageCount < 2) {
			this.showWarning("Nothing to compact (no messages yet)");
			return;
		}

		await this.executeCompaction(customInstructions, false);
	}

	private handleAutocompactCommand(): void {
		const currentEnabled = this.settingsManager.getCompactionEnabled();
		const newState = !currentEnabled;
		this.settingsManager.setCompactionEnabled(newState);
		this.footer.setAutoCompactEnabled(newState);

		// Show brief notification (same style as thinking level toggle)
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("dim", `Auto-compaction: ${newState ? "on" : "off"}`), 1, 0));
		this.ui.requestRender();
	}

	private updatePendingMessagesDisplay(): void {
		this.pendingMessagesContainer.clear();

		if (this.queuedMessages.length > 0) {
			this.pendingMessagesContainer.addChild(new Spacer(1));

			for (const message of this.queuedMessages) {
				const queuedText = theme.fg("dim", "Queued: " + message);
				this.pendingMessagesContainer.addChild(new TruncatedText(queuedText, 1, 0));
			}
		}
	}

	stop(): void {
		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = null;
		}
		this.footer.dispose();
		if (this.isInitialized) {
			this.ui.stop();
			this.isInitialized = false;
		}
	}
}

/**
 * Kill a process and all its children (cross-platform)
 */
function killProcessTree(pid: number): void {
	if (process.platform === "win32") {
		// Use taskkill on Windows to kill process tree
		try {
			spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
				stdio: "ignore",
				detached: true,
			});
		} catch {
			// Ignore errors if taskkill fails
		}
	} else {
		// Use SIGKILL on Unix/Linux/Mac
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			// Fallback to killing just the child if process group kill fails
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// Process already dead
			}
		}
	}
}
