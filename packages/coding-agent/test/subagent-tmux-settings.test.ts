import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SettingsManager } from "../src/core/settings-manager.js";

const tempDirs: string[] = [];

function createSettingsHarness(): { agentDir: string; projectDir: string; manager: SettingsManager } {
	const rootDir = mkdtempSync(join(tmpdir(), "pi-subagent-tmux-settings-"));
	tempDirs.push(rootDir);
	const agentDir = join(rootDir, "agent");
	const projectDir = join(rootDir, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(projectDir, { recursive: true });
	return {
		agentDir,
		projectDir,
		manager: SettingsManager.create(projectDir, agentDir),
	};
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("subagent tmux linked window setting", () => {
	it("defaults to linking tmux subagent windows into the current tmux session", () => {
		const { manager } = createSettingsHarness();
		expect(manager.getSubagentTmuxLinkedWindows()).toBe(true);
	});

	it("persists the linked-window tmux preference", async () => {
		const { agentDir, manager } = createSettingsHarness();

		manager.setSubagentTmuxLinkedWindows(false);
		await manager.flush();

		expect(manager.getSubagentTmuxLinkedWindows()).toBe(false);

		const savedSettings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8")) as {
			subagentTmuxLinkedWindows?: boolean;
		};
		expect(savedSettings.subagentTmuxLinkedWindows).toBe(false);
	});
});
