import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.js";
import { ExtensionRunner } from "../src/core/extensions/runner.js";
import type { CommandMetadata, CommandResult, ExportCommandData } from "../src/core/extensions/types.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";
import { SettingsManager } from "../src/core/settings-manager.js";
import { userMsg } from "./utilities.js";

type PipelineTestGlobals = typeof globalThis & {
	pipelineOrder?: string[];
	pipelineCancelled?: boolean;
	pipelineMetadata?: CommandMetadata;
	pipelineAfterMetadata?: CommandMetadata;
	pipelineBeforeCount?: number;
	pipelineDisabledCalled?: boolean;
};

const globals = globalThis as PipelineTestGlobals;

describe("Command pipeline", () => {
	let tempDir: string;
	let extensionsDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;
	let settingsManager: SettingsManager;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-command-pipeline-test-"));
		extensionsDir = path.join(tempDir, "extensions");
		fs.mkdirSync(extensionsDir);
		sessionManager = SessionManager.inMemory();
		modelRegistry = new ModelRegistry(new AuthStorage(path.join(tempDir, "auth.json")));
		settingsManager = SettingsManager.inMemory();
		globals.pipelineOrder = undefined;
		globals.pipelineCancelled = undefined;
		globals.pipelineMetadata = undefined;
		globals.pipelineAfterMetadata = undefined;
		globals.pipelineBeforeCount = undefined;
		globals.pipelineDisabledCalled = undefined;
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	async function createRunner(...extensions: string[]): Promise<ExtensionRunner> {
		fs.rmSync(extensionsDir, { recursive: true, force: true });
		fs.mkdirSync(extensionsDir);
		for (let i = 0; i < extensions.length; i++) {
			fs.writeFileSync(path.join(extensionsDir, `e${i}.ts`), extensions[i]);
		}

		const result = await discoverAndLoadExtensions([], tempDir, tempDir);
		return new ExtensionRunner(
			result.extensions,
			result.runtime,
			tempDir,
			sessionManager,
			modelRegistry,
			settingsManager,
		);
	}

	function createExportData(): ExportCommandData {
		sessionManager.appendMessage(userMsg("export me"));
		return {
			entries: sessionManager.getEntries(),
			outputPath: undefined,
			target: "file",
		};
	}

	it("chains before handlers in order", async () => {
		globals.pipelineOrder = [];
		const runner = await createRunner(`
			export default function (pi) {
				pi.beforeCommand("export", { id: "a" }, async () => {
					globalThis.pipelineOrder = globalThis.pipelineOrder ?? [];
					globalThis.pipelineOrder.push("a");
				});
				pi.beforeCommand("export", { id: "b" }, async () => {
					globalThis.pipelineOrder.push("b");
				});
			}
		`);

		const data = createExportData();
		await runner.dispatchCommand(
			"export",
			data,
			async (): Promise<CommandResult> => ({
				success: true,
				filePath: "out.html",
			}),
		);

		expect(globals.pipelineOrder).toEqual(["a", "b"]);
	});

	it("cancels the pipeline and skips later handlers", async () => {
		const runner = await createRunner(`
			export default function (pi) {
				pi.beforeCommand("export", { id: "stop" }, async () => ({ cancel: true }));
				pi.beforeCommand("export", { id: "later" }, async () => {
					globalThis.pipelineCancelled = true;
				});
			}
		`);

		const data = createExportData();
		let builtInCalled = false;
		const result = await runner.dispatchCommand("export", data, async (): Promise<CommandResult> => {
			builtInCalled = true;
			return { success: true, filePath: "out.html" };
		});

		expect(result.cancelled).toBe(true);
		expect(builtInCalled).toBe(false);
		expect(globals.pipelineCancelled).toBeUndefined();
	});

	it("merges metadata across before handlers", async () => {
		const runner = await createRunner(`
			export default function (pi) {
				pi.beforeCommand("export", { id: "first" }, async () => ({
					metadata: { warning: "first", "ext:first": true },
				}));
				pi.beforeCommand("export", { id: "second" }, async () => ({
					metadata: { warning: "second", "ext:second": "ok" },
				}));
				pi.afterCommand("export", { id: "after" }, async (data) => {
					globalThis.pipelineAfterMetadata = data.metadata;
				});
			}
		`);

		const data = createExportData();
		await runner.dispatchCommand("export", data, async (_payload, metadata): Promise<CommandResult> => {
			globals.pipelineMetadata = metadata;
			return { success: true, filePath: "out.html" };
		});

		const metadata = globals.pipelineMetadata as CommandMetadata;
		expect(metadata.warning).toBe("second");
		expect(metadata["ext:first"]).toBe(true);
		expect(metadata["ext:second"]).toBe("ok");
		expect(globals.pipelineAfterMetadata).toEqual(metadata);
	});

	it("respects configured ordering", async () => {
		globals.pipelineOrder = [];
		const runner = await createRunner(`
			export default function (pi) {
				pi.beforeCommand("export", { id: "a" }, async () => {
					globalThis.pipelineOrder = globalThis.pipelineOrder ?? [];
					globalThis.pipelineOrder.push("a");
				});
				pi.beforeCommand("export", { id: "b" }, async () => {
					globalThis.pipelineOrder.push("b");
				});
			}
		`);

		settingsManager.setPipelineConfig("export", { order: ["b", "a"] });
		const data = createExportData();
		await runner.dispatchCommand(
			"export",
			data,
			async (): Promise<CommandResult> => ({
				success: true,
				filePath: "out.html",
			}),
		);

		expect(globals.pipelineOrder).toEqual(["b", "a"]);
	});

	it("skips disabled handlers", async () => {
		globals.pipelineOrder = [];
		const runner = await createRunner(`
			export default function (pi) {
				pi.beforeCommand("export", { id: "a" }, async () => {
					globalThis.pipelineDisabledCalled = true;
				});
				pi.beforeCommand("export", { id: "b" }, async () => {
					globalThis.pipelineOrder = globalThis.pipelineOrder ?? [];
					globalThis.pipelineOrder.push("b");
				});
			}
		`);

		settingsManager.setPipelineConfig("export", { disabled: ["a"] });
		const data = createExportData();
		await runner.dispatchCommand(
			"export",
			data,
			async (): Promise<CommandResult> => ({
				success: true,
				filePath: "out.html",
			}),
		);

		expect(globals.pipelineDisabledCalled).toBeUndefined();
		expect(globals.pipelineOrder).toEqual(["b"]);
	});

	it("prevents reentrancy from invoking hooks", async () => {
		globals.pipelineBeforeCount = 0;
		const runner = await createRunner(`
			export default function (pi) {
				pi.beforeCommand("export", { id: "a" }, async () => {
					globalThis.pipelineBeforeCount = (globalThis.pipelineBeforeCount ?? 0) + 1;
				});
			}
		`);

		const data = createExportData();
		let innerExecuted = false;
		await runner.dispatchCommand("export", data, async (payload): Promise<CommandResult> => {
			await runner.dispatchCommand("export", payload, async (): Promise<CommandResult> => {
				innerExecuted = true;
				return { success: true, filePath: "inner.html" };
			});
			return { success: true, filePath: "outer.html" };
		});

		expect(innerExecuted).toBe(true);
		expect(globals.pipelineBeforeCount).toBe(1);
	});
});
