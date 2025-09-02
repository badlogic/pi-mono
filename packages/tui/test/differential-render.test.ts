import assert from "node:assert";
import { describe, test } from "node:test";
import { Container, TextComponent, TextEditor, TUI } from "../src/index.js";
import { VirtualTerminal } from "./virtual-terminal.js";

describe("Differential Rendering - Dynamic Content", () => {
	test("handles static text, dynamic container, and text editor correctly", async () => {
		const terminal = new VirtualTerminal(80, 10); // Small viewport to test scrolling
		const ui = new TUI(terminal);
		ui.start();

		// Step 1: Add a static text component
		const staticText = new TextComponent("Static Header Text");
		ui.addChild(staticText);

		// Step 2: Add an initially empty container
		const container = new Container();
		ui.addChild(container);

		// Step 3: Add a text editor field
		const editor = new TextEditor();
		ui.addChild(editor);
		ui.setFocus(editor);

		// Wait for next tick to complete and flush virtual terminal
		await new Promise((resolve) => process.nextTick(resolve));
		await terminal.flush();

		// Step 4: Check initial output in scrollbuffer
		let scrollBuffer = terminal.getScrollBuffer();
		let viewport = terminal.getViewport();

		console.log("Initial render:");
		console.log("Viewport lines:", viewport.length);
		console.log("ScrollBuffer lines:", scrollBuffer.length);

		// Count non-empty lines in scrollbuffer
		const nonEmptyInBuffer = scrollBuffer.filter((line) => line.trim() !== "").length;
		console.log("Non-empty lines in scrollbuffer:", nonEmptyInBuffer);

		// Verify initial render has static text in scrollbuffer
		assert.ok(
			scrollBuffer.some((line) => line.includes("Static Header Text")),
			`Expected static text in scrollbuffer`,
		);

		// Step 5: Add 100 text components to container
		console.log("\nAdding 100 components to container...");
		for (let i = 1; i <= 100; i++) {
			container.addChild(new TextComponent(`Dynamic Item ${i}`));
		}

		// Request render after adding all components
		ui.requestRender();

		// Wait for next tick to complete and flush
		await new Promise((resolve) => process.nextTick(resolve));
		await terminal.flush();

		// Step 6: Check output after adding 100 components
		scrollBuffer = terminal.getScrollBuffer();
		viewport = terminal.getViewport();

		console.log("\nAfter adding 100 items:");
		console.log("Viewport lines:", viewport.length);
		console.log("ScrollBuffer lines:", scrollBuffer.length);

		// Count all dynamic items in scrollbuffer
		let dynamicItemsInBuffer = 0;
		const allItemNumbers = new Set<number>();
		for (const line of scrollBuffer) {
			const match = line.match(/Dynamic Item (\d+)/);
			if (match) {
				dynamicItemsInBuffer++;
				allItemNumbers.add(parseInt(match[1]));
			}
		}

		console.log("Dynamic items found in scrollbuffer:", dynamicItemsInBuffer);
		console.log("Unique item numbers:", allItemNumbers.size);
		console.log("Item range:", Math.min(...allItemNumbers), "-", Math.max(...allItemNumbers));

		// CRITICAL TEST: The scrollbuffer should contain ALL 100 items
		// This is what the differential render should preserve!
		assert.strictEqual(
			allItemNumbers.size,
			100,
			`Expected all 100 unique items in scrollbuffer, but found ${allItemNumbers.size}`,
		);

		// Verify items are 1-100
		for (let i = 1; i <= 100; i++) {
			assert.ok(allItemNumbers.has(i), `Missing Dynamic Item ${i} in scrollbuffer`);
		}

		// Also verify the static header is still in scrollbuffer
		assert.ok(
			scrollBuffer.some((line) => line.includes("Static Header Text")),
			"Static header should still be in scrollbuffer",
		);

		// And the editor should be there too
		assert.ok(
			scrollBuffer.some((line) => line.includes("╭") && line.includes("╮")),
			"Editor top border should be in scrollbuffer",
		);
		assert.ok(
			scrollBuffer.some((line) => line.includes("╰") && line.includes("╯")),
			"Editor bottom border should be in scrollbuffer",
		);

		ui.stop();
	});

	test("differential render correctly updates only changed components", async () => {
		const terminal = new VirtualTerminal(80, 24);
		const ui = new TUI(terminal);
		ui.start();

		// Create multiple containers with different content
		const header = new TextComponent("=== Application Header ===");
		const statusContainer = new Container();
		const contentContainer = new Container();
		const footer = new TextComponent("=== Footer ===");

		ui.addChild(header);
		ui.addChild(statusContainer);
		ui.addChild(contentContainer);
		ui.addChild(footer);

		// Add initial content
		statusContainer.addChild(new TextComponent("Status: Ready"));
		contentContainer.addChild(new TextComponent("Content Line 1"));
		contentContainer.addChild(new TextComponent("Content Line 2"));

		// Initial render
		await new Promise((resolve) => process.nextTick(resolve));
		await terminal.flush();

		let viewport = terminal.getViewport();
		assert.strictEqual(viewport[0], "=== Application Header ===");
		assert.strictEqual(viewport[1], "Status: Ready");
		assert.strictEqual(viewport[2], "Content Line 1");
		assert.strictEqual(viewport[3], "Content Line 2");
		assert.strictEqual(viewport[4], "=== Footer ===");

		// Track lines redrawn
		const initialLinesRedrawn = ui.getLinesRedrawn();

		// Update only the status
		statusContainer.clear();
		statusContainer.addChild(new TextComponent("Status: Processing..."));
		ui.requestRender();

		await new Promise((resolve) => process.nextTick(resolve));
		await terminal.flush();

		viewport = terminal.getViewport();
		assert.strictEqual(viewport[0], "=== Application Header ===");
		assert.strictEqual(viewport[1], "Status: Processing...");
		assert.strictEqual(viewport[2], "Content Line 1");
		assert.strictEqual(viewport[3], "Content Line 2");
		assert.strictEqual(viewport[4], "=== Footer ===");

		const afterStatusUpdate = ui.getLinesRedrawn();
		const statusUpdateLines = afterStatusUpdate - initialLinesRedrawn;
		console.log(`Lines redrawn for status update: ${statusUpdateLines}`);

		// Add many items to content container
		for (let i = 3; i <= 20; i++) {
			contentContainer.addChild(new TextComponent(`Content Line ${i}`));
		}
		ui.requestRender();

		await new Promise((resolve) => process.nextTick(resolve));
		await terminal.flush();

		viewport = terminal.getViewport();

		// With 24 rows - 1 for cursor = 23 visible
		// We have: 1 header + 1 status + 20 content + 1 footer = 23 lines
		// Should fit exactly
		assert.strictEqual(viewport[0], "=== Application Header ===");
		assert.strictEqual(viewport[1], "Status: Processing...");
		assert.strictEqual(viewport[21], "Content Line 20");
		assert.strictEqual(viewport[22], "=== Footer ===");

		// Now update just one content line
		const contentLine10 = contentContainer.getChild(9) as TextComponent;
		contentLine10.setText("Content Line 10 - MODIFIED");
		ui.requestRender();

		await new Promise((resolve) => process.nextTick(resolve));
		await terminal.flush();

		viewport = terminal.getViewport();
		assert.strictEqual(viewport[11], "Content Line 10 - MODIFIED");
		assert.strictEqual(viewport[0], "=== Application Header ==="); // Should be unchanged
		assert.strictEqual(viewport[22], "=== Footer ==="); // Should be unchanged

		ui.stop();
	});
});
