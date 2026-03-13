import { beforeAll, describe, expect, test } from "vitest";
import { Header } from "../src/modes/interactive/components/header.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

describe("Header component", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("renders something for large widths", () => {
		const header = new Header();
		const output = header.render(100);
		expect(output.length).toBeGreaterThan(1);
		// Check that it contains some ANSI escape codes for colors
		expect(output.some((line) => line.includes("\x1b["))).toBe(true);
	});

	test("renders micro fallback for small widths", () => {
		const header = new Header();
		const output = header.render(10);
		expect(output.length).toBeGreaterThan(0);
		expect(output.some((line) => line.includes("J"))).toBe(true);
	});
});
