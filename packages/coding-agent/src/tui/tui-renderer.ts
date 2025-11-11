import type { Agent, AgentEvent, AgentState } from "@mariozechner/pi-agent";
import type { AssistantMessage, Message } from "@mariozechner/pi-ai";
import type { SlashCommand } from "@mariozechner/pi-tui";
import { CombinedAutocompleteProvider, Container, Loader, ProcessTerminal, Text, TUI } from "@mariozechner/pi-tui";
import chalk from "chalk";
import { AssistantMessageComponent } from "./assistant-message.js";
import { CustomEditor } from "./custom-editor.js";
import { FooterComponent } from "./footer.js";
import { ThinkingSelectorComponent } from "./thinking-selector.js";
import { ToolExecutionComponent } from "./tool-execution.js";
import { UserMessageComponent } from "./user-message.js";

/**
 * TUI renderer for the coding agent
 */
export class TuiRenderer {
	private ui: TUI;
	private chatContainer: Container;
	private statusContainer: Container;
	private editor: CustomEditor;
	private editorContainer: Container; // Container to swap between editor and selector
	private footer: FooterComponent;
	private agent: Agent;
	private version: string;
	private isInitialized = false;
	private onInputCallback?: (text: string) => void;
	private loadingAnimation: Loader | null = null;
	private onInterruptCallback?: () => void;
	private lastSigintTime = 0;

	// Streaming message tracking
	private streamingComponent: AssistantMessageComponent | null = null;

	// Tool execution tracking: toolCallId -> component
	private pendingTools = new Map<string, ToolExecutionComponent>();

	// Track assistant message with tool calls that needs stats shown after tools complete
	private deferredStats: { component: AssistantMessageComponent; usage: any; toolCallIds: Set<string> } | null = null;

	// Thinking level selector
	private thinkingSelector: ThinkingSelectorComponent | null = null;

	// Track if this is the first user message (to skip spacer)
	private isFirstUserMessage = true;

	constructor(agent: Agent, version: string) {
		this.agent = agent;
		this.version = version;
		this.ui = new TUI(new ProcessTerminal());
		this.chatContainer = new Container();
		this.statusContainer = new Container();
		this.editor = new CustomEditor();
		this.editorContainer = new Container(); // Container to hold editor or selector
		this.editorContainer.addChild(this.editor); // Start with editor
		this.footer = new FooterComponent(agent.state);

		// Define slash commands
		const thinkingCommand: SlashCommand = {
			name: "thinking",
			description: "Select reasoning level (opens selector UI)",
		};

		// Setup autocomplete for file paths and slash commands
		const autocompleteProvider = new CombinedAutocompleteProvider([thinkingCommand], process.cwd());
		this.editor.setAutocompleteProvider(autocompleteProvider);
	}

	async init(): Promise<void> {
		if (this.isInitialized) return;

		// Add header with logo and instructions
		const logo = chalk.bold.cyan("pi") + chalk.dim(` v${this.version}`);
		const instructions =
			chalk.dim("esc") +
			chalk.gray(" to interrupt") +
			"\n" +
			chalk.dim("ctrl+c") +
			chalk.gray(" to clear") +
			"\n" +
			chalk.dim("ctrl+c twice") +
			chalk.gray(" to exit") +
			"\n" +
			chalk.dim("ctrl+k") +
			chalk.gray(" to delete line") +
			"\n" +
			chalk.dim("/") +
			chalk.gray(" for commands") +
			"\n" +
			chalk.dim("drop files") +
			chalk.gray(" to attach");
		const header = new Text(logo + "\n" + instructions);

		// Setup UI layout
		this.ui.addChild(header);
		this.ui.addChild(this.chatContainer);
		this.ui.addChild(this.statusContainer);
		this.ui.addChild(this.editorContainer); // Use container that can hold editor or selector
		this.ui.addChild(this.footer);
		this.ui.setFocus(this.editor);

		// Set up custom key handlers on the editor
		this.editor.onEscape = () => {
			// Intercept Escape key when processing
			if (this.loadingAnimation && this.onInterruptCallback) {
				this.onInterruptCallback();
			}
		};

		this.editor.onCtrlC = () => {
			this.handleCtrlC();
		};

		// Handle editor submission
		this.editor.onSubmit = (text: string) => {
			text = text.trim();
			if (!text) return;

			// Check for /thinking command
			if (text === "/thinking") {
				// Show thinking level selector
				this.showThinkingSelector();
				this.editor.setText("");
				return;
			}

			if (this.onInputCallback) {
				this.onInputCallback(text);
			}
		};

		// Start the UI
		this.ui.start();
		this.isInitialized = true;
	}

	async handleEvent(event: AgentEvent, state: AgentState): Promise<void> {
		if (!this.isInitialized) {
			await this.init();
		}

		// Update footer with current stats
		this.footer.updateState(state);

		switch (event.type) {
			case "agent_start":
				// Show loading animation
				this.editor.disableSubmit = true;
				// Stop old loader before clearing
				if (this.loadingAnimation) {
					this.loadingAnimation.stop();
				}
				this.statusContainer.clear();
				this.loadingAnimation = new Loader(this.ui, "Working... (esc to interrupt)");
				this.statusContainer.addChild(this.loadingAnimation);
				this.ui.requestRender();
				break;

			case "message_start":
				if (event.message.role === "user") {
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
					this.streamingComponent.updateContent(event.message as AssistantMessage);
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

					// Check if this message has tool calls
					const hasToolCalls = assistantMsg.content.some((c) => c.type === "toolCall");

					if (hasToolCalls) {
						// Defer stats until after tool executions complete
						const toolCallIds = new Set<string>();
						for (const content of assistantMsg.content) {
							if (content.type === "toolCall") {
								toolCallIds.add(content.id);
							}
						}
						this.deferredStats = { component: this.streamingComponent, usage: assistantMsg.usage, toolCallIds };
						// Hide stats for now
						this.streamingComponent.hideStats();
					}
					// Keep the streaming component - it's now the final assistant message
					this.streamingComponent = null;
				}
				this.ui.requestRender();
				break;

			case "tool_execution_start": {
				// Add empty line before tool execution
				this.chatContainer.addChild(new Text("", 0, 0));
				// Create tool execution component and add it
				const component = new ToolExecutionComponent(event.toolName, event.args);
				this.chatContainer.addChild(component);
				this.pendingTools.set(event.toolCallId, component);
				this.ui.requestRender();
				break;
			}

			case "tool_execution_end": {
				// Update the existing tool component with the result
				const component = this.pendingTools.get(event.toolCallId);
				if (component) {
					// Update the component with the result
					component.updateResult({
						output: typeof event.result === "string" ? event.result : event.result.output,
						isError: event.isError,
					});
					this.pendingTools.delete(event.toolCallId);

					// Check if this was part of deferred stats and all tools are complete
					if (this.deferredStats) {
						this.deferredStats.toolCallIds.delete(event.toolCallId);
						if (this.deferredStats.toolCallIds.size === 0) {
							// All tools complete - show stats now on the component
							this.deferredStats.component.updateStats(this.deferredStats.usage);
							this.deferredStats = null;
						}
					}

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
				this.deferredStats = null; // Clear any deferred stats
				this.editor.disableSubmit = false;
				this.ui.requestRender();
				break;
		}
	}

	private addMessageToChat(message: Message): void {
		if (message.role === "user") {
			const userMsg = message as any;
			// Extract text content from content blocks
			const textBlocks = userMsg.content.filter((c: any) => c.type === "text");
			const textContent = textBlocks.map((c: any) => c.text).join("");
			if (textContent) {
				const userComponent = new UserMessageComponent(textContent, this.isFirstUserMessage);
				this.chatContainer.addChild(userComponent);
				this.isFirstUserMessage = false;
			}
		} else if (message.role === "assistant") {
			const assistantMsg = message as AssistantMessage;

			// Add assistant message component
			const assistantComponent = new AssistantMessageComponent(assistantMsg);
			this.chatContainer.addChild(assistantComponent);

			// Check if this message has tool calls
			const hasToolCalls = assistantMsg.content.some((c) => c.type === "toolCall");

			if (hasToolCalls) {
				// Defer stats until after tool executions complete
				const toolCallIds = new Set<string>();
				for (const content of assistantMsg.content) {
					if (content.type === "toolCall") {
						toolCallIds.add(content.id);
					}
				}
				this.deferredStats = { component: assistantComponent, usage: assistantMsg.usage, toolCallIds };
				// Hide stats for now
				assistantComponent.hideStats();
			}
			// else: stats are shown by the component constructor
		}
		// Note: tool calls and results are now handled via tool_execution_start/end events
	}

	renderInitialMessages(state: AgentState): void {
		// Render all existing messages (for --continue mode)
		// Track assistant components with their tool calls to show stats after tools
		const assistantWithTools = new Map<
			number,
			{
				component: AssistantMessageComponent;
				usage: any;
				toolCallIds: Set<string>;
				remainingToolCallIds: Set<string>;
			}
		>();

		// Reset first user message flag for initial render
		this.isFirstUserMessage = true;

		// Render messages
		for (let i = 0; i < state.messages.length; i++) {
			const message = state.messages[i];

			if (message.role === "user") {
				const userMsg = message as any;
				const textBlocks = userMsg.content.filter((c: any) => c.type === "text");
				const textContent = textBlocks.map((c: any) => c.text).join("");
				if (textContent) {
					const userComponent = new UserMessageComponent(textContent, this.isFirstUserMessage);
					this.chatContainer.addChild(userComponent);
					this.isFirstUserMessage = false;
				}
			} else if (message.role === "assistant") {
				const assistantMsg = message as AssistantMessage;
				const assistantComponent = new AssistantMessageComponent(assistantMsg);
				this.chatContainer.addChild(assistantComponent);

				// Check if this message has tool calls
				const toolCallIds = new Set<string>();
				for (const content of assistantMsg.content) {
					if (content.type === "toolCall") {
						toolCallIds.add(content.id);
					}
				}
				if (toolCallIds.size > 0) {
					// Hide stats until tools complete
					assistantComponent.hideStats();
					assistantWithTools.set(i, {
						component: assistantComponent,
						usage: assistantMsg.usage,
						toolCallIds,
						remainingToolCallIds: new Set(toolCallIds),
					});
				}
			} else if (message.role === "toolResult") {
				// Render tool calls that have already completed
				const toolResultMsg = message as any;
				const assistantMsgIndex = state.messages.findIndex(
					(m) =>
						m.role === "assistant" &&
						m.content.some((c: any) => c.type === "toolCall" && c.id === toolResultMsg.toolCallId),
				);

				if (assistantMsgIndex !== -1) {
					const assistantMsg = state.messages[assistantMsgIndex] as AssistantMessage;
					const toolCall = assistantMsg.content.find(
						(c) => c.type === "toolCall" && c.id === toolResultMsg.toolCallId,
					) as any;
					if (toolCall) {
						// Add empty line before tool execution
						this.chatContainer.addChild(new Text("", 0, 0));
						const component = new ToolExecutionComponent(toolCall.name, toolCall.arguments);
						component.updateResult({
							output: toolResultMsg.output,
							isError: toolResultMsg.isError,
						});
						this.chatContainer.addChild(component);

						// Check if this was the last tool call for this assistant message
						const assistantData = assistantWithTools.get(assistantMsgIndex);
						if (assistantData) {
							assistantData.remainingToolCallIds.delete(toolResultMsg.toolCallId);
							if (assistantData.remainingToolCallIds.size === 0) {
								// All tools for this assistant message are complete - show stats
								assistantData.component.updateStats(assistantData.usage);
							}
						}
					}
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

	setInterruptCallback(callback: () => void): void {
		this.onInterruptCallback = callback;
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

	clearEditor(): void {
		this.editor.setText("");
		this.statusContainer.clear();
		this.ui.requestRender();
	}

	private showThinkingSelector(): void {
		// Create thinking selector with current level
		this.thinkingSelector = new ThinkingSelectorComponent(
			this.agent.state.thinkingLevel,
			(level) => {
				// Apply the selected thinking level
				this.agent.setThinkingLevel(level);

				// Show confirmation message with padding and blue color
				this.chatContainer.addChild(new Text("", 0, 0)); // Blank line before
				const confirmText = new Text(chalk.blue(`Thinking level set to: ${level}`), 0, 0);
				this.chatContainer.addChild(confirmText);
				this.chatContainer.addChild(new Text("", 0, 0)); // Blank line after

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

	stop(): void {
		if (this.loadingAnimation) {
			this.loadingAnimation.stop();
			this.loadingAnimation = null;
		}
		if (this.isInitialized) {
			this.ui.stop();
			this.isInitialized = false;
		}
	}
}
