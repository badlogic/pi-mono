import { test, describe } from "node:test";
import assert from "node:assert";
import { VirtualTerminal } from "./virtual-terminal.js";

describe("VirtualTerminal", () => {
	test("writes and reads simple text", async () => {
		const terminal = new VirtualTerminal(80, 24);

		terminal.write("Hello, World!");

		// Wait for write to process
		const output = await terminal.flushAndGetViewport();

		assert.strictEqual(output[0], "Hello, World!");
		assert.strictEqual(output[1], "");
	});

	test("handles newlines correctly", async () => {
		const terminal = new VirtualTerminal(80, 24);

		terminal.write("Line 1\r\nLine 2\r\nLine 3");

		const output = await terminal.flushAndGetViewport();

		assert.strictEqual(output[0], "Line 1");
		assert.strictEqual(output[1], "Line 2");
		assert.strictEqual(output[2], "Line 3");
	});

	test("handles ANSI cursor movement", async () => {
		const terminal = new VirtualTerminal(80, 24);

		// Write text with proper newlines, move cursor up, overwrite
		terminal.write("First line\r\nSecond line");
		terminal.write("\x1b[1A"); // Move up 1 line
		terminal.write("\rOverwritten");

		const output = await terminal.flushAndGetViewport();

		assert.strictEqual(output[0], "Overwritten");
		assert.strictEqual(output[1], "Second line");
	});

	test("handles clear line escape sequence", async () => {
		const terminal = new VirtualTerminal(80, 24);

		terminal.write("This will be cleared");
		terminal.write("\r\x1b[2K"); // Clear line
		terminal.write("New text");

		const output = await terminal.flushAndGetViewport();

		assert.strictEqual(output[0], "New text");
	});

	test("tracks cursor position", async () => {
		const terminal = new VirtualTerminal(80, 24);

		terminal.write("Hello");
		await terminal.flush();

		const cursor = terminal.getCursorPosition();
		assert.strictEqual(cursor.x, 5); // After "Hello"
		assert.strictEqual(cursor.y, 0); // First line

		terminal.write("\r\nWorld"); // Use CR+LF for proper newline
		await terminal.flush();

		const cursor2 = terminal.getCursorPosition();
		assert.strictEqual(cursor2.x, 5); // After "World"
		assert.strictEqual(cursor2.y, 1); // Second line
	});

	test("handles viewport overflow with scrolling", async () => {
		const terminal = new VirtualTerminal(80, 10); // Small viewport

		// Write more lines than viewport can hold
		for (let i = 1; i <= 15; i++) {
			terminal.write(`Line ${i}\r\n`);
		}

		const viewport = await terminal.flushAndGetViewport();
		const scrollBuffer = terminal.getScrollBuffer();

		// Viewport should show lines 7-15 plus empty line (because viewport starts after scrolling)
		assert.strictEqual(viewport.length, 10);
		assert.strictEqual(viewport[0], "Line 7");
		assert.strictEqual(viewport[8], "Line 15");
		assert.strictEqual(viewport[9], "");  // Last line is empty after the final \r\n

		// Scroll buffer should have all lines
		assert.ok(scrollBuffer.length >= 15);
		// Check specific lines exist in the buffer
		const hasLine1 = scrollBuffer.some(line => line === "Line 1");
		const hasLine15 = scrollBuffer.some(line => line === "Line 15");
		assert.ok(hasLine1, "Buffer should contain 'Line 1'");
		assert.ok(hasLine15, "Buffer should contain 'Line 15'");
	});

	test("resize updates dimensions", async () => {
		const terminal = new VirtualTerminal(80, 24);

		assert.strictEqual(terminal.columns, 80);
		assert.strictEqual(terminal.rows, 24);

		terminal.resize(100, 30);

		assert.strictEqual(terminal.columns, 100);
		assert.strictEqual(terminal.rows, 30);
	});

	test("reset clears terminal completely", async () => {
		const terminal = new VirtualTerminal(80, 24);

		terminal.write("Some text\r\nMore text");

		let output = await terminal.flushAndGetViewport();
		assert.strictEqual(output[0], "Some text");
		assert.strictEqual(output[1], "More text");

		terminal.reset();

		output = await terminal.flushAndGetViewport();
		assert.strictEqual(output[0], "");
		assert.strictEqual(output[1], "");
	});

	test("sendInput triggers handler", async () => {
		const terminal = new VirtualTerminal(80, 24);

		let received = "";
		terminal.start((data) => {
			received = data;
		}, () => {});

		terminal.sendInput("a");
		assert.strictEqual(received, "a");

		terminal.sendInput("\x1b[A"); // Up arrow
		assert.strictEqual(received, "\x1b[A");

		terminal.stop();
	});

	test("resize triggers handler", async () => {
		const terminal = new VirtualTerminal(80, 24);

		let resized = false;
		terminal.start(() => {}, () => {
			resized = true;
		});

		terminal.resize(100, 30);
		assert.strictEqual(resized, true);

		terminal.stop();
	});
});