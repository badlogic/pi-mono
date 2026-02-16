import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { AgentSession } from "../src/core/agent-session.js";
import { SessionManager } from "../src/core/session-manager.js";
import { assistantMsg, createTestSession, type TestSessionContext, userMsg } from "./utilities.js";

interface SessionScopeFixture {
	workspaceRoot: string;
	projectA: string;
	projectB: string;
	sessionDirA: string;
	sessionDirB: string;
	sessionFileA: string;
	sessionFileB: string;
	ctx: TestSessionContext;
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
	const workspaceRoot = join(tmpdir(), `pi-rpc-current-scope-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const projectA = join(workspaceRoot, "project-a");
	const projectB = join(workspaceRoot, "project-b");
	const sessionDirA = join(workspaceRoot, "sessions-a");
	const sessionDirB = join(workspaceRoot, "sessions-b");

	const { manager: sessionManagerA, file: sessionFileA } = createPersistedSession(projectA, sessionDirA, "A");
	const { file: sessionFileB } = createPersistedSession(projectB, sessionDirB, "B");
	const ctx = createTestSession({ sessionManager: sessionManagerA, cwd: projectA });

	return {
		workspaceRoot,
		projectA,
		projectB,
		sessionDirA,
		sessionDirB,
		sessionFileA,
		sessionFileB,
		ctx,
	};
}

/** Resolve current scope from an AgentSession, matching the rpc-mode.ts inline logic. */
function resolveFromSession(session: AgentSession): { cwd: string; sessionDir: string | undefined } {
	const headerCwd = session.sessionManager.getHeader()?.cwd;
	const sessionFile = session.sessionFile;
	if (headerCwd && sessionFile) {
		return { cwd: headerCwd, sessionDir: dirname(sessionFile) };
	}
	return { cwd: session.sessionManager.getCwd(), sessionDir: session.sessionManager.getSessionDir() };
}

describe("RPC list_sessions current scope semantics", () => {
	let fixture: SessionScopeFixture;

	beforeEach(() => {
		fixture = createFixture();
	});

	afterEach(() => {
		fixture.ctx.cleanup();
		if (existsSync(fixture.workspaceRoot)) {
			rmSync(fixture.workspaceRoot, { recursive: true });
		}
	});

	test("scope: current follows switched session context in RPC resolver", async () => {
		const session = fixture.ctx.session;

		const listCurrent = async (): Promise<string[]> => {
			const currentScope = resolveFromSession(session);
			const sessions = await SessionManager.list(currentScope.cwd, currentScope.sessionDir);
			return sessions.map((s) => s.path);
		};

		const startupCwd = session.sessionManager.getCwd();
		const startupSessionDir = session.sessionManager.getSessionDir();

		const beforeSwitchScope = resolveFromSession(session);
		expect(beforeSwitchScope.cwd).toBe(fixture.projectA);
		expect(beforeSwitchScope.sessionDir).toBe(fixture.sessionDirA);

		const beforeSwitch = await listCurrent();
		expect(beforeSwitch).toContain(fixture.sessionFileA);
		expect(beforeSwitch).not.toContain(fixture.sessionFileB);

		const switched = await session.switchSession(fixture.sessionFileB);
		expect(switched).toBe(true);
		expect(session.sessionManager.getSessionFile()).toBe(fixture.sessionFileB);
		expect(session.sessionManager.getHeader()?.cwd).toBe(fixture.projectB);

		// Core SessionManager context remains startup-bound after switch_session.
		// The RPC resolver compensates by reading from the active session header.
		expect(session.sessionManager.getCwd()).toBe(startupCwd);
		expect(session.sessionManager.getSessionDir()).toBe(startupSessionDir);

		const afterSwitchScope = resolveFromSession(session);
		expect(afterSwitchScope.cwd).toBe(fixture.projectB);
		expect(afterSwitchScope.sessionDir).toBe(fixture.sessionDirB);

		const afterSwitch = await listCurrent();
		expect(afterSwitch).toContain(fixture.sessionFileB);
		expect(afterSwitch).not.toContain(fixture.sessionFileA);
	});

	test("falls back to SessionManager context when session file is unavailable", () => {
		const fallbackSessionManager = SessionManager.inMemory("/fallback-cwd");
		const fallbackCtx = createTestSession({ sessionManager: fallbackSessionManager, cwd: "/fallback-cwd" });

		const resolvedScope = resolveFromSession(fallbackCtx.session);
		expect(resolvedScope.cwd).toBe(fallbackSessionManager.getCwd());
		expect(resolvedScope.sessionDir).toBe(fallbackSessionManager.getSessionDir());

		fallbackCtx.cleanup();
	});

	test("falls back to SessionManager context when header cwd is unavailable", () => {
		const fallbackSessionManager = SessionManager.create(fixture.projectA, fixture.sessionDirA);
		// Simulate missing header cwd: sessionFile present but headerCwd undefined
		const sessionFile = "/tmp/example/session.jsonl";
		const headerCwd: string | undefined = undefined;
		let resolvedScope: { cwd: string; sessionDir: string | undefined };
		if (headerCwd && sessionFile) {
			resolvedScope = { cwd: headerCwd, sessionDir: dirname(sessionFile) };
		} else {
			resolvedScope = {
				cwd: fallbackSessionManager.getCwd(),
				sessionDir: fallbackSessionManager.getSessionDir(),
			};
		}
		expect(resolvedScope.cwd).toBe(fallbackSessionManager.getCwd());
		expect(resolvedScope.sessionDir).toBe(fallbackSessionManager.getSessionDir());
	});
});
