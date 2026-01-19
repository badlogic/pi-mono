import type { Model } from "@mariozechner/pi-ai";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { ScopedModelsSelectorComponent } from "../src/modes/interactive/components/scoped-models-selector.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

const mockModels: Model<"anthropic-messages">[] = [
	{
		id: "claude-sonnet-4-5",
		name: "Claude Sonnet 4.5",
		api: "anthropic-messages",
		provider: "anthropic",
		baseUrl: "https://api.anthropic.com",
		reasoning: true,
		input: ["text"],
		cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		contextWindow: 200000,
		maxTokens: 8192,
	},
	{
		id: "gpt-4o",
		name: "GPT-4o",
		api: "anthropic-messages",
		provider: "openai",
		baseUrl: "https://api.openai.com",
		reasoning: true,
		input: ["text"],
		cost: { input: 5, output: 15, cacheRead: 0.5, cacheWrite: 5 },
		contextWindow: 128000,
		maxTokens: 4096,
	},
];

function renderAll(selector: ScopedModelsSelectorComponent, width = 120): string {
	return selector.render(width).join("\n");
}

describe("ScopedModelsSelectorComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("shows ✓ for enabled models even when all models are enabled", () => {
		const selector = new ScopedModelsSelectorComponent(
			{ allModels: mockModels, enabledIds: null },
			{ onChange: vi.fn(), onPersist: vi.fn(), onCancel: vi.fn() },
		);

		const out = renderAll(selector);
		expect(out).toContain("claude-sonnet-4-5");
		expect(out).toContain("gpt-4o");
		expect(out).toMatch(/✓/);
	});

	test("Ctrl+T cycles thinking overrides and shows :level suffix", () => {
		const onChange = vi.fn();
		const selector = new ScopedModelsSelectorComponent(
			{ allModels: mockModels, enabledIds: ["anthropic/claude-sonnet-4-5"] },
			{ onChange, onPersist: vi.fn(), onCancel: vi.fn() },
		);

		// Ctrl+T (\x14) should set first override to :minimal
		selector.handleInput("\x14");
		let out = renderAll(selector);
		expect(out).toContain("claude-sonnet-4-5:minimal");

		// Next cycle -> :low
		selector.handleInput("\x14");
		out = renderAll(selector);
		expect(out).toContain("claude-sonnet-4-5:low");

		// Ensure it emitted at least one change
		expect(onChange).toHaveBeenCalled();
	});

	test("Ctrl+T works when all models are enabled", () => {
		const selector = new ScopedModelsSelectorComponent(
			{ allModels: mockModels, enabledIds: null },
			{ onChange: vi.fn(), onPersist: vi.fn(), onCancel: vi.fn() },
		);

		selector.handleInput("\x14");
		const out = renderAll(selector);
		expect(out).toContain("claude-sonnet-4-5:minimal");
	});

	test("Ctrl+R resets selection and thinking overrides", () => {
		const selector = new ScopedModelsSelectorComponent(
			{ allModels: mockModels, enabledIds: ["anthropic/claude-sonnet-4-5"] },
			{ onChange: vi.fn(), onPersist: vi.fn(), onCancel: vi.fn() },
		);

		// Set override
		selector.handleInput("\x14"); // Ctrl+T
		let out = renderAll(selector);
		expect(out).toContain("claude-sonnet-4-5:minimal");

		// Toggle off the model (Enter = \r)
		selector.handleInput("\r");
		out = renderAll(selector);
		expect(out).toMatch(/claude-sonnet-4-5/);

		// Reset (Ctrl+R = \x12)
		selector.handleInput("\x12");
		out = renderAll(selector);
		expect(out).toContain("claude-sonnet-4-5");
		expect(out).not.toContain("claude-sonnet-4-5:minimal");
	});
});
