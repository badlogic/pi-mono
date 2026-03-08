import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPluginCommand } from "../src/cli/plugin-command.js";
import { SettingsManager } from "../src/core/settings-manager.js";

describe("plugin command", () => {
	let tempDir: string;
	let agentDir: string;
	let pluginDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-plugin-command-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		agentDir = join(tempDir, "agent");
		pluginDir = join(tempDir, "plugin");
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(pluginDir, { recursive: true });
		process.exitCode = undefined;
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("lists no plugins when settings are empty", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await runPluginCommand(["list"], { cwd: tempDir, agentDir });
			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain("No plugins installed");
			expect(process.exitCode).toBeUndefined();
		} finally {
			logSpy.mockRestore();
		}
	});

	it("installs a local plugin into project scope and lists it as json", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await runPluginCommand(["install", pluginDir, "--local"], { cwd: tempDir, agentDir });
			logSpy.mockClear();

			await runPluginCommand(["list", "--json"], { cwd: tempDir, agentDir });
			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			const parsed = JSON.parse(output) as {
				plugins: Array<{ source: string; scope: string; installed: boolean; type: string; path?: string }>;
			};

			expect(parsed.plugins).toHaveLength(1);
			expect(parsed.plugins[0]).toMatchObject({
				scope: "project",
				installed: true,
				type: "local",
				path: pluginDir,
			});
		} finally {
			logSpy.mockRestore();
		}
	});

	it("does not persist install during dry run", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await runPluginCommand(["install", pluginDir, "--local", "--dry-run"], { cwd: tempDir, agentDir });
			logSpy.mockClear();

			await runPluginCommand(["list", "--json"], { cwd: tempDir, agentDir });
			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			const parsed = JSON.parse(output) as { plugins: unknown[] };
			expect(parsed.plugins).toEqual([]);
		} finally {
			logSpy.mockRestore();
		}
	});

	it("reports missing local plugins in doctor output", async () => {
		const missingPluginDir = join(tempDir, "missing-plugin");
		const settingsManager = SettingsManager.create(tempDir, agentDir);
		settingsManager.setProjectPackages([missingPluginDir]);
		await settingsManager.flush();

		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await runPluginCommand(["doctor", "--json"], { cwd: tempDir, agentDir });
			const output = logSpy.mock.calls.map(([message]) => String(message)).join("\n");
			const parsed = JSON.parse(output) as { ok: unknown[]; errors: Array<{ source: string; message: string }> };

			expect(parsed.ok).toEqual([]);
			expect(parsed.errors).toHaveLength(1);
			expect(parsed.errors[0]).toMatchObject({
				source: missingPluginDir,
				message: "Local plugin path does not exist",
			});
			expect(process.exitCode).toBe(1);
		} finally {
			logSpy.mockRestore();
		}
	});

	it("fails clearly for unsupported plugin actions", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await runPluginCommand(["config"], { cwd: tempDir, agentDir });
			const output = errorSpy.mock.calls.map(([message]) => String(message)).join("\n");
			expect(output).toContain("plugin config");
			expect(output).toContain("not supported");
			expect(process.exitCode).toBe(1);
		} finally {
			errorSpy.mockRestore();
		}
	});

	it("uninstalls a configured local plugin from project scope", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		try {
			await runPluginCommand(["install", pluginDir, "--local"], { cwd: tempDir, agentDir });
			await runPluginCommand(["uninstall", pluginDir, "--local"], { cwd: tempDir, agentDir });

			const settingsManager = SettingsManager.create(tempDir, agentDir);
			expect(settingsManager.getProjectSettings().packages ?? []).toEqual([]);
			expect(existsSync(join(tempDir, ".pi", "settings.json"))).toBe(true);
		} finally {
			logSpy.mockRestore();
		}
	});
});
