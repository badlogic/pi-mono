import assert from "node:assert";
import { describe, test } from "node:test";
import {
	Container,
	MarkdownComponent,
	SelectList,
	TextComponent,
	TextEditor,
	TUI,
	WhitespaceComponent,
} from "../src/index.js";
import { VirtualTerminal } from "./virtual-terminal.js";

describe("TUI Rendering", () => {
	test("renders single text component", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const ui = new TUI(terminal);
		ui.start();

		const text = new TextComponent("Hello, World!");
		ui.addChild(text);

		// Wait for next tick for render to complete
		await new Promise((resolve) => process.nextTick(resolve));

		// Wait for writes to complete and get the rendered output
		const output = await terminal.flushAndGetViewport();

		// Expected: text on first line
		assert.strictEqual(output[0], "Hello, World!");

		// Check cursor position
		const cursor = terminal.getCursorPosition();
		assert.strictEqual(cursor.y, 1);
		assert.strictEqual(cursor.x, 0);

		ui.stop();
	});

	test("renders multiple text components", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const ui = new TUI(terminal);
		ui.start();

		ui.addChild(new TextComponent("Line 1"));
		ui.addChild(new TextComponent("Line 2"));
		ui.addChild(new TextComponent("Line 3"));

		// Wait for next tick for render to complete
		await new Promise((resolve) => process.nextTick(resolve));

		const output = await terminal.flushAndGetViewport();
		assert.strictEqual(output[0], "Line 1");
		assert.strictEqual(output[1], "Line 2");
		assert.strictEqual(output[2], "Line 3");

		ui.stop();
	});

	test("renders text component with padding", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const ui = new TUI(terminal);
		ui.start();

		ui.addChild(new TextComponent("Top text"));
		ui.addChild(new TextComponent("Padded text", { top: 2, bottom: 2 }));
		ui.addChild(new TextComponent("Bottom text"));

		// Wait for next tick for render to complete
		await new Promise((resolve) => process.nextTick(resolve));

		const output = await terminal.flushAndGetViewport();
		assert.strictEqual(output[0], "Top text");
		assert.strictEqual(output[1], ""); // top padding
		assert.strictEqual(output[2], ""); // top padding
		assert.strictEqual(output[3], "Padded text");
		assert.strictEqual(output[4], ""); // bottom padding
		assert.strictEqual(output[5], ""); // bottom padding
		assert.strictEqual(output[6], "Bottom text");

		ui.stop();
	});

	test("renders container with children", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const ui = new TUI(terminal);
		ui.start();

		const container = new Container();
		container.addChild(new TextComponent("Child 1"));
		container.addChild(new TextComponent("Child 2"));

		ui.addChild(new TextComponent("Before container"));
		ui.addChild(container);
		ui.addChild(new TextComponent("After container"));

		// Wait for next tick for render to complete
		await new Promise((resolve) => process.nextTick(resolve));

		const output = await terminal.flushAndGetViewport();
		assert.strictEqual(output[0], "Before container");
		assert.strictEqual(output[1], "Child 1");
		assert.strictEqual(output[2], "Child 2");
		assert.strictEqual(output[3], "After container");

		ui.stop();
	});

	test("handles text editor rendering", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const ui = new TUI(terminal);
		ui.start();

		const editor = new TextEditor();
		ui.addChild(editor);
		ui.setFocus(editor);

		// Wait for next tick for render to complete
		await new Promise((resolve) => process.nextTick(resolve));

		// Initial state - empty editor with cursor
		const output = await terminal.flushAndGetViewport();

		// Check that we have the border characters
		assert.ok(output[0].includes("╭"));
		assert.ok(output[0].includes("╮"));
		assert.ok(output[1].includes("│"));

		ui.stop();
	});

	test("differential rendering only updates changed lines", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const ui = new TUI(terminal);
		ui.start();

		const staticText = new TextComponent("Static text");
		const dynamicText = new TextComponent("Initial");

		ui.addChild(staticText);
		ui.addChild(dynamicText);

		// Wait for initial render
		await new Promise((resolve) => process.nextTick(resolve));
		await terminal.flush();

		// Save initial state
		const initialViewport = [...terminal.getViewport()];

		// Change only the dynamic text
		dynamicText.setText("Changed");
		ui.requestRender();

		// Wait for render
		await new Promise((resolve) => process.nextTick(resolve));

		// Flush terminal buffer
		await terminal.flush();

		// Check the viewport now shows the change
		const newViewport = terminal.getViewport();
		assert.strictEqual(newViewport[0], "Static text"); // Unchanged
		assert.strictEqual(newViewport[1], "Changed"); // Changed

		ui.stop();
	});

	test("handles component removal", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const ui = new TUI(terminal);
		ui.start();

		const text1 = new TextComponent("Line 1");
		const text2 = new TextComponent("Line 2");
		const text3 = new TextComponent("Line 3");

		ui.addChild(text1);
		ui.addChild(text2);
		ui.addChild(text3);

		// Wait for initial render
		await new Promise((resolve) => process.nextTick(resolve));

		let output = await terminal.flushAndGetViewport();
		assert.strictEqual(output[0], "Line 1");
		assert.strictEqual(output[1], "Line 2");
		assert.strictEqual(output[2], "Line 3");

		// Remove middle component
		ui.removeChild(text2);
		ui.requestRender();

		await new Promise((resolve) => setImmediate(resolve));

		output = await terminal.flushAndGetViewport();
		assert.strictEqual(output[0], "Line 1");
		assert.strictEqual(output[1], "Line 3");
		assert.strictEqual(output[2].trim(), ""); // Should be cleared

		ui.stop();
	});

	test("handles viewport overflow", async () => {
		const terminal = new VirtualTerminal(80, 10); // Small viewport
		const ui = new TUI(terminal);
		ui.start();

		// Add more lines than viewport can hold
		for (let i = 1; i <= 15; i++) {
			ui.addChild(new TextComponent(`Line ${i}`));
		}

		// Wait for next tick for render to complete
		await new Promise((resolve) => process.nextTick(resolve));

		const output = await terminal.flushAndGetViewport();

		// Should only render what fits in viewport (9 lines + 1 for cursor)
		// When content exceeds viewport, we show the last N lines
		assert.strictEqual(output[0], "Line 7");
		assert.strictEqual(output[1], "Line 8");
		assert.strictEqual(output[2], "Line 9");
		assert.strictEqual(output[3], "Line 10");
		assert.strictEqual(output[4], "Line 11");
		assert.strictEqual(output[5], "Line 12");
		assert.strictEqual(output[6], "Line 13");
		assert.strictEqual(output[7], "Line 14");
		assert.strictEqual(output[8], "Line 15");

		ui.stop();
	});

	test("handles whitespace component", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const ui = new TUI(terminal);
		ui.start();

		ui.addChild(new TextComponent("Before"));
		ui.addChild(new WhitespaceComponent(3));
		ui.addChild(new TextComponent("After"));

		// Wait for next tick for render to complete
		await new Promise((resolve) => process.nextTick(resolve));

		const output = await terminal.flushAndGetViewport();
		assert.strictEqual(output[0], "Before");
		assert.strictEqual(output[1], "");
		assert.strictEqual(output[2], "");
		assert.strictEqual(output[3], "");
		assert.strictEqual(output[4], "After");

		ui.stop();
	});

	test("markdown component renders correctly", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const ui = new TUI(terminal);
		ui.start();

		const markdown = new MarkdownComponent("# Hello\n\nThis is **bold** text.");
		ui.addChild(markdown);

		// Wait for next tick for render to complete
		await new Promise((resolve) => process.nextTick(resolve));

		const output = await terminal.flushAndGetViewport();
		// Should have formatted markdown
		assert.ok(output[0].includes("Hello")); // Header
		assert.ok(output[2].includes("This is")); // Paragraph after blank line
		assert.ok(output[2].includes("bold")); // Bold text

		ui.stop();
	});

	test("select list renders and handles selection", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const ui = new TUI(terminal);
		ui.start();

		const items = [
			{ label: "Option 1", value: "1" },
			{ label: "Option 2", value: "2" },
			{ label: "Option 3", value: "3" },
		];

		const selectList = new SelectList(items);
		ui.addChild(selectList);
		ui.setFocus(selectList);

		// Wait for next tick for render to complete
		await new Promise((resolve) => process.nextTick(resolve));

		const output = await terminal.flushAndGetViewport();
		// First option should be selected (has → indicator)
		assert.ok(output[0].startsWith("→"), `Expected first line to start with →, got: "${output[0]}"`);
		assert.ok(output[0].includes("Option 1"));
		assert.ok(output[1].startsWith(" "), `Expected second line to start with space, got: "${output[1]}"`);
		assert.ok(output[1].includes("Option 2"));

		ui.stop();
	});

	test("preserves existing terminal content when rendering", async () => {
		const terminal = new VirtualTerminal(80, 24);

		// Write some content to the terminal before starting TUI
		// This simulates having existing content in the scrollback buffer
		terminal.write("Previous command output line 1\r\n");
		terminal.write("Previous command output line 2\r\n");
		terminal.write("Some important information\r\n");
		terminal.write("Last line before TUI starts\r\n");

		// Flush to ensure writes are complete
		await terminal.flush();

		// Get the initial state with existing content
		const initialOutput = [...terminal.getViewport()];
		assert.strictEqual(initialOutput[0], "Previous command output line 1");
		assert.strictEqual(initialOutput[1], "Previous command output line 2");
		assert.strictEqual(initialOutput[2], "Some important information");
		assert.strictEqual(initialOutput[3], "Last line before TUI starts");

		// Now start the TUI with a text editor
		const ui = new TUI(terminal);
		ui.start();

		const editor = new TextEditor();
		let submittedText = "";
		editor.onSubmit = (text) => {
			submittedText = text;
		};
		ui.addChild(editor);
		ui.setFocus(editor);

		// Wait for initial render
		await new Promise((resolve) => process.nextTick(resolve));
		await terminal.flush();

		// Check that the editor is rendered after the existing content
		const afterTuiStart = terminal.getViewport();

		// The existing content should still be visible above the editor
		assert.strictEqual(afterTuiStart[0], "Previous command output line 1");
		assert.strictEqual(afterTuiStart[1], "Previous command output line 2");
		assert.strictEqual(afterTuiStart[2], "Some important information");
		assert.strictEqual(afterTuiStart[3], "Last line before TUI starts");

		// The editor should appear after the existing content
		// The editor is 3 lines tall (top border, content line, bottom border)
		// Top border with box drawing characters filling the width (80 chars)
		assert.strictEqual(afterTuiStart[4][0], "╭");
		assert.strictEqual(afterTuiStart[4][78], "╮");

		// Content line should have the prompt
		assert.strictEqual(afterTuiStart[5].substring(0, 4), "│ > ");
		// And should end with vertical bar
		assert.strictEqual(afterTuiStart[5][78], "│");

		// Bottom border
		assert.strictEqual(afterTuiStart[6][0], "╰");
		assert.strictEqual(afterTuiStart[6][78], "╯");

		// Type some text into the editor
		terminal.sendInput("Hello World");

		// Wait for the input to be processed
		await new Promise((resolve) => process.nextTick(resolve));
		await terminal.flush();

		// Check that text appears in the editor
		const afterTyping = terminal.getViewport();
		assert.strictEqual(afterTyping[0], "Previous command output line 1");
		assert.strictEqual(afterTyping[1], "Previous command output line 2");
		assert.strictEqual(afterTyping[2], "Some important information");
		assert.strictEqual(afterTyping[3], "Last line before TUI starts");

		// The editor content should show the typed text with the prompt ">"
		assert.strictEqual(afterTyping[5].substring(0, 15), "│ > Hello World");

		// Send SHIFT+ENTER to the editor (adds a new line)
		// According to text-editor.ts line 251, SHIFT+ENTER is detected as "\n" which calls addNewLine()
		terminal.sendInput("\n");

		// Wait for the input to be processed
		await new Promise((resolve) => process.nextTick(resolve));
		await terminal.flush();

		// Check that existing content is still preserved after adding new line
		const afterNewLine = terminal.getViewport();
		assert.strictEqual(afterNewLine[0], "Previous command output line 1");
		assert.strictEqual(afterNewLine[1], "Previous command output line 2");
		assert.strictEqual(afterNewLine[2], "Some important information");
		assert.strictEqual(afterNewLine[3], "Last line before TUI starts");

		// Editor should now be 4 lines tall (top border, first line, second line, bottom border)
		// Top border at line 4
		assert.strictEqual(afterNewLine[4][0], "╭");
		assert.strictEqual(afterNewLine[4][78], "╮");

		// First line with text at line 5
		assert.strictEqual(afterNewLine[5].substring(0, 15), "│ > Hello World");
		assert.strictEqual(afterNewLine[5][78], "│");

		// Second line (empty, with continuation prompt "  ") at line 6
		assert.strictEqual(afterNewLine[6].substring(0, 4), "│   ");
		assert.strictEqual(afterNewLine[6][78], "│");

		// Bottom border at line 7
		assert.strictEqual(afterNewLine[7][0], "╰");
		assert.strictEqual(afterNewLine[7][78], "╯");

		// Verify that onSubmit was NOT called (since we pressed SHIFT+ENTER, not plain ENTER)
		assert.strictEqual(submittedText, "");

		ui.stop();
	});
});
