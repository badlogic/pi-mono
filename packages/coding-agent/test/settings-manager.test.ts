import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.js";

const testDir = join(__dirname, "fixtures/settings-test");
const globalDir = join(testDir, "global");
const projectDir = join(testDir, "project");
const projectSettingsDir = join(projectDir, ".pi");

describe("SettingsManager", () => {
	beforeEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
		mkdirSync(globalDir, { recursive: true });
		mkdirSync(projectSettingsDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true });
		}
	});

	describe("project settings merge", () => {
		it("should deep merge nested objects (skills, retry, etc)", () => {
			writeFileSync(
				join(globalDir, "settings.json"),
				JSON.stringify({
					skills: { enabled: true, enableCodexUser: true, enableClaudeUser: true },
				}),
			);
			writeFileSync(
				join(projectSettingsDir, "settings.json"),
				JSON.stringify({
					skills: { enableCodexUser: false },
				}),
			);

			const manager = new SettingsManager(globalDir, projectDir);
			const skillsSettings = manager.getSkillsSettings();

			// enableCodexUser overridden by project, others preserved from global
			expect(skillsSettings.enabled).toBe(true);
			expect(skillsSettings.enableCodexUser).toBe(false);
			expect(skillsSettings.enableClaudeUser).toBe(true);
		});

		it("should replace arrays entirely (not merge)", () => {
			writeFileSync(
				join(globalDir, "settings.json"),
				JSON.stringify({
					hooks: ["/global/hook1.ts", "/global/hook2.ts"],
				}),
			);
			writeFileSync(
				join(projectSettingsDir, "settings.json"),
				JSON.stringify({
					hooks: ["/project/hook.ts"],
				}),
			);

			const manager = new SettingsManager(globalDir, projectDir);

			expect(manager.getHookPaths()).toEqual(["/project/hook.ts"]);
		});

		it("should save to global settings only, preserving project overrides", () => {
			writeFileSync(join(globalDir, "settings.json"), JSON.stringify({ defaultModel: "claude-sonnet" }));
			writeFileSync(join(projectSettingsDir, "settings.json"), JSON.stringify({ defaultModel: "gpt-4o" }));

			const manager = new SettingsManager(globalDir, projectDir);
			manager.setDefaultModel("new-model");

			// Project file should be untouched
			const projectContent = JSON.parse(readFileSync(join(projectSettingsDir, "settings.json"), "utf-8"));
			expect(projectContent.defaultModel).toBe("gpt-4o");

			// Global file should have the new value
			const globalContent = JSON.parse(readFileSync(join(globalDir, "settings.json"), "utf-8"));
			expect(globalContent.defaultModel).toBe("new-model");

			// Getter returns project override (project takes precedence)
			expect(manager.getDefaultModel()).toBe("gpt-4o");
		});
	});
});
