import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSessionManager } from "../src/registry.js";

describe("registry/session manager", () => {
	it("creates, opens and resumes JSONL session files deterministically", () => {
		const cwd = mkdtempSync(join(tmpdir(), "agent-service-registry-"));
		const sessionDir = ".sessions";
		try {
			const first = buildSessionManager(cwd, {}, sessionDir);
			first.appendModelChange("openai", "gpt-test");
			const firstPath = first.getSessionFile();
			expect(firstPath).toBeDefined();

			const opened = buildSessionManager(cwd, { sessionPath: firstPath }, sessionDir);
			expect(basename(opened.getSessionFile() ?? "")).toBe(basename(firstPath ?? ""));

			const resumed = buildSessionManager(cwd, { continueRecent: true }, sessionDir);
			expect((resumed.getSessionFile() ?? "").endsWith(".jsonl")).toBe(true);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
