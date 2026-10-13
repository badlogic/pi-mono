import { afterEach, describe, expect, it, vi } from "vitest";
import { KEYBINDINGS, KeybindingsManager, useWindowsKeybindings } from "../src/core/keybindings.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

describe("tool display keybindings", () => {
	let harness: Harness | undefined;
	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
		vi.restoreAllMocks();
	});

	it.each(["f2", "alt+g"] as const)("reserves the group shortcut %s from extension overrides", async (key) => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		harness = await createHarness({
			extensionFactories: [(pi) => pi.registerShortcut(key, { handler: async () => {} })],
		});
		const runner = harness.session.extensionRunner;
		if (!runner) throw new Error("Expected the fixture extension runner");
		const config = new KeybindingsManager({ "app.tools.toggleGroups": key }).getEffectiveConfig();
		expect(runner.getShortcuts(config).has(key)).toBe(false);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("Skipping."));
	});
	it("uses independent configurable actions for groups and output", () => {
		const defaults = new KeybindingsManager().getEffectiveConfig();
		expect(defaults["app.tools.toggleGroups"]).toBe("f2");
		expect(defaults["app.tools.expand"]).toBe("ctrl+o");

		const custom = new KeybindingsManager({ "app.tools.toggleGroups": "alt+g" }).getEffectiveConfig();
		expect(custom["app.tools.toggleGroups"]).toBe("alt+g");
		expect(custom["app.tools.expand"]).toBe("ctrl+o");
	});

	it("distinguishes legacy F2 sequences from output expansion without default clashes", () => {
		const manager = new KeybindingsManager();
		for (const data of ["\x1bOQ", "\x1b[12~"]) {
			expect(manager.matches(data, "app.tools.toggleGroups")).toBe(true);
			expect(manager.matches(data, "app.tools.expand")).toBe(false);
		}
		expect(manager.matches("\x0f", "app.tools.toggleGroups")).toBe(false);
		expect(manager.matches("\x0f", "app.tools.expand")).toBe(true);
		const f2Actions = Object.entries(manager.getEffectiveConfig())
			.filter(([, keys]) => (Array.isArray(keys) ? keys.includes("f2") : keys === "f2"))
			.map(([action]) => action);
		expect(f2Actions).toEqual(["app.tools.toggleGroups"]);
	});
});

describe("Windows keybinding defaults", () => {
	it("uses Windows keybindings on native Windows", () => {
		expect(useWindowsKeybindings("win32", {})).toBe(true);
	});

	it("uses Windows keybindings in WSL without relying on Windows Terminal detection", () => {
		expect(useWindowsKeybindings("linux", { WSL_DISTRO_NAME: "Ubuntu" })).toBe(true);
		expect(useWindowsKeybindings("linux", { WSL_INTEROP: "/run/WSL/123_interop" })).toBe(true);
	});

	it("does not use Windows keybindings from WT_SESSION alone", () => {
		expect(useWindowsKeybindings("linux", { WT_SESSION: "session" })).toBe(false);
	});

	it("keeps non-Windows defaults on other platforms", () => {
		expect(useWindowsKeybindings("linux", {})).toBe(false);
		expect(useWindowsKeybindings("darwin", {})).toBe(false);
	});

	it("applies the detected defaults consistently", () => {
		const windowsKeybindings = useWindowsKeybindings();
		const nativeWindows = process.platform === "win32";

		expect(KEYBINDINGS["app.clipboard.pasteImage"].defaultKeys).toBe(windowsKeybindings ? "alt+v" : "ctrl+v");
		expect(KEYBINDINGS["tui.altScreen.search"].defaultKeys).toBe(windowsKeybindings ? "ctrl+f" : "ctrl+shift+f");
		expect(KEYBINDINGS["app.message.followUp"].defaultKeys).toBe(windowsKeybindings ? "ctrl+q" : "alt+enter");
		expect(KEYBINDINGS["app.model.cycleBackward"].defaultKeys).toBe(windowsKeybindings ? "alt+p" : "shift+ctrl+p");
		expect(KEYBINDINGS["tui.editor.undo"].defaultKeys).toBe(
			nativeWindows ? "ctrl+z" : windowsKeybindings ? "alt+z" : "ctrl+-",
		);
		expect(KEYBINDINGS["tui.altScreen.previousPrompt"].defaultKeys).toEqual(
			windowsKeybindings ? "ctrl+up" : ["ctrl+shift+up", "ctrl+up"],
		);
		expect(KEYBINDINGS["tui.altScreen.nextPrompt"].defaultKeys).toEqual(
			windowsKeybindings ? "ctrl+down" : ["ctrl+shift+down", "ctrl+down"],
		);
		expect(KEYBINDINGS["app.message.dequeue"].defaultKeys).toBe(windowsKeybindings ? "alt+q" : "alt+up");
	});
});
