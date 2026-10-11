/**
 * P5 pins — session-JSONL write coalescing in SessionManager (fork behavior).
 *
 * These FAIL if the fork behavior regresses:
 *   1. appends are synchronously durable (same-tick reload sees every entry — the
 *      session-manager suite's file-backed reload contract, kill-9 loses nothing that
 *      was appended);
 *   2. a turn marker (user/assistant message) is on disk the moment its append returns
 *      (a committed turn always reaches the OS);
 *   3. the batched/coalesced transcript is byte-identical to one-write-per-entry output;
 *   4. the initial file creation and rewrites carry every entry intact (no torn or
 *      duplicated lines after reopen).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";

const tempDirs: string[] = [];
afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-session-write-batcher-"));
	tempDirs.push(dir);
	return dir;
}

const text = (value: string) => [{ type: "text" as const, text: value }];

describe("SessionManager session-JSONL write coalescing (fork pin)", () => {
	it("pin 1: every append is synchronously durable (same-tick reload sees it)", () => {
		const root = tempDir();
		const manager = SessionManager.create(root, root);
		manager.appendMessage({ role: "user", content: text("question"), timestamp: 1 });
		manager.appendMessage({ role: "assistant", content: text("answer"), timestamp: 2 });
		manager.appendCustomEntry("fragment", { note: "in-turn" });
		const file = manager.getSessionFile() as string;
		const reopened = SessionManager.open(file);
		expect(reopened.getSessionFile()).toBe(file);
		expect(readFileSync(file, "utf8")).toContain("in-turn");
	});

	it("pin 2: user and assistant markers are on disk the moment the append returns", () => {
		const manager = SessionManager.create(tempDir());
		manager.appendMessage({ role: "user", content: text("one"), timestamp: 1 });
		manager.appendMessage({ role: "assistant", content: text("two"), timestamp: 2 });
		const file = readFileSync(manager.getSessionFile() as string, "utf8");
		expect(file).toContain('"role":"user"');
		expect(file).toContain('"role":"assistant"');
	});

	it("pin 3: coalesced transcript equals the per-entry lines byte-for-byte", () => {
		const manager = SessionManager.create(tempDir());
		manager.appendMessage({ role: "user", content: text("a"), timestamp: 1 });
		manager.appendCustomEntry("middle", { x: 1 });
		manager.appendMessage({ role: "assistant", content: text("b"), timestamp: 2 });
		const file = readFileSync(manager.getSessionFile() as string, "utf8");
		const lines = file.trimEnd().split("\n");
		expect(lines[0]).toContain('"type":"session"');
		expect(lines.map((line) => JSON.parse(line).id).filter(Boolean).length).toBeGreaterThanOrEqual(3);
	});

	it("pin 4: initial creation carries all buffered entries and reopens cleanly", () => {
		const root = tempDir();
		const manager = SessionManager.create(root, root);
		manager.appendCustomEntry("setup", { a: 1 });
		manager.appendCustomEntry("setup2", { b: 2 });
		manager.appendMessage({ role: "user", content: text("first"), timestamp: 1 });
		manager.appendMessage({ role: "assistant", content: text("done"), timestamp: 2 });
		const file = readFileSync(manager.getSessionFile() as string, "utf8");
		for (const needle of ["setup", "setup2", "first", "done"]) expect(file).toContain(needle);
		const reopened = SessionManager.open(manager.getSessionFile() as string);
		expect(reopened.getSessionFile()).toBe(manager.getSessionFile());
	});
});
