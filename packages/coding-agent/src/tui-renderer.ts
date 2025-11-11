import type { AgentState } from "@mariozechner/pi-agent";
import type { AssistantMessage, Message } from "@mariozechner/pi-ai";
import {
	CombinedAutocompleteProvider,
	Container,
	Editor,
	Loader,
	Markdown,
	ProcessTerminal,
	Spacer,
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
	private textComponent: Markdown | null = null;
	private toolCallsContainer: Container | null = null;
	private currentContent = "";
	private currentToolCalls: any[] = [];

	updateContent(message: Message | null) {
		if (!message) {
			this.clear();
			return;
		}

		if (message.role === "assistant") {
			const assistantMsg = message as AssistantMessage;

			// Update text content
			const textContent = assistantMsg.content
				.filter((c) => c.type === "text")
				.map((c) => c.text)
				.join("");
			if (textContent !== this.currentContent) {
				this.currentContent = textContent;
				if (this.textComponent) {
					this.removeChild(this.textComponent);
				}
				if (textContent) {
					this.textComponent = new Markdown(textContent);
					this.addChild(this.textComponent);
				}
			}

			// Update tool calls
			const toolCalls = assistantMsg.content.filter((c) => c.type === "toolCall");
			if (JSON.stringify(toolCalls) !== JSON.stringify(this.currentToolCalls)) {
				this.currentToolCalls = toolCalls;
				if (this.toolCallsContainer) {
					this.removeChild(this.toolCallsContainer);
				}
				if (toolCalls.length > 0) {
					this.toolCallsContainer = new Container();
					for (const toolCall of toolCalls) {
						const argsStr =
							typeof toolCall.arguments === "string" ? toolCall.arguments : JSON.stringify(toolCall.arguments);
						this.toolCallsContainer.addChild(new Text(chalk.yellow(`[tool] ${toolCall.name}(${argsStr})`)));
					}
					this.addChild(this.toolCallsContainer);
				}
			}
		}
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

	// Message tracking
	private lastStableMessageCount = 0;
	private streamingComponent: StreamingMessageComponent | null = null;

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
			chalk.blueBright(">> coding-agent interactive <<") +
				"\n" +
				chalk.dim("Press Escape to interrupt while processing") +
				"\n" +
				chalk.dim("Press CTRL+C to clear the text editor") +
				"\n" +
				chalk.dim("Press CTRL+C twice quickly to exit"),
		);

		// Setup UI layout
		this.ui.addChild(header);
		this.ui.addChild(this.chatContainer);
		this.ui.addChild(this.statusContainer);
		this.ui.addChild(new Spacer(1));
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

	async handleStateUpdate(state: AgentState): Promise<void> {
		if (!this.isInitialized) {
			await this.init();
		}

		// Count stable messages (exclude the streaming one if streaming)
		const stableMessageCount = state.isStreaming ? state.messages.length - 1 : state.messages.length;

		// Add any NEW stable messages
		if (stableMessageCount > this.lastStableMessageCount) {
			for (let i = this.lastStableMessageCount; i < stableMessageCount; i++) {
				const message = state.messages[i];
				this.addMessageToChat(message);
			}
			this.lastStableMessageCount = stableMessageCount;
		}

		// Handle streaming message
		if (state.isStreaming) {
			const streamingMessage = state.messages[state.messages.length - 1];

			// Show loading animation if we just started streaming
			if (!this.loadingAnimation) {
				this.editor.disableSubmit = true;
				this.statusContainer.clear();
				this.loadingAnimation = new Loader(this.ui);
				this.statusContainer.addChild(this.loadingAnimation);
			}

			// Create or update streaming component
			if (!this.streamingComponent) {
				this.streamingComponent = new StreamingMessageComponent();
				this.chatContainer.addChild(this.streamingComponent);
			}
			this.streamingComponent.updateContent(streamingMessage);
		} else {
			// Streaming stopped
			if (this.loadingAnimation) {
				this.loadingAnimation.stop();
				this.loadingAnimation = null;
				this.statusContainer.clear();
			}

			if (this.streamingComponent) {
				this.chatContainer.removeChild(this.streamingComponent);
				this.streamingComponent = null;
			}

			this.editor.disableSubmit = false;
		}

		this.ui.requestRender();
	}

	private addMessageToChat(message: Message): void {
		if (message.role === "user") {
			this.chatContainer.addChild(new Text(chalk.green("[user]")));
			const userMsg = message as any;
			const textContent = userMsg.content?.map((c: any) => c.text || "").join("") || message.content || "";
			this.chatContainer.addChild(new Text(textContent));
			this.chatContainer.addChild(new Spacer(1));
		} else if (message.role === "assistant") {
			this.chatContainer.addChild(new Text(chalk.hex("#FFA500")("[assistant]")));
			const assistantMsg = message as AssistantMessage;

			// Render text content
			const textContent = assistantMsg.content
				.filter((c) => c.type === "text")
				.map((c) => c.text)
				.join("");
			if (textContent) {
				this.chatContainer.addChild(new Markdown(textContent));
			}

			// Render tool calls
			const toolCalls = assistantMsg.content.filter((c) => c.type === "toolCall");
			for (const toolCall of toolCalls) {
				const argsStr =
					typeof toolCall.arguments === "string" ? toolCall.arguments : JSON.stringify(toolCall.arguments);
				this.chatContainer.addChild(new Text(chalk.yellow(`[tool] ${toolCall.name}(${argsStr})`)));
			}

			this.chatContainer.addChild(new Spacer(1));
		} else if (message.role === "toolResult") {
			const toolResultMsg = message as any;
			const output = toolResultMsg.result?.output || toolResultMsg.result || "";

			// Truncate long outputs
			const lines = output.split("\n");
			const maxLines = 10;
			const truncated = lines.length > maxLines;
			const toShow = truncated ? lines.slice(0, maxLines) : lines;

			for (const line of toShow) {
				this.chatContainer.addChild(new Text(chalk.gray(line)));
			}

			if (truncated) {
				this.chatContainer.addChild(new Text(chalk.dim(`... (${lines.length - maxLines} more lines)`)));
			}
			this.chatContainer.addChild(new Spacer(1));
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

	setInterruptCallback(callback: () => void): void {
		this.onInterruptCallback = callback;
	}

	clearEditor(): void {
		this.editor.setText("");
		this.statusContainer.clear();
		const hint = new Text(chalk.dim("Press Ctrl+C again to exit"));
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
