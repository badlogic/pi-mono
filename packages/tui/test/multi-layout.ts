#!/usr/bin/env npx tsx
import { TUI, Container, TextComponent, TextEditor, MarkdownComponent } from "../src/index.js";

/**
 * Multi-Component Layout Demo
 *
 * Demonstrates:
 * - Complex layout with multiple containers
 * - Header, sidebar, main content, and footer areas
 * - Mixing static and dynamic components
 * - Debug logging configuration
 */

const ui = new TUI();

// Create layout containers
const header = new TextComponent("📝 Advanced TUI Demo", { bottom: 1 });
const mainContent = new Container();
const sidebar = new Container();
const footer = new TextComponent("Press Ctrl+C to exit", { top: 1 });

// Sidebar content
sidebar.addChild(new TextComponent("📁 Files:", { bottom: 1 }));
sidebar.addChild(new TextComponent("- config.json"));
sidebar.addChild(new TextComponent("- README.md"));
sidebar.addChild(new TextComponent("- package.json"));

// Main content area
const chatArea = new Container();
const inputArea = new TextEditor();

// Add welcome message
chatArea.addChild(
	new MarkdownComponent(`
# Welcome to the TUI Demo

This demonstrates multiple components working together:

- **Header**: Static title with padding
- **Sidebar**: File list (simulated)
- **Chat Area**: Scrollable message history
- **Input**: Interactive text editor
- **Footer**: Status information

Try typing a message and pressing Enter!
`),
);

inputArea.onSubmit = (text) => {
	if (text.trim()) {
		const message = new MarkdownComponent(`
**${new Date().toLocaleTimeString()}:** ${text}
		`);
		chatArea.addChild(message);
		ui.requestRender();
	}
};

// Build layout
mainContent.addChild(chatArea);
mainContent.addChild(inputArea);

ui.addChild(header);
ui.addChild(mainContent);
ui.addChild(footer);
ui.setFocus(inputArea);

// Handle Ctrl+C to exit
ui.onGlobalKeyPress = (data: string) => {
	if (data === "\x03") {
		ui.stop();
		console.log("\nMulti-layout demo exited");
		process.exit(0);
	}
	return true;
};

ui.start();