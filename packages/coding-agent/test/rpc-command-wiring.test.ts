import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { SessionManager } from "../src/core/session-manager.js";
import {
	applyRpcLabelChange,
	resolveListSessionsTarget,
	toNavigateTreeOptions,
	toRpcNavigateTreeResult,
	toRpcSessionListItem,
} from "../src/modes/rpc/rpc-command-wiring.js";
import { assistantMsg, userMsg } from "./utilities.js";

interface SessionScopeFixture {
	workspaceRoot: string;
	projectA: string;
	projectB: string;
	sessionDirA: string;
	sessionDirB: string;
	sessionFileB: string;
	sessionManager: SessionManager;
}

function createPersistedSession(
	cwd: string,
	sessionDir: string,
	prefix: string,
): { manager: SessionManager; file: string } {
	mkdirSync(cwd, { recursive: true });
	mkdirSync(sessionDir, { recursive: true });

	const manager = SessionManager.create(cwd, sessionDir);
	manager.appendMessage(userMsg(`${prefix} user`));
	manager.appendMessage(assistantMsg(`${prefix} assistant`));

	const file = manager.getSessionFile();
	if (!file) {
		throw new Error("Expected persisted session file path");
	}

	return { manager, file };
}

function createFixture(): SessionScopeFixture {
	const workspaceRoot = join(tmpdir(), `pi-rpc-list-sessions-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const projectA = join(workspaceRoot, "project-a");
	const projectB = join(workspaceRoot, "project-b");
	const sessionDirA = join(workspaceRoot, "sessions-a");
	const sessionDirB = join(workspaceRoot, "sessions-b");

	const { manager: sessionManagerA } = createPersistedSession(projectA, sessionDirA, "A");
	const { file: sessionFileB } = createPersistedSession(projectB, sessionDirB, "B");

	return {
		workspaceRoot,
		projectA,
		projectB,
		sessionDirA,
		sessionDirB,
		sessionFileB,
		sessionManager: sessionManagerA,
	};
}

describe("rpc list_sessions scope resolution", () => {
	let fixture: SessionScopeFixture;

	beforeEach(() => {
		fixture = createFixture();
	});

	afterEach(() => {
		if (existsSync(fixture.workspaceRoot)) {
			rmSync(fixture.workspaceRoot, { recursive: true });
		}
	});

	test("scope: current follows active session state after session switch", () => {
		const manager = fixture.sessionManager;

		const beforeSwitchTarget = resolveListSessionsTarget({ sessionManager: manager }, "current");
		expect(beforeSwitchTarget.listAll).toBe(false);
		expect(beforeSwitchTarget.cwd).toBe(fixture.projectA);
		expect(beforeSwitchTarget.sessionDir).toBe(fixture.sessionDirA);

		manager.setSessionFile(fixture.sessionFileB);
		manager.syncLocation();
		const afterSwitchTarget = resolveListSessionsTarget({ sessionManager: manager }, "current");

		expect(manager.getCwd()).toBe(fixture.projectB);
		expect(manager.getSessionDir()).toBe(fixture.sessionDirB);
		expect(afterSwitchTarget.cwd).toBe(fixture.projectB);
		expect(afterSwitchTarget.sessionDir).toBe(fixture.sessionDirB);
	});

	test("scope: all resolves to global listing", () => {
		const manager = fixture.sessionManager;
		const target = resolveListSessionsTarget({ sessionManager: manager }, "all");

		expect(target.listAll).toBe(true);
		expect(target.cwd).toBe(manager.getCwd());
		expect(target.sessionDir).toBeUndefined();
	});

	test("defaults to current scope when scope is omitted", () => {
		const manager = fixture.sessionManager;
		const target = resolveListSessionsTarget({ sessionManager: manager }, undefined);

		expect(target.listAll).toBe(false);
		expect(target.cwd).toBe(fixture.projectA);
		expect(target.sessionDir).toBe(fixture.sessionDirA);
	});

	test("normalizes blank session directories to undefined", () => {
		const target = resolveListSessionsTarget(
			{
				sessionManager: {
					getCwd: () => "/fallback-cwd",
					getSessionDir: () => "   ",
				},
			},
			"current",
		);

		expect(target.cwd).toBe("/fallback-cwd");
		expect(target.sessionDir).toBeUndefined();
	});
});

describe("toRpcSessionListItem", () => {
	const sample = {
		path: "/tmp/s.jsonl",
		id: "session-id",
		cwd: "/tmp",
		name: "sample",
		parentSessionPath: "/tmp/parent.jsonl",
		created: new Date("2026-01-01T00:00:00.000Z"),
		modified: new Date("2026-01-01T00:01:00.000Z"),
		messageCount: 3,
		firstMessage: "hello",
		allMessagesText: "hello world",
	};

	test("always includes allMessagesText", () => {
		const item = toRpcSessionListItem(sample);
		expect(item.allMessagesText).toBe("hello world");
	});

	test("normalizes path and date fields for rpc transport", () => {
		const item = toRpcSessionListItem({ ...sample, path: "relative/session.jsonl" });

		expect(item.path).toBe(resolve("relative/session.jsonl"));
		expect(item.created).toBe(sample.created.toISOString());
		expect(item.modified).toBe(sample.modified.toISOString());
	});

	test("falls back to epoch timestamp for invalid dates", () => {
		const invalidDate = new Date("invalid-date");
		const item = toRpcSessionListItem({ ...sample, created: invalidDate, modified: invalidDate });

		expect(item.created).toBe("1970-01-01T00:00:00.000Z");
		expect(item.modified).toBe("1970-01-01T00:00:00.000Z");
	});
});

describe("toNavigateTreeOptions", () => {
	test("normalizes whitespace labels to undefined", () => {
		const options = toNavigateTreeOptions({
			summarize: true,
			customInstructions: "focus",
			replaceInstructions: false,
			label: "   ",
		});

		expect(options).toEqual({
			summarize: true,
			customInstructions: "focus",
			replaceInstructions: false,
			label: undefined,
		});
	});
});

describe("toRpcNavigateTreeResult", () => {
	test("maps summary metadata to rpc shape", () => {
		const result = toRpcNavigateTreeResult({
			cancelled: false,
			editorText: "draft",
			summaryEntry: {
				id: "summary-1",
				summary: "summary text",
				fromHook: true,
			},
		});

		expect(result.editorText).toBe("draft");
		expect(result.summaryEntry?.fromExtension).toBe(true);
	});

	test("maps missing fromHook to false for stable transport semantics", () => {
		const result = toRpcNavigateTreeResult({
			cancelled: false,
			summaryEntry: {
				id: "summary-2",
				summary: "summary text",
			},
		});

		expect(result.summaryEntry?.fromExtension).toBe(false);
	});

	test("preserves cancelled/aborted navigation states", () => {
		const result = toRpcNavigateTreeResult({ cancelled: true, aborted: true });

		expect(result.cancelled).toBe(true);
		expect(result.aborted).toBe(true);
		expect(result.summaryEntry).toBeUndefined();
	});
});

describe("applyRpcLabelChange", () => {
	test("sets label on existing entry", () => {
		const manager = SessionManager.inMemory();
		const entryId = manager.appendMessage(userMsg("Hello"));

		applyRpcLabelChange(manager, entryId, "checkpoint");

		expect(manager.getLabel(entryId)).toBe("checkpoint");
	});

	test("clears label when label is undefined", () => {
		const manager = SessionManager.inMemory();
		const entryId = manager.appendMessage(userMsg("Hello"));

		applyRpcLabelChange(manager, entryId, "checkpoint");
		applyRpcLabelChange(manager, entryId, undefined);

		expect(manager.getLabel(entryId)).toBeUndefined();
	});

	test("clears label when label is empty or whitespace", () => {
		const manager = SessionManager.inMemory();
		const entryId = manager.appendMessage(userMsg("Hello"));

		applyRpcLabelChange(manager, entryId, "checkpoint");
		applyRpcLabelChange(manager, entryId, "   ");

		expect(manager.getLabel(entryId)).toBeUndefined();
	});

	test("throws when entry does not exist", () => {
		const manager = SessionManager.inMemory();
		expect(() => applyRpcLabelChange(manager, "missing", "label")).toThrow("Entry missing not found");
	});
});
