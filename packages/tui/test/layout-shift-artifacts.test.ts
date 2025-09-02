import assert from "node:assert";
import { describe, test } from "node:test";
import { Container, TextComponent, TextEditor, TUI } from "../src/index.js";
import { VirtualTerminal } from "./virtual-terminal.js";

describe("Layout shift artifacts", () => {
	test("clears artifacts when components shift positions dynamically (like agent Ctrl+C)", async () => {
		const term = new VirtualTerminal(80, 20);
		const ui = new TUI(term);

		// Simulate agent's layout: header, chat container, status container, editor
		const header = new TextComponent(">> pi interactive chat <<<");
		const chatContainer = new Container();
		const statusContainer = new Container();
		const editor = new TextEditor({ multiline: false });

		// Add some chat content
		chatContainer.addChild(new TextComponent("[user]"));
		chatContainer.addChild(new TextComponent("Hello"));
		chatContainer.addChild(new TextComponent("[assistant]"));
		chatContainer.addChild(new TextComponent("Hi there!"));

		ui.addChild(header);
		ui.addChild(chatContainer);
		ui.addChild(statusContainer);
		ui.addChild(editor);

		// Initial render
		ui.start();
		await new Promise((resolve) => process.nextTick(resolve));
		await term.flush();

		// Capture initial state
		const initialViewport = term.getViewport();

		// Simulate what happens when Ctrl+C is pressed (like in agent)
		statusContainer.clear();
		const hint = new TextComponent("Press Ctrl+C again to exit");
		statusContainer.addChild(hint);
		ui.requestRender();

		// Wait for render
		await new Promise((resolve) => process.nextTick(resolve));
		await term.flush();

		// Capture state with status message
		const withStatusViewport = term.getViewport();

		// Simulate the timeout that clears the hint (like agent does after 500ms)
		statusContainer.clear();
		ui.requestRender();

		// Wait for render
		await new Promise((resolve) => process.nextTick(resolve));
		await term.flush();

		// Capture final state
		const finalViewport = term.getViewport();

		// Check for artifacts - look for duplicate bottom borders on consecutive lines
		let foundDuplicateBorder = false;
		for (let i = 0; i < finalViewport.length - 1; i++) {
			const currentLine = finalViewport[i];
			const nextLine = finalViewport[i + 1];

			// Check if we have duplicate bottom borders (the artifact)
			if (
				currentLine.includes("╰") &&
				currentLine.includes("╯") &&
				nextLine.includes("╰") &&
				nextLine.includes("╯")
			) {
				foundDuplicateBorder = true;
			}
		}

		// The test should FAIL if we find duplicate borders (indicating the bug exists)
		assert.strictEqual(foundDuplicateBorder, false, "Found duplicate bottom borders - rendering artifact detected!");

		// Also check that there's only one bottom border total
		const bottomBorderCount = finalViewport.filter((line) => line.includes("╰")).length;
		assert.strictEqual(bottomBorderCount, 1, `Expected 1 bottom border, found ${bottomBorderCount}`);

		// Verify the editor is back in its original position
		const finalEditorStartLine = finalViewport.findIndex((line) => line.includes("╭"));
		const initialEditorStartLine = initialViewport.findIndex((line) => line.includes("╭"));
		assert.strictEqual(finalEditorStartLine, initialEditorStartLine);

		ui.stop();
	});

	test("handles rapid addition and removal of components", async () => {
		const term = new VirtualTerminal(80, 20);
		const ui = new TUI(term);

		const header = new TextComponent("Header");
		const editor = new TextEditor({ multiline: false });

		ui.addChild(header);
		ui.addChild(editor);

		// Initial render
		ui.start();
		await new Promise((resolve) => process.nextTick(resolve));
		await term.flush();

		// Rapidly add and remove a status message
		const status = new TextComponent("Temporary Status");

		// Add status
		ui.children.splice(1, 0, status);
		ui.requestRender();
		await new Promise((resolve) => process.nextTick(resolve));
		await term.flush();

		// Remove status immediately
		ui.children.splice(1, 1);
		ui.requestRender();
		await new Promise((resolve) => process.nextTick(resolve));
		await term.flush();

		// Final output check
		const finalViewport = term.getViewport();

		// Should only have one set of borders for the editor
		const topBorderCount = finalViewport.filter((line) => line.includes("╭") && line.includes("╮")).length;
		const bottomBorderCount = finalViewport.filter((line) => line.includes("╰") && line.includes("╯")).length;

		assert.strictEqual(topBorderCount, 1);
		assert.strictEqual(bottomBorderCount, 1);

		// Check no duplicate lines
		for (let i = 0; i < finalViewport.length - 1; i++) {
			const currentLine = finalViewport[i];
			const nextLine = finalViewport[i + 1];

			// If current line is a bottom border, next line should not be a bottom border
			if (currentLine.includes("╰") && currentLine.includes("╯")) {
				assert.strictEqual(nextLine.includes("╰") && nextLine.includes("╯"), false);
			}
		}

		ui.stop();
	});
});
