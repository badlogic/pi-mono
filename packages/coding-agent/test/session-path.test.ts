import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { getSessionPathNotFoundHint, isPathLikeSessionArg, resolveSessionPath } from "../src/cli/session-path.js";

describe("session path resolution", () => {
	const tempDirs: string[] = [];

	const createTempDir = (): string => {
		const dir = mkdtempSync(join(tmpdir(), "pi-session-path-"));
		tempDirs.push(dir);
		return dir;
	};

	afterEach(() => {
		for (const dir of tempDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		tempDirs.length = 0;
	});

	it("detects path-like session args", () => {
		expect(isPathLikeSessionArg("C:\\Users\\Admin\\session.jsonl")).toBe(true);
		expect(isPathLikeSessionArg("C:/Users/Admin/session.jsonl")).toBe(true);
		expect(isPathLikeSessionArg("/tmp/session.jsonl")).toBe(true);
		expect(isPathLikeSessionArg("94a31582")).toBe(false);
	});

	it("detects likely Git Bash/MSYS escaped Windows paths", () => {
		const escapedPath = "C:UsersAdmin.piagentsessions--C--Users-Admin--2026-03-02.jsonl";
		const hint = getSessionPathNotFoundHint(escapedPath);
		expect(hint).toContain("unquoted Windows path");
		expect(hint).toContain("quote the path");
		expect(getSessionPathNotFoundHint("C:/Users/Admin/.pi/agent/sessions/session.jsonl")).toBeUndefined();
	});

	it("resolves existing explicit session paths", async () => {
		const cwd = createTempDir();
		const file = join(cwd, "session.jsonl");
		writeFileSync(
			file,
			`${JSON.stringify({ type: "session", version: 3, id: "abc", timestamp: "2026-01-01T00:00:00.000Z", cwd })}\n`,
		);

		const resolved = await resolveSessionPath(file, cwd);
		expect(resolved).toEqual({ type: "path", path: file });
	});

	it("treats existing directories as missing session files", async () => {
		const cwd = createTempDir();
		const sessionDir = join(cwd, "session.jsonl");
		mkdirSync(sessionDir, { recursive: true });

		const resolved = await resolveSessionPath(sessionDir, cwd);
		expect(resolved.type).toBe("not_found");
		if (resolved.type !== "not_found") {
			throw new Error("Expected not_found result");
		}
		expect(resolved.pathLike).toBe(true);
	});

	it("returns not_found for missing path-like args and includes escaped-path hint", async () => {
		const cwd = createTempDir();
		const escapedPath = "C:UsersAdmin.piagentsessions--C--Users-Admin--2026-03-02.jsonl";

		const resolved = await resolveSessionPath(escapedPath, cwd);
		expect(resolved.type).toBe("not_found");
		if (resolved.type !== "not_found") {
			throw new Error("Expected not_found result");
		}
		expect(resolved.pathLike).toBe(true);
		expect(resolved.hint).toContain("Git Bash/MSYS");
	});

	it("resolves local session ID prefixes", async () => {
		const cwd = createTempDir();
		const sessionDir = join(cwd, "sessions");
		mkdirSync(sessionDir, { recursive: true });

		const sessionId = "94a31582-6d60-4d01-a5ae-0e17bc89a312";
		const file = join(sessionDir, `2026-03-02T21-23-51-158Z_${sessionId}.jsonl`);
		writeFileSync(
			file,
			`${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: "2026-03-02T21:23:51.158Z", cwd })}\n`,
		);

		const resolved = await resolveSessionPath("94a31582", cwd, sessionDir);
		expect(resolved.type).toBe("local");
		if (resolved.type !== "local") {
			throw new Error("Expected local result");
		}
		expect(resolved.path).toBe(file);
	});

	it("returns not_found for unknown ID prefixes", async () => {
		const cwd = createTempDir();
		const sessionDir = join(cwd, "sessions");
		mkdirSync(sessionDir, { recursive: true });

		const resolved = await resolveSessionPath("unknown-session-id", cwd, sessionDir);
		expect(resolved).toEqual({
			type: "not_found",
			arg: "unknown-session-id",
			pathLike: false,
		});
	});
});
