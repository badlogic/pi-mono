import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	loadThemeFromPath,
	onThemeChange,
	setRegisteredThemes,
	setTheme,
	stopThemeWatcher,
	theme,
} from "../src/modes/interactive/theme/theme.js";

const TEST_THEME_NAME = "test-theme";
const TEST_THEME_ACCENT = "#111111";
const TEST_THEME_UPDATED_ACCENT = "#22aa22";

function writeThemeFile(path: string, name: string, accent: string): void {
	const darkPath = join(process.cwd(), "src/modes/interactive/theme/dark.json");
	const dark = JSON.parse(readFileSync(darkPath, "utf-8"));
	dark.name = name;
	dark.colors.accent = accent;
	writeFileSync(path, JSON.stringify(dark, null, 2));
}

function writeThemeFileAtomically(path: string, name: string, accent: string): void {
	const tmpPath = `${path}.tmp`;
	writeThemeFile(tmpPath, name, accent);
	renameSync(tmpPath, path);
}

function createThemeChangeTracker(): {
	getCount: () => number;
	waitForNext: (timeoutMs?: number) => Promise<void>;
	expectNoChangeFor: (durationMs: number) => Promise<void>;
	dispose: () => void;
} {
	let changes = 0;
	let nextTarget = 1;
	const waiters: Array<{
		target: number;
		resolve: () => void;
		reject: (error: Error) => void;
		timer: ReturnType<typeof setTimeout>;
	}> = [];

	onThemeChange(() => {
		changes++;
		for (let i = waiters.length - 1; i >= 0; i--) {
			const waiter = waiters[i];
			if (changes >= waiter.target) {
				clearTimeout(waiter.timer);
				waiters.splice(i, 1);
				waiter.resolve();
			}
		}
	});

	const waitForTarget = (target: number, timeoutMs: number): Promise<void> => {
		if (changes >= target) {
			return Promise.resolve();
		}
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(`Timed out waiting for ${target} theme change(s), got ${changes}`));
			}, timeoutMs);
			waiters.push({ target, resolve, reject, timer });
		});
	};

	return {
		getCount: () => changes,
		waitForNext: (timeoutMs: number = 2_000) => {
			nextTarget = Math.max(nextTarget, changes + 1);
			const target = nextTarget;
			nextTarget++;
			return waitForTarget(target, timeoutMs);
		},
		expectNoChangeFor: async (durationMs: number) => {
			const before = changes;
			await new Promise((resolve) => setTimeout(resolve, durationMs));
			expect(changes).toBe(before);
		},
		dispose: () => {
			for (const waiter of waiters) {
				clearTimeout(waiter.timer);
			}
			waiters.length = 0;
			onThemeChange(() => undefined);
		},
	};
}

describe("theme hot reload", () => {
	const tempDirs: string[] = [];
	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
	let themesDir = "";
	let themePath = "";
	let tracker: ReturnType<typeof createThemeChangeTracker>;
	let initialAccentOutput = "";

	beforeEach(() => {
		const agentDir = mkdtempSync(join(tmpdir(), "pi-agent-dir-"));
		themesDir = join(agentDir, "themes");
		mkdirSync(themesDir, { recursive: true });
		tempDirs.push(agentDir);
		process.env.PI_CODING_AGENT_DIR = agentDir;
		stopThemeWatcher();
		setRegisteredThemes([]);
		onThemeChange(() => undefined);

		themePath = registerTheme(TEST_THEME_NAME, TEST_THEME_ACCENT);
		setTheme(TEST_THEME_NAME, true);
		tracker = createThemeChangeTracker();
		initialAccentOutput = theme.fg("accent", "X");
	});

	afterEach(() => {
		tracker.dispose();
		stopThemeWatcher();
		setRegisteredThemes([]);
		onThemeChange(() => undefined);
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
		process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	});

	function registerTheme(name: string, accent: string): string {
		const filePath = join(themesDir, `${name}.json`);
		writeThemeFile(filePath, name, accent);
		setRegisteredThemes([loadThemeFromPath(filePath)]);
		return filePath;
	}

	it("reloads active file-backed registered theme when file changes", async () => {
		const changed = tracker.waitForNext();
		writeThemeFile(themePath, TEST_THEME_NAME, TEST_THEME_UPDATED_ACCENT);
		await changed;
		expect(theme.fg("accent", "X")).not.toBe(initialAccentOutput);
	});

	it("watches the active theme source path, not only agentDir/themes", async () => {
		const externalThemeDir = mkdtempSync(join(tmpdir(), "pi-theme-source-"));
		tempDirs.push(externalThemeDir);
		const externalThemePath = join(externalThemeDir, `${TEST_THEME_NAME}.json`);
		writeThemeFile(externalThemePath, TEST_THEME_NAME, TEST_THEME_ACCENT);
		setRegisteredThemes([loadThemeFromPath(externalThemePath)]);

		tracker.dispose();
		setTheme(TEST_THEME_NAME, true);
		tracker = createThemeChangeTracker();

		const decoyPath = join(themesDir, `${TEST_THEME_NAME}.json`);
		writeThemeFile(decoyPath, TEST_THEME_NAME, "#999999");
		await tracker.expectNoChangeFor(400);

		const changed = tracker.waitForNext();
		writeThemeFile(externalThemePath, TEST_THEME_NAME, TEST_THEME_UPDATED_ACCENT);
		await changed;
		expect(tracker.getCount()).toBeGreaterThan(0);
	});

	it("reattaches watcher and reloads after atomic-save rename events", async () => {
		const changed = tracker.waitForNext();
		writeThemeFileAtomically(themePath, TEST_THEME_NAME, TEST_THEME_UPDATED_ACCENT);
		await changed;
		expect(tracker.getCount()).toBeGreaterThan(0);
		expect(theme.fg("accent", "X")).not.toBe(initialAccentOutput);
	});

	it("ignores invalid intermediate file content and recovers on next valid save", async () => {
		writeFileSync(themePath, "{ invalid json");
		await tracker.expectNoChangeFor(400);
		expect(theme.fg("accent", "X")).toBe(initialAccentOutput);

		const changed = tracker.waitForNext();
		writeThemeFile(themePath, TEST_THEME_NAME, TEST_THEME_UPDATED_ACCENT);
		await changed;
		expect(theme.fg("accent", "X")).not.toBe(initialAccentOutput);
	});

	it("falls back when active theme file is deleted", async () => {
		const changed = tracker.waitForNext();
		rmSync(themePath, { force: true });
		await changed;
		expect(theme.fg("accent", "X")).not.toBe(initialAccentOutput);
		expect(tracker.getCount()).toBeGreaterThan(0);
	});

	it("switches watched file when switching active theme", async () => {
		const themePathA = join(themesDir, "theme-a.json");
		const themePathB = join(themesDir, "theme-b.json");
		writeThemeFile(themePathA, "theme-a", "#101010");
		writeThemeFile(themePathB, "theme-b", "#202020");
		setRegisteredThemes([loadThemeFromPath(themePathA), loadThemeFromPath(themePathB)]);

		const switchTracker = createThemeChangeTracker();
		setTheme("theme-a", true);
		setTheme("theme-b", true);
		const before = theme.fg("accent", "X");

		writeThemeFile(themePathA, "theme-a", "#303030");
		await switchTracker.expectNoChangeFor(400);
		expect(theme.fg("accent", "X")).toBe(before);

		const changed = switchTracker.waitForNext();
		writeThemeFile(themePathB, "theme-b", "#404040");
		await changed;
		expect(theme.fg("accent", "X")).not.toBe(before);
		switchTracker.dispose();
	});
});
