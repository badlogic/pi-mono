#!/usr/bin/env node

import {
	CombinedAutocompleteProvider,
	Container,
	MarkdownComponent,
	TextComponent,
	TextEditor,
	TUI,
} from "../src/index.js";

// Create TUI manager
const ui = new TUI();
ui.configureLogging({
	enabled: true,
	logLevel: "debug",
	logFile: "tui-debug.log",
});

// Create a chat container that will hold messages
const chatContainer = new Container();
const editor = new TextEditor();

// Set up autocomplete with slash commands
const autocompleteProvider = new CombinedAutocompleteProvider(
	[
		{ name: "clear", description: "Clear chat history" },
		{ name: "clear-last", description: "Clear last message" },
		{ name: "exit", description: "Exit the application" },
	],
	process.cwd(),
);
editor.setAutocompleteProvider(autocompleteProvider);

// Add components to UI
ui.addChild(new TextComponent("Differential Rendering TUI"));
ui.addChild(chatContainer);
ui.addChild(editor);

// Set focus to the editor (index 2)
ui.setFocus(editor);

// Test with Claude's multiline text
const testText = `Root level:
- CLAUDE.md
- README.md
- biome.json
- package.json
- package-lock.json
- tsconfig.json
- tui-debug.log

Directories:
- \`data/\` (JSON test files)
- \`dist/\` 
- \`docs/\` (markdown documentation)
- \`node_modules/\`
- \`src/\` (TypeScript source files)`;

// Pre-fill the editor with the test text
editor.setText(testText);

// Handle editor submissions
editor.onSubmit = (text: string) => {
	text = text.trim();

	if (text === "/clear") {
		chatContainer.clear();
		ui.requestRender();
		return;
	}

	if (text === "/clear-last") {
		const count = chatContainer.getChildCount();
		if (count > 0) {
			chatContainer.removeChildAt(count - 1);
			ui.requestRender();
		}
		return;
	}

	if (text === "/exit") {
		ui.stop();
		return;
	}

	if (text) {
		// Create new message component and add to chat container
		const message = new MarkdownComponent(text);
		chatContainer.addChild(message);

		// Manually trigger re-render
		ui.requestRender();
	}
};

// Start the UI
ui.start();
