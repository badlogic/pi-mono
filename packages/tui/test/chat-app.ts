#!/usr/bin/env npx tsx
import { TUI, Container, TextEditor, MarkdownComponent, CombinedAutocompleteProvider } from "../src/index.js";

/**
 * Chat Application with Autocomplete
 * 
 * Demonstrates:
 * - Slash command system with autocomplete
 * - Dynamic message history
 * - Markdown rendering for messages
 * - Container-based layout
 */

const ui = new TUI();
const chatHistory = new Container();
const editor = new TextEditor();

// Set up autocomplete with slash commands
const autocompleteProvider = new CombinedAutocompleteProvider([
	{ name: "clear", description: "Clear chat history" },
	{ name: "help", description: "Show help information" },
	{
		name: "attach",
		description: "Attach a file",
		getArgumentCompletions: (prefix) => {
			// Return file suggestions for attach command
			return null; // Use default file completion
		},
	},
]);

editor.setAutocompleteProvider(autocompleteProvider);

editor.onSubmit = (text) => {
	// Handle slash commands
	if (text.startsWith("/")) {
		const [command, ...args] = text.slice(1).split(" ");
		if (command === "clear") {
			chatHistory.clear();
			return;
		}
		if (command === "help") {
			const help = new MarkdownComponent(`
## Available Commands
- \`/clear\` - Clear chat history
- \`/help\` - Show this help
- \`/attach <file>\` - Attach a file
			`);
			chatHistory.addChild(help);
			ui.requestRender();
			return;
		}
	}

	// Regular message
	const message = new MarkdownComponent(`**You:** ${text}`);
	chatHistory.addChild(message);

	// Add AI response (simulated)
	setTimeout(() => {
		const response = new MarkdownComponent(`**AI:** Response to "${text}"`);
		chatHistory.addChild(response);
		ui.requestRender();
	}, 1000);
};

// Handle Ctrl+C to exit
ui.onGlobalKeyPress = (data: string) => {
	if (data === "\x03") {
		ui.stop();
		console.log("\nChat application exited");
		process.exit(0);
	}
	return true;
};

ui.addChild(chatHistory);
ui.addChild(editor);
ui.setFocus(editor);
ui.start();