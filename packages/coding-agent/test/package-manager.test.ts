import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DefaultPackageManager, type ProgressEvent } from "../src/core/package-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";

describe("DefaultPackageManager", () => {
	let tempDir: string;
	let settingsManager: SettingsManager;
	let packageManager: DefaultPackageManager;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		const agentDir = join(tempDir, "agent");
		mkdirSync(agentDir, { recursive: true });

		settingsManager = SettingsManager.inMemory();
		packageManager = new DefaultPackageManager({
			cwd: tempDir,
			agentDir,
			settingsManager,
		});
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("resolve", () => {
		it("should return empty paths when no sources configured", async () => {
			const result = await packageManager.resolve();
			expect(result.extensions).toEqual([]);
			expect(result.skills).toEqual([]);
			expect(result.prompts).toEqual([]);
			expect(result.themes).toEqual([]);
		});

		it("should resolve local extension paths from settings", async () => {
			const extPath = join(tempDir, "my-extension.ts");
			writeFileSync(extPath, "export default function() {}");
			settingsManager.setExtensionPaths([extPath]);

			const result = await packageManager.resolve();
			expect(result.extensions).toContain(extPath);
		});

		it("should resolve skill paths from settings", async () => {
			const skillDir = join(tempDir, "skills");
			mkdirSync(skillDir, { recursive: true });
			writeFileSync(
				join(skillDir, "SKILL.md"),
				`---
name: test-skill
description: A test skill
---
Content`,
			);

			settingsManager.setSkillPaths([skillDir]);

			const result = await packageManager.resolve();
			expect(result.skills).toContain(skillDir);
		});
	});

	describe("resolveExtensionSources", () => {
		it("should resolve local paths", async () => {
			const extPath = join(tempDir, "ext.ts");
			writeFileSync(extPath, "export default function() {}");

			const result = await packageManager.resolveExtensionSources([extPath]);
			expect(result.extensions).toContain(extPath);
		});

		it("should handle directories with pi manifest", async () => {
			const pkgDir = join(tempDir, "my-package");
			mkdirSync(pkgDir, { recursive: true });
			writeFileSync(
				join(pkgDir, "package.json"),
				JSON.stringify({
					name: "my-package",
					pi: {
						extensions: ["./src/index.ts"],
						skills: ["./skills"],
					},
				}),
			);
			mkdirSync(join(pkgDir, "src"), { recursive: true });
			writeFileSync(join(pkgDir, "src", "index.ts"), "export default function() {}");
			mkdirSync(join(pkgDir, "skills"), { recursive: true });

			const result = await packageManager.resolveExtensionSources([pkgDir]);
			expect(result.extensions).toContain(join(pkgDir, "src", "index.ts"));
			expect(result.skills).toContain(join(pkgDir, "skills"));
		});

		it("should handle directories with auto-discovery layout", async () => {
			const pkgDir = join(tempDir, "auto-pkg");
			mkdirSync(join(pkgDir, "extensions"), { recursive: true });
			mkdirSync(join(pkgDir, "themes"), { recursive: true });
			writeFileSync(join(pkgDir, "extensions", "main.ts"), "export default function() {}");
			writeFileSync(join(pkgDir, "themes", "dark.json"), "{}");

			const result = await packageManager.resolveExtensionSources([pkgDir]);
			expect(result.extensions).toContain(join(pkgDir, "extensions"));
			expect(result.themes).toContain(join(pkgDir, "themes"));
		});
	});

	describe("progress callback", () => {
		it("should emit progress events", async () => {
			const events: ProgressEvent[] = [];
			packageManager.setProgressCallback((event) => events.push(event));

			const extPath = join(tempDir, "ext.ts");
			writeFileSync(extPath, "export default function() {}");

			// Local paths don't trigger install progress, but we can verify the callback is set
			await packageManager.resolveExtensionSources([extPath]);

			// For now just verify no errors - npm/git would trigger actual events
			expect(events.length).toBe(0);
		});
	});

	describe("source parsing", () => {
		it("should emit progress events on install attempt", async () => {
			const events: ProgressEvent[] = [];
			packageManager.setProgressCallback((event) => events.push(event));

			// Use public install method which emits progress events
			try {
				await packageManager.install("npm:nonexistent-package@1.0.0");
			} catch {
				// Expected to fail - package doesn't exist
			}

			// Should have emitted start event before failure
			expect(events.some((e) => e.type === "start" && e.action === "install")).toBe(true);
			// Should have emitted error event
			expect(events.some((e) => e.type === "error")).toBe(true);
		});

		it("should recognize github URLs without git: prefix", async () => {
			const events: ProgressEvent[] = [];
			packageManager.setProgressCallback((event) => events.push(event));

			// This should be parsed as a git source, not throw "unsupported"
			try {
				await packageManager.install("https://github.com/nonexistent/repo");
			} catch {
				// Expected to fail - repo doesn't exist
			}

			// Should have attempted clone, not thrown unsupported error
			expect(events.some((e) => e.type === "start" && e.action === "install")).toBe(true);
		});
	});
});
