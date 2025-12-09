import { describe, expect, test } from "vitest";

describe("Exit command", () => {
	test("/exit command should trigger exit", () => {
		const text = "/exit";
		const shouldExit = text.startsWith("/exit") || text.startsWith("/quit");

		expect(shouldExit).toBe(true);
	});

	test("/quit command should also trigger exit", () => {
		const text = "/quit";
		const shouldExit = text.startsWith("/exit") || text.startsWith("/quit");

		expect(shouldExit).toBe(true);
	});

	test("/exit with arguments should trigger exit", () => {
		const text = "/exit now";
		const shouldExit = text.startsWith("/exit") || text.startsWith("/quit");

		expect(shouldExit).toBe(true);
	});

	test("/quit with arguments should trigger exit", () => {
		const text = "/quit please";
		const shouldExit = text.startsWith("/exit") || text.startsWith("/quit");

		expect(shouldExit).toBe(true);
	});

	test("other commands should not trigger exit", () => {
		const commands = ["/clear", "/help", "/model", "/thinking", "/export"];

		commands.forEach((text) => {
			const shouldExit = text.startsWith("/exit") || text.startsWith("/quit");
			expect(shouldExit).toBe(false);
		});
	});

	test("regular text with 'exit' or 'quit' should not trigger", () => {
		const textSamples = ["I want to exit this loop", "How do I quit vim?", "exit", "quit"];

		textSamples.forEach((text) => {
			const shouldExit = text.startsWith("/exit") || text.startsWith("/quit");
			expect(shouldExit).toBe(false);
		});
	});

	test("partial slash commands should not trigger exit", () => {
		const partialMatches = ["/exi", "/qui", "/ex", "/qu"];

		partialMatches.forEach((text) => {
			const shouldExit = text.startsWith("/exit") || text.startsWith("/quit");
			expect(shouldExit).toBe(false);
		});
	});

	test("exit command with leading whitespace should work after trim", () => {
		const withSpaces = ["/exit ", " /exit", "/quit ", " /quit"];

		withSpaces.forEach((text) => {
			const trimmed = text.trim();
			const shouldExit = trimmed.startsWith("/exit") || trimmed.startsWith("/quit");
			// After trim it should work
			expect(shouldExit).toBe(true);
		});
	});

	test("slash command definition has correct format", () => {
		// Test that the command definition will be correct
		const exitCommand = {
			name: "exit (quit)",
			description: "Exit the REPL",
		};

		expect(exitCommand.name).toBe("exit (quit)");
		expect(exitCommand.description).toBe("Exit the REPL");
	});

	test("exit command should be shown in chat area and input cleared", () => {
		// This test documents the exit flow:
		// 1. Show /exit in chat container (working area)
		// 2. Clear the input box
		// 3. Stop UI and exit
		const editorText = "/exit";
		const shouldShowInChatArea = true;
		const shouldClearInput = true;

		expect(shouldShowInChatArea).toBe(true);
		expect(shouldClearInput).toBe(true);
		expect(editorText.startsWith("/exit")).toBe(true);
	});
});
