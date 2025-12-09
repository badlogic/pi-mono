/**
 * Interactive mode for the coding agent.
 * Handles TUI rendering and user interaction, delegating business logic to AgentSession.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentEvent, AgentState, AppMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message } from "@mariozechner/pi-ai";
import type { SlashCommand } from "@mariozechner/pi-tui";
import {
	CombinedAutocompleteProvider,
	type Component,
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
import { exec } from "child_process";
import type { AgentSession } from "../../core/agent-session.js";
import { isBashExecutionMessage } from "../../core/messages.js";
import { invalidateOAuthCache } from "../../core/model-config.js";
import { listOAuthProviders, login, logout, type SupportedOAuthProvider } from "../../core/oauth/index.js";
import { getLatestCompactionEntry, SUMMARY_PREFIX, SUMMARY_SUFFIX } from "../../core/session-manager.js";
import type { TruncationResult } from "../../core/tools/truncate.js";
import { getChangelogPath, parseChangelog } from "../../utils/changelog.js";
import { copyToClipboard } from "../../utils/clipboard.js";
import { APP_NAME, getDebugLogPath, getOAuthPath } from "../../utils/config.js";
import { AssistantMessageComponent } from "./components/assistant-message.js";
import { BashExecutionComponent } from "./components/bash-execution.js";
import { CompactionComponent } from "./components/compaction.js";
import { CustomEditor } from "./components/custom-editor.js";
import { DynamicBorder } from "./components/dynamic-border.js";
import { FooterComponent } from "./components/footer.js";
import { ModelSelectorComponent } from "./components/model-selector.js";
import { OAuthSelectorComponent } from "./components/oauth-selector.js";
import { QueueModeSelectorComponent } from "./components/queue-mode-selector.js";
import { SessionSelectorComponent } from "./components/session-selector.js";
import { ThemeSelectorComponent } from "./components/theme-selector.js";
import { ThinkingSelectorComponent } from "./components/thinking-selector.js";
import { ToolExecutionComponent } from "./components/tool-execution.js";
import { UserMessageComponent } from "./components/user-message.js";
import { UserMessageSelectorComponent } from "./components/user-message-selector.js";
import { getEditorTheme, getMarkdownTheme, onThemeChange, setTheme, theme } from "./theme/theme.js";

export class InteractiveMode {
	private session: AgentSession;
	private ui: TUI;
	private chatContainer: Container;
	private pendingMessagesContainer: Container;
	private statusContainer: Container;
	private editor: CustomEditor;
	private editorContainer: Container;
	private footer: FooterComponent;
	private version: string;
	private isInitialized = false;
	private onInputCallback?: (text: string) => void;
	private loadingAnimation: Loader | null = null;

	private lastSigintTime = 0;
	private lastEscapeTime = 0;
	private changelogMarkdown: string | null = null;

	// Streaming message tracking
	private streamingComponent: AssistantMessageComponent | null = null;

	// Tool execution tracking: toolCallId -> component
	private pendingTools = new Map<string, ToolExecutionComponent>();

	// Track if this is the first user message (to skip spacer)
	private isFirstUserMessage = true;

	// Tool output expansion state
	private toolOutputExpanded = false;

	// Thinking block visibility state
	private hideThinkingBlock = false;

	// Agent subscription unsubscribe function
	private unsubscribe?: () => void;

	// Track if editor is in bash mode (text starts with !)
	private isBashMode = false;

	// Track current bash execution component
	private bashComponent: BashExecutionComponent | null = null;

	// Convenience accessors
	private get agent() {
		return this.session.agent;
	}
	private get sessionManager() {
		return this.session.sessionManager;
	}
	private get settingsManager() {
		return this.session.settingsManager;
	}

	constructor(
		session: AgentSession,
		version: string,
		changelogMarkdown: string | null = null,
		fdPath: string | null = null,
	) {
		this.session = session;
		this.version = version;
		this.changelogMarkdown = changelogMarkdown;
		this.ui = new TUI(new ProcessTerminal());
		this.chatContainer = new Container();
		this.pendingMessagesContainer = new Container();
		this.statusContainer = new Container();
		this.editor = new CustomEditor(getEditorTheme());
		this.editorContainer = new Container();
		this.editorContainer.addChild(this.editor);
		this.footer = new FooterComponent(session.state);
		this.footer.setAutoCompactEnabled(session.autoCompactionEnabled);

		// Define slash commands for autocomplete
		const slashCommands: SlashCommand[] = [
			{ name: "thinking", description: "Select reasoning level (opens selector UI)" },
			{ name: "model", description: "Select model (opens selector UI)" },
			{ name: "export", description: "Export session to HTML file" },
			{ name: "copy", description: "Copy last agent message to clipboard" },
			{ name: "session", description: "Show session info and stats" },
			{ name: "changelog", description: "Show changelog entries" },
			{ name: "branch", description: "Create a new branch from a previous message" },
			{ name: "login", description: "Login with OAuth provider" },
			{ name: "logout", description: "Logout from OAuth provider" },
			{ name: "queue", description: "Select message queue mode (opens selector UI)" },
			{ name: "theme", description: "Select color theme (opens selector UI)" },
			{ name: "clear", description: "Clear context and start a fresh session" },
			{ name: "compact", description: "Manually compact the session context" },
			{ name: "autocompact", description: "Toggle automatic context compaction" },
			{ name: "resume", description: "Resume a different session" },
		];

		// Load hide thinking block setting
		this.hideThinkingBlock = this.settingsManager.getHideThinkingBlock();

		// Convert file commands to SlashCommand format
		const fileSlashCommands: SlashCommand[] = this.session.fileCommands.map((cmd) => ({
			name: cmd.name,
			description: cmd.description,
		}));

		// Setup autocomplete
		const autocompleteProvider = new CombinedAutocompleteProvider(
			[...slashCommands, ...fileSlashCommands],
			process.cwd(),
			fdPath,
		);
		this.editor.setAutocompleteProvider(autocompleteProvider);
	}

	async init(): Promise<void> {
		if (this.isInitialized) return;

		// Add header
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
			theme.fg("dim", "ctrl+t") +
			theme.fg("muted", " to toggle thinking") +
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

		// Add changelog if provided
		if (this.changelogMarkdown) {
			this.ui.addChild(new DynamicBorder());
			if (this.settingsManager.getCollapseChangelog()) {
				const versionMatch = this.changelogMarkdown.match(/##\s+\[?(\d+\.\d+\.\d+)\]?/);
				const latestVersion = versionMatch ? versionMatch[1] : this.version;
				const condensedText = `Updated to v${latestVersion}. Use ${theme.bold("/changelog")} to view full changelog.`;
				this.ui.addChild(new Text(condensedText, 1, 0));
			} else {
				this.ui.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
				this.ui.addChild(new Spacer(1));
				this.ui.addChild(new Markdown(this.changelogMarkdown.trim(), 1, 0, getMarkdownTheme()));
				this.ui.addChild(new Spacer(1));
			}
			this.ui.addChild(new DynamicBorder());
		}

		this.ui.addChild(this.chatContainer);
		this.ui.addChild(this.pendingMessagesContainer);
		this.ui.addChild(this.statusContainer);
		this.ui.addChild(new Spacer(1));
		this.ui.addChild(this.editorContainer);
		this.ui.addChild(this.footer);
		this.ui.setFocus(this.editor);

		this.setupKeyHandlers();
		this.setupEditorSubmitHandler();

		// Start the UI
		this.ui.start();
		this.isInitialized = true;

		// Subscribe to agent events
		this.subscribeToAgent();

		// Set up theme file watcher
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

	private setupKeyHandlers(): void {
		this.editor.onEscape = () => {
			if (this.loadingAnimation) {
				// Abort and restore queued messages to editor
				const queuedMessages = this.session.clearQueue();
				const queuedText = queuedMessages.join("\n\n");
				const currentText = this.editor.getText();
				const combinedText = [queuedText, currentText].filter((t) => t.trim()).join("\n\n");
				this.editor.setText(combinedText);
				this.updatePendingMessagesDisplay();
				this.agent.abort();
			} else if (this.session.isBashRunning) {
				this.session.abortBash();
			} else if (this.isBashMode) {
				this.editor.setText("");
				this.isBashMode = false;
				this.updateEditorBorderColor();
			} else if (!this.editor.getText().trim()) {
				// Double-escape with empty editor triggers /branch
				const now = Date.now();
				if (now - this.lastEscapeTime < 500) {
					this.showUserMessageSelector();
					this.lastEscapeTime = 0;
				} else {
					this.lastEscapeTime = now;
				}
			}
		};

		this.editor.onCtrlC = () => this.handleCtrlC();
		this.editor.onShiftTab = () => this.cycleThinkingLevel();
		this.editor.onCtrlP = () => this.cycleModel();
		this.editor.onCtrlO = () => this.toggleToolOutputExpansion();
		this.editor.onCtrlT = () => this.toggleThinkingBlockVisibility();

		this.editor.onChange = (text: string) => {
			const wasBashMode = this.isBashMode;
			this.isBashMode = text.trimStart().startsWith("!");
			if (wasBashMode !== this.isBashMode) {
				this.updateEditorBorderColor();
			}
		};
	}

	private setupEditorSubmitHandler(): void {
		this.editor.onSubmit = async (text: string) => {
			text = text.trim();
			if (!text) return;

			// Handle slash commands
			if (text === "/thinking") {
				this.showThinkingSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/model") {
				this.showModelSelector();
				this.editor.setText("");
				return;
			}
			if (text.startsWith("/export")) {
				this.handleExportCommand(text);
				this.editor.setText("");
				return;
			}
			if (text === "/copy") {
				this.handleCopyCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/session") {
				this.handleSessionCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/changelog") {
				this.handleChangelogCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/branch") {
				this.showUserMessageSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/login") {
				this.showOAuthSelector("login");
				this.editor.setText("");
				return;
			}
			if (text === "/logout") {
				this.showOAuthSelector("logout");
				this.editor.setText("");
				return;
			}
			if (text === "/queue") {
				this.showQueueModeSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/theme") {
				this.showThemeSelector();
				this.editor.setText("");
				return;
			}
			if (text === "/clear") {
				await this.handleClearCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/compact" || text.startsWith("/compact ")) {
				const customInstructions = text.startsWith("/compact ") ? text.slice(9).trim() : undefined;
				await this.handleCompactCommand(customInstructions);
				this.editor.setText("");
				return;
			}
			if (text === "/autocompact") {
				this.handleAutocompactCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/debug") {
				this.handleDebugCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/resume") {
				this.showSessionSelector();
				this.editor.setText("");
				return;
			}

			// Handle bash command
			if (text.startsWith("!")) {
				const command = text.slice(1).trim();
				if (command) {
					if (this.session.isBashRunning) {
						this.showWarning("A bash command is already running. Press Esc to cancel it first.");
						this.editor.setText(text);
						return;
					}
					this.editor.addToHistory(text);
					await this.handleBashCommand(command);
					this.isBashMode = false;
					this.updateEditorBorderColor();
					return;
				}
			}

			// Queue message if agent is streaming
			if (this.session.isStreaming) {
				await this.session.queueMessage(text);
				this.updatePendingMessagesDisplay();
				this.editor.addToHistory(text);
				this.editor.setText("");
				this.ui.requestRender();
				return;
			}

			// Normal message submission
			if (this.onInputCallback) {
				this.onInputCallback(text);
			}
			this.editor.addToHistory(text);
		};
	}

	private subscribeToAgent(): void {
		this.unsubscribe = this.session.subscribe(async (event) => {
			await this.handleEvent(event, this.session.state);
		});
	}

	private async handleEvent(event: AgentEvent, state: AgentState): Promise<void> {
		if (!this.isInitialized) {
			await this.init();
		}

		this.footer.updateState(state);

		switch (event.type) {
			case "agent_start":
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
					this.addMessageToChat(event.message);
					this.editor.setText("");
					this.updatePendingMessagesDisplay();
					this.ui.requestRender();
				} else if (event.message.role === "assistant") {
					this.streamingComponent = new AssistantMessageComponent(undefined, this.hideThinkingBlock);
					this.chatContainer.addChild(this.streamingComponent);
					this.streamingComponent.updateContent(event.message as AssistantMessage);
					this.ui.requestRender();
				}
				break;

			case "message_update":
				if (this.streamingComponent && event.message.role === "assistant") {
					const assistantMsg = event.message as AssistantMessage;
					this.streamingComponent.updateContent(assistantMsg);

					for (const content of assistantMsg.content) {
						if (content.type === "toolCall") {
							if (!this.pendingTools.has(content.id)) {
								this.chatContainer.addChild(new Text("", 0, 0));
								const component = new ToolExecutionComponent(content.name, content.arguments);
								this.chatContainer.addChild(component);
								this.pendingTools.set(content.id, component);
							} else {
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
				if (event.message.role === "user") break;
				if (this.streamingComponent && event.message.role === "assistant") {
					const assistantMsg = event.message as AssistantMessage;
					this.streamingComponent.updateContent(assistantMsg);

					if (assistantMsg.stopReason === "aborted" || assistantMsg.stopReason === "error") {
						const errorMessage =
							assistantMsg.stopReason === "aborted" ? "Operation aborted" : assistantMsg.errorMessage || "Error";
						for (const [, component] of this.pendingTools.entries()) {
							component.updateResult({
								content: [{ type: "text", text: errorMessage }],
								isError: true,
							});
						}
						this.pendingTools.clear();
					}
					this.streamingComponent = null;
					this.footer.invalidate();
				}
				this.ui.requestRender();
				break;

			case "tool_execution_start": {
				if (!this.pendingTools.has(event.toolCallId)) {
					const component = new ToolExecutionComponent(event.toolName, event.args);
					this.chatContainer.addChild(component);
					this.pendingTools.set(event.toolCallId, component);
					this.ui.requestRender();
				}
				break;
			}

			case "tool_execution_end": {
				const component = this.pendingTools.get(event.toolCallId);
				if (component) {
					const resultData =
						typeof event.result === "string"
							? {
									content: [{ type: "text" as const, text: event.result }],
									details: undefined,
									isError: event.isError,
								}
							: { content: event.result.content, details: event.result.details, isError: event.isError };
					component.updateResult(resultData);
					this.pendingTools.delete(event.toolCallId);
					this.ui.requestRender();
				}
				break;
			}

			case "agent_end":
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
				this.ui.requestRender();
				break;
		}
	}

	private addMessageToChat(message: Message | AppMessage): void {
		if (isBashExecutionMessage(message)) {
			const component = new BashExecutionComponent(message.command, this.ui);
			if (message.output) {
				component.appendOutput(message.output);
			}
			component.setComplete(
				message.exitCode,
				message.cancelled,
				message.truncated ? ({ truncated: true } as TruncationResult) : undefined,
				message.fullOutputPath,
			);
			this.chatContainer.addChild(component);
			return;
		}

		if (message.role === "user") {
			const textBlocks =
				typeof message.content === "string"
					? [{ type: "text", text: message.content }]
					: message.content.filter((c: { type: string }) => c.type === "text");
			const textContent = textBlocks.map((c) => (c as { text: string }).text).join("");
			if (textContent) {
				const userComponent = new UserMessageComponent(textContent, this.isFirstUserMessage);
				this.chatContainer.addChild(userComponent);
				this.isFirstUserMessage = false;
			}
		} else if (message.role === "assistant") {
			const assistantComponent = new AssistantMessageComponent(message as AssistantMessage, this.hideThinkingBlock);
			this.chatContainer.addChild(assistantComponent);
		}
	}

	renderInitialMessages(state: AgentState): void {
		this.isFirstUserMessage = true;
		this.footer.updateState(state);
		this.updateEditorBorderColor();

		const compactionEntry = getLatestCompactionEntry(this.sessionManager.loadEntries());

		for (const message of state.messages) {
			if (isBashExecutionMessage(message)) {
				this.addMessageToChat(message);
				continue;
			}

			if (message.role === "user") {
				const textBlocks =
					typeof message.content === "string"
						? [{ type: "text", text: message.content }]
						: message.content.filter((c: { type: string }) => c.type === "text");
				const textContent = textBlocks.map((c) => (c as { text: string }).text).join("");
				if (textContent) {
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
				const assistantComponent = new AssistantMessageComponent(assistantMsg, this.hideThinkingBlock);
				this.chatContainer.addChild(assistantComponent);

				for (const content of assistantMsg.content) {
					if (content.type === "toolCall") {
						const component = new ToolExecutionComponent(content.name, content.arguments);
						this.chatContainer.addChild(component);

						if (assistantMsg.stopReason === "aborted" || assistantMsg.stopReason === "error") {
							const errorMessage =
								assistantMsg.stopReason === "aborted"
									? "Operation aborted"
									: assistantMsg.errorMessage || "Error";
							component.updateResult({ content: [{ type: "text", text: errorMessage }], isError: true });
						} else {
							this.pendingTools.set(content.id, component);
						}
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

		// Populate editor history
		for (const message of state.messages) {
			if (message.role === "user") {
				const textBlocks =
					typeof message.content === "string"
						? [{ type: "text", text: message.content }]
						: message.content.filter((c: { type: string }) => c.type === "text");
				const textContent = textBlocks.map((c) => (c as { text: string }).text).join("");
				if (textContent && !textContent.startsWith(SUMMARY_PREFIX)) {
					this.editor.addToHistory(textContent);
				}
			}
		}

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
		this.isFirstUserMessage = true;
		this.pendingTools.clear();

		const compactionEntry = getLatestCompactionEntry(this.sessionManager.loadEntries());

		for (const message of this.session.messages) {
			if (isBashExecutionMessage(message)) {
				this.addMessageToChat(message);
				continue;
			}

			if (message.role === "user") {
				const textBlocks =
					typeof message.content === "string"
						? [{ type: "text", text: message.content }]
						: message.content.filter((c: { type: string }) => c.type === "text");
				const textContent = textBlocks.map((c) => (c as { text: string }).text).join("");
				if (textContent) {
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
				const assistantComponent = new AssistantMessageComponent(assistantMsg, this.hideThinkingBlock);
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

	// =========================================================================
	// Key handlers
	// =========================================================================

	private handleCtrlC(): void {
		const now = Date.now();
		if (now - this.lastSigintTime < 500) {
			this.stop();
			process.exit(0);
		} else {
			this.clearEditor();
			this.lastSigintTime = now;
		}
	}

	private updateEditorBorderColor(): void {
		if (this.isBashMode) {
			this.editor.borderColor = theme.getBashModeBorderColor();
		} else {
			const level = this.session.thinkingLevel || "off";
			this.editor.borderColor = theme.getThinkingBorderColor(level);
		}
		this.ui.requestRender();
	}

	private cycleThinkingLevel(): void {
		const newLevel = this.session.cycleThinkingLevel();
		if (newLevel === null) {
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(new Text(theme.fg("dim", "Current model does not support thinking"), 1, 0));
		} else {
			this.updateEditorBorderColor();
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(new Text(theme.fg("dim", `Thinking level: ${newLevel}`), 1, 0));
		}
		this.ui.requestRender();
	}

	private async cycleModel(): Promise<void> {
		try {
			const result = await this.session.cycleModel();
			if (result === null) {
				this.chatContainer.addChild(new Spacer(1));
				const msg = this.session.scopedModels.length > 0 ? "Only one model in scope" : "Only one model available";
				this.chatContainer.addChild(new Text(theme.fg("dim", msg), 1, 0));
			} else {
				this.updateEditorBorderColor();
				this.chatContainer.addChild(new Spacer(1));
				const thinkingStr =
					result.model.reasoning && result.thinkingLevel !== "off" ? ` (thinking: ${result.thinkingLevel})` : "";
				this.chatContainer.addChild(
					new Text(theme.fg("dim", `Switched to ${result.model.name || result.model.id}${thinkingStr}`), 1, 0),
				);
			}
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
		this.ui.requestRender();
	}

	private toggleToolOutputExpansion(): void {
		this.toolOutputExpanded = !this.toolOutputExpanded;
		for (const child of this.chatContainer.children) {
			if (child instanceof ToolExecutionComponent) {
				child.setExpanded(this.toolOutputExpanded);
			} else if (child instanceof CompactionComponent) {
				child.setExpanded(this.toolOutputExpanded);
			} else if (child instanceof BashExecutionComponent) {
				child.setExpanded(this.toolOutputExpanded);
			}
		}
		this.ui.requestRender();
	}

	private toggleThinkingBlockVisibility(): void {
		this.hideThinkingBlock = !this.hideThinkingBlock;
		this.settingsManager.setHideThinkingBlock(this.hideThinkingBlock);

		for (const child of this.chatContainer.children) {
			if (child instanceof AssistantMessageComponent) {
				child.setHideThinkingBlock(this.hideThinkingBlock);
			}
		}

		this.chatContainer.clear();
		this.rebuildChatFromMessages();

		const status = this.hideThinkingBlock ? "hidden" : "visible";
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("dim", `Thinking blocks: ${status}`), 1, 0));
		this.ui.requestRender();
	}

	// =========================================================================
	// UI helpers
	// =========================================================================

	clearEditor(): void {
		this.editor.setText("");
		this.ui.requestRender();
	}

	showError(errorMessage: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("error", `Error: ${errorMessage}`), 1, 0));
		this.ui.requestRender();
	}

	showWarning(warningMessage: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0));
		this.ui.requestRender();
	}

	showNewVersionNotification(newVersion: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.chatContainer.addChild(
			new Text(
				theme.bold(theme.fg("warning", "Update Available")) +
					"\n" +
					theme.fg("muted", `New version ${newVersion} is available. Run: `) +
					theme.fg("accent", "npm install -g @mariozechner/pi-coding-agent"),
				1,
				0,
			),
		);
		this.chatContainer.addChild(new DynamicBorder((text) => theme.fg("warning", text)));
		this.ui.requestRender();
	}

	private updatePendingMessagesDisplay(): void {
		this.pendingMessagesContainer.clear();
		const queuedMessages = this.session.getQueuedMessages();
		if (queuedMessages.length > 0) {
			this.pendingMessagesContainer.addChild(new Spacer(1));
			for (const message of queuedMessages) {
				const queuedText = theme.fg("dim", "Queued: " + message);
				this.pendingMessagesContainer.addChild(new TruncatedText(queuedText, 1, 0));
			}
		}
	}

	// =========================================================================
	// Selectors
	// =========================================================================

	/**
	 * Shows a selector component in place of the editor.
	 * @param create Factory that receives a `done` callback and returns the component and focus target
	 */
	private showSelector(create: (done: () => void) => { component: Component; focus: Component }): void {
		const done = () => {
			this.editorContainer.clear();
			this.editorContainer.addChild(this.editor);
			this.ui.setFocus(this.editor);
		};
		const { component, focus } = create(done);
		this.editorContainer.clear();
		this.editorContainer.addChild(component);
		this.ui.setFocus(focus);
		this.ui.requestRender();
	}

	private showThinkingSelector(): void {
		this.showSelector((done) => {
			const selector = new ThinkingSelectorComponent(
				this.session.thinkingLevel,
				(level) => {
					this.session.setThinkingLevel(level);
					this.updateEditorBorderColor();
					this.chatContainer.addChild(new Spacer(1));
					this.chatContainer.addChild(new Text(theme.fg("dim", `Thinking level: ${level}`), 1, 0));
					done();
					this.ui.requestRender();
				},
				() => {
					done();
					this.ui.requestRender();
				},
			);
			return { component: selector, focus: selector.getSelectList() };
		});
	}

	private showQueueModeSelector(): void {
		this.showSelector((done) => {
			const selector = new QueueModeSelectorComponent(
				this.session.queueMode,
				(mode) => {
					this.session.setQueueMode(mode);
					this.chatContainer.addChild(new Spacer(1));
					this.chatContainer.addChild(new Text(theme.fg("dim", `Queue mode: ${mode}`), 1, 0));
					done();
					this.ui.requestRender();
				},
				() => {
					done();
					this.ui.requestRender();
				},
			);
			return { component: selector, focus: selector.getSelectList() };
		});
	}

	private showThemeSelector(): void {
		const currentTheme = this.settingsManager.getTheme() || "dark";
		this.showSelector((done) => {
			const selector = new ThemeSelectorComponent(
				currentTheme,
				(themeName) => {
					const result = setTheme(themeName);
					this.settingsManager.setTheme(themeName);
					this.ui.invalidate();
					this.chatContainer.addChild(new Spacer(1));
					if (result.success) {
						this.chatContainer.addChild(new Text(theme.fg("dim", `Theme: ${themeName}`), 1, 0));
					} else {
						this.chatContainer.addChild(
							new Text(
								theme.fg(
									"error",
									`Failed to load theme "${themeName}": ${result.error}\nFell back to dark theme.`,
								),
								1,
								0,
							),
						);
					}
					done();
					this.ui.requestRender();
				},
				() => {
					done();
					this.ui.requestRender();
				},
				(themeName) => {
					const result = setTheme(themeName);
					if (result.success) {
						this.ui.invalidate();
						this.ui.requestRender();
					}
				},
			);
			return { component: selector, focus: selector.getSelectList() };
		});
	}

	private showModelSelector(): void {
		this.showSelector((done) => {
			const selector = new ModelSelectorComponent(
				this.ui,
				this.session.model,
				this.settingsManager,
				(model) => {
					this.agent.setModel(model);
					this.sessionManager.saveModelChange(model.provider, model.id);
					this.chatContainer.addChild(new Spacer(1));
					this.chatContainer.addChild(new Text(theme.fg("dim", `Model: ${model.id}`), 1, 0));
					done();
					this.ui.requestRender();
				},
				() => {
					done();
					this.ui.requestRender();
				},
			);
			return { component: selector, focus: selector };
		});
	}

	private showUserMessageSelector(): void {
		const userMessages = this.session.getUserMessagesForBranching();

		if (userMessages.length <= 1) {
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(new Text(theme.fg("dim", "No messages to branch from"), 1, 0));
			this.ui.requestRender();
			return;
		}

		this.showSelector((done) => {
			const selector = new UserMessageSelectorComponent(
				userMessages.map((m) => ({ index: m.entryIndex, text: m.text })),
				(entryIndex) => {
					const selectedText = this.session.branch(entryIndex);
					this.chatContainer.clear();
					this.isFirstUserMessage = true;
					this.renderInitialMessages(this.session.state);
					this.chatContainer.addChild(new Spacer(1));
					this.chatContainer.addChild(new Text(theme.fg("dim", "Branched to new session"), 1, 0));
					this.editor.setText(selectedText);
					done();
					this.ui.requestRender();
				},
				() => {
					done();
					this.ui.requestRender();
				},
			);
			return { component: selector, focus: selector.getMessageList() };
		});
	}

	private showSessionSelector(): void {
		this.showSelector((done) => {
			const selector = new SessionSelectorComponent(
				this.sessionManager,
				async (sessionPath) => {
					done();
					await this.handleResumeSession(sessionPath);
				},
				() => {
					done();
					this.ui.requestRender();
				},
			);
			return { component: selector, focus: selector.getSessionList() };
		});
	}

	private async handleResumeSession(sessionPath: string): Promise<void> {
		// Stop loading animation
		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = null;
		}
		this.statusContainer.clear();

		// Clear UI state
		this.pendingMessagesContainer.clear();
		this.streamingComponent = null;
		this.pendingTools.clear();

		// Switch session via AgentSession
		await this.session.switchSession(sessionPath);

		// Clear and re-render the chat
		this.chatContainer.clear();
		this.isFirstUserMessage = true;
		this.renderInitialMessages(this.session.state);

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("dim", "Resumed session"), 1, 0));
		this.ui.requestRender();
	}

	private async showOAuthSelector(mode: "login" | "logout"): Promise<void> {
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
		}

		this.showSelector((done) => {
			const selector = new OAuthSelectorComponent(
				mode,
				async (providerId: string) => {
					done();

					if (mode === "login") {
						this.chatContainer.addChild(new Spacer(1));
						this.chatContainer.addChild(new Text(theme.fg("dim", `Logging in to ${providerId}...`), 1, 0));
						this.ui.requestRender();

						try {
							await login(
								providerId as SupportedOAuthProvider,
								(url: string) => {
									this.chatContainer.addChild(new Spacer(1));
									this.chatContainer.addChild(new Text(theme.fg("accent", "Opening browser to:"), 1, 0));
									this.chatContainer.addChild(new Text(theme.fg("accent", url), 1, 0));
									this.chatContainer.addChild(new Spacer(1));
									this.chatContainer.addChild(
										new Text(theme.fg("warning", "Paste the authorization code below:"), 1, 0),
									);
									this.ui.requestRender();

									const openCmd =
										process.platform === "darwin"
											? "open"
											: process.platform === "win32"
												? "start"
												: "xdg-open";
									exec(`${openCmd} "${url}"`);
								},
								async () => {
									return new Promise<string>((resolve) => {
										const codeInput = new Input();
										codeInput.onSubmit = () => {
											const code = codeInput.getValue();
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

							invalidateOAuthCache();
							this.chatContainer.addChild(new Spacer(1));
							this.chatContainer.addChild(
								new Text(theme.fg("success", `✓ Successfully logged in to ${providerId}`), 1, 0),
							);
							this.chatContainer.addChild(new Text(theme.fg("dim", `Tokens saved to ${getOAuthPath()}`), 1, 0));
							this.ui.requestRender();
						} catch (error: unknown) {
							this.showError(`Login failed: ${error instanceof Error ? error.message : String(error)}`);
						}
					} else {
						try {
							await logout(providerId as SupportedOAuthProvider);
							invalidateOAuthCache();
							this.chatContainer.addChild(new Spacer(1));
							this.chatContainer.addChild(
								new Text(theme.fg("success", `✓ Successfully logged out of ${providerId}`), 1, 0),
							);
							this.chatContainer.addChild(
								new Text(theme.fg("dim", `Credentials removed from ${getOAuthPath()}`), 1, 0),
							);
							this.ui.requestRender();
						} catch (error: unknown) {
							this.showError(`Logout failed: ${error instanceof Error ? error.message : String(error)}`);
						}
					}
				},
				() => {
					done();
					this.ui.requestRender();
				},
			);
			return { component: selector, focus: selector };
		});
	}

	// =========================================================================
	// Command handlers
	// =========================================================================

	private handleExportCommand(text: string): void {
		const parts = text.split(/\s+/);
		const outputPath = parts.length > 1 ? parts[1] : undefined;

		try {
			const filePath = this.session.exportToHtml(outputPath);
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(new Text(theme.fg("dim", `Session exported to: ${filePath}`), 1, 0));
			this.ui.requestRender();
		} catch (error: unknown) {
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(
				new Text(
					theme.fg(
						"error",
						`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`,
					),
					1,
					0,
				),
			);
			this.ui.requestRender();
		}
	}

	private handleCopyCommand(): void {
		const text = this.session.getLastAssistantText();
		if (!text) {
			this.showError("No agent messages to copy yet.");
			return;
		}

		try {
			copyToClipboard(text);
			this.chatContainer.addChild(new Spacer(1));
			this.chatContainer.addChild(new Text(theme.fg("dim", "Copied last agent message to clipboard"), 1, 0));
			this.ui.requestRender();
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
	}

	private handleSessionCommand(): void {
		const stats = this.session.getSessionStats();

		let info = `${theme.bold("Session Info")}\n\n`;
		info += `${theme.fg("dim", "File:")} ${stats.sessionFile}\n`;
		info += `${theme.fg("dim", "ID:")} ${stats.sessionId}\n\n`;
		info += `${theme.bold("Messages")}\n`;
		info += `${theme.fg("dim", "User:")} ${stats.userMessages}\n`;
		info += `${theme.fg("dim", "Assistant:")} ${stats.assistantMessages}\n`;
		info += `${theme.fg("dim", "Tool Calls:")} ${stats.toolCalls}\n`;
		info += `${theme.fg("dim", "Tool Results:")} ${stats.toolResults}\n`;
		info += `${theme.fg("dim", "Total:")} ${stats.totalMessages}\n\n`;
		info += `${theme.bold("Tokens")}\n`;
		info += `${theme.fg("dim", "Input:")} ${stats.tokens.input.toLocaleString()}\n`;
		info += `${theme.fg("dim", "Output:")} ${stats.tokens.output.toLocaleString()}\n`;
		if (stats.tokens.cacheRead > 0) {
			info += `${theme.fg("dim", "Cache Read:")} ${stats.tokens.cacheRead.toLocaleString()}\n`;
		}
		if (stats.tokens.cacheWrite > 0) {
			info += `${theme.fg("dim", "Cache Write:")} ${stats.tokens.cacheWrite.toLocaleString()}\n`;
		}
		info += `${theme.fg("dim", "Total:")} ${stats.tokens.total.toLocaleString()}\n`;

		if (stats.cost > 0) {
			info += `\n${theme.bold("Cost")}\n`;
			info += `${theme.fg("dim", "Total:")} ${stats.cost.toFixed(4)}`;
		}

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(info, 1, 0));
		this.ui.requestRender();
	}

	private handleChangelogCommand(): void {
		const changelogPath = getChangelogPath();
		const allEntries = parseChangelog(changelogPath);

		const changelogMarkdown =
			allEntries.length > 0
				? allEntries
						.reverse()
						.map((e) => e.content)
						.join("\n\n")
				: "No changelog entries found.";

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder());
		this.ui.addChild(new Text(theme.bold(theme.fg("accent", "What's New")), 1, 0));
		this.ui.addChild(new Spacer(1));
		this.chatContainer.addChild(new Markdown(changelogMarkdown, 1, 1, getMarkdownTheme()));
		this.chatContainer.addChild(new DynamicBorder());
		this.ui.requestRender();
	}

	private async handleClearCommand(): Promise<void> {
		// Stop loading animation
		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = null;
		}
		this.statusContainer.clear();

		// Reset via session
		await this.session.reset();

		// Clear UI state
		this.chatContainer.clear();
		this.pendingMessagesContainer.clear();
		this.streamingComponent = null;
		this.pendingTools.clear();
		this.isFirstUserMessage = true;

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(
			new Text(theme.fg("accent", "✓ Context cleared") + "\n" + theme.fg("muted", "Started fresh session"), 1, 1),
		);
		this.ui.requestRender();
	}

	private handleDebugCommand(): void {
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
			"=== Agent messages (JSONL) ===",
			...this.session.messages.map((msg) => JSON.stringify(msg)),
			"",
		].join("\n");

		fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
		fs.writeFileSync(debugLogPath, debugData);

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(
			new Text(theme.fg("accent", "✓ Debug log written") + "\n" + theme.fg("muted", debugLogPath), 1, 1),
		);
		this.ui.requestRender();
	}

	private async handleBashCommand(command: string): Promise<void> {
		this.bashComponent = new BashExecutionComponent(command, this.ui);
		this.chatContainer.addChild(this.bashComponent);
		this.ui.requestRender();

		try {
			const result = await this.session.executeBash(command, (chunk) => {
				if (this.bashComponent) {
					this.bashComponent.appendOutput(chunk);
					this.ui.requestRender();
				}
			});

			if (this.bashComponent) {
				this.bashComponent.setComplete(
					result.exitCode,
					result.cancelled,
					result.truncated ? ({ truncated: true, content: result.output } as TruncationResult) : undefined,
					result.fullOutputPath,
				);
			}
		} catch (error) {
			if (this.bashComponent) {
				this.bashComponent.setComplete(null, false);
			}
			this.showError(`Bash command failed: ${error instanceof Error ? error.message : "Unknown error"}`);
		}

		this.bashComponent = null;
		this.ui.requestRender();
	}

	private async handleCompactCommand(customInstructions?: string): Promise<void> {
		const entries = this.sessionManager.loadEntries();
		const messageCount = entries.filter((e) => e.type === "message").length;

		if (messageCount < 2) {
			this.showWarning("Nothing to compact (no messages yet)");
			return;
		}

		await this.executeCompaction(customInstructions, false);
	}

	private handleAutocompactCommand(): void {
		const newState = !this.session.autoCompactionEnabled;
		this.session.setAutoCompactionEnabled(newState);
		this.footer.setAutoCompactEnabled(newState);

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("dim", `Auto-compaction: ${newState ? "on" : "off"}`), 1, 0));
		this.ui.requestRender();
	}

	private async executeCompaction(customInstructions?: string, isAuto = false): Promise<void> {
		// Stop loading animation
		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = null;
		}
		this.statusContainer.clear();

		// Set up escape handler during compaction
		const originalOnEscape = this.editor.onEscape;
		this.editor.onEscape = () => {
			this.session.abortCompaction();
		};

		// Show compacting status
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
			const result = await this.session.compact(customInstructions);

			// Rebuild UI
			this.chatContainer.clear();
			this.rebuildChatFromMessages();

			// Add compaction component
			const compactionComponent = new CompactionComponent(result.tokensBefore, result.summary);
			compactionComponent.setExpanded(this.toolOutputExpanded);
			this.chatContainer.addChild(compactionComponent);

			this.footer.updateState(this.session.state);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message === "Compaction cancelled" || (error instanceof Error && error.name === "AbortError")) {
				this.showError("Compaction cancelled");
			} else {
				this.showError(`Compaction failed: ${message}`);
			}
		} finally {
			compactingLoader.stop();
			this.statusContainer.clear();
			this.editor.onEscape = originalOnEscape;
		}
	}

	stop(): void {
		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = null;
		}
		this.footer.dispose();
		if (this.unsubscribe) {
			this.unsubscribe();
		}
		if (this.isInitialized) {
			this.ui.stop();
			this.isInitialized = false;
		}
	}
}
