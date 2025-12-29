import { describe, expect, test, vi } from "vitest";
import { BashExecutionComponent } from "../src/modes/interactive/components/bash-execution.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

describe("BashExecutionComponent", () => {
	test("can disable the inline loader to avoid duplicate running indicators", () => {
		initTheme("dark");

		const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(() => 123 as any);
		vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});

		const ui = { terminal: { columns: 80 }, requestRender: () => {} } as any;
		const component = new BashExecutionComponent("sleep 5", ui, { showLoader: false });

		expect(setIntervalSpy).not.toHaveBeenCalled();

		const rendered = component.render(120).join("\n");
		expect(rendered).not.toContain("Running...");

		setIntervalSpy.mockRestore();
	});
});
