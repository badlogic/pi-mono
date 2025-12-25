/**
 * Interactive mode for the coding agent.
 * Handles TUI rendering and user interaction, delegating business logic to AgentSession.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentState, AppMessage, Attachment } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message, OAuthProvider } from "@mariozechner/pi-ai";
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
import { exec, spawnSync } from "child_process";
import { APP_NAME, getAuthPath, getDebugLogPath } from "../../config.js";
import type { AgentSession, AgentSessionEvent } from "../../core/agent-session.js";
import type { LoadedCustomTool, SessionEvent as ToolSessionEvent } from "../../core/custom-tools/index.js";
import type { HookUIContext } from "../../core/hooks/index.js";
import { isBashExecutionMessage } from "../../core/messages.js";
import {
	getLatestCompactionEntry,
	SessionManager,
	SUMMARY_PREFIX,
	SUMMARY_SUFFIX,
} from "../../core/session-manager.js";
import { loadSkills } from "../../core/skills.js";
import { loadProjectContextFiles } from "../../core/system-prompt.js";
import type { TruncationResult } from "../../core/tools/truncate.js";
import { getChangelogPath, parseChangelog } from "../../utils/changelog.js";
import { copyToClipboard } from "../../utils/clipboard.js";
import { ArminComponent } from "./components/armin.js";
import { AssistantMessageComponent } from "./components/assistant-message.js";
import { BashExecutionComponent } from "./components/bash-execution.js";
import { CompactionComponent } from "./components/compaction.js";
import { CustomEditor } from "./components/custom-editor.js";
import { DynamicBorder } from "./components/dynamic-border.js";
import { FooterComponent } from "./components/footer.js";
import { HookInputComponent } from "./components/hook-input.js";
import { HookSelectorComponent } from "./components/hook-selector.js";
import { ModelSelectorComponent } from "./components/model-selector.js";
import { OAuthSelectorComponent } from "./components/oauth-selector.js";
import { SessionSelectorComponent } from "./components/session-selector.js";
import { SettingsSelectorComponent } from "./components/settings-selector.js";
import { ToolExecutionComponent } from "./components/tool-execution.js";
import { UserMessageComponent } from "./components/user-message.js";
import { UserMessageSelectorComponent } from "./components/user-message-selector.js";
import { getAvailableThemes, getEditorTheme, getMarkdownTheme, onThemeChange, setTheme, theme } from "./theme/theme.js";

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

	// Track pending bash components (shown in pending area, moved to chat on submit)
	private pendingBashComponents: BashExecutionComponent[] = [];

	// Auto-compaction state
	private autoCompactionLoader: Loader | null = null;
	private autoCompactionEscapeHandler?: () => void;

	// Auto-retry state
	private retryLoader: Loader | null = null;
	private retryEscapeHandler?: () => void;

	// Hook UI state
	private hookSelector: HookSelectorComponent | null = null;
	private hookInput: HookInputComponent | null = null;

	// Custom tools for custom rendering
	private customTools: Map<string, LoadedCustomTool>;

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
		customTools: LoadedCustomTool[] = [],
		private setToolUIContext: (uiContext: HookUIContext, hasUI: boolean) => void = () => {},
		fdPath: string | null = null,
	) {
		this.session = session;
		this.version = version;
		this.changelogMarkdown = changelogMarkdown;
		this.customTools = new Map(customTools.map((ct) => [ct.tool.name, ct]));
		this.ui = new TUI(new ProcessTerminal());
		this.chatContainer = new Container();
		this.pendingMessagesContainer = new Container();
		this.statusContainer = new Container();
		this.editor = new CustomEditor(getEditorTheme());
		this.editorContainer = new Container();
		this.editorContainer.addChild(this.editor);
		this.footer = new FooterComponent(session.state, session.modelRegistry);
		this.footer.setAutoCompactEnabled(session.autoCompactionEnabled);

		// Define slash commands for autocomplete
		const slashCommands: SlashCommand[] = [
			{ name: "settings", description: "Open settings menu" },
			{ name: "model", description: "Select model (opens selector UI)" },
			{ name: "export", description: "Export session to HTML file" },
			{ name: "copy", description: "Copy last agent message to clipboard" },
			{ name: "session", description: "Show session info and stats" },
			{ name: "changelog", description: "Show changelog entries" },
			{ name: "hotkeys", description: "Show all keyboard shortcuts" },
			{ name: "branch", description: "Create a new branch from a previous message" },
			{ name: "login", description: "Login with OAuth provider" },
			{ name: "logout", description: "Logout from OAuth provider" },
			{ name: "new", description: "Start a new session" },
			{ name: "compact", description: "Manually compact the session context" },
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
			theme.fg("dim", "ctrl+d") +
			theme.fg("muted", " to exit (empty)") +
			"\n" +
			theme.fg("dim", "ctrl+z") +
			theme.fg("muted", " to suspend") +
			"\n" +
			theme.fg("dim", "ctrl+k") +
			theme.fg("muted", " to delete line") +
			"\n" +
			theme.fg("dim", "shift+tab") +
			theme.fg("muted", " to cycle thinking") +
			"\n" +
			theme.fg("dim", "ctrl+p/shift+ctrl+p") +
			theme.fg("muted", " to cycle models") +
			"\n" +
			theme.fg("dim", "ctrl+l") +
			theme.fg("muted", " to select model") +
			"\n" +
			theme.fg("dim", "ctrl+o") +
			theme.fg("muted", " to expand tools") +
			"\n" +
			theme.fg("dim", "ctrl+t") +
			theme.fg("muted", " to toggle thinking") +
			"\n" +
			theme.fg("dim", "ctrl+g") +
			theme.fg("muted", " for external editor") +
			"\n" +
			theme.fg("dim", "/") +
			theme.fg("muted", " for commands") +
			"\n" +
			theme.fg("dim", "!") +
			theme.fg("muted", " to run bash") +
			"\n" +
			theme.fg("dim", "drop files") +
			theme.fg("muted", " to attach");
		const header = new Text(`${logo}\n${instructions}`, 1, 0);

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

		// Initialize hooks with TUI-based UI context
		await this.initHooksAndCustomTools();

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

	// =========================================================================
	// Hook System
	// =========================================================================

	/**
	 * Initialize the hook system with TUI-based UI context.
	 */
	private async initHooksAndCustomTools(): Promise<void> {
		// Show loaded project context files
		const contextFiles = loadProjectContextFiles();
		if (contextFiles.length > 0) {
			const contextList = contextFiles.map((f) => theme.fg("dim", `  ${f.path}`)).join("\n");
			this.chatContainer.addChild(new Text(theme.fg("muted", "Loaded context:\n") + contextList, 0, 0));
			this.chatContainer.addChild(new Spacer(1));
		}

		// Show loaded skills
		const skillsSettings = this.session.skillsSettings;
		if (skillsSettings?.enabled !== false) {
			const { skills, warnings: skillWarnings } = loadSkills(skillsSettings ?? {});
			if (skills.length > 0) {
				const skillList = skills.map((s) => theme.fg("dim", `  ${s.filePath}`)).join("\n");
				this.chatContainer.addChild(new Text(theme.fg("muted", "Loaded skills:\n") + skillList, 0, 0));
				this.chatContainer.addChild(new Spacer(1));
			}

			// Show skill warnings if any
			if (skillWarnings.length > 0) {
				const warningList = skillWarnings
					.map((w) => theme.fg("warning", `  ${w.skillPath}: ${w.message}`))
					.join("\n");
				this.chatContainer.addChild(new Text(theme.fg("warning", "Skill warnings:\n") + warningList, 0, 0));
				this.chatContainer.addChild(new Spacer(1));
			}
		}

		// Show loaded custom tools
		if (this.customTools.size > 0) {
			const toolList = Array.from(this.customTools.values())
				.map((ct) => theme.fg("dim", `  ${ct.tool.name} (${ct.path})`))
				.join("\n");
			this.chatContainer.addChild(new Text(theme.fg("muted", "Loaded custom tools:\n") + toolList, 0, 0));
			this.chatContainer.addChild(new Spacer(1));
		}

		// Load session entries if any
		const entries = this.session.sessionManager.getEntries();

		// Set TUI-based UI context for custom tools
		const uiContext = this.createHookUIContext();
		this.setToolUIContext(uiContext, true);

		// Notify custom tools of session start
		await this.emitToolSessionEvent({
			entries,
			sessionFile: this.session.sessionFile,
			previousSessionFile: null,
			reason: "start",
		});

		const hookRunner = this.session.hookRunner;
		if (!hookRunner) {
			return; // No hooks loaded
		}

		// Set UI context on hook runner
		hookRunner.setUIContext(uiContext, true);
		hookRunner.setSessionFile(this.session.sessionFile);

		// Subscribe to hook errors
		hookRunner.onError((error) => {
			this.showHookError(error.hookPath, error.error);
		});

		// Set up send handler for pi.send()
		hookRunner.setSendHandler((text, attachments) => {
			this.handleHookSend(text, attachments);
		});

		// Show loaded hooks
		const hookPaths = hookRunner.getHookPaths();
		if (hookPaths.length > 0) {
			const hookList = hookPaths.map((p) => theme.fg("dim", `  ${p}`)).join("\n");
			this.chatContainer.addChild(new Text(theme.fg("muted", "Loaded hooks:\n") + hookList, 0, 0));
			this.chatContainer.addChild(new Spacer(1));
		}

		// Emit session event
		await hookRunner.emit({
			type: "session",
			entries,
			sessionFile: this.session.sessionFile,
			previousSessionFile: null,
			reason: "start",
		});
	}

	/**
	 * Emit session event to all custom tools.
	 */
	private async emitToolSessionEvent(event: ToolSessionEvent): Promise<void> {
		for (const { tool } of this.customTools.values()) {
			if (tool.onSession) {
				try {
					await tool.onSession(event);
				} catch (err) {
					this.showToolError(tool.name, err instanceof Error ? err.message : String(err));
				}
			}
		}
	}

	/**
	 * Show a tool error in the chat.
	 */
	private showToolError(toolName: string, error: string): void {
		const errorText = new Text(theme.fg("error", `Tool "${toolName}" error: ${error}`), 1, 0);
		this.chatContainer.addChild(errorText);
		this.ui.requestRender();
	}

	/**
	 * Create the UI context for hooks.
	 */
	private createHookUIContext(): HookUIContext {
		return {
			select: (title, options) => this.showHookSelector(title, options),
			confirm: (title, message) => this.showHookConfirm(title, message),
			input: (title, placeholder) => this.showHookInput(title, placeholder),
			notify: (message, type) => this.showHookNotify(message, type),
		};
	}

	/**
	 * Show a selector for hooks.
	 */
	private showHookSelector(title: string, options: string[]): Promise<string | null> {
		return new Promise((resolve) => {
			this.hookSelector = new HookSelectorComponent(
				title,
				options,
				(option) => {
					this.hideHookSelector();
					resolve(option);
				},
				() => {
					this.hideHookSelector();
					resolve(null);
				},
			);

			this.editorContainer.clear();
			this.editorContainer.addChild(this.hookSelector);
			this.ui.setFocus(this.hookSelector);
			this.ui.requestRender();
		});
	}

	/**
	 * Hide the hook selector.
	 */
	private hideHookSelector(): void {
		this.editorContainer.clear();
		this.editorContainer.addChild(this.editor);
		this.hookSelector = null;
		this.ui.setFocus(this.editor);
		this.ui.requestRender();
	}

	/**
	 * Show a confirmation dialog for hooks.
	 */
	private async showHookConfirm(title: string, message: string): Promise<boolean> {
		const result = await this.showHookSelector(`${title}\n${message}`, ["Yes", "No"]);
		return result === "Yes";
	}

	/**
	 * Show a text input for hooks.
	 */
	private showHookInput(title: string, placeholder?: string): Promise<string | null> {
		return new Promise((resolve) => {
			this.hookInput = new HookInputComponent(
				title,
				placeholder,
				(value) => {
					this.hideHookInput();
					resolve(value);
				},
				() => {
					this.hideHookInput();
					resolve(null);
				},
			);

			this.editorContainer.clear();
			this.editorContainer.addChild(this.hookInput);
			this.ui.setFocus(this.hookInput);
			this.ui.requestRender();
		});
	}

	/**
	 * Hide the hook input.
	 */
	private hideHookInput(): void {
		this.editorContainer.clear();
		this.editorContainer.addChild(this.editor);
		this.hookInput = null;
		this.ui.setFocus(this.editor);
		this.ui.requestRender();
	}

	/**
	 * Show a notification for hooks.
	 */
	private showHookNotify(message: string, type?: "info" | "warning" | "error"): void {
		if (type === "error") {
			this.showError(message);
		} else if (type === "warning") {
			this.showWarning(message);
		} else {
			this.showStatus(message);
		}
	}

	/**
	 * Show a hook error in the UI.
	 */
	private showHookError(hookPath: string, error: string): void {
		const errorText = new Text(theme.fg("error", `Hook "${hookPath}" error: ${error}`), 1, 0);
		this.chatContainer.addChild(errorText);
		this.ui.requestRender();
	}

	/**
	 * Handle pi.send() from hooks.
	 * If streaming, queue the message. Otherwise, start a new agent loop.
	 */
	private handleHookSend(text: string, attachments?: Attachment[]): void {
		if (this.session.isStreaming) {
			// Queue the message for later (note: attachments are lost when queuing)
			this.session.queueMessage(text);
			this.updatePendingMessagesDisplay();
		} else {
			// Start a new agent loop immediately
			this.session.prompt(text, { attachments }).catch((err) => {
				this.showError(err instanceof Error ? err.message : String(err));
			});
		}
	}

	// =========================================================================
	// Key Handlers
	// =========================================================================

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
		this.editor.onCtrlD = () => this.handleCtrlD();
		this.editor.onCtrlZ = () => this.handleCtrlZ();
		this.editor.onShiftTab = () => this.cycleThinkingLevel();
		this.editor.onCtrlP = () => this.cycleModel("forward");
		this.editor.onShiftCtrlP = () => this.cycleModel("backward");
		this.editor.onCtrlL = () => this.showModelSelector();
		this.editor.onCtrlO = () => this.toggleToolOutputExpansion();
		this.editor.onCtrlT = () => this.toggleThinkingBlockVisibility();
		this.editor.onCtrlG = () => this.openExternalEditor();

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
			if (text === "/settings") {
				this.showSettingsSelector();
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
			if (text === "/hotkeys") {
				this.handleHotkeysCommand();
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
			if (text === "/new") {
				this.editor.setText("");
				await this.handleClearCommand();
				return;
			}
			if (text === "/compact" || text.startsWith("/compact ")) {
				const customInstructions = text.startsWith("/compact ") ? text.slice(9).trim() : undefined;
				this.editor.setText("");
				this.editor.disableSubmit = true;
				try {
					await this.handleCompactCommand(customInstructions);
				} finally {
					this.editor.disableSubmit = false;
				}
				return;
			}
			if (text === "/debug") {
				this.handleDebugCommand();
				this.editor.setText("");
				return;
			}
			if (text === "/arminsayshi") {
				this.handleArminSaysHi();
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

			// Block input during compaction
			if (this.session.isCompacting) {
				return;
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
			// First, move any pending bash components to chat
			this.flushPendingBashComponents();

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

	private async handleEvent(event: AgentSessionEvent, state: AgentState): Promise<void> {
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
								const component = new ToolExecutionComponent(
									content.name,
									content.arguments,
									{
										showImages: this.settingsManager.getShowImages(),
									},
									this.customTools.get(content.name)?.tool,
									this.ui,
								);
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
					const component = new ToolExecutionComponent(
						event.toolName,
						event.args,
						{
							showImages: this.settingsManager.getShowImages(),
						},
						this.customTools.get(event.toolName)?.tool,
						this.ui,
					);
					this.chatContainer.addChild(component);
					this.pendingTools.set(event.toolCallId, component);
					this.ui.requestRender();
				}
				break;
			}

			case "tool_execution_update": {
				const component = this.pendingTools.get(event.toolCallId);
				if (component) {
					component.updateResult({ ...event.partialResult, isError: false }, true);
					this.ui.requestRender();
				}
				break;
			}

			case "tool_execution_end": {
				const component = this.pendingTools.get(event.toolCallId);
				if (component) {
					component.updateResult({ ...event.result, isError: event.isError });
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

			case "auto_compaction_start": {
				// Disable submit to preserve editor text during compaction
				this.editor.disableSubmit = true;
				// Set up escape to abort auto-compaction
				this.autoCompactionEscapeHandler = this.editor.onEscape;
				this.editor.onEscape = () => {
					this.session.abortCompaction();
				};
				// Show compacting indicator with reason
				this.statusContainer.clear();
				const reasonText = event.reason === "overflow" ? "Context overflow detected, " : "";
				this.autoCompactionLoader = new Loader(
					this.ui,
					(spinner) => theme.fg("accent", spinner),
					(text) => theme.fg("muted", text),
					`${reasonText}Auto-compacting... (esc to cancel)`,
				);
				this.statusContainer.addChild(this.autoCompactionLoader);
				this.ui.requestRender();
				break;
			}

			case "auto_compaction_end": {
				// Re-enable submit
				this.editor.disableSubmit = false;
				// Restore escape handler
				if (this.autoCompactionEscapeHandler) {
					this.editor.onEscape = this.autoCompactionEscapeHandler;
					this.autoCompactionEscapeHandler = undefined;
				}
				// Stop loader
				if (this.autoCompactionLoader) {
					this.autoCompactionLoader.stop();
					this.autoCompactionLoader = null;
					this.statusContainer.clear();
				}
				// Handle result
				if (event.aborted) {
					this.showStatus("Auto-compaction cancelled");
				} else if (event.result) {
					// Rebuild chat to show compacted state
					this.chatContainer.clear();
					this.rebuildChatFromMessages();
					// Add compaction component (same as manual /compact)
					const compactionComponent = new CompactionComponent(event.result.tokensBefore, event.result.summary);
					compactionComponent.setExpanded(this.toolOutputExpanded);
					this.chatContainer.addChild(compactionComponent);
					this.footer.updateState(this.session.state);
				}
				this.ui.requestRender();
				break;
			}

			case "auto_retry_start": {
				// Set up escape to abort retry
				this.retryEscapeHandler = this.editor.onEscape;
				this.editor.onEscape = () => {
					this.session.abortRetry();
				};
				// Show retry indicator
				this.statusContainer.clear();
				const delaySeconds = Math.round(event.delayMs / 1000);
				this.retryLoader = new Loader(
					this.ui,
					(spinner) => theme.fg("warning", spinner),
					(text) => theme.fg("muted", text),
					`Retrying (${event.attempt}/${event.maxAttempts}) in ${delaySeconds}s... (esc to cancel)`,
				);
				this.statusContainer.addChild(this.retryLoader);
				this.ui.requestRender();
				break;
			}

			case "auto_retry_end": {
				// Restore escape handler
				if (this.retryEscapeHandler) {
					this.editor.onEscape = this.retryEscapeHandler;
					this.retryEscapeHandler = undefined;
				}
				// Stop loader
				if (this.retryLoader) {
					this.retryLoader.stop();
					this.retryLoader = null;
					this.statusContainer.clear();
				}
				// Show error only on final failure (success shows normal response)
				if (!event.success) {
					this.showError(`Retry failed after ${event.attempt} attempts: ${event.finalError || "Unknown error"}`);
				}
				this.ui.requestRender();
				break;
			}
		}
	}

	/** Extract text content from a user message */
	private getUserMessageText(message: Message): string {
		if (message.role !== "user") return "";
		const textBlocks =
			typeof message.content === "string"
				? [{ type: "text", text: message.content }]
				: message.content.filter((c: { type: string }) => c.type === "text");
		return textBlocks.map((c) => (c as { text: string }).text).join("");
	}

	/** Show a status message in the chat */
	private showStatus(message: string): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(theme.fg("dim", message), 1, 0));
		this.ui.requestRender();
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
			const textContent = this.getUserMessageText(message);
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

	/**
	 * Render messages to chat. Used for initial load and rebuild after compaction.
	 * @param messages Messages to render
	 * @param options.updateFooter Update footer state
	 * @param options.populateHistory Add user messages to editor history
	 */
	private renderMessages(
		messages: readonly (Message | AppMessage)[],
		options: { updateFooter?: boolean; populateHistory?: boolean } = {},
	): void {
		this.isFirstUserMessage = true;
		this.pendingTools.clear();

		if (options.updateFooter) {
			this.footer.updateState(this.session.state);
			this.updateEditorBorderColor();
		}

		const compactionEntry = getLatestCompactionEntry(this.sessionManager.getEntries());

		for (const message of messages) {
			if (isBashExecutionMessage(message)) {
				this.addMessageToChat(message);
				continue;
			}

			if (message.role === "user") {
				const textContent = this.getUserMessageText(message);
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
						if (options.populateHistory) {
							this.editor.addToHistory(textContent);
						}
					}
				}
			} else if (message.role === "assistant") {
				const assistantMsg = message as AssistantMessage;
				const assistantComponent = new AssistantMessageComponent(assistantMsg, this.hideThinkingBlock);
				this.chatContainer.addChild(assistantComponent);

				for (const content of assistantMsg.content) {
					if (content.type === "toolCall") {
						const component = new ToolExecutionComponent(
							content.name,
							content.arguments,
							{
								showImages: this.settingsManager.getShowImages(),
							},
							this.customTools.get(content.name)?.tool,
							this.ui,
						);
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
					component.updateResult(message);
					this.pendingTools.delete(message.toolCallId);
				}
			}
		}
		this.pendingTools.clear();
		this.ui.requestRender();
	}

	renderInitialMessages(state: AgentState): void {
		this.renderMessages(state.messages, { updateFooter: true, populateHistory: true });

		// Show compaction info if session was compacted
		const entries = this.sessionManager.getEntries();
		const compactionCount = entries.filter((e) => e.type === "compaction").length;
		if (compactionCount > 0) {
			const times = compactionCount === 1 ? "1 time" : `${compactionCount} times`;
			this.showStatus(`Session compacted ${times}`);
		}
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
		this.renderMessages(this.session.messages);
	}

	// =========================================================================
	// Key handlers
	// =========================================================================

	private handleCtrlC(): void {
		const now = Date.now();
		if (now - this.lastSigintTime < 500) {
			void this.shutdown();
		} else {
			this.clearEditor();
			this.lastSigintTime = now;
		}
	}

	private handleCtrlD(): void {
		// Only called when editor is empty (enforced by CustomEditor)
		void this.shutdown();
	}

	/**
	 * Gracefully shutdown the agent.
	 * Emits shutdown event to hooks, then exits.
	 */
	private async shutdown(): Promise<void> {
		// Emit shutdown event to hooks
		const hookRunner = this.session.hookRunner;
		if (hookRunner?.hasHandlers("session")) {
			const entries = this.sessionManager.getEntries();
			await hookRunner.emit({
				type: "session",
				entries,
				sessionFile: this.session.sessionFile,
				previousSessionFile: null,
				reason: "shutdown",
			});
		}

		this.stop();
		process.exit(0);
	}

	private handleCtrlZ(): void {
		// Set up handler to restore TUI when resumed
		process.once("SIGCONT", () => {
			this.ui.start();
			this.ui.requestRender(true);
		});

		// Stop the TUI (restore terminal to normal mode)
		this.ui.stop();

		// Send SIGTSTP to process group (pid=0 means all processes in group)
		process.kill(0, "SIGTSTP");
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
			this.showStatus("Current model does not support thinking");
		} else {
			this.footer.updateState(this.session.state);
			this.updateEditorBorderColor();
			this.showStatus(`Thinking level: ${newLevel}`);
		}
	}

	private async cycleModel(direction: "forward" | "backward"): Promise<void> {
		try {
			const result = await this.session.cycleModel(direction);
			if (result === null) {
				const msg = this.session.scopedModels.length > 0 ? "Only one model in scope" : "Only one model available";
				this.showStatus(msg);
			} else {
				this.footer.updateState(this.session.state);
				this.updateEditorBorderColor();
				const thinkingStr =
					result.model.reasoning && result.thinkingLevel !== "off" ? ` (thinking: ${result.thinkingLevel})` : "";
				this.showStatus(`Switched to ${result.model.name || result.model.id}${thinkingStr}`);
			}
		} catch (error) {
			this.showError(error instanceof Error ? error.message : String(error));
		}
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
		this.showStatus(`Thinking blocks: ${this.hideThinkingBlock ? "hidden" : "visible"}`);
	}

	private openExternalEditor(): void {
		// Determine editor (respect $VISUAL, then $EDITOR)
		const editorCmd = process.env.VISUAL || process.env.EDITOR;
		if (!editorCmd) {
			this.showWarning("No editor configured. Set $VISUAL or $EDITOR environment variable.");
			return;
		}

		const currentText = this.editor.getText();
		const tmpFile = path.join(os.tmpdir(), `pi-editor-${Date.now()}.pi.md`);

		try {
			// Write current content to temp file
			fs.writeFileSync(tmpFile, currentText, "utf-8");

			// Stop TUI to release terminal
			this.ui.stop();

			// Split by space to support editor arguments (e.g., "code --wait")
			const [editor, ...editorArgs] = editorCmd.split(" ");

			// Spawn editor synchronously with inherited stdio for interactive editing
			const result = spawnSync(editor, [...editorArgs, tmpFile], {
				stdio: "inherit",
			});

			// On successful exit (status 0), replace editor content
			if (result.status === 0) {
				const newContent = fs.readFileSync(tmpFile, "utf-8").replace(/\n$/, "");
				this.editor.setText(newContent);
			}
			// On non-zero exit, keep original text (no action needed)
		} finally {
			// Clean up temp file
			try {
				fs.unlinkSync(tmpFile);
			} catch {
				// Ignore cleanup errors
			}

			// Restart TUI
			this.ui.start();
			this.ui.requestRender();
		}
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
				const queuedText = theme.fg("dim", `Queued: ${message}`);
				this.pendingMessagesContainer.addChild(new TruncatedText(queuedText, 1, 0));
			}
		}
	}

	/** Move pending bash components from pending area to chat */
	private flushPendingBashComponents(): void {
		for (const component of this.pendingBashComponents) {
			this.pendingMessagesContainer.removeChild(component);
			this.chatContainer.addChild(component);
		}
		this.pendingBashComponents = [];
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

	private showSettingsSelector(): void {
		this.showSelector((done) => {
			const selector = new SettingsSelectorComponent(
				{
					autoCompact: this.session.autoCompactionEnabled,
					showImages: this.settingsManager.getShowImages(),
					queueMode: this.session.queueMode,
					thinkingLevel: this.session.thinkingLevel,
					availableThinkingLevels: this.session.getAvailableThinkingLevels(),
					currentTheme: this.settingsManager.getTheme() || "dark",
					availableThemes: getAvailableThemes(),
					hideThinkingBlock: this.hideThinkingBlock,
					collapseChangelog: this.settingsManager.getCollapseChangelog(),
				},
				{
					onAutoCompactChange: (enabled) => {
						this.session.setAutoCompactionEnabled(enabled);
						this.footer.setAutoCompactEnabled(enabled);
					},
					onShowImagesChange: (enabled) => {
						this.settingsManager.setShowImages(enabled);
						for (const child of this.chatContainer.children) {
							if (child instanceof ToolExecutionComponent) {
								child.setShowImages(enabled);
							}
						}
					},
					onQueueModeChange: (mode) => {
						this.session.setQueueMode(mode);
					},
					onThinkingLevelChange: (level) => {
						this.session.setThinkingLevel(level);
						this.footer.updateState(this.session.state);
						this.updateEditorBorderColor();
					},
					onThemeChange: (themeName) => {
						const result = setTheme(themeName, true);
						this.settingsManager.setTheme(themeName);
						this.ui.invalidate();
						if (!result.success) {
							this.showError(`Failed to load theme "${themeName}": ${result.error}\nFell back to dark theme.`);
						}
					},
					onThemePreview: (themeName) => {
						const result = setTheme(themeName, true);
						if (result.success) {
							this.ui.invalidate();
							this.ui.requestRender();
						}
					},
					onHideThinkingBlockChange: (hidden) => {
						this.hideThinkingBlock = hidden;
						this.settingsManager.setHideThinkingBlock(hidden);
						for (const child of this.chatContainer.children) {
							if (child instanceof AssistantMessageComponent) {
								child.setHideThinkingBlock(hidden);
							}
						}
						this.chatContainer.clear();
						this.rebuildChatFromMessages();
					},
					onCollapseChangelogChange: (collapsed) => {
						this.settingsManager.setCollapseChangelog(collapsed);
					},
					onCancel: () => {
						done();
						this.ui.requestRender();
					},
				},
			);
			return { component: selector, focus: selector.getSettingsList() };
		});
	}

	private showModelSelector(): void {
		this.showSelector((done) => {
			const selector = new ModelSelectorComponent(
				this.ui,
				this.session.model,
				this.settingsManager,
				this.session.modelRegistry,
				this.session.scopedModels,
				async (model) => {
					try {
						await this.session.setModel(model);
						this.footer.updateState(this.session.state);
						this.updateEditorBorderColor();
						done();
						this.showStatus(`Model: ${model.id}`);
					} catch (error) {
						done();
						this.showError(error instanceof Error ? error.message : String(error));
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

	private showUserMessageSelector(): void {
		const userMessages = this.session.getUserMessagesForBranching();

		if (userMessages.length === 0) {
			this.showStatus("No messages to branch from");
			return;
		}

		this.showSelector((done) => {
			const selector = new UserMessageSelectorComponent(
				userMessages.map((m) => ({ index: m.entryIndex, text: m.text })),
				async (entryIndex) => {
					const result = await this.session.branch(entryIndex);
					if (result.cancelled) {
						// Hook cancelled the branch
						done();
						this.ui.requestRender();
						return;
					}

					this.chatContainer.clear();
					this.isFirstUserMessage = true;
					this.renderInitialMessages(this.session.state);
					this.editor.setText(result.selectedText);
					done();
					this.showStatus("Branched to new session");
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
			const sessions = SessionManager.list(this.sessionManager.getCwd(), this.sessionManager.getSessionDir());
			const selector = new SessionSelectorComponent(
				sessions,
				async (sessionPath) => {
					done();
					await this.handleResumeSession(sessionPath);
				},
				() => {
					done();
					this.ui.requestRender();
				},
				() => {
					void this.shutdown();
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

		// Switch session via AgentSession (emits hook and tool session events)
		await this.session.switchSession(sessionPath);

		// Clear and re-render the chat
		this.chatContainer.clear();
		this.isFirstUserMessage = true;
		this.renderInitialMessages(this.session.state);
		this.showStatus("Resumed session");
	}

	private async showOAuthSelector(mode: "login" | "logout"): Promise<void> {
		if (mode === "logout") {
			const providers = this.session.modelRegistry.authStorage.list();
			const loggedInProviders = providers.filter(
				(p) => this.session.modelRegistry.authStorage.get(p)?.type === "oauth",
			);
			if (loggedInProviders.length === 0) {
				this.showStatus("No OAuth providers logged in. Use /login first.");
				return;
			}
		}

		this.showSelector((done) => {
			const selector = new OAuthSelectorComponent(
				mode,
				this.session.modelRegistry.authStorage,
				async (providerId: string) => {
					done();

					if (mode === "login") {
						this.showStatus(`Logging in to ${providerId}...`);

						try {
							await this.session.modelRegistry.authStorage.login(providerId as OAuthProvider, {
								onAuth: (info: { url: string; instructions?: string }) => {
									this.chatContainer.addChild(new Spacer(1));
									this.chatContainer.addChild(new Text(theme.fg("accent", "Opening browser to:"), 1, 0));
									this.chatContainer.addChild(new Text(theme.fg("accent", info.url), 1, 0));
									if (info.instructions) {
										this.chatContainer.addChild(new Spacer(1));
										this.chatContainer.addChild(new Text(theme.fg("warning", info.instructions), 1, 0));
									}
									this.ui.requestRender();

									const openCmd =
										process.platform === "darwin"
											? "open"
											: process.platform === "win32"
												? "start"
												: "xdg-open";
									exec(`${openCmd} "${info.url}"`);
								},
								onPrompt: async (prompt: { message: string; placeholder?: string }) => {
									this.chatContainer.addChild(new Spacer(1));
									this.chatContainer.addChild(new Text(theme.fg("warning", prompt.message), 1, 0));
									if (prompt.placeholder) {
										this.chatContainer.addChild(new Text(theme.fg("dim", prompt.placeholder), 1, 0));
									}
									this.ui.requestRender();

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
								onProgress: (message: string) => {
									this.chatContainer.addChild(new Text(theme.fg("dim", message), 1, 0));
									this.ui.requestRender();
								},
							});
							// Refresh models to pick up new baseUrl (e.g., github-copilot)
							this.session.modelRegistry.refresh();
							this.chatContainer.addChild(new Spacer(1));
							this.chatContainer.addChild(
								new Text(theme.fg("success", `✓ Successfully logged in to ${providerId}`), 1, 0),
							);
							this.chatContainer.addChild(
								new Text(theme.fg("dim", `Credentials saved to ${getAuthPath()}`), 1, 0),
							);
							this.ui.requestRender();
						} catch (error: unknown) {
							this.showError(`Login failed: ${error instanceof Error ? error.message : String(error)}`);
						}
					} else {
						try {
							this.session.modelRegistry.authStorage.logout(providerId);
							// Refresh models to reset baseUrl
							this.session.modelRegistry.refresh();
							this.chatContainer.addChild(new Spacer(1));
							this.chatContainer.addChild(
								new Text(theme.fg("success", `✓ Successfully logged out of ${providerId}`), 1, 0),
							);
							this.chatContainer.addChild(
								new Text(theme.fg("dim", `Credentials removed from ${getAuthPath()}`), 1, 0),
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
			this.showStatus(`Session exported to: ${filePath}`);
		} catch (error: unknown) {
			this.showError(`Failed to export session: ${error instanceof Error ? error.message : "Unknown error"}`);
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
			this.showStatus("Copied last agent message to clipboard");
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

	private handleHotkeysCommand(): void {
		const hotkeys = `
**Navigation**
| Key | Action |
|-----|--------|
| \`Arrow keys\` | Move cursor / browse history (Up when empty) |
| \`Option+Left/Right\` | Move by word |
| \`Ctrl+A\` / \`Home\` / \`Cmd+Left\` | Start of line |
| \`Ctrl+E\` / \`End\` / \`Cmd+Right\` | End of line |

**Editing**
| Key | Action |
|-----|--------|
| \`Enter\` | Send message |
| \`Shift+Enter\` / \`Alt+Enter\` | New line |
| \`Ctrl+W\` / \`Option+Backspace\` | Delete word backwards |
| \`Ctrl+U\` | Delete to start of line |
| \`Ctrl+K\` | Delete to end of line |

**Other**
| Key | Action |
|-----|--------|
| \`Tab\` | Path completion / accept autocomplete |
| \`Escape\` | Cancel autocomplete / abort streaming |
| \`Ctrl+C\` | Clear editor (first) / exit (second) |
| \`Ctrl+D\` | Exit (when editor is empty) |
| \`Ctrl+Z\` | Suspend to background |
| \`Shift+Tab\` | Cycle thinking level |
| \`Ctrl+P\` | Cycle models |
| \`Ctrl+O\` | Toggle tool output expansion |
| \`Ctrl+T\` | Toggle thinking block visibility |
| \`Ctrl+G\` | Edit message in external editor |
| \`/\` | Slash commands |
| \`!\` | Run bash command |
`;
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new DynamicBorder());
		this.chatContainer.addChild(new Text(theme.bold(theme.fg("accent", "Keyboard Shortcuts")), 1, 0));
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Markdown(hotkeys.trim(), 1, 1, getMarkdownTheme()));
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

		// Reset via session (emits hook and tool session events)
		await this.session.reset();

		// Clear UI state
		this.chatContainer.clear();
		this.pendingMessagesContainer.clear();
		this.streamingComponent = null;
		this.pendingTools.clear();
		this.isFirstUserMessage = true;

		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new Text(`${theme.fg("accent", "✓ New session started")}`, 1, 1));
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
			new Text(`${theme.fg("accent", "✓ Debug log written")}\n${theme.fg("muted", debugLogPath)}`, 1, 1),
		);
		this.ui.requestRender();
	}

	private handleArminSaysHi(): void {
		this.chatContainer.addChild(new Spacer(1));
		this.chatContainer.addChild(new ArminComponent(this.ui));
		this.ui.requestRender();
	}

	private async handleBashCommand(command: string): Promise<void> {
		const isDeferred = this.session.isStreaming;
		this.bashComponent = new BashExecutionComponent(command, this.ui);

		if (isDeferred) {
			// Show in pending area when agent is streaming
			this.pendingMessagesContainer.addChild(this.bashComponent);
			this.pendingBashComponents.push(this.bashComponent);
		} else {
			// Show in chat immediately when agent is idle
			this.chatContainer.addChild(this.bashComponent);
		}
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
		const entries = this.sessionManager.getEntries();
		const messageCount = entries.filter((e) => e.type === "message").length;

		if (messageCount < 2) {
			this.showWarning("Nothing to compact (no messages yet)");
			return;
		}

		await this.executeCompaction(customInstructions, false);
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
