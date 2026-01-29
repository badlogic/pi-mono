import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.js";

describe("SettingsManager - Corruption Protection", () => {
	const testDir = join(process.cwd(), "test-settings-corruption-tmp");
	const agentDir = join(testDir, "agent");
	const projectDir = join(testDir, "project");

	beforeEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(join(projectDir, ".pi"), { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
	});

	it("should NOT overwrite corrupted settings.json with minimal settings", () => {
		const settingsPath = join(agentDir, "settings.json");

		// Initial state: corrupted JSON (trailing comma)
		const corruptedContent = `{
  "theme": "dark",
  "packages": ["npm:pi-mcp-adapter"],
}`;
		writeFileSync(settingsPath, corruptedContent);

		// Pi starts up, loads settings. Should warn but NOT wipe if we fix it.
		// Currently it wipes.
		const manager = SettingsManager.create(projectDir, agentDir);

		// User changes an UNRELATED setting via UI (this triggers save)
		manager.setTheme("light");

		const savedContent = readFileSync(settingsPath, "utf-8");

		// The file should NOT have been overwritten with valid JSON.
		// It should still contain the corrupted content.
		expect(savedContent).toBe(corruptedContent);
	});
});
