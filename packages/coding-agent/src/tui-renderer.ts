import type { Agent, AgentState, ThinkingLevel } from "@mariozechner/pi-agent";
import type { AssistantMessage, Message } from "@mariozechner/pi-ai";
import type { SlashCommand } from "@mariozechner/pi-tui";
import {
	CombinedAutocompleteProvider,
	Container,
	Editor,
	Loader,
	Markdown,
	ProcessTerminal,
	Text,
	TUI,
} from "@mariozechner/pi-tui";
import chalk from "chalk";

/**
 * Custom editor that handles Escape and Ctrl+C keys for coding-agent
 */
class CustomEditor extends Editor {
	public onEscape?: () => void;
	public onCtrlC?: () => void;

	handleInput(data: string): void {
		// Intercept Escape key
		if (data === "\x1b" && this.onEscape) {
			this.onEscape();
			return;
		}

		// Intercept Ctrl+C
		if (data === "\x03" && this.onCtrlC) {
			this.onCtrlC();
			return;
		}

		// Pass to parent for normal handling
		super.handleInput(data);
	}
}

/**
 * Component that renders a streaming message with live updates
 */
class StreamingMessageComponent extends Container {
	private markdown: Markdown;
	private statsText: Text;

	constructor() {
		super();
		this.markdown = new Markdown("");
		this.statsText = new Text("", 1, 0);
		this.addChild(this.markdown);
		this.addChild(this.statsText);
	}

	updateContent(message: Message | null) {
		if (!message) {
			this.markdown.setText("");
			this.statsText.setText("");
			return;
		}

		if (message.role === "assistant") {
			const assistantMsg = message as AssistantMessage;

			// Update text content
			const textContent = assistantMsg.content
				.filter((c) => c.type === "text")
				.map((c) => c.text)
				.join("");

			this.markdown.setText(textContent);

			// Update usage stats
			const usage = assistantMsg.usage;
			if (usage) {
				// Format token counts (similar to web-ui)
				const formatTokens = (count: number): string => {
					if (count < 1000) return count.toString();
					if (count < 10000) return (count / 1000).toFixed(1) + "k";
					return Math.round(count / 1000) + "k";
				};

				const statsParts = [];
				if (usage.input) statsParts.push(`↑${formatTokens(usage.input)}`);
				if (usage.output) statsParts.push(`↓${formatTokens(usage.output)}`);
				if (usage.cacheRead) statsParts.push(`R${formatTokens(usage.cacheRead)}`);
				if (usage.cacheWrite) statsParts.push(`W${formatTokens(usage.cacheWrite)}`);
				if (usage.cost?.total) statsParts.push(`$${usage.cost.total.toFixed(3)}`);

				this.statsText.setText(chalk.dim(statsParts.join(" ")));
			} else {
				this.statsText.setText("");
			}
		}
	}
}

/**
 * Component that renders a tool call with its result (updateable)
 */
class ToolExecutionComponent extends Container {
	private markdown: Markdown;
	private toolName: string;
	private args: any;
	private result?: { output: string; isError: boolean };

	constructor(toolName: string, args: any) {
		super();
		this.toolName = toolName;
		this.args = args;
		this.markdown = new Markdown("", undefined, undefined, { r: 40, g: 40, b: 50 });
		this.addChild(this.markdown);
		this.updateDisplay();
	}

	updateResult(result: { output: string; isError: boolean }): void {
		this.result = result;
		this.updateDisplay();
	}

	private updateDisplay(): void {
		const bgColor = this.result
			? this.result.isError
				? { r: 60, g: 40, b: 40 }
				: { r: 40, g: 50, b: 40 }
			: { r: 40, g: 40, b: 50 };
		this.markdown.setCustomBgRgb(bgColor);
		this.markdown.setText(this.formatToolExecution());
	}

	private formatToolExecution(): string {
		let text = "";

		// Format based on tool type
		if (this.toolName === "bash") {
			const command = this.args.command || "";
			text = `**$ ${command}**`;
			if (this.result) {
				const lines = this.result.output.split("\n");
				const maxLines = 5;
				const displayLines = lines.slice(0, maxLines);
				const remaining = lines.length - maxLines;

				text += "\n```\n" + displayLines.join("\n");
				if (remaining > 0) {
					text += `\n... (${remaining} more lines)`;
				}
				text += "\n```";

				if (this.result.isError) {
					text += " ❌";
				}
			}
		} else if (this.toolName === "read") {
			const path = this.args.path || "";
			text = `**read** \`${path}\``;
			if (this.result) {
				const lines = this.result.output.split("\n");
				const maxLines = 5;
				const displayLines = lines.slice(0, maxLines);
				const remaining = lines.length - maxLines;

				text += "\n```\n" + displayLines.join("\n");
				if (remaining > 0) {
					text += `\n... (${remaining} more lines)`;
				}
				text += "\n```";

				if (this.result.isError) {
					text += " ❌";
				}
			}
		} else if (this.toolName === "write") {
			const path = this.args.path || "";
			const content = this.args.content || "";
			const lines = content.split("\n");
			text = `**write** \`${path}\` (${lines.length} lines)`;
			if (this.result) {
				text += this.result.isError ? " ❌" : " ✓";
			}
		} else if (this.toolName === "edit") {
			const path = this.args.path || "";
			text = `**edit** \`${path}\``;
			if (this.result) {
				text += this.result.isError ? " ❌" : " ✓";
			}
		} else {
			// Generic tool
			text = `**${this.toolName}**\n\`\`\`json\n${JSON.stringify(this.args, null, 2)}\n\`\`\``;
			if (this.result) {
				text += `\n\`\`\`\n${this.result.output}\n\`\`\``;
				text += this.result.isError ? " ❌" : " ✓";
			}
		}

		return text;
	}
}

/**
 * Footer component that shows pwd, token stats, and context usage
 */
class FooterComponent {
	private state: AgentState;

	constructor(state: AgentState) {
		this.state = state;
	}

	updateState(state: AgentState): void {
		this.state = state;
	}

	render(width: number): string[] {
		// Calculate cumulative usage from all assistant messages
		let totalInput = 0;
		let totalOutput = 0;
		let totalCacheRead = 0;
		let totalCacheWrite = 0;
		let totalCost = 0;

		for (const message of this.state.messages) {
			if (message.role === "assistant") {
				const assistantMsg = message as AssistantMessage;
				totalInput += assistantMsg.usage.input;
				totalOutput += assistantMsg.usage.output;
				totalCacheRead += assistantMsg.usage.cacheRead;
				totalCacheWrite += assistantMsg.usage.cacheWrite;
				totalCost += assistantMsg.usage.cost.total;
			}
		}

		// Calculate total tokens and % of context window
		const totalTokens = totalInput + totalOutput;
		const contextWindow = this.state.model.contextWindow;
		const contextPercent = contextWindow > 0 ? ((totalTokens / contextWindow) * 100).toFixed(1) : "0.0";

		// Format token counts (similar to web-ui)
		const formatTokens = (count: number): string => {
			if (count < 1000) return count.toString();
			if (count < 10000) return (count / 1000).toFixed(1) + "k";
			return Math.round(count / 1000) + "k";
		};

		// Replace home directory with ~
		let pwd = process.cwd();
		const home = process.env.HOME || process.env.USERPROFILE;
		if (home && pwd.startsWith(home)) {
			pwd = "~" + pwd.slice(home.length);
		}

		// Truncate path if too long to fit width
		const maxPathLength = Math.max(20, width - 10); // Leave some margin
		if (pwd.length > maxPathLength) {
			const start = pwd.slice(0, Math.floor(maxPathLength / 2) - 2);
			const end = pwd.slice(-(Math.floor(maxPathLength / 2) - 1));
			pwd = `${start}...${end}`;
		}

		// Build stats line
		const statsParts = [];
		if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
		if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
		if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
		if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);
		if (totalCost) statsParts.push(`$${totalCost.toFixed(3)}`);
		statsParts.push(`${contextPercent}%`);

		const statsLine = statsParts.join(" ");

		// Return two lines: pwd and stats
		return [chalk.dim(pwd), chalk.dim(statsLine)];
	}
}

/**
 * TUI renderer for the coding agent
 */
export class TuiRenderer {
	private ui: TUI;
	private chatContainer: Container;
	private statusContainer: Container;
	private editor: CustomEditor;
	private footer: FooterComponent;
	private agent: Agent;
	private isInitialized = false;
	private onInputCallback?: (text: string) => void;
	private loadingAnimation: Loader | null = null;
	private onInterruptCallback?: () => void;
	private lastSigintTime = 0;

	// Streaming message tracking
	private streamingComponent: StreamingMessageComponent | null = null;

	// Tool execution tracking: toolCallId -> component
	private pendingTools = new Map<string, ToolExecutionComponent>();

	// Track assistant message with tool calls that needs stats shown after tools complete
	private deferredStats: { usage: any; toolCallIds: Set<string> } | null = null;

	constructor(agent: Agent) {
		this.agent = agent;
		this.ui = new TUI(new ProcessTerminal());
		this.chatContainer = new Container();
		this.statusContainer = new Container();
		this.editor = new CustomEditor();
		this.footer = new FooterComponent(agent.state);

		// Define slash commands
		const thinkingCommand: SlashCommand = {
			name: "thinking",
			description: "Set reasoning level (off, minimal, low, medium, high)",
			getArgumentCompletions: (argumentPrefix: string) => {
				const levels = ["off", "minimal", "low", "medium", "high"];
				return levels
					.filter((level) => level.toLowerCase().startsWith(argumentPrefix.toLowerCase()))
					.map((level) => ({
						value: level,
						label: level,
						description: `Set thinking level to ${level}`,
					}));
			},
		};

		// Setup autocomplete for file paths and slash commands
		const autocompleteProvider = new CombinedAutocompleteProvider([thinkingCommand], process.cwd());
		this.editor.setAutocompleteProvider(autocompleteProvider);
	}

	async init(): Promise<void> {
		if (this.isInitialized) return;

		// Add header with instructions
		const header = new Text(
			">> coding-agent interactive <<\n" +
				"Press Escape to interrupt while processing\n" +
				"Press CTRL+C twice quickly to exit\n",
		);

		// Setup UI layout
		this.ui.addChild(header);
		this.ui.addChild(this.chatContainer);
		this.ui.addChild(this.statusContainer);
		this.ui.addChild(this.editor);
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

			// Check for slash commands
			if (text.startsWith("/thinking ")) {
				const level = text.slice("/thinking ".length).trim() as ThinkingLevel;
				const validLevels: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high"];
				if (validLevels.includes(level)) {
					this.agent.setThinkingLevel(level);
					// Show confirmation message
					const confirmText = new Text(chalk.dim(`Thinking level set to: ${level}`), 1, 0);
					this.chatContainer.addChild(confirmText);
					this.ui.requestRender();
					this.editor.setText("");
					return;
				} else {
					// Show error message
					const errorText = new Text(
						chalk.red(`Invalid thinking level: ${level}. Use: off, minimal, low, medium, high`),
						1,
						0,
					);
					this.chatContainer.addChild(errorText);
					this.ui.requestRender();
					this.editor.setText("");
					return;
				}
			}

			if (this.onInputCallback) {
				this.onInputCallback(text);
			}
		};

		// Start the UI
		this.ui.start();
		this.isInitialized = true;
	}

	async handleEvent(event: import("@mariozechner/pi-agent").AgentEvent, state: AgentState): Promise<void> {
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
					// Create streaming component for assistant messages
					this.streamingComponent = new StreamingMessageComponent();
					this.chatContainer.addChild(this.streamingComponent);
					this.streamingComponent.updateContent(event.message);
					this.ui.requestRender();
				}
				break;

			case "message_update":
				// Update streaming component
				if (this.streamingComponent && event.message.role === "assistant") {
					this.streamingComponent.updateContent(event.message);
					this.ui.requestRender();
				}
				break;

			case "message_end":
				// Skip user messages (already shown in message_start)
				if (event.message.role === "user") {
					break;
				}
				if (this.streamingComponent && event.message.role === "assistant") {
					this.chatContainer.removeChild(this.streamingComponent);
					this.streamingComponent = null;
				}
				// Show final assistant message
				this.addMessageToChat(event.message);
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
					// Add empty line after tool execution
					this.chatContainer.addChild(new Text("", 0, 0));
					this.pendingTools.delete(event.toolCallId);

					// Check if this was part of deferred stats and all tools are complete
					if (this.deferredStats) {
						this.deferredStats.toolCallIds.delete(event.toolCallId);
						if (this.deferredStats.toolCallIds.size === 0) {
							// All tools complete - show stats now
							this.addStatsComponent(this.deferredStats.usage);
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
				// User messages with dark gray background
				this.chatContainer.addChild(new Markdown(textContent, undefined, undefined, { r: 52, g: 53, b: 65 }));
			}
		} else if (message.role === "assistant") {
			const assistantMsg = message as AssistantMessage;

			// Render text content first (tool calls handled by events)
			const textContent = assistantMsg.content
				.filter((c) => c.type === "text")
				.map((c) => c.text)
				.join("");
			if (textContent) {
				// Assistant messages with no background
				this.chatContainer.addChild(new Markdown(textContent));
			}

			// Check if aborted - show after partial content
			if (assistantMsg.stopReason === "aborted") {
				// Show red "Aborted" message after partial content
				const abortedText = new Text(chalk.red("Aborted"));
				this.chatContainer.addChild(abortedText);
				return;
			}

			if (assistantMsg.stopReason === "error") {
				// Show red error message after partial content
				const errorMsg = assistantMsg.errorMessage || "Unknown error";
				const errorText = new Text(chalk.red(`Error: ${errorMsg}`));
				this.chatContainer.addChild(errorText);
				return;
			}

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
				this.deferredStats = { usage: assistantMsg.usage, toolCallIds };
			} else {
				// No tool calls - show stats immediately
				this.addStatsComponent(assistantMsg.usage);
			}
		}
		// Note: tool calls and results are now handled via tool_execution_start/end events
	}

	private addStatsComponent(usage: any): void {
		if (!usage) return;

		// Format token counts (similar to web-ui)
		const formatTokens = (count: number): string => {
			if (count < 1000) return count.toString();
			if (count < 10000) return (count / 1000).toFixed(1) + "k";
			return Math.round(count / 1000) + "k";
		};

		const statsParts = [];
		if (usage.input) statsParts.push(`↑${formatTokens(usage.input)}`);
		if (usage.output) statsParts.push(`↓${formatTokens(usage.output)}`);
		if (usage.cacheRead) statsParts.push(`R${formatTokens(usage.cacheRead)}`);
		if (usage.cacheWrite) statsParts.push(`W${formatTokens(usage.cacheWrite)}`);
		if (usage.cost?.total) statsParts.push(`$${usage.cost.total.toFixed(3)}`);

		if (statsParts.length > 0) {
			const statsText = new Text(chalk.dim(statsParts.join(" ")), 1, 0);
			this.chatContainer.addChild(statsText);
			// Add empty line after stats
			this.chatContainer.addChild(new Text("", 0, 0));
		}
	}

	renderInitialMessages(state: AgentState): void {
		// Render all existing messages (for --continue mode)
		// Track assistant messages with their tool calls to show stats after tools
		const assistantWithTools = new Map<
			number,
			{ usage: any; toolCallIds: Set<string>; remainingToolCallIds: Set<string> }
		>();

		// First pass: identify assistant messages with tool calls
		for (let i = 0; i < state.messages.length; i++) {
			const message = state.messages[i];
			if (message.role === "assistant") {
				const assistantMsg = message as AssistantMessage;
				const toolCallIds = new Set<string>();
				for (const content of assistantMsg.content) {
					if (content.type === "toolCall") {
						toolCallIds.add(content.id);
					}
				}
				if (toolCallIds.size > 0) {
					assistantWithTools.set(i, {
						usage: assistantMsg.usage,
						toolCallIds,
						remainingToolCallIds: new Set(toolCallIds),
					});
				}
			}
		}

		// Second pass: render messages
		for (let i = 0; i < state.messages.length; i++) {
			const message = state.messages[i];

			if (message.role === "user" || message.role === "assistant") {
				// Temporarily disable deferred stats for initial render
				const savedDeferredStats = this.deferredStats;
				this.deferredStats = null;
				this.addMessageToChat(message);
				this.deferredStats = savedDeferredStats;
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
						// Add empty line after tool execution
						this.chatContainer.addChild(new Text("", 0, 0));

						// Check if this was the last tool call for this assistant message
						const assistantData = assistantWithTools.get(assistantMsgIndex);
						if (assistantData) {
							assistantData.remainingToolCallIds.delete(toolResultMsg.toolCallId);
							if (assistantData.remainingToolCallIds.size === 0) {
								// All tools for this assistant message are complete - show stats
								this.addStatsComponent(assistantData.usage);
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
