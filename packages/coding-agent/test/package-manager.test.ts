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

	describe("pattern filtering in top-level arrays", () => {
		it("should exclude extensions with ! pattern", async () => {
			const extDir = join(tempDir, "extensions");
			mkdirSync(extDir, { recursive: true });
			writeFileSync(join(extDir, "keep.ts"), "export default function() {}");
			writeFileSync(join(extDir, "remove.ts"), "export default function() {}");

			settingsManager.setExtensionPaths([extDir, "!**/remove.ts"]);

			const result = await packageManager.resolve();
			expect(result.extensions.some((p) => p.endsWith("keep.ts"))).toBe(true);
			expect(result.extensions.some((p) => p.endsWith("remove.ts"))).toBe(false);
		});

		it("should filter themes with glob patterns", async () => {
			const themesDir = join(tempDir, "themes");
			mkdirSync(themesDir, { recursive: true });
			writeFileSync(join(themesDir, "dark.json"), "{}");
			writeFileSync(join(themesDir, "light.json"), "{}");
			writeFileSync(join(themesDir, "funky.json"), "{}");

			settingsManager.setThemePaths([themesDir, "!funky.json"]);

			const result = await packageManager.resolve();
			expect(result.themes.some((p) => p.endsWith("dark.json"))).toBe(true);
			expect(result.themes.some((p) => p.endsWith("light.json"))).toBe(true);
			expect(result.themes.some((p) => p.endsWith("funky.json"))).toBe(false);
		});

		it("should filter prompts with exclusion pattern", async () => {
			const promptsDir = join(tempDir, "prompts");
			mkdirSync(promptsDir, { recursive: true });
			writeFileSync(join(promptsDir, "review.md"), "Review code");
			writeFileSync(join(promptsDir, "explain.md"), "Explain code");

			settingsManager.setPromptTemplatePaths([promptsDir, "!explain.md"]);

			const result = await packageManager.resolve();
			expect(result.prompts.some((p) => p.endsWith("review.md"))).toBe(true);
			expect(result.prompts.some((p) => p.endsWith("explain.md"))).toBe(false);
		});

		it("should filter skills with exclusion pattern", async () => {
			const skillsDir = join(tempDir, "skills");
			mkdirSync(join(skillsDir, "good-skill"), { recursive: true });
			mkdirSync(join(skillsDir, "bad-skill"), { recursive: true });
			writeFileSync(
				join(skillsDir, "good-skill", "SKILL.md"),
				"---\nname: good-skill\ndescription: Good\n---\nContent",
			);
			writeFileSync(
				join(skillsDir, "bad-skill", "SKILL.md"),
				"---\nname: bad-skill\ndescription: Bad\n---\nContent",
			);

			settingsManager.setSkillPaths([skillsDir, "!**/bad-skill"]);

			const result = await packageManager.resolve();
			expect(result.skills.some((p) => p.includes("good-skill"))).toBe(true);
			expect(result.skills.some((p) => p.includes("bad-skill"))).toBe(false);
		});

		it("should work without patterns (backward compatible)", async () => {
			const extPath = join(tempDir, "my-ext.ts");
			writeFileSync(extPath, "export default function() {}");

			settingsManager.setExtensionPaths([extPath]);

			const result = await packageManager.resolve();
			expect(result.extensions).toContain(extPath);
		});
	});

	describe("pattern filtering in pi manifest", () => {
		it("should support glob patterns in manifest extensions", async () => {
			const pkgDir = join(tempDir, "manifest-pkg");
			mkdirSync(join(pkgDir, "extensions"), { recursive: true });
			mkdirSync(join(pkgDir, "node_modules/dep/extensions"), { recursive: true });
			writeFileSync(join(pkgDir, "extensions", "local.ts"), "export default function() {}");
			writeFileSync(join(pkgDir, "node_modules/dep/extensions", "remote.ts"), "export default function() {}");
			writeFileSync(join(pkgDir, "node_modules/dep/extensions", "skip.ts"), "export default function() {}");
			writeFileSync(
				join(pkgDir, "package.json"),
				JSON.stringify({
					name: "manifest-pkg",
					pi: {
						extensions: ["extensions", "node_modules/dep/extensions", "!**/skip.ts"],
					},
				}),
			);

			const result = await packageManager.resolveExtensionSources([pkgDir]);
			expect(result.extensions.some((p) => p.endsWith("local.ts"))).toBe(true);
			expect(result.extensions.some((p) => p.endsWith("remote.ts"))).toBe(true);
			expect(result.extensions.some((p) => p.endsWith("skip.ts"))).toBe(false);
		});

		it("should support glob patterns in manifest skills", async () => {
			const pkgDir = join(tempDir, "skill-manifest-pkg");
			mkdirSync(join(pkgDir, "skills/good-skill"), { recursive: true });
			mkdirSync(join(pkgDir, "skills/bad-skill"), { recursive: true });
			writeFileSync(
				join(pkgDir, "skills/good-skill", "SKILL.md"),
				"---\nname: good-skill\ndescription: Good\n---\nContent",
			);
			writeFileSync(
				join(pkgDir, "skills/bad-skill", "SKILL.md"),
				"---\nname: bad-skill\ndescription: Bad\n---\nContent",
			);
			writeFileSync(
				join(pkgDir, "package.json"),
				JSON.stringify({
					name: "skill-manifest-pkg",
					pi: {
						skills: ["skills", "!**/bad-skill"],
					},
				}),
			);

			const result = await packageManager.resolveExtensionSources([pkgDir]);
			expect(result.skills.some((p) => p.includes("good-skill"))).toBe(true);
			expect(result.skills.some((p) => p.includes("bad-skill"))).toBe(false);
		});
	});

	describe("pattern filtering in package filters", () => {
		it("should exclude extensions from package with ! pattern", async () => {
			const pkgDir = join(tempDir, "pattern-pkg");
			mkdirSync(join(pkgDir, "extensions"), { recursive: true });
			writeFileSync(join(pkgDir, "extensions", "foo.ts"), "export default function() {}");
			writeFileSync(join(pkgDir, "extensions", "bar.ts"), "export default function() {}");
			writeFileSync(join(pkgDir, "extensions", "baz.ts"), "export default function() {}");

			settingsManager.setPackages([
				{
					source: pkgDir,
					extensions: ["!**/baz.ts"],
					skills: [],
					prompts: [],
					themes: [],
				},
			]);

			const result = await packageManager.resolve();
			expect(result.extensions.some((p) => p.endsWith("foo.ts"))).toBe(true);
			expect(result.extensions.some((p) => p.endsWith("bar.ts"))).toBe(true);
			expect(result.extensions.some((p) => p.endsWith("baz.ts"))).toBe(false);
		});

		it("should filter themes from package", async () => {
			const pkgDir = join(tempDir, "theme-pkg");
			mkdirSync(join(pkgDir, "themes"), { recursive: true });
			writeFileSync(join(pkgDir, "themes", "nice.json"), "{}");
			writeFileSync(join(pkgDir, "themes", "ugly.json"), "{}");

			settingsManager.setPackages([
				{
					source: pkgDir,
					extensions: [],
					skills: [],
					prompts: [],
					themes: ["!ugly.json"],
				},
			]);

			const result = await packageManager.resolve();
			expect(result.themes.some((p) => p.endsWith("nice.json"))).toBe(true);
			expect(result.themes.some((p) => p.endsWith("ugly.json"))).toBe(false);
		});

		it("should combine include and exclude patterns", async () => {
			const pkgDir = join(tempDir, "combo-pkg");
			mkdirSync(join(pkgDir, "extensions"), { recursive: true });
			writeFileSync(join(pkgDir, "extensions", "alpha.ts"), "export default function() {}");
			writeFileSync(join(pkgDir, "extensions", "beta.ts"), "export default function() {}");
			writeFileSync(join(pkgDir, "extensions", "gamma.ts"), "export default function() {}");

			settingsManager.setPackages([
				{
					source: pkgDir,
					extensions: ["**/alpha.ts", "**/beta.ts", "!**/beta.ts"],
					skills: [],
					prompts: [],
					themes: [],
				},
			]);

			const result = await packageManager.resolve();
			expect(result.extensions.some((p) => p.endsWith("alpha.ts"))).toBe(true);
			expect(result.extensions.some((p) => p.endsWith("beta.ts"))).toBe(false);
			expect(result.extensions.some((p) => p.endsWith("gamma.ts"))).toBe(false);
		});

		it("should work with direct paths (no patterns)", async () => {
			const pkgDir = join(tempDir, "direct-pkg");
			mkdirSync(join(pkgDir, "extensions"), { recursive: true });
			writeFileSync(join(pkgDir, "extensions", "one.ts"), "export default function() {}");
			writeFileSync(join(pkgDir, "extensions", "two.ts"), "export default function() {}");

			settingsManager.setPackages([
				{
					source: pkgDir,
					extensions: ["extensions/one.ts"],
					skills: [],
					prompts: [],
					themes: [],
				},
			]);

			const result = await packageManager.resolve();
			expect(result.extensions.some((p) => p.endsWith("one.ts"))).toBe(true);
			expect(result.extensions.some((p) => p.endsWith("two.ts"))).toBe(false);
		});
	});
});
