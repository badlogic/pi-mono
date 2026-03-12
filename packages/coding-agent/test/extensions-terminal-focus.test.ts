import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.js";
import { ExtensionRunner } from "../src/core/extensions/runner.js";
import type { ExtensionUIContext } from "../src/core/extensions/types.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";
import type { Theme } from "../src/modes/interactive/theme/theme.js";

describe("Terminal Focus Extension Event", () => {
	let tempDir: string;
	let extensionsDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-terminal-focus-test-"));
		extensionsDir = path.join(tempDir, "extensions");
		fs.mkdirSync(extensionsDir);
		delete (globalThis as { testVar?: unknown }).testVar;
	});

	afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

	async function createRunner(...extensions: string[]) {
		fs.rmSync(extensionsDir, { recursive: true, force: true });
		fs.mkdirSync(extensionsDir);
		for (let i = 0; i < extensions.length; i++) {
			fs.writeFileSync(path.join(extensionsDir, `e${i}.ts`), extensions[i]);
		}
		const result = await discoverAndLoadExtensions([], tempDir, tempDir);
		const sm = SessionManager.inMemory();
		const mr = new ModelRegistry(AuthStorage.create(path.join(tempDir, "auth.json")));
		return new ExtensionRunner(result.extensions, result.runtime, tempDir, sm, mr);
	}

	it("exposes terminal focus state through ctx.ui and terminal_focus event", async () => {
		const runner = await createRunner(`
export default function (pi) {
	pi.on("terminal_focus", (event, ctx) => {
		globalThis.testVar = {
			focused: event.focused,
			previousFocused: event.previousFocused,
			uiFocused: ctx.ui.isTerminalFocused(),
		};
	});
}
`);

		const uiContext = {
			select: async () => undefined,
			confirm: async () => false,
			input: async () => undefined,
			notify: () => {},
			onTerminalInput: () => () => {},
			isTerminalFocused: () => false,
			setStatus: () => {},
			setWorkingMessage: () => {},
			setWidget: () => {},
			setFooter: () => {},
			setHeader: () => {},
			setTitle: () => {},
			custom: async () => undefined as never,
			pasteToEditor: () => {},
			setEditorText: () => {},
			getEditorText: () => "",
			editor: async () => undefined,
			setEditorComponent: () => {},
			get theme() {
				return {} as Theme;
			},
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({ success: false, error: "not used" }),
			getToolsExpanded: () => false,
			setToolsExpanded: () => {},
		} satisfies ExtensionUIContext;

		runner.setUIContext(uiContext);
		await runner.emit({ type: "terminal_focus", focused: false, previousFocused: true });

		expect((globalThis as { testVar?: unknown }).testVar).toEqual({
			focused: false,
			previousFocused: true,
			uiFocused: false,
		});
	});

	it("no-op UI context reports terminal unfocused", async () => {
		const runner = await createRunner(`
export default function (pi) {
	pi.on("terminal_focus", (_event, ctx) => {
		globalThis.testVar = ctx.ui.isTerminalFocused();
	});
}
`);

		await runner.emit({ type: "terminal_focus", focused: true, previousFocused: false });
		expect((globalThis as { testVar?: unknown }).testVar).toBe(false);
	});
});
