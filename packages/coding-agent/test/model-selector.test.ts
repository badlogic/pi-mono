import { setKeybindings, type TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ModelSelectorComponent } from "../src/modes/interactive/components/model-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

function createFakeTui(): TUI {
	return { requestRender: () => {} } as unknown as TUI;
}

describe("model selector", () => {
	let harness: Harness | undefined;

	beforeAll(() => {
		initTheme("dark");
	});

	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
	});

	it("keeps the current model marked while browsing", async () => {
		harness = await createHarness({
			models: [
				{ id: "current-model", name: "Current Model", reasoning: true },
				{ id: "browsed-model", name: "Browsed Model", reasoning: true },
			],
		});
		const currentModel = harness.getModel("current-model")!;
		const selector = new ModelSelectorComponent(
			createFakeTui(),
			currentModel,
			harness.session.modelRuntime,
			[],
			() => {},
			() => {},
		);

		const getModelRow = (id: string): string | undefined =>
			stripAnsi(selector.render(120).join("\n"))
				.split("\n")
				.find((line) => line.includes(`${id} [`))
				?.trimEnd();

		expect(getModelRow("current-model")).toBe(`→ ✓ current-model [${currentModel.provider}]`);
		selector.handleInput("\x1b[B");
		expect(getModelRow("current-model")).toBe(`  ✓ current-model [${currentModel.provider}]`);
		expect(getModelRow("browsed-model")).toBe(`→   browsed-model [${currentModel.provider}]`);
		selector.dispose();
	});

	it("preserves scoped order when filtering", async () => {
		harness = await createHarness({
			models: [
				{ id: "gpt-6-sol", name: "Sol 6", reasoning: true },
				{ id: "gpt-6.1-sol", name: "Sol 6.1", reasoning: true },
				{ id: "other-model", name: "Other Model", reasoning: true },
			],
		});
		const currentModel = harness.getModel("gpt-6-sol")!;
		const scopedModels = [
			{ model: harness.getModel("gpt-6.1-sol")! },
			{ model: harness.getModel("other-model")! },
			{ model: currentModel },
		];
		const selector = new ModelSelectorComponent(
			createFakeTui(),
			currentModel,
			harness.session.modelRuntime,
			scopedModels,
			() => {},
			() => {},
			"sol",
		);
		const modelRows = () =>
			stripAnsi(selector.render(120).join("\n"))
				.split("\n")
				.filter((line) => line.includes(`[${currentModel.provider}]`))
				.map((line) => line.replace(/^[→✓\s]+/, "").split(" [")[0]);

		expect(modelRows()).toEqual(["gpt-6.1-sol", "gpt-6-sol"]);

		await vi.waitFor(() => {
			expect(stripAnsi(selector.render(120).join("\n"))).toContain("Model catalogs refreshed.");
		});
		expect(modelRows()).toEqual(["gpt-6.1-sol", "gpt-6-sol"]);

		selector.handleInput("\t");
		expect(modelRows()).toEqual(["gpt-6-sol", "gpt-6.1-sol"]);
		selector.handleInput("\t");
		expect(modelRows()).toEqual(["gpt-6.1-sol", "gpt-6-sol"]);

		selector.getSearchInput().setValue("");
		selector.handleInput("\x1b[D");
		expect(modelRows()).toEqual(scopedModels.map(({ model }) => model.id));
		selector.dispose();
	});

	it.each([
		["anthropic", ""],
		["openrouter", "anthropic/"],
		["amazon-bedrock", "anthropic."],
	])("ranks Opus before Sonnet for %s in both scopes", async (provider, idPrefix) => {
		harness = await createHarness({
			models: [
				{ id: "claude-sonnet-5", name: "Claude Sonnet 5", reasoning: true },
				{ id: "claude-opus-5", name: "Claude Opus 5", reasoning: true },
			],
		});
		const models = harness.models.map((model) => ({
			...model,
			provider,
			id: `${idPrefix}${model.id}`,
			name: `Anthropic: ${model.name}`,
		}));
		vi.spyOn(harness.session.modelRuntime, "getAvailableSnapshot").mockReturnValue(models);
		vi.spyOn(harness.session.modelRuntime, "getModel").mockImplementation((provider, id) =>
			models.find((model) => model.provider === provider && model.id === id),
		);
		const selector = new ModelSelectorComponent(
			createFakeTui(),
			models[0],
			harness.session.modelRuntime,
			models.map((model) => ({ model })),
			() => {},
			() => {},
			"opus",
			undefined,
			models[0],
		);
		try {
			await vi.waitFor(() => {
				expect(stripAnsi(selector.render(120).join("\n"))).toContain("Model catalogs refreshed.");
			});
			for (const scope of ["scoped", "all"]) {
				const rendered = stripAnsi(selector.render(120).join("\n"));
				const modelRows = rendered.split("\n").filter((line) => line.includes(`[${provider}]`));
				expect(modelRows, scope).toHaveLength(2);
				expect(modelRows[0], scope).toContain(`→   ${idPrefix}claude-opus-5`);
				expect(modelRows[1], scope).toContain(`${idPrefix}claude-sonnet-5`);
				selector.handleInput("\t");
			}

			selector.getSearchInput().setValue("default");
			selector.handleInput("\x1b[D");
			expect(stripAnsi(selector.render(120).join("\n"))).toContain(
				`${idPrefix}claude-sonnet-5 [${provider}] · default`,
			);
		} finally {
			selector.dispose();
		}
	});

	it("uses the configured save binding", async () => {
		setKeybindings(new KeybindingsManager({ "app.models.save": "ctrl+r" }));
		harness = await createHarness();
		const currentModel = harness.getModel()!;
		const saveDefault = vi.fn();
		const selector = new ModelSelectorComponent(
			createFakeTui(),
			currentModel,
			harness.session.modelRuntime,
			[],
			() => {},
			() => {},
			undefined,
			saveDefault,
		);

		expect(stripAnsi(selector.render(120).join("\n"))).toContain("Ctrl+R to set as default");
		selector.handleInput("\x13");
		expect(saveDefault).not.toHaveBeenCalled();
		selector.handleInput("\x12");
		expect(saveDefault).toHaveBeenCalledWith(currentModel);
	});

	it("lists every catalog that failed to refresh", async () => {
		harness = await createHarness();
		vi.spyOn(harness.session.modelRuntime, "refresh").mockResolvedValue({
			aborted: false,
			errors: new Map([
				["openai", new Error("unavailable")],
				["anthropic", new Error("unavailable")],
			]),
		});

		const selector = new ModelSelectorComponent(
			createFakeTui(),
			harness.getModel(),
			harness.session.modelRuntime,
			[],
			() => {},
			() => {},
		);

		await vi.waitFor(() => {
			const rendered = stripAnsi(selector.render(120).join("\n"));
			expect(rendered).toContain("Could not refresh 2 model catalogs (openai, anthropic); showing cached models.");
		});
	});
});
