import {
	CombinedAutocompleteProvider,
	Container,
	MarkdownComponent,
	TextComponent,
	TextEditor,
	TUI,
	WhitespaceComponent,
} from "@mariozechner/pi-tui";
import chalk from "chalk";
import type { AgentEvent, AgentEventReceiver } from "../agent.js";

class LoadingAnimation extends TextComponent {
	private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	private currentFrame = 0;
	private intervalId: NodeJS.Timeout | null = null;
	private ui: TUI | null = null;

	constructor(ui: TUI) {
		super("", { bottom: 1 });
		this.ui = ui;
		this.start();
	}

	start() {
		this.updateDisplay();
		this.intervalId = setInterval(() => {
			this.currentFrame = (this.currentFrame + 1) % this.frames.length;
			this.updateDisplay();
		}, 80);
	}

	stop() {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	private updateDisplay() {
		const frame = this.frames[this.currentFrame];
		this.setText(`${chalk.cyan(frame)} ${chalk.dim("Thinking...")}`);
		if (this.ui) {
			this.ui.requestRender();
		}
	}
}

export class TuiRenderer implements AgentEventReceiver {
	private ui: TUI;
	private chatContainer: Container;
	private statusContainer: Container;
	private editor: TextEditor;
	private tokenContainer: Container;
	private isInitialized = false;
	private onInputCallback?: (text: string) => void;
	private currentLoadingAnimation: LoadingAnimation | null = null;
	private onInterruptCallback?: () => void;
	private lastSigintTime = 0;
	private lastInputTokens = 0;
	private lastOutputTokens = 0;
	private lastCacheReadTokens = 0;
	private lastCacheWriteTokens = 0;
	private tokenStatusComponent: TextComponent | null = null;

	constructor() {
		this.ui = new TUI();
		this.chatContainer = new Container();
		this.statusContainer = new Container();
		this.editor = new TextEditor();
		this.tokenContainer = new Container();

		// Setup autocomplete for file paths and slash commands
		const autocompleteProvider = new CombinedAutocompleteProvider(
			[],
			process.cwd(), // Base directory for file path completion
		);
		this.editor.setAutocompleteProvider(autocompleteProvider);
	}

	async init(): Promise<void> {
		if (this.isInitialized) return;

		// Add header with instructions
		const header = new TextComponent(
			chalk.gray(chalk.blueBright(">> pi interactive chat <<<")) +
				"\n" +
				chalk.dim("Press Escape to interrupt while processing") +
				"\n" +
				chalk.dim("Press CTRL+C to clear the text editor") +
				"\n" +
				chalk.dim("Press CTRL+C twice quickly to exit"),
			{ bottom: 1 },
		);

		// Setup UI layout
		this.ui.addChild(header);
		this.ui.addChild(this.chatContainer);
		this.ui.addChild(this.statusContainer);
		this.ui.addChild(new WhitespaceComponent(1));
		this.ui.addChild(this.editor);
		this.ui.addChild(this.tokenContainer);
		this.ui.setFocus(this.editor);

		// Set up global key handler for Escape and Ctrl+C
		this.ui.onGlobalKeyPress = (data: string): boolean => {
			// Intercept Escape key when processing
			if (data === "\x1b" && this.currentLoadingAnimation) {
				// Call interrupt callback if set
				if (this.onInterruptCallback) {
					this.onInterruptCallback();
				}

				// Stop the loading animation immediately
				if (this.currentLoadingAnimation) {
					this.currentLoadingAnimation.stop();
					this.statusContainer.clear();
					this.currentLoadingAnimation = null;
				}

				// Don't show message here - the interrupted event will handle it

				// Re-enable editor submission
				this.editor.disableSubmit = false;

				this.ui.requestRender();

				// Don't forward to editor
				return false;
			}

			// Handle Ctrl+C (raw mode sends \x03)
			if (data === "\x03") {
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

				// Don't forward to editor
				return false;
			}

			// Forward all other keys
			return true;
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
		await this.ui.start();
		this.isInitialized = true;
	}

	async on(event: AgentEvent): Promise<void> {
		// Ensure UI is initialized
		if (!this.isInitialized) {
			await this.init();
		}

		switch (event.type) {
			case "assistant_start":
				this.chatContainer.addChild(new TextComponent(chalk.hex("#FFA500")("[assistant]")));
				// Disable editor submission while processing
				this.editor.disableSubmit = true;
				// Start loading animation in the status container
				this.statusContainer.clear();
				this.currentLoadingAnimation = new LoadingAnimation(this.ui);
				this.statusContainer.addChild(this.currentLoadingAnimation);
				break;

			case "thinking": {
				// Show thinking in dim text
				const thinkingContainer = new Container();
				thinkingContainer.addChild(new TextComponent(chalk.dim("[thinking]")));

				// Split thinking text into lines for better display
				const thinkingLines = event.text.split("\n");
				for (const line of thinkingLines) {
					thinkingContainer.addChild(new TextComponent(chalk.dim(line)));
				}
				thinkingContainer.addChild(new WhitespaceComponent(1));
				this.chatContainer.addChild(thinkingContainer);
				break;
			}

			case "tool_call":
				this.chatContainer.addChild(new TextComponent(chalk.yellow(`[tool] ${event.name}(${event.args})`)));
				break;

			case "tool_result": {
				// Show tool result with truncation
				const lines = event.result.split("\n");
				const maxLines = 10;
				const truncated = lines.length > maxLines;
				const toShow = truncated ? lines.slice(0, maxLines) : lines;

				const resultContainer = new Container();
				for (const line of toShow) {
					resultContainer.addChild(new TextComponent(event.isError ? chalk.red(line) : chalk.gray(line)));
				}

				if (truncated) {
					resultContainer.addChild(new TextComponent(chalk.dim(`... (${lines.length - maxLines} more lines)`)));
				}
				resultContainer.addChild(new WhitespaceComponent(1));
				this.chatContainer.addChild(resultContainer);
				break;
			}

			case "assistant_message":
				// Stop loading animation when assistant responds
				if (this.currentLoadingAnimation) {
					this.currentLoadingAnimation.stop();
					this.currentLoadingAnimation = null;
					this.statusContainer.clear();
				}
				// Re-enable editor submission
				this.editor.disableSubmit = false;
				// Use MarkdownComponent for rich formatting
				this.chatContainer.addChild(new MarkdownComponent(event.text));
				this.chatContainer.addChild(new WhitespaceComponent(1));
				break;

			case "error":
				// Stop loading animation on error
				if (this.currentLoadingAnimation) {
					this.currentLoadingAnimation.stop();
					this.currentLoadingAnimation = null;
					this.statusContainer.clear();
				}
				// Re-enable editor submission
				this.editor.disableSubmit = false;
				this.chatContainer.addChild(new TextComponent(chalk.red(`[error] ${event.message}`), { bottom: 1 }));
				break;

			case "user_message":
				// Render user message
				this.chatContainer.addChild(new TextComponent(chalk.green("[user]")));
				this.chatContainer.addChild(new TextComponent(event.text, { bottom: 1 }));
				break;

			case "token_usage":
				// Store the latest token counts (not cumulative since prompt includes full context)
				this.lastInputTokens = event.inputTokens;
				this.lastOutputTokens = event.outputTokens;
				this.lastCacheReadTokens = event.cacheReadTokens;
				this.lastCacheWriteTokens = event.cacheWriteTokens;
				this.updateTokenDisplay();
				break;

			case "interrupted":
				// Stop the loading animation
				if (this.currentLoadingAnimation) {
					this.currentLoadingAnimation.stop();
					this.currentLoadingAnimation = null;
					this.statusContainer.clear();
				}
				// Show interrupted message
				this.chatContainer.addChild(new TextComponent(chalk.red("[Interrupted by user]"), { bottom: 1 }));
				// Re-enable editor submission
				this.editor.disableSubmit = false;
				break;
		}

		this.ui.requestRender();
	}

	private updateTokenDisplay(): void {
		// Clear and update token display
		this.tokenContainer.clear();

		// Build token display text
		let tokenText = chalk.dim(`↑${this.lastInputTokens.toLocaleString()} ↓${this.lastOutputTokens.toLocaleString()}`);

		// Add cache info if available
		if (this.lastCacheReadTokens > 0 || this.lastCacheWriteTokens > 0) {
			const cacheText: string[] = [];
			if (this.lastCacheReadTokens > 0) {
				cacheText.push(`⟲${this.lastCacheReadTokens.toLocaleString()}`);
			}
			if (this.lastCacheWriteTokens > 0) {
				cacheText.push(`⟳${this.lastCacheWriteTokens.toLocaleString()}`);
			}
			tokenText += chalk.dim(` (${cacheText.join(" ")})`);
		}

		this.tokenStatusComponent = new TextComponent(tokenText);
		this.tokenContainer.addChild(this.tokenStatusComponent);
	}

	async getUserInput(): Promise<string> {
		return new Promise((resolve) => {
			this.onInputCallback = (text: string) => {
				this.onInputCallback = undefined; // Clear callback
				resolve(text);
			};
		});
	}

	setInterruptCallback(callback: () => void): void {
		this.onInterruptCallback = callback;
	}

	clearEditor(): void {
		this.editor.setText("");

		// Show hint in status container
		this.statusContainer.clear();
		const hint = new TextComponent(chalk.dim("Press Ctrl+C again to exit"));
		this.statusContainer.addChild(hint);
		this.ui.requestRender();

		// Clear the hint after 500ms
		setTimeout(() => {
			this.statusContainer.clear();
			this.ui.requestRender();
		}, 500);
	}

	renderAssistantLabel(): void {
		// Just render the assistant label without starting animations
		// Used for restored session history
		this.chatContainer.addChild(new TextComponent(chalk.hex("#FFA500")("[assistant]")));
		this.ui.requestRender();
	}

	stop(): void {
		if (this.currentLoadingAnimation) {
			this.currentLoadingAnimation.stop();
			this.currentLoadingAnimation = null;
		}
		if (this.isInitialized) {
			this.ui.stop();
			this.isInitialized = false;
		}
	}
}
