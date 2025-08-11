import { test, describe } from "node:test";
import assert from "node:assert";
import { VirtualTerminal } from "./virtual-terminal.js";
import { TUI, Container, TextComponent, MarkdownComponent, TextEditor, LoadingAnimation } from "../src/index.js";

describe("Multi-Message Garbled Output Reproduction", () => {
	test("handles rapid message additions with large content without garbling", async () => {
		const terminal = new VirtualTerminal(100, 30);
		const ui = new TUI(terminal);
		ui.start();

		// Simulate the chat demo structure
		const chatContainer = new Container();
		const statusContainer = new Container();
		const editor = new TextEditor();

		ui.addChild(chatContainer);
		ui.addChild(statusContainer);
		ui.addChild(editor);
		ui.setFocus(editor);

		// Initial render
		await new Promise(resolve => process.nextTick(resolve));
		await terminal.flush();

		// Step 1: Simulate user message
		chatContainer.addChild(new TextComponent("[user]"));
		chatContainer.addChild(new TextComponent("read all README.md files except in node_modules"));

		// Step 2: Start loading animation (assistant thinking)
		const loadingAnim = new LoadingAnimation(ui, "Thinking");
		statusContainer.addChild(loadingAnim);

		ui.requestRender();
		await new Promise(resolve => process.nextTick(resolve));
		await terminal.flush();

		// Step 3: Simulate rapid tool calls with large outputs
		chatContainer.addChild(new TextComponent("[assistant]"));

		// Simulate glob tool
		chatContainer.addChild(new TextComponent('[tool] glob({"pattern":"**/README.md"})'));
		const globResult = `README.md
node_modules/@biomejs/biome/README.md
node_modules/@esbuild/darwin-arm64/README.md
node_modules/@types/node/README.md
node_modules/@xterm/headless/README.md
node_modules/@xterm/xterm/README.md
node_modules/chalk/readme.md
node_modules/esbuild/README.md
node_modules/fsevents/README.md
node_modules/get-tsconfig/README.md
... (59 more lines)`;
		chatContainer.addChild(new TextComponent(globResult));

		ui.requestRender();
		await new Promise(resolve => process.nextTick(resolve));
		await terminal.flush();

		// Simulate multiple read tool calls with long content
		const readmeContent = `# Pi Monorepo
A collection of tools for managing LLM deployments and building AI agents.

## Packages

- **[@mariozechner/pi-tui](packages/tui)** - Terminal UI library with differential rendering
- **[@mariozechner/pi-agent](packages/agent)** - General-purpose agent with tool calling and session persistence
- **[@mariozechner/pi](packages/pods)** - CLI for managing vLLM deployments on GPU pods

... (76 more lines)`;

		// First read
		chatContainer.addChild(new TextComponent('[tool] read({"path": "README.md"})'));
		chatContainer.addChild(new MarkdownComponent(readmeContent));

		ui.requestRender();
		await new Promise(resolve => process.nextTick(resolve));
		await terminal.flush();

		// Second read with even more content
		const tuiReadmeContent = `# @mariozechner/pi-tui

Terminal UI framework with surgical differential rendering for building flicker-free interactive CLI applications.

## Features

- **Surgical Differential Rendering**: Three-strategy system that minimizes redraws to 1-2 lines for typical updates
- **Scrollback Buffer Preservation**: Correctly maintains terminal history when content exceeds viewport
- **Zero Flicker**: Components like text editors remain perfectly still while other parts update
- **Interactive Components**: Text editor with autocomplete, selection lists, markdown rendering
... (570 more lines)`;

		chatContainer.addChild(new TextComponent('[tool] read({"path": "packages/tui/README.md"})'));
		chatContainer.addChild(new MarkdownComponent(tuiReadmeContent));

		ui.requestRender();
		await new Promise(resolve => process.nextTick(resolve));
		await terminal.flush();

		// Step 4: Stop loading animation and add assistant response
		loadingAnim.stop();
		statusContainer.clear();

		const assistantResponse = `I've read the README files from your monorepo. Here's a summary:

The Pi Monorepo contains three main packages:

1. **pi-tui** - A terminal UI framework with advanced differential rendering
2. **pi-agent** - An AI agent with tool calling capabilities
3. **pi** - A CLI for managing GPU pods with vLLM

The TUI library features surgical differential rendering that minimizes screen updates.`;

		chatContainer.addChild(new MarkdownComponent(assistantResponse));

		ui.requestRender();
		await new Promise(resolve => process.nextTick(resolve));
		await terminal.flush();

		// Step 5: CRITICAL - Send a new message while previous content is displayed
		chatContainer.addChild(new TextComponent("[user]"));
		chatContainer.addChild(new TextComponent("What is the main purpose of the TUI library?"));

		// Start new loading animation
		const loadingAnim2 = new LoadingAnimation(ui, "Thinking");
		statusContainer.addChild(loadingAnim2);

		ui.requestRender();
		await new Promise(resolve => process.nextTick(resolve));
		await terminal.flush();

		// Add assistant response
		loadingAnim2.stop();
		statusContainer.clear();

		chatContainer.addChild(new TextComponent("[assistant]"));
		const secondResponse = `The main purpose of the TUI library is to provide a **flicker-free terminal UI framework** with surgical differential rendering.

Key aspects:
- Minimizes screen redraws to only 1-2 lines for typical updates
- Preserves terminal scrollback buffer
- Enables building interactive CLI applications without visual artifacts`;

		chatContainer.addChild(new MarkdownComponent(secondResponse));

		ui.requestRender();
		await new Promise(resolve => process.nextTick(resolve));
		await terminal.flush();

		// Debug: Show the garbled output after the problematic step
		console.log("\n=== After second read (where garbling occurs) ===");
		const debugOutput = terminal.getScrollBuffer();
		debugOutput.forEach((line, i) => {
			if (line.trim()) console.log(`${i}: "${line}"`);
		});
		
		// Step 6: Check final output
		const finalOutput = terminal.getScrollBuffer();

		// Check that first user message is NOT garbled
		const userLine1 = finalOutput.find(line => line.includes("read all README.md files"));
		assert.strictEqual(userLine1, "read all README.md files except in node_modules",
			`First user message is garbled: "${userLine1}"`);

		// Check that second user message is clean
		const userLine2 = finalOutput.find(line => line.includes("What is the main purpose"));
		assert.strictEqual(userLine2, "What is the main purpose of the TUI library?",
			`Second user message is garbled: "${userLine2}"`);

		// Check for common garbling patterns
		const garbledPatterns = [
			"README.mdategy",
			"README.mdectly",
			"modulesl rendering",
			"[assistant]ns.",
			"node_modules/@esbuild/darwin-arm64/README.mdategy"
		];

		for (const pattern of garbledPatterns) {
			const hasGarbled = finalOutput.some(line => line.includes(pattern));
			assert.ok(!hasGarbled, `Found garbled pattern "${pattern}" in output`);
		}

		ui.stop();
	});
});