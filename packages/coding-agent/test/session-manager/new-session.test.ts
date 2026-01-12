import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../src/core/session-manager.js";
import { userMsg } from "../utilities.js";

function isInDir(filePath: string, dir: string): boolean {
	const resolvedFile = resolve(filePath);
	const resolvedDir = resolve(dir);
	return resolvedFile === resolvedDir || resolvedFile.startsWith(resolvedDir + sep);
}

describe("SessionManager newSession persistence", () => {
	let tempRoot: string | undefined;

	afterEach(() => {
		if (tempRoot) {
			rmSync(tempRoot, { recursive: true, force: true });
			tempRoot = undefined;
		}
	});

	it("newSession generates a new session file path when persisting", () => {
		tempRoot = mkdtempSync(join(tmpdir(), "pi-session-manager-"));
		const sessionDir = join(tempRoot, "sessions");
		mkdirSync(sessionDir, { recursive: true });

		const session = SessionManager.create("/tmp/cwd", sessionDir);
		const firstFile = session.getSessionFile();
		expect(firstFile).toBeTruthy();
		expect(isInDir(firstFile!, sessionDir)).toBe(true);

		session.newSession();
		const secondFile = session.getSessionFile();
		expect(secondFile).toBeTruthy();
		expect(isInDir(secondFile!, sessionDir)).toBe(true);
		expect(secondFile).not.toBe(firstFile);
	});

	it("open(nonexistent) keeps the explicit session path", () => {
		tempRoot = mkdtempSync(join(tmpdir(), "pi-session-manager-"));
		const explicitPath = join(tempRoot, "explicit.jsonl");

		const session = SessionManager.open(explicitPath);
		expect(session.getSessionFile()).toBe(resolve(explicitPath));
	});

	it("persists after first user message and does not append across /new", () => {
		tempRoot = mkdtempSync(join(tmpdir(), "pi-session-manager-"));
		const sessionDir = join(tempRoot, "sessions");
		mkdirSync(sessionDir, { recursive: true });

		const session = SessionManager.create("/tmp/cwd", sessionDir);
		const firstFile = session.getSessionFile();
		expect(firstFile).toBeTruthy();
		expect(existsSync(firstFile!)).toBe(false);

		session.appendMessage(userMsg("hello"));
		expect(existsSync(firstFile!)).toBe(true);

		const firstLines = readFileSync(firstFile!, "utf8")
			.split("\n")
			.filter((l) => l.trim().length > 0);
		expect(firstLines).toHaveLength(2);
		expect(JSON.parse(firstLines[0])?.type).toBe("session");
		expect(JSON.parse(firstLines[1])?.type).toBe("message");
		expect(JSON.parse(firstLines[1])?.message?.role).toBe("user");

		session.newSession();
		const secondFile = session.getSessionFile();
		expect(secondFile).toBeTruthy();
		expect(secondFile).not.toBe(firstFile);

		session.appendMessage(userMsg("new"));
		expect(existsSync(secondFile!)).toBe(true);

		const firstLinesAfter = readFileSync(firstFile!, "utf8")
			.split("\n")
			.filter((l) => l.trim().length > 0);
		expect(firstLinesAfter).toHaveLength(2);
	});
});
