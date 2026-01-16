/**
 * EmbeddedSessionComponent - Overlay UI for embedded sessions.
 */

import type { AgentMessage, AgentTool } from "@mariozechner/pi-agent-core";
import { Agent } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Model, TextContent } from "@mariozechner/pi-ai";
import {
	AgentSession,
	type AgentSessionEvent,
	AssistantMessageComponent,
	CompactionSummaryMessageComponent,
	CustomEditor,
	getEditorTheme,
	type KeybindingsManager,
	ModelSelectorComponent,
	SessionManager,
	type ToolDefinition,
	ToolExecutionComponent,
	theme,
	UserMessageComponent,
} from "@mariozechner/pi-coding-agent";
import type { CompactionSummaryMessage } from "@mariozechner/pi-coding-agent/core/messages.js";
import { Container, Loader, Spacer, Text, type TUI, visibleWidth } from "@mariozechner/pi-tui";
import type { EmbeddedSessionOptions, EmbeddedSessionResult } from "./types.js";

export interface EmbeddedSessionComponentConfig {
	tui: TUI;
	parentSession: AgentSession;
	options: EmbeddedSessionOptions;
	keybindings: KeybindingsManager;
	onClose: (result: EmbeddedSessionResult) => void;
	getToolDefinition?: (name: string) => ToolDefinition | undefined;
}

/**
 * Component that renders an embedded session in an overlay.
 */
export class EmbeddedSessionComponent extends Container {
	private tui: TUI;
	private parentSession: AgentSession;
	private embeddedSession!: AgentSession;
	private options: EmbeddedSessionOptions;
	private keybindings: KeybindingsManager;
	private onCloseCallback: (result: EmbeddedSessionResult) => void;
	private getToolDefinitionFn: (name: string) => ToolDefinition | undefined;
	private cwd: string;

	// UI Components
	private chatContainer!: Container;
	private editor!: CustomEditor;
	private statusLine!: Container;
	private loadingIndicator: Loader | undefined;

	// Overlay dimensions - use options if provided, otherwise defaults
	get width(): number {
		const opt = this.options.width;
		if (typeof opt === "number") return opt;
		if (typeof opt === "string" && opt.endsWith("%")) {
			const pct = parseInt(opt, 10);
			if (!Number.isNaN(pct) && pct > 0) {
				return Math.floor(this.tui.terminal.columns * (pct / 100));
			}
		}
		return Math.floor(this.tui.terminal.columns * 0.9);
	}
	get maxHeight(): number {
		const opt = this.options.maxHeight;
		if (typeof opt === "number") return opt;
		if (typeof opt === "string" && opt.endsWith("%")) {
			const pct = parseInt(opt, 10);
			if (!Number.isNaN(pct) && pct > 0) {
				return Math.floor(this.tui.terminal.rows * (pct / 100));
			}
		}
		return Math.floor(this.tui.terminal.rows * 0.85);
	}

	// State
	private startTime: number;
	private filesRead = new Set<string>();
	private filesModified = new Set<string>();
	private closed = false;
	private unsubscribe?: () => void;

	// Streaming state
	private streamingComponent: AssistantMessageComponent | undefined;
	private pendingTools = new Map<string, ToolExecutionComponent>();
	private toolArgsCache = new Map<string, Record<string, unknown>>();
	private toolOutputExpanded = false;

	private constructor(config: EmbeddedSessionComponentConfig) {
		super();
		this.tui = config.tui;
		this.parentSession = config.parentSession;
		this.options = config.options;
		this.keybindings = config.keybindings;
		this.onCloseCallback = config.onClose;
		this.getToolDefinitionFn = config.getToolDefinition ?? (() => undefined);
		this.cwd = config.parentSession.sessionManager.getCwd();
		this.startTime = Date.now();
	}

	static async create(config: EmbeddedSessionComponentConfig): Promise<EmbeddedSessionComponent> {
		const component = new EmbeddedSessionComponent(config);
		await component.initialize();
		return component;
	}

	private async initialize(): Promise<void> {
		// 1. Create SessionManager
		const sessionManager = this.createSessionManager();

		// 2. Create tools
		const tools = this.createTools();

		// 3. Get system prompt from parent
		const systemPrompt = this.parentSession.agent.state.systemPrompt;

		// 4. Get model
		const model = this.options.model ?? this.parentSession.model;
		if (!model) {
			throw new Error("Cannot create embedded session: no model specified and parent has no model");
		}

		// 5. Get initial messages
		const initialMessages = this.buildInitialMessages();

		// 6. Create Agent
		const agent = new Agent({
			initialState: {
				model,
				systemPrompt,
				tools,
				messages: initialMessages,
				thinkingLevel: this.options.thinkingLevel ?? this.parentSession.thinkingLevel,
			},
			getApiKey: (provider) => this.parentSession.modelRegistry.getApiKeyForProvider(provider),
		});

		// 7. Create AgentSession
		this.embeddedSession = new AgentSession({
			agent,
			sessionManager,
			settingsManager: this.parentSession.settingsManager,
			modelRegistry: this.parentSession.modelRegistry,
			promptTemplates: [...this.parentSession.promptTemplates],
			skills: [...this.parentSession.skills],
		});

		// 8. Build UI
		this.buildUI();

		// 9. Subscribe to events
		this.unsubscribe = this.embeddedSession.subscribe(this.handleEvent);

		// 10. Send initial message if provided
		if (this.options.initialMessage) {
			this.embeddedSession.prompt(this.options.initialMessage).catch((err) => {
				this.showError(err.message);
			});
		}
	}

	private createSessionManager(): SessionManager {
		const parentId = this.parentSession.sessionManager.getSessionId();
		const cwd = this.parentSession.sessionManager.getCwd();

		if (this.options.sessionFile === false) {
			return SessionManager.inMemory(cwd);
		}

		return SessionManager.createEmbedded(parentId, cwd, {
			sessionFile: typeof this.options.sessionFile === "string" ? this.options.sessionFile : undefined,
		});
	}

	private createTools(): AgentTool[] {
		if (this.options.inheritTools === false) {
			return this.options.additionalTools ?? [];
		}

		let tools = [...this.parentSession.agent.state.tools];

		if (this.options.excludeTools?.length) {
			const excluded = new Set(this.options.excludeTools);
			tools = tools.filter((t) => !excluded.has(t.name));
		}

		if (this.options.additionalTools?.length) {
			tools.push(...this.options.additionalTools);
		}

		return tools;
	}

	private buildInitialMessages(): AgentMessage[] {
		if (!this.options.includeParentContext) {
			return [];
		}

		const depth = this.options.parentContextDepth ?? 5;
		const parentMessages = this.parentSession.agent.state.messages;
		const totalUserMessages = parentMessages.filter((m) => m.role === "user").length;
		const startAfterExchange = totalUserMessages - depth;

		const relevantMessages: AgentMessage[] = [];
		let userMessageCount = 0;

		for (const msg of parentMessages) {
			if (msg.role === "user") {
				userMessageCount++;
			}
			if (userMessageCount > startAfterExchange) {
				if (msg.role === "user" || msg.role === "assistant") {
					relevantMessages.push(JSON.parse(JSON.stringify(msg)));
				}
			}
		}

		return relevantMessages;
	}

	private buildUI(): void {
		this.chatContainer = new Container();
		this.addChild(this.chatContainer);

		this.editor = new CustomEditor(this.tui, getEditorTheme(), this.keybindings);
		this.editor.onSubmit = (text) => this.handleSubmit(text);
		this.editor.onEscape = () => {
			if (this.embeddedSession.isStreaming) {
				this.embeddedSession.abort();
			} else {
				this.close(true);
			}
		};
		this.addChild(this.editor as any);

		this.statusLine = new Container();
		this.updateStatusLine();
		this.addChild(this.statusLine);
	}

	private updateStatusLine(): void {
		this.statusLine.clear();
		const stats = this.embeddedSession.getSessionStats();
		const tokens = `${this.formatTokens(stats.tokens.input)}in/${this.formatTokens(stats.tokens.output)}out`;

		const hints = [
			theme.fg("muted", `tokens: ${tokens}`),
			theme.fg("dim", "│"),
			theme.fg("dim", "Enter") + theme.fg("muted", " send"),
			theme.fg("dim", "/model") + theme.fg("muted", " switch"),
			theme.fg("dim", "/done") + theme.fg("muted", " complete"),
			theme.fg("dim", "Esc") + theme.fg("muted", " cancel"),
		].join("  ");

		this.statusLine.addChild(new Text(hints, 0, 0));
	}

	private formatTokens(n: number): string {
		return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
	}

	private showModelSelector(initialSearchInput?: string): void {
		const selector = new ModelSelectorComponent(
			this.tui,
			this.embeddedSession.model,
			this.embeddedSession.settingsManager,
			this.embeddedSession.modelRegistry,
			[],
			async (model: Model<any>) => {
				try {
					await this.embeddedSession.setModel(model);
					this.tui.hideOverlay();
					this.tui.setFocus(this.editor);
					this.updateStatusLine();
					this.tui.requestRender();
				} catch (error) {
					this.tui.hideOverlay();
					this.tui.setFocus(this.editor);
					this.showError(error instanceof Error ? error.message : String(error));
				}
			},
			() => {
				this.tui.hideOverlay();
				this.tui.setFocus(this.editor);
				this.tui.requestRender();
			},
			initialSearchInput,
		);
		this.tui.showOverlay(selector, { anchor: "center" });
		this.tui.setFocus(selector);
	}

	handleInput(data: string): void {
		this.editor.handleInput(data);
	}

	private handleSubmit(text: string): void {
		const trimmed = text.trim();
		if (!trimmed) return;

		this.editor.setText("");

		if (trimmed === "/done" || trimmed === "/close") {
			this.close(false);
			return;
		}

		if (trimmed === "/compact") {
			this.embeddedSession.compact().catch((err) => this.showError(err.message));
			return;
		}

		if (trimmed === "/model" || trimmed.startsWith("/model ")) {
			const searchTerm = trimmed.startsWith("/model ") ? trimmed.slice(7).trim() : undefined;
			this.showModelSelector(searchTerm);
			return;
		}

		const behavior = this.embeddedSession.isStreaming ? "followUp" : undefined;
		this.embeddedSession.prompt(trimmed, { streamingBehavior: behavior }).catch((err) => {
			this.showError(err.message);
		});
	}

	private handleEvent = (event: AgentSessionEvent): void => {
		switch (event.type) {
			case "agent_start":
				this.showLoading();
				break;
			case "agent_end":
				this.hideLoading();
				this.updateStatusLine();
				break;
			case "message_start":
				if (event.message.role === "user") {
					this.renderUserMessage(event.message);
				} else if (event.message.role === "assistant") {
					this.startStreamingAssistant(event.message as AssistantMessage);
				} else if (event.message.role === "compactionSummary") {
					this.renderCompactionSummary(event.message as CompactionSummaryMessage);
				}
				break;
			case "message_update":
				if (event.message.role === "assistant") {
					this.updateStreamingAssistant(event.message as AssistantMessage);
				}
				break;
			case "message_end":
				if (event.message.role === "assistant") {
					this.endStreamingAssistant(event.message as AssistantMessage);
				}
				break;
			case "tool_execution_start":
				this.handleToolStart(event);
				break;
			case "tool_execution_update":
				this.handleToolUpdate(event);
				break;
			case "tool_execution_end":
				this.handleToolEnd(event);
				break;
		}
		this.tui.requestRender();
	};

	private renderUserMessage(message: AgentMessage): void {
		if (message.role !== "user" || !("content" in message)) return;
		const textContent = this.extractTextFromContent(message.content);
		if (textContent) {
			this.chatContainer.addChild(new UserMessageComponent(textContent));
			this.chatContainer.addChild(new Spacer(1));
		}
	}

	private extractTextFromContent(content: any): string {
		if (typeof content === "string") return content;
		return content
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join(" ");
	}

	private renderCompactionSummary(message: CompactionSummaryMessage): void {
		this.chatContainer.addChild(new Spacer(1));
		const component = new CompactionSummaryMessageComponent(message);
		component.setExpanded(this.toolOutputExpanded);
		this.chatContainer.addChild(component);
	}

	private startStreamingAssistant(message: AssistantMessage): void {
		this.streamingComponent = new AssistantMessageComponent(
			message,
			this.embeddedSession.settingsManager.getHideThinkingBlock(),
		);
		this.chatContainer.addChild(this.streamingComponent);
		this.renderToolCallsFromMessage(message);
	}

	private updateStreamingAssistant(message: AssistantMessage): void {
		if (this.streamingComponent) {
			this.streamingComponent.updateContent(message);
			this.renderToolCallsFromMessage(message);
		}
	}

	private endStreamingAssistant(message: AssistantMessage): void {
		if (this.streamingComponent) {
			this.streamingComponent.updateContent(message);

			if (message.stopReason === "aborted" || message.stopReason === "error") {
				const errorMessage =
					message.stopReason === "aborted" ? "Operation aborted" : message.errorMessage || "Error";
				for (const [, component] of this.pendingTools) {
					component.updateResult({ content: [{ type: "text", text: errorMessage }], isError: true });
				}
				this.pendingTools.clear();
			} else {
				for (const [, component] of this.pendingTools) {
					component.setArgsComplete();
				}
			}

			this.streamingComponent = undefined;
			this.chatContainer.addChild(new Spacer(1));
		}
	}

	private renderToolCallsFromMessage(message: AssistantMessage): void {
		for (const content of message.content) {
			if (content.type === "toolCall") {
				if (!this.pendingTools.has(content.id)) {
					const component = new ToolExecutionComponent(
						content.name,
						content.arguments,
						{ showImages: this.parentSession.settingsManager.getShowImages() },
						this.getToolDefinitionFn(content.name),
						this.tui,
						this.cwd,
					);
					component.setExpanded(this.toolOutputExpanded);
					this.pendingTools.set(content.id, component);
					this.chatContainer.addChild(component);
					this.toolArgsCache.set(content.id, content.arguments as Record<string, unknown>);
				} else {
					const component = this.pendingTools.get(content.id);
					if (component) {
						component.updateArgs(content.arguments);
						this.toolArgsCache.set(content.id, content.arguments as Record<string, unknown>);
					}
				}
			}
		}
	}

	private handleToolStart(event: { toolCallId: string; toolName: string; args: unknown }): void {
		if (this.pendingTools.has(event.toolCallId)) return;

		this.toolArgsCache.set(event.toolCallId, event.args as Record<string, unknown>);
		const component = new ToolExecutionComponent(
			event.toolName,
			event.args,
			{ showImages: this.parentSession.settingsManager.getShowImages() },
			this.getToolDefinitionFn(event.toolName),
			this.tui,
			this.cwd,
		);
		component.setExpanded(this.toolOutputExpanded);
		this.pendingTools.set(event.toolCallId, component);
		this.chatContainer.addChild(component);
	}

	private handleToolUpdate(event: { toolCallId: string; partialResult: unknown }): void {
		const component = this.pendingTools.get(event.toolCallId);
		if (component) {
			component.updateResult(event.partialResult as any);
		}
	}

	private handleToolEnd(event: { toolCallId: string; toolName: string; result: any; isError: boolean }): void {
		const component = this.pendingTools.get(event.toolCallId);
		if (component) {
			component.updateResult({ ...event.result, isError: event.isError });
			this.pendingTools.delete(event.toolCallId);
		}

		const args = this.toolArgsCache.get(event.toolCallId);
		this.toolArgsCache.delete(event.toolCallId);

		if (args && typeof args.path === "string") {
			if (event.toolName === "read") {
				this.filesRead.add(args.path);
			} else if (event.toolName === "write" || event.toolName === "edit") {
				this.filesModified.add(args.path);
			}
		}
	}

	private showLoading(): void {
		if (!this.loadingIndicator) {
			this.loadingIndicator = new Loader(
				this.tui,
				(s) => theme.fg("accent", s),
				(t) => theme.fg("muted", t),
				"Working...",
			);
			this.statusLine.addChild(this.loadingIndicator);
		}
	}

	private hideLoading(): void {
		if (this.loadingIndicator) {
			this.loadingIndicator.stop();
			this.loadingIndicator = undefined;
			this.statusLine.clear();
			this.updateStatusLine();
		}
	}

	private showError(message: string): void {
		this.chatContainer.addChild(new Text(theme.fg("error", `Error: ${message}`), 1, 0));
		this.chatContainer.addChild(new Spacer(1));
	}

	async close(cancelled: boolean): Promise<void> {
		if (this.closed) return;
		this.closed = true;

		await this.embeddedSession.abort();
		this.unsubscribe?.();

		let summary: string | undefined;
		if (!cancelled && this.options.generateSummary !== false) {
			summary = await this.generateSummary();
		}

		const stats = this.embeddedSession.getSessionStats();
		const result: EmbeddedSessionResult = {
			cancelled,
			summary,
			sessionId: this.embeddedSession.sessionManager.getSessionId(),
			sessionFile: this.embeddedSession.sessionManager.getSessionFile(),
			durationMs: Date.now() - this.startTime,
			filesRead: Array.from(this.filesRead),
			filesModified: Array.from(this.filesModified),
			messageCount: stats.totalMessages,
			tokens: {
				input: stats.tokens.input,
				output: stats.tokens.output,
				cacheRead: stats.tokens.cacheRead,
				cacheWrite: stats.tokens.cacheWrite,
			},
		};

		this.hideLoading();
		this.onCloseCallback(result);
	}

	private async generateSummary(): Promise<string | undefined> {
		const messages = this.embeddedSession.agent.state.messages;
		if (messages.length === 0) return undefined;

		const lastAssistant = messages.filter((m) => m.role === "assistant").pop() as AssistantMessage | undefined;
		if (!lastAssistant) return undefined;

		const text = lastAssistant.content
			.filter((c): c is TextContent => c.type === "text")
			.map((c) => c.text)
			.join("\n")
			.trim();

		if (!text) return undefined;

		const maxLength = 500;
		return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
	}

	invalidate(): void {
		this.chatContainer?.invalidate?.();
		this.statusLine?.invalidate?.();
	}

	render(_width: number): string[] {
		const w = this.width;
		const maxH = this.maxHeight;
		const border = (s: string) => theme.fg("border", s);
		const innerWidth = Math.max(1, w - 2);

		const pad = (s: string, len: number) => {
			const vis = visibleWidth(s);
			return s + " ".repeat(Math.max(0, len - vis));
		};

		const row = (content: string) => border("│") + pad(content, innerWidth) + border("│");
		const emptyRow = () => border("│") + " ".repeat(innerWidth) + border("│");
		const separator = () => border(`├${"─".repeat(innerWidth)}┤`);

		const editorLines = this.editor.render(innerWidth - 2);
		const statusLines = this.statusLine.render(innerWidth - 2);

		const hasModel = !!this.embeddedSession?.model;
		const fixedLines = 1 + (hasModel ? 1 : 0) + 1 + 1 + 1 + editorLines.length + 1 + 1 + statusLines.length + 1;
		const chatMaxHeight = Math.max(1, maxH - fixedLines);

		let chatLines = this.chatContainer.render(innerWidth - 2);
		if (chatLines.length > chatMaxHeight) {
			chatLines = chatLines.slice(-chatMaxHeight);
		}

		const result: string[] = [];

		// Top border with title
		const title = this.options.title ?? "Embedded Session";
		const model = this.embeddedSession?.model;
		const modelStr = model ? `${model.provider}/${model.id}` : "";
		let titleText = ` ${title} `;
		let titleLen = visibleWidth(titleText);

		// Truncate title if it's too long for the border
		if (titleLen > innerWidth - 4) {
			const maxTitleLen = innerWidth - 7; // Account for borders and ellipsis
			titleText = ` ${title.slice(0, Math.max(0, maxTitleLen))}... `;
			titleLen = visibleWidth(titleText);
		}

		const borderLen = Math.max(0, innerWidth - titleLen);
		const leftBorder = Math.floor(borderLen / 2);
		const rightBorder = borderLen - leftBorder;
		result.push(
			border(`╭${"─".repeat(leftBorder)}`) + theme.fg("accent", titleText) + border(`${"─".repeat(rightBorder)}╮`),
		);

		if (modelStr) {
			result.push(row(` ${theme.fg("dim", modelStr)}`));
		}

		result.push(separator());

		if (chatLines.length === 0) {
			result.push(emptyRow());
		} else {
			for (const line of chatLines) {
				result.push(row(` ${line}`));
			}
		}

		result.push(separator());
		result.push(emptyRow());

		for (const line of editorLines) {
			result.push(row(` ${line}`));
		}

		result.push(emptyRow());
		result.push(separator());

		for (const line of statusLines) {
			result.push(row(` ${line}`));
		}

		result.push(border(`╰${"─".repeat(innerWidth)}╯`));

		return result;
	}

	dispose(): void {
		this.close(true);
	}
}
