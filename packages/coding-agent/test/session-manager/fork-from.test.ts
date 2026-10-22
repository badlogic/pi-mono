import type * as Fs from "node:fs";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";

const { openSyncSpy, appendFileSyncSpy } = vi.hoisted(() => ({
	openSyncSpy: vi.fn(),
	appendFileSyncSpy: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof Fs>();
	openSyncSpy.mockImplementation(actual.openSync);
	appendFileSyncSpy.mockImplementation(actual.appendFileSync);
	return { ...actual, openSync: openSyncSpy, appendFileSync: appendFileSyncSpy };
});

describe("SessionManager.forkFrom", () => {
	// Regression test for #11253: forking reopened the target file once per entry.
	it("copies all entries while opening the new session file only once for writing", () => {
		const tempDir = mkdtempSync(join(tmpdir(), "pi-fork-from-"));
		const sourcePath = join(tempDir, "source.jsonl");
		const lines = [
			JSON.stringify({
				type: "session",
				version: 3,
				id: "source-id",
				timestamp: new Date().toISOString(),
				cwd: tempDir,
			}),
		];
		let parentId: string | null = null;
		for (let i = 0; i < 50; i++) {
			const id = `e${i}`;
			lines.push(
				JSON.stringify({
					type: "message",
					id,
					parentId,
					timestamp: new Date().toISOString(),
					message: { role: "user", content: `message ${i}`, timestamp: 0 },
				}),
			);
			parentId = id;
		}
		writeFileSync(sourcePath, `${lines.join("\n")}\n`);

		const targetDir = join(tempDir, "sessions");
		openSyncSpy.mockClear();
		appendFileSyncSpy.mockClear();
		const forked = SessionManager.forkFrom(sourcePath, tempDir, targetDir);
		const newFile = forked.getSessionFile()!;

		const writeOpens = openSyncSpy.mock.calls.filter(([path, flags]) => path === newFile && flags !== "r");
		expect(writeOpens).toEqual([[newFile, "wx"]]);
		expect(appendFileSyncSpy.mock.calls.filter(([path]) => path === newFile)).toHaveLength(0);

		const written = readFileSync(newFile, "utf8").trimEnd().split("\n");
		expect(written).toHaveLength(51);
		expect(JSON.parse(written[0]).parentSession).toBe(sourcePath);
		expect(written.slice(1)).toEqual(lines.slice(1));
		expect(forked.getEntries()).toHaveLength(50);
	});
});
