import type { AgentState } from "@mariozechner/pi-agent";
import type { AssistantMessage, Message } from "@mariozechner/pi-ai";
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

	constructor() {
		super();
		this.markdown = new Markdown("");
		this.addChild(this.markdown);
	}

	updateContent(message: Message | null) {
		if (!message) {
			this.markdown.setText("");
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
		}
	}
}

/**
 * Component that renders a tool call with its result
 */
class ToolExecutionComponent extends Container {
	private markdown: Markdown;

	constructor(toolName: string, args: any, result?: { output: string; isError: boolean }) {
		super();
		const bgColor = result
			? result.isError
				? { r: 60, g: 40, b: 40 }
				: { r: 40, g: 50, b: 40 }
			: { r: 40, g: 40, b: 50 };
		this.markdown = new Markdown(this.formatToolExecution(toolName, args, result), undefined, undefined, bgColor);
		this.addChild(this.markdown);
	}

	private formatToolExecution(toolName: string, args: any, result?: { output: string; isError: boolean }): string {
		let text = "";

		// Format based on tool type
		if (toolName === "bash") {
			const command = args.command || "";
			text = `**$ ${command}**`;
			if (result) {
				const lines = result.output.split("\n");
				const maxLines = 5;
				const displayLines = lines.slice(0, maxLines);
				const remaining = lines.length - maxLines;

				text += "\n```\n" + displayLines.join("\n");
				if (remaining > 0) {
					text += `\n... (${remaining} more lines)`;
				}
				text += "\n```";

				if (result.isError) {
					text += " ❌";
				}
			}
		} else if (toolName === "read") {
			const path = args.path || "";
			text = `**read** \`${path}\``;
			if (result) {
				const lines = result.output.split("\n");
				const maxLines = 5;
				const displayLines = lines.slice(0, maxLines);
				const remaining = lines.length - maxLines;

				text += "\n```\n" + displayLines.join("\n");
				if (remaining > 0) {
					text += `\n... (${remaining} more lines)`;
				}
				text += "\n```";

				if (result.isError) {
					text += " ❌";
				}
			}
		} else if (toolName === "write") {
			const path = args.path || "";
			const content = args.content || "";
			const lines = content.split("\n");
			text = `**write** \`${path}\` (${lines.length} lines)`;
			if (result) {
				text += result.isError ? " ❌" : " ✓";
			}
		} else if (toolName === "edit") {
			const path = args.path || "";
			text = `**edit** \`${path}\``;
			if (result) {
				text += result.isError ? " ❌" : " ✓";
			}
		} else {
			// Generic tool
			text = `**${toolName}**\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``;
			if (result) {
				text += `\n\`\`\`\n${result.output}\n\`\`\``;
				text += result.isError ? " ❌" : " ✓";
			}
		}

		return text;
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
	private isInitialized = false;
	private onInputCallback?: (text: string) => void;
	private loadingAnimation: Loader | null = null;
	private onInterruptCallback?: () => void;
	private lastSigintTime = 0;

	// Streaming message tracking
	private streamingComponent: StreamingMessageComponent | null = null;

	// Tool execution tracking: toolCallId -> { component, toolName, args }
	private pendingTools = new Map<string, { component: ToolExecutionComponent; toolName: string; args: any }>();

	constructor() {
		this.ui = new TUI(new ProcessTerminal());
		this.chatContainer = new Container();
		this.statusContainer = new Container();
		this.editor = new CustomEditor();

		// Setup autocomplete for file paths and slash commands
		const autocompleteProvider = new CombinedAutocompleteProvider([], process.cwd());
		this.editor.setAutocompleteProvider(autocompleteProvider);
	}

	async init(): Promise<void> {
		if (this.isInitialized) return;

		// Add header with instructions
		const header = new Text(
			">> coding-agent interactive <<\n" +
				"Press Escape to interrupt while processing\n" +
				"Press CTRL+C to clear the text editor\n" +
				"Press CTRL+C twice quickly to exit\n",
		);

		// Setup UI layout
		this.ui.addChild(header);
		this.ui.addChild(this.chatContainer);
		this.ui.addChild(this.statusContainer);
		this.ui.addChild(this.editor);
		this.ui.setFocus(this.editor);

		// Set up custom key handlers on the editor
		this.editor.onEscape = () => {
			// Intercept Escape key when processing
			if (this.loadingAnimation && this.onInterruptCallback) {
				this.onInterruptCallback();
			}
		};

		this.editor.onCtrlC = () => {
			// Handle Ctrl+C (raw mode sends \x03)
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
		};

		// Handle editor submission
		this.editor.onSubmit = (text: string) => {
			text = text.trim();
			if (!text) return;

			if (this.onInputCallback) {
				this.onInputCallback(text);
			}
		};

		// Start the UI
		this.ui.start();
		this.isInitialized = true;
	}

	async handleEvent(event: import("@mariozechner/pi-agent").AgentEvent, _state: AgentState): Promise<void> {
		if (!this.isInitialized) {
			await this.init();
		}

		switch (event.type) {
			case "agent_start":
				// Show loading animation
				this.editor.disableSubmit = true;
				// Stop old loader before clearing
				if (this.loadingAnimation) {
					this.loadingAnimation.stop();
				}
				this.statusContainer.clear();
				this.loadingAnimation = new Loader(this.ui, "Working...");
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
				// Create tool execution component and add it
				const component = new ToolExecutionComponent(event.toolName, event.args);
				this.chatContainer.addChild(component);
				this.pendingTools.set(event.toolCallId, { component, toolName: event.toolName, args: event.args });
				this.ui.requestRender();
				break;
			}

			case "tool_execution_end": {
				// Update the existing tool component with the result
				const pending = this.pendingTools.get(event.toolCallId);
				if (pending) {
					// Re-render the component with result
					this.chatContainer.removeChild(pending.component);
					const updatedComponent = new ToolExecutionComponent(pending.toolName, pending.args, {
						output: typeof event.result === "string" ? event.result : event.result.output,
						isError: event.isError,
					});
					this.chatContainer.addChild(updatedComponent);
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
		}
		// Note: tool calls and results are now handled via tool_execution_start/end events
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

	clearEditor(): void {
		this.editor.setText("");
		this.statusContainer.clear();
		const hint = new Text("Press Ctrl+C again to exit");
		this.statusContainer.addChild(hint);
		this.ui.requestRender();

		setTimeout(() => {
			this.statusContainer.clear();
			this.ui.requestRender();
		}, 500);
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
