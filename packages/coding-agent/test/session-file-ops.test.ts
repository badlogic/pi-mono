/**
 * Unit tests for session-file-ops.ts.
 *
 * Tests deleteSessionFile() — the shared utility for session deletion
 * with trash→unlink fallback logic. Uses temp files for isolation.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { deleteSessionFile } from "../src/core/session-file-ops.js";

function createTempFile(dir: string, name = "test-session.jsonl"): string {
	const filePath = join(dir, name);
	writeFileSync(filePath, '{"type":"test"}\n', "utf-8");
	return filePath;
}

describe("deleteSessionFile", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `pi-session-ops-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	test("deletes an existing file and reports method", async () => {
		const filePath = createTempFile(testDir);

		expect(existsSync(filePath)).toBe(true);
		const result = await deleteSessionFile(filePath);

		expect(result.ok).toBe(true);
		expect(result.method).toMatch(/^(trash|unlink)$/);
		expect(existsSync(filePath)).toBe(false);
	});

	test("reports success for non-existent file (idempotent)", async () => {
		const filePath = join(testDir, "does-not-exist.jsonl");

		expect(existsSync(filePath)).toBe(false);
		const result = await deleteSessionFile(filePath);

		// trash may exit 0 or non-zero for missing files depending on implementation,
		// but the function should always report ok: true when file doesn't exist
		expect(result.ok).toBe(true);
	});
});
