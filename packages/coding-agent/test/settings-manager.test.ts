import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsManager } from "../src/core/settings-manager.js";

describe("SettingsManager", () => {
	const testDir = join(process.cwd(), "test-settings-tmp");
	const agentDir = join(testDir, "agent");
	const projectDir = join(testDir, "project");

	beforeEach(() => {
		// Clean up and create fresh directories
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

	describe("preserves externally added settings", () => {
		it("should preserve enabledModels when changing thinking level", () => {
			// Create initial settings file
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					theme: "dark",
					defaultModel: "claude-sonnet",
				}),
			);

			// Create SettingsManager (simulates pi starting up)
			const manager = SettingsManager.create(projectDir, agentDir);

			// Simulate user editing settings.json externally to add enabledModels
			const currentSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			currentSettings.enabledModels = ["claude-opus-4-5", "gpt-5.2-codex"];
			writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2));

			// User changes thinking level via Shift+Tab
			manager.setDefaultThinkingLevel("high");

			// Verify enabledModels is preserved
			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.enabledModels).toEqual(["claude-opus-4-5", "gpt-5.2-codex"]);
			expect(savedSettings.defaultThinkingLevel).toBe("high");
			expect(savedSettings.theme).toBe("dark");
			expect(savedSettings.defaultModel).toBe("claude-sonnet");
		});

		it("should preserve custom settings when changing theme", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					defaultModel: "claude-sonnet",
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			// User adds custom settings externally
			const currentSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			currentSettings.shellPath = "/bin/zsh";
			currentSettings.extensions = ["/path/to/extension.ts"];
			writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2));

			// User changes theme
			manager.setTheme("light");

			// Verify all settings preserved
			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.shellPath).toBe("/bin/zsh");
			expect(savedSettings.extensions).toEqual(["/path/to/extension.ts"]);
			expect(savedSettings.theme).toBe("light");
		});

		it("should let in-memory changes override file changes for same key", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					theme: "dark",
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			// User externally sets thinking level to "low"
			const currentSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			currentSettings.defaultThinkingLevel = "low";
			writeFileSync(settingsPath, JSON.stringify(currentSettings, null, 2));

			// But then changes it via UI to "high"
			manager.setDefaultThinkingLevel("high");

			// In-memory change should win
			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.defaultThinkingLevel).toBe("high");
		});
	});

	describe("packages migration", () => {
		it("should keep local-only extensions in extensions array", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					extensions: ["/local/ext.ts", "./relative/ext.ts"],
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getPackages()).toEqual([]);
			expect(manager.getExtensionPaths()).toEqual(["/local/ext.ts", "./relative/ext.ts"]);
		});

		it("should handle packages with filtering objects", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					packages: [
						"npm:simple-pkg",
						{
							source: "npm:shitty-extensions",
							extensions: ["extensions/oracle.ts"],
							skills: [],
						},
					],
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			const packages = manager.getPackages();
			expect(packages).toHaveLength(2);
			expect(packages[0]).toBe("npm:simple-pkg");
			expect(packages[1]).toEqual({
				source: "npm:shitty-extensions",
				extensions: ["extensions/oracle.ts"],
				skills: [],
			});
		});
	});

	describe("reload", () => {
		it("should reload global settings from disk", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					theme: "dark",
					extensions: ["/before.ts"],
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			writeFileSync(
				settingsPath,
				JSON.stringify({
					theme: "light",
					extensions: ["/after.ts"],
					defaultModel: "claude-sonnet",
				}),
			);

			manager.reload();

			expect(manager.getTheme()).toBe("light");
			expect(manager.getExtensionPaths()).toEqual(["/after.ts"]);
			expect(manager.getDefaultModel()).toBe("claude-sonnet");
		});

		it("should keep previous settings when file is invalid", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			writeFileSync(settingsPath, "{ invalid json");
			manager.reload();

			expect(manager.getTheme()).toBe("dark");
		});
	});

	describe("shellCommandPrefix", () => {
		it("should load shellCommandPrefix from settings", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ shellCommandPrefix: "shopt -s expand_aliases" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getShellCommandPrefix()).toBe("shopt -s expand_aliases");
		});

		it("should return undefined when shellCommandPrefix is not set", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }));

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getShellCommandPrefix()).toBeUndefined();
		});

		it("should preserve shellCommandPrefix when saving unrelated settings", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(settingsPath, JSON.stringify({ shellCommandPrefix: "shopt -s expand_aliases" }));

			const manager = SettingsManager.create(projectDir, agentDir);
			manager.setTheme("light");

			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.shellCommandPrefix).toBe("shopt -s expand_aliases");
			expect(savedSettings.theme).toBe("light");
		});
	});

	describe("sessionSearch settings", () => {
		it("should default to enabled=true", () => {
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getSessionSearchEnabled()).toBe(true);
		});

		it("should default to scope=cwd", () => {
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getSessionSearchScope()).toBe("cwd");
		});

		it("should default to recentLimit=25", () => {
			const manager = SettingsManager.create(projectDir, agentDir);
			expect(manager.getSessionSearchRecentLimit()).toBe(25);
		});

		it("should load custom sessionSearch settings", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					sessionSearch: {
						enabled: false,
						scope: "all",
						recentLimit: 50,
					},
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			expect(manager.getSessionSearchEnabled()).toBe(false);
			expect(manager.getSessionSearchScope()).toBe("all");
			expect(manager.getSessionSearchRecentLimit()).toBe(50);
		});

		it("should persist enabled setting", () => {
			const settingsPath = join(agentDir, "settings.json");
			const manager = SettingsManager.create(projectDir, agentDir);

			manager.setSessionSearchEnabled(false);

			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.sessionSearch?.enabled).toBe(false);
		});

		it("should persist scope setting", () => {
			const settingsPath = join(agentDir, "settings.json");
			const manager = SettingsManager.create(projectDir, agentDir);

			manager.setSessionSearchScope("recent");

			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.sessionSearch?.scope).toBe("recent");
		});

		it("should persist recentLimit setting", () => {
			const settingsPath = join(agentDir, "settings.json");
			const manager = SettingsManager.create(projectDir, agentDir);

			manager.setSessionSearchRecentLimit(10);

			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.sessionSearch?.recentLimit).toBe(10);
		});

		it("should clamp recentLimit to 1-100 range", () => {
			const manager = SettingsManager.create(projectDir, agentDir);

			manager.setSessionSearchRecentLimit(0);
			expect(manager.getSessionSearchRecentLimit()).toBe(1);

			manager.setSessionSearchRecentLimit(150);
			expect(manager.getSessionSearchRecentLimit()).toBe(100);

			manager.setSessionSearchRecentLimit(50);
			expect(manager.getSessionSearchRecentLimit()).toBe(50);
		});

		it("should floor fractional recentLimit values", () => {
			const manager = SettingsManager.create(projectDir, agentDir);

			manager.setSessionSearchRecentLimit(15.7);
			expect(manager.getSessionSearchRecentLimit()).toBe(15);
		});

		it("should preserve sessionSearch settings when changing unrelated settings", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					sessionSearch: {
						enabled: false,
						scope: "recent",
						recentLimit: 15,
					},
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);
			manager.setTheme("dark");

			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.sessionSearch).toEqual({
				enabled: false,
				scope: "recent",
				recentLimit: 15,
			});
			expect(savedSettings.theme).toBe("dark");
		});

		it("should only modify changed nested fields", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					sessionSearch: {
						enabled: true,
						scope: "all",
						recentLimit: 25,
					},
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);

			// Externally modify recentLimit
			const current = JSON.parse(readFileSync(settingsPath, "utf-8"));
			current.sessionSearch.recentLimit = 100;
			writeFileSync(settingsPath, JSON.stringify(current));

			// Change only scope via manager
			manager.setSessionSearchScope("cwd");

			// Should preserve external recentLimit change
			const savedSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
			expect(savedSettings.sessionSearch.scope).toBe("cwd");
			expect(savedSettings.sessionSearch.recentLimit).toBe(100);
			expect(savedSettings.sessionSearch.enabled).toBe(true);
		});

		it("should return merged sessionSearch settings", () => {
			const settingsPath = join(agentDir, "settings.json");
			writeFileSync(
				settingsPath,
				JSON.stringify({
					sessionSearch: {
						enabled: false,
						scope: "recent",
						recentLimit: 10,
					},
				}),
			);

			const manager = SettingsManager.create(projectDir, agentDir);
			const settings = manager.getSessionSearchSettings();

			expect(settings).toEqual({
				enabled: false,
				scope: "recent",
				recentLimit: 10,
			});
		});

		it("should return default sessionSearch settings when not configured", () => {
			const manager = SettingsManager.create(projectDir, agentDir);
			const settings = manager.getSessionSearchSettings();

			expect(settings).toEqual({
				enabled: true,
				scope: "cwd",
				recentLimit: 25,
			});
		});
	});
});
