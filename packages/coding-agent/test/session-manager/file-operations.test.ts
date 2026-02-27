import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findMostRecentSession, loadEntriesFromFile, SessionManager } from "../../src/core/session-manager.js";

describe("loadEntriesFromFile", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `session-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns empty array for non-existent file", () => {
		const entries = loadEntriesFromFile(join(tempDir, "nonexistent.jsonl"));
		expect(entries).toEqual([]);
	});

	it("returns empty array for empty file", () => {
		const file = join(tempDir, "empty.jsonl");
		writeFileSync(file, "");
		expect(loadEntriesFromFile(file)).toEqual([]);
	});

	it("returns empty array for file without valid session header", () => {
		const file = join(tempDir, "no-header.jsonl");
		writeFileSync(file, '{"type":"message","id":"1"}\n');
		expect(loadEntriesFromFile(file)).toEqual([]);
	});

	it("returns empty array for malformed JSON", () => {
		const file = join(tempDir, "malformed.jsonl");
		writeFileSync(file, "not json\n");
		expect(loadEntriesFromFile(file)).toEqual([]);
	});

	it("loads valid session file", () => {
		const file = join(tempDir, "valid.jsonl");
		writeFileSync(
			file,
			'{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n' +
				'{"type":"message","id":"1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":"hi","timestamp":1}}\n',
		);
		const entries = loadEntriesFromFile(file);
		expect(entries).toHaveLength(2);
		expect(entries[0].type).toBe("session");
		expect(entries[1].type).toBe("message");
	});

	it("skips malformed lines but keeps valid ones", () => {
		const file = join(tempDir, "mixed.jsonl");
		writeFileSync(
			file,
			'{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n' +
				"not valid json\n" +
				'{"type":"message","id":"1","parentId":null,"timestamp":"2025-01-01T00:00:01Z","message":{"role":"user","content":"hi","timestamp":1}}\n',
		);
		const entries = loadEntriesFromFile(file);
		expect(entries).toHaveLength(2);
	});
});

describe("findMostRecentSession", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `session-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("returns null for empty directory", () => {
		expect(findMostRecentSession(tempDir)).toBeNull();
	});

	it("returns null for non-existent directory", () => {
		expect(findMostRecentSession(join(tempDir, "nonexistent"))).toBeNull();
	});

	it("ignores non-jsonl files", () => {
		writeFileSync(join(tempDir, "file.txt"), "hello");
		writeFileSync(join(tempDir, "file.json"), "{}");
		expect(findMostRecentSession(tempDir)).toBeNull();
	});

	it("ignores jsonl files without valid session header", () => {
		writeFileSync(join(tempDir, "invalid.jsonl"), '{"type":"message"}\n');
		expect(findMostRecentSession(tempDir)).toBeNull();
	});

	it("returns single valid session file", () => {
		const file = join(tempDir, "session.jsonl");
		writeFileSync(file, '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n');
		expect(findMostRecentSession(tempDir)).toBe(file);
	});

	it("returns most recently modified session", async () => {
		const file1 = join(tempDir, "older.jsonl");
		const file2 = join(tempDir, "newer.jsonl");

		writeFileSync(file1, '{"type":"session","id":"old","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n');
		// Small delay to ensure different mtime
		await new Promise((r) => setTimeout(r, 10));
		writeFileSync(file2, '{"type":"session","id":"new","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n');

		expect(findMostRecentSession(tempDir)).toBe(file2);
	});

	it("skips invalid files and returns valid one", async () => {
		const invalid = join(tempDir, "invalid.jsonl");
		const valid = join(tempDir, "valid.jsonl");

		writeFileSync(invalid, '{"type":"not-session"}\n');
		await new Promise((r) => setTimeout(r, 10));
		writeFileSync(valid, '{"type":"session","id":"abc","timestamp":"2025-01-01T00:00:00Z","cwd":"/tmp"}\n');

		expect(findMostRecentSession(tempDir)).toBe(valid);
	});
});

describe("SessionManager.setSessionFile with corrupted files", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `session-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("truncates and rewrites empty file with valid header", () => {
		const emptyFile = join(tempDir, "empty.jsonl");
		writeFileSync(emptyFile, "");

		const sm = SessionManager.open(emptyFile, tempDir);

		// Should have created a new session with valid header
		expect(sm.getSessionId()).toBeTruthy();
		expect(sm.getHeader()).toBeTruthy();
		expect(sm.getHeader()?.type).toBe("session");

		// File should now contain a valid header
		const content = readFileSync(emptyFile, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);
		expect(lines.length).toBe(1);
		const header = JSON.parse(lines[0]);
		expect(header.type).toBe("session");
		expect(header.id).toBe(sm.getSessionId());
	});

	it("truncates and rewrites file without valid header", () => {
		const noHeaderFile = join(tempDir, "no-header.jsonl");
		// File with messages but no session header (corrupted state)
		writeFileSync(
			noHeaderFile,
			'{"type":"message","id":"abc","parentId":"orphaned","timestamp":"2025-01-01T00:00:00Z","message":{"role":"assistant","content":"test"}}\n',
		);

		const sm = SessionManager.open(noHeaderFile, tempDir);

		// Should have created a new session with valid header
		expect(sm.getSessionId()).toBeTruthy();
		expect(sm.getHeader()).toBeTruthy();
		expect(sm.getHeader()?.type).toBe("session");

		// File should now contain only a valid header (old content truncated)
		const content = readFileSync(noHeaderFile, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);
		expect(lines.length).toBe(1);
		const header = JSON.parse(lines[0]);
		expect(header.type).toBe("session");
		expect(header.id).toBe(sm.getSessionId());
	});

	it("preserves explicit session file path when recovering from corrupted file", () => {
		const explicitPath = join(tempDir, "my-session.jsonl");
		writeFileSync(explicitPath, "");

		const sm = SessionManager.open(explicitPath, tempDir);

		// The session file path should be preserved
		expect(sm.getSessionFile()).toBe(explicitPath);
	});

	it("subsequent loads of recovered file work correctly", () => {
		const corruptedFile = join(tempDir, "corrupted.jsonl");
		writeFileSync(corruptedFile, "garbage content\n");

		// First open recovers the file
		const sm1 = SessionManager.open(corruptedFile, tempDir);
		const sessionId = sm1.getSessionId();

		// Second open should load the recovered file successfully
		const sm2 = SessionManager.open(corruptedFile, tempDir);
		expect(sm2.getSessionId()).toBe(sessionId);
		expect(sm2.getHeader()?.type).toBe("session");
	});

	it("rewrites deferred pre-assistant state instead of duplicating the existing session prefix", () => {
		const sessionFile = join(tempDir, "preassistant-prefix.jsonl");
		writeFileSync(
			sessionFile,
			[
				JSON.stringify({
					type: "session",
					version: 3,
					id: "session-1",
					timestamp: "2026-02-24T21:10:41.329Z",
					cwd: tempDir,
				}),
				JSON.stringify({
					type: "model_change",
					id: "root0001",
					parentId: null,
					timestamp: "2026-02-24T21:10:42.000Z",
					provider: "openai-codex",
					modelId: "gpt-5.3-codex",
				}),
				JSON.stringify({
					type: "thinking_level_change",
					id: "child0001",
					parentId: "root0001",
					timestamp: "2026-02-24T21:10:43.000Z",
					thinkingLevel: "xhigh",
				}),
				"",
			].join("\n"),
		);

		const session = SessionManager.open(sessionFile, tempDir);
		session.appendCustomEntry("plan-mode", { enabled: false });
		session.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "ready" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		});

		const lines = readFileSync(sessionFile, "utf-8").trim().split("\n").filter(Boolean);
		const records = lines.map((line) => JSON.parse(line));

		expect(records.filter((record) => record.type === "session")).toHaveLength(1);

		const entryIds = records
			.filter((record) => record.type !== "session")
			.map((record) => record.id)
			.filter((id): id is string => typeof id === "string");
		expect(new Set(entryIds).size).toBe(entryIds.length);
	});

	it("deduplicates duplicate entry IDs when building tree from malformed files", () => {
		const malformedFile = join(tempDir, "duplicate-ids.jsonl");
		writeFileSync(
			malformedFile,
			[
				JSON.stringify({
					type: "session",
					version: 3,
					id: "session-2",
					timestamp: "2026-02-24T21:10:41.329Z",
					cwd: tempDir,
				}),
				JSON.stringify({
					type: "custom",
					customType: "marker",
					id: "root0001",
					parentId: null,
					timestamp: "2026-02-24T21:10:42.000Z",
				}),
				JSON.stringify({
					type: "custom",
					customType: "marker",
					id: "child0001",
					parentId: "root0001",
					timestamp: "2026-02-24T21:10:43.000Z",
				}),
				JSON.stringify({
					type: "custom",
					customType: "marker",
					id: "root0001",
					parentId: null,
					timestamp: "2026-02-24T21:10:42.000Z",
				}),
				JSON.stringify({
					type: "custom",
					customType: "marker",
					id: "child0001",
					parentId: "root0001",
					timestamp: "2026-02-24T21:10:43.000Z",
				}),
				JSON.stringify({
					type: "custom",
					customType: "marker",
					id: "leaf0001",
					parentId: "child0001",
					timestamp: "2026-02-24T21:10:44.000Z",
				}),
				"",
			].join("\n"),
		);

		const session = SessionManager.open(malformedFile, tempDir);
		const tree = session.getTree();

		expect(tree).toHaveLength(1);
		expect(tree[0].entry.id).toBe("root0001");
		expect(tree[0].children).toHaveLength(1);
		expect(tree[0].children[0].entry.id).toBe("child0001");
		expect(tree[0].children[0].children).toHaveLength(1);
		expect(tree[0].children[0].children[0].entry.id).toBe("leaf0001");
	});

	it("breaks malformed parent cycles into roots when building a tree", () => {
		const malformedFile = join(tempDir, "parent-cycle.jsonl");
		writeFileSync(
			malformedFile,
			[
				JSON.stringify({
					type: "session",
					version: 3,
					id: "session-3",
					timestamp: "2026-02-24T21:10:41.329Z",
					cwd: tempDir,
				}),
				JSON.stringify({
					type: "custom",
					customType: "marker",
					id: "cycle-a",
					parentId: "cycle-b",
					timestamp: "2026-02-24T21:10:42.000Z",
				}),
				JSON.stringify({
					type: "custom",
					customType: "marker",
					id: "cycle-b",
					parentId: "cycle-a",
					timestamp: "2026-02-24T21:10:43.000Z",
				}),
				"",
			].join("\n"),
		);

		const session = SessionManager.open(malformedFile, tempDir);
		const tree = session.getTree();

		expect(tree).toHaveLength(2);
		expect(tree.map((node) => node.entry.id).sort()).toEqual(["cycle-a", "cycle-b"]);
		expect(tree.every((node) => node.children.length === 0)).toBe(true);
	});
});
