/**
 * Unit tests for rename_session and delete_session RPC commands.
 *
 * Tests:
 * 1. Core operations (SessionManager + deleteSessionFile)
 * 2. RPC handler validation (empty name, non-existent path, active session)
 *
 * Uses temp files for filesystem operations — no API key needed.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { deleteSessionFile } from "../src/core/session-file-ops.js";
import { SessionManager } from "../src/core/session-manager.js";
import { deleteSessionByPath, renameSessionByPath } from "../src/modes/rpc/rpc-session-mutation.js";
import { assistantMsg, userMsg } from "./utilities.js";

describe("session mutation", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `rpc-session-mutation-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	/** Create a persisted session file in testDir and return its path. */
	function createPersistedSession(name?: string): string {
		const sm = SessionManager.create(testDir, testDir);
		const sessionPath = sm.getSessionFile()!;
		sm.appendMessage(userMsg("test message"));
		sm.appendMessage(assistantMsg("test reply"));
		if (name) {
			sm.appendSessionInfo(name);
		}
		return sessionPath;
	}

	describe("rename_session (core)", () => {
		test("renames an existing session file", () => {
			const sessionPath = createPersistedSession();
			expect(SessionManager.open(sessionPath).getSessionName()).toBeUndefined();

			const mgr = SessionManager.open(sessionPath);
			mgr.appendSessionInfo("new-name");

			expect(SessionManager.open(sessionPath).getSessionName()).toBe("new-name");
		});

		test("overwrites an existing name", () => {
			const sessionPath = createPersistedSession("old-name");
			expect(SessionManager.open(sessionPath).getSessionName()).toBe("old-name");

			const mgr = SessionManager.open(sessionPath);
			mgr.appendSessionInfo("renamed");

			expect(SessionManager.open(sessionPath).getSessionName()).toBe("renamed");
		});

		test("appendSessionInfo with whitespace-only name results in no name", () => {
			const sessionPath = createPersistedSession();
			const mgr = SessionManager.open(sessionPath);
			mgr.appendSessionInfo("  ");

			expect(SessionManager.open(sessionPath).getSessionName()).toBeUndefined();
		});
	});

	describe("delete_session (core)", () => {
		test("deletes an existing session file", async () => {
			const sessionPath = createPersistedSession("doomed");
			expect(existsSync(sessionPath)).toBe(true);

			const result = await deleteSessionFile(sessionPath);

			expect(result.ok).toBe(true);
			expect(existsSync(sessionPath)).toBe(false);
		});

		test("reports ok for already-absent file", async () => {
			const fakePath = join(testDir, "already-gone.jsonl");

			const result = await deleteSessionFile(fakePath);

			expect(result.ok).toBe(true);
		});
	});

	describe("renameSessionByPath (RPC handler logic)", () => {
		test("renames session successfully", () => {
			const sessionPath = createPersistedSession();

			renameSessionByPath(sessionPath, "my-session");

			expect(SessionManager.open(sessionPath).getSessionName()).toBe("my-session");
		});

		test("throws on empty name after trimming", () => {
			const sessionPath = createPersistedSession();

			expect(() => renameSessionByPath(sessionPath, "   ")).toThrow(/empty/i);
		});

		test("throws on non-existent session path", () => {
			const fakePath = join(testDir, "nonexistent.jsonl");

			expect(() => renameSessionByPath(fakePath, "test")).toThrow(/not found/i);
		});
	});

	describe("deleteSessionByPath (RPC handler logic)", () => {
		test("deletes session successfully", async () => {
			const sessionPath = createPersistedSession("doomed");

			await deleteSessionByPath(sessionPath, undefined);

			expect(existsSync(sessionPath)).toBe(false);
		});

		test("throws when deleting the active session", async () => {
			const sessionPath = createPersistedSession("active");

			await expect(deleteSessionByPath(sessionPath, sessionPath)).rejects.toThrow(/active|current/i);
			expect(existsSync(sessionPath)).toBe(true);
		});

		test("throws on non-existent session path", async () => {
			const fakePath = join(testDir, "nonexistent.jsonl");

			await expect(deleteSessionByPath(fakePath, undefined)).rejects.toThrow(/not found/i);
		});
	});
});
