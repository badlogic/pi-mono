/**
 * Simple chat interface demo using tui-new.ts
 */

import { CombinedAutocompleteProvider } from "../src/autocomplete.js";
import { Editor } from "../src/components-new/editor.js";
import { Loader } from "../src/components-new/loader.js";
import { Markdown } from "../src/components-new/markdown.js";
import { Spacer } from "../src/components-new/spacer.js";
import { ProcessTerminal } from "../src/terminal.js";
import { Text, TUI } from "../src/tui-new.js";

// Create terminal
const terminal = new ProcessTerminal();

// Create TUI
const tui = new TUI(terminal);

// Create chat container with some initial messages
tui.addChild(new Text("Welcome to Simple Chat!"));
tui.addChild(new Text("Type your messages below. Type '/' for commands. Press Ctrl+C to exit.\n"));

// Create editor with autocomplete
const editor = new Editor();

// Set up autocomplete provider with slash commands and file completion
const autocompleteProvider = new CombinedAutocompleteProvider(
	[
		{ name: "delete", description: "Delete the last message" },
		{ name: "clear", description: "Clear all messages" },
	],
	process.cwd(),
);
editor.setAutocompleteProvider(autocompleteProvider);

tui.addChild(editor);

// Focus the editor
tui.setFocus(editor);

// Track if we're waiting for bot response
let isResponding = false;

// Handle message submission
editor.onSubmit = (value: string) => {
	// Prevent submission if already responding
	if (isResponding) {
		return;
	}

	const trimmed = value.trim();

	// Handle slash commands
	if (trimmed === "/delete") {
		const children = tui.children;
		// Remove component before editor (if there are any besides the initial text)
		if (children.length > 3) {
			// children[0] = "Welcome to Simple Chat!"
			// children[1] = "Type your messages below..."
			// children[2...n-1] = messages
			// children[n] = editor
			children.splice(children.length - 2, 1);
		}
		tui.requestRender();
		return;
	}

	if (trimmed === "/clear") {
		const children = tui.children;
		// Remove all messages but keep the welcome text and editor
		children.splice(2, children.length - 3);
		tui.requestRender();
		return;
	}

	if (trimmed) {
		// Mark as responding and disable submit
		isResponding = true;
		editor.disableSubmit = true;

		// Add user message with custom gray background (similar to Claude.ai)
		const userMessage = new Markdown(value, undefined, undefined, { r: 52, g: 53, b: 65 });

		// Insert before the editor (which is last)
		const children = tui.children;
		children.splice(children.length - 1, 0, userMessage);
		children.splice(children.length - 1, 0, new Spacer());

		// Add loader
		const loader = new Loader(tui, "Thinking...");
		const loaderSpacer = new Spacer();
		children.splice(children.length - 1, 0, loader);
		children.splice(children.length - 1, 0, loaderSpacer);

		tui.requestRender();

		// Simulate a 1 second delay
		setTimeout(() => {
			// Remove loader and its spacer
			tui.removeChild(loader);
			tui.removeChild(loaderSpacer);

			// Simulate a response
			const responses = [
				"That's interesting! Tell me more.",
				"I see what you mean.",
				"Fascinating perspective!",
				"Could you elaborate on that?",
				"That makes sense to me.",
				"I hadn't thought of it that way.",
				"Great point!",
				"Thanks for sharing that.",
			];
			const randomResponse = responses[Math.floor(Math.random() * responses.length)];

			// Add assistant message with no background (transparent)
			const botMessage = new Markdown(randomResponse);
			children.splice(children.length - 1, 0, botMessage);
			children.splice(children.length - 1, 0, new Spacer());

			// Re-enable submit
			isResponding = false;
			editor.disableSubmit = false;

			// Request render
			tui.requestRender();
		}, 1000);
	}
};

// Start the TUI
tui.start();
