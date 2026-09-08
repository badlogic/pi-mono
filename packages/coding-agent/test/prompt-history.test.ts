import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PromptHistoryStore } from "../src/core/prompt-history.ts";

describe("PromptHistoryStore", () => {
	const testDir = join(process.cwd(), "test-prompt-history-tmp");
	const agentDir = join(testDir, "agent");
	const workspaceDir = join(testDir, "workspace");
	const childDir = join(workspaceDir, "child");
	const siblingDir = join(testDir, "sibling");

	beforeEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
		mkdirSync(childDir, { recursive: true });
		mkdirSync(siblingDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true });
	});

	it("loads the newest distinct prompts from a workspace and its children", () => {
		const history = new PromptHistoryStore(agentDir);

		history.record(workspaceDir, "  root prompt  ");
		history.record(childDir, "child prompt");
		history.record(childDir, "root prompt");

		expect(history.load(workspaceDir)).toEqual(["root prompt", "child prompt"]);
		expect(history.load(childDir)).toEqual(["root prompt", "child prompt"]);
	});

	it("does not load prompts from a parent or sibling workspace", () => {
		const history = new PromptHistoryStore(agentDir);

		history.record(testDir, "parent prompt");
		history.record(workspaceDir, "workspace prompt");
		history.record(siblingDir, "sibling prompt");

		expect(history.load(workspaceDir)).toEqual(["workspace prompt"]);
	});

	it("does not persist prompts larger than 16 KiB", () => {
		const history = new PromptHistoryStore(agentDir);

		history.record(workspaceDir, "x".repeat(16 * 1024 + 1));

		expect(history.load(workspaceDir)).toEqual([]);
	});

	it("persists the first prompt when another process briefly holds the history lock", async () => {
		const history = new PromptHistoryStore(agentDir);
		const historyPath = join(agentDir, "prompt-history.json");
		mkdirSync(agentDir);
		const child = spawn(
			process.execPath,
			[
				"-e",
				'const lockfile = require("proper-lockfile"); const release = lockfile.lockSync(process.argv[1], { realpath: false }); process.stdout.write("locked\\n"); setTimeout(() => release(), 50);',
				historyPath,
			],
			{ cwd: process.cwd(), stdio: ["ignore", "pipe", "inherit"] },
		);
		if (!child.stdout) throw new Error("Child stdout is unavailable");
		await once(child.stdout, "data");

		history.record(workspaceDir, "during lock");
		await once(child, "exit");

		expect(history.load(workspaceDir)).toEqual(["during lock"]);
	});

	it("keeps at most 100 prompts across all workspaces", () => {
		const history = new PromptHistoryStore(agentDir);

		for (let index = 0; index < 101; index++) {
			const cwd = join(testDir, `workspace-${index}`);
			mkdirSync(cwd);
			history.record(cwd, `prompt ${index}`);
		}

		const stored = JSON.parse(readFileSync(join(agentDir, "prompt-history.json"), "utf8"));
		expect(stored.entries).toHaveLength(100);
	});
});
