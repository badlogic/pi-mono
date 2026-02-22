import assert from "node:assert";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";
import { matchesKey } from "../src/keys.js";
import { KittyKeyboardShim } from "../src/kitty-keyboard-shim.js";

class MockStdout extends EventEmitter {
	writes: string[] = [];

	write(data: string): boolean {
		this.writes.push(data);
		return true;
	}
}

function createMockStdin(): NodeJS.ReadStream {
	return new EventEmitter() as unknown as NodeJS.ReadStream;
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("KittyKeyboardShim", () => {
	it("treats AltGr printable input as text in win32 fallback mode", async () => {
		const stdin = createMockStdin();
		const stdout = new MockStdout();
		const shim = new KittyKeyboardShim(stdin, stdout as unknown as NodeJS.WriteStream, "win32", {
			windowsKittyProbeTimeoutMs: 20,
			windowsProbeResponseSuppressMs: 20,
		});
		const received: string[] = [];

		shim.start((data) => {
			received.push(data);
		});

		await wait(40);

		stdin.emit("data", "\x1b[81;0;64;1;9_");

		assert.deepStrictEqual(received, ["@"]);
		assert.ok(stdout.writes.includes("\x1b[?9001h"));

		shim.stop();
	});

	it("defaults to win32 translation mode on Windows", () => {
		const stdin = createMockStdin();
		const stdout = new MockStdout();
		const shim = new KittyKeyboardShim(stdin, stdout as unknown as NodeJS.WriteStream, "win32");

		shim.start(() => {});

		assert.ok(stdout.writes.includes("\x1b[?9001h"));
		assert.ok(!stdout.writes.includes("\x1b[?u\x1b[c"));
		assert.strictEqual(shim.kittyNative, false);

		shim.stop();
	});

	it("does not false-negative to win32 fallback when DA1 arrives before Kitty response", () => {
		const stdin = createMockStdin();
		const stdout = new MockStdout();
		const shim = new KittyKeyboardShim(stdin, stdout as unknown as NodeJS.WriteStream, "win32", {
			windowsKittyProbeTimeoutMs: 200,
			windowsProbeResponseSuppressMs: 50,
			windowsPreferKittyNative: true,
		});
		const received: string[] = [];

		shim.start((data) => {
			received.push(data);
		});

		stdin.emit("data", "\x1b[?1;2c");
		stdin.emit("data", "\x1b[?1u");
		stdin.emit("data", "\x1b[?1;2c");
		stdin.emit("data", "a");

		assert.strictEqual(shim.kittyNative, true);
		assert.ok(stdout.writes.includes("\x1b[>7u"));
		assert.ok(!stdout.writes.includes("\x1b[?9001h"));
		assert.deepStrictEqual(received, ["a"]);

		shim.stop();
	});

	it("does not treat empty CSI ? u probe response as Kitty support", async () => {
		const stdin = createMockStdin();
		const stdout = new MockStdout();
		const shim = new KittyKeyboardShim(stdin, stdout as unknown as NodeJS.WriteStream, "win32", {
			windowsKittyProbeTimeoutMs: 20,
			windowsProbeResponseSuppressMs: 20,
			windowsPreferKittyNative: true,
		});
		const received: string[] = [];

		shim.start((data) => {
			received.push(data);
		});

		stdin.emit("data", "\x1b[?u");
		await wait(40);

		assert.strictEqual(shim.kittyNative, false);
		assert.ok(stdout.writes.includes("\x1b[?9001h"));
		assert.deepStrictEqual(received, []);

		shim.stop();
	});

	it("translates Shift+Enter in win32 fallback so keybinding matching works", async () => {
		const stdin = createMockStdin();
		const stdout = new MockStdout();
		const shim = new KittyKeyboardShim(stdin, stdout as unknown as NodeJS.WriteStream, "win32", {
			windowsKittyProbeTimeoutMs: 20,
			windowsProbeResponseSuppressMs: 20,
		});
		const received: string[] = [];

		shim.start((data) => {
			received.push(data);
		});

		await wait(40);
		stdin.emit("data", "\x1b[13;0;13;1;16_");

		assert.deepStrictEqual(received, ["\x1b[13;2u"]);
		assert.strictEqual(matchesKey(received[0]!, "shift+enter"), true);

		shim.stop();
	});

	it("falls back to win32 translation when Kitty probe times out", async () => {
		const stdin = createMockStdin();
		const stdout = new MockStdout();
		const shim = new KittyKeyboardShim(stdin, stdout as unknown as NodeJS.WriteStream, "win32", {
			windowsKittyProbeTimeoutMs: 20,
			windowsProbeResponseSuppressMs: 20,
			windowsPreferKittyNative: true,
		});

		shim.start(() => {});

		await wait(40);

		assert.ok(stdout.writes.includes("\x1b[?9001h"));
		assert.strictEqual(shim.kittyNative, false);

		shim.stop();
	});
});
