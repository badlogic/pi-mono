import assert from "node:assert";
import { describe, it } from "node:test";
import { Markdown } from "../src/components/markdown.js";

describe("Markdown component", () => {
	describe("Nested lists", () => {
		it("should render simple nested list", () => {
			const markdown = new Markdown(
				`- Item 1
  - Nested 1.1
  - Nested 1.2
- Item 2`,
				undefined,
				undefined,
				undefined,
				0,
				0,
			);

			const lines = markdown.render(80);

			// Check that we have content
			assert.ok(lines.length > 0);

			// Strip ANSI codes for checking
			const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));

			// Check structure
			assert.ok(plainLines.some((line) => line.includes("- Item 1")));
			assert.ok(plainLines.some((line) => line.includes("  - Nested 1.1")));
			assert.ok(plainLines.some((line) => line.includes("  - Nested 1.2")));
			assert.ok(plainLines.some((line) => line.includes("- Item 2")));
		});

		it("should render deeply nested list", () => {
			const markdown = new Markdown(
				`- Level 1
  - Level 2
    - Level 3
      - Level 4`,
				undefined,
				undefined,
				undefined,
				0,
				0,
			);

			const lines = markdown.render(80);
			const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));

			// Check proper indentation
			assert.ok(plainLines.some((line) => line.includes("- Level 1")));
			assert.ok(plainLines.some((line) => line.includes("  - Level 2")));
			assert.ok(plainLines.some((line) => line.includes("    - Level 3")));
			assert.ok(plainLines.some((line) => line.includes("      - Level 4")));
		});

		it("should render ordered nested list", () => {
			const markdown = new Markdown(
				`1. First
   1. Nested first
   2. Nested second
2. Second`,
				undefined,
				undefined,
				undefined,
				0,
				0,
			);

			const lines = markdown.render(80);
			const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));

			assert.ok(plainLines.some((line) => line.includes("1. First")));
			assert.ok(plainLines.some((line) => line.includes("  1. Nested first")));
			assert.ok(plainLines.some((line) => line.includes("  2. Nested second")));
			assert.ok(plainLines.some((line) => line.includes("2. Second")));
		});

		it("should render mixed ordered and unordered nested lists", () => {
			const markdown = new Markdown(
				`1. Ordered item
   - Unordered nested
   - Another nested
2. Second ordered
   - More nested`,
				undefined,
				undefined,
				undefined,
				0,
				0,
			);

			const lines = markdown.render(80);
			const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));

			assert.ok(plainLines.some((line) => line.includes("1. Ordered item")));
			assert.ok(plainLines.some((line) => line.includes("  - Unordered nested")));
			assert.ok(plainLines.some((line) => line.includes("2. Second ordered")));
		});
	});

	describe("Tables", () => {
		it("should render simple table", () => {
			const markdown = new Markdown(
				`| Name | Age |
| --- | --- |
| Alice | 30 |
| Bob | 25 |`,
				undefined,
				undefined,
				undefined,
				0,
				0,
			);

			const lines = markdown.render(80);
			const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));

			// Check table structure
			assert.ok(plainLines.some((line) => line.includes("Name")));
			assert.ok(plainLines.some((line) => line.includes("Age")));
			assert.ok(plainLines.some((line) => line.includes("Alice")));
			assert.ok(plainLines.some((line) => line.includes("Bob")));
			// Check for table borders
			assert.ok(plainLines.some((line) => line.includes("│")));
			assert.ok(plainLines.some((line) => line.includes("─")));
		});

		it("should render table with alignment", () => {
			const markdown = new Markdown(
				`| Left | Center | Right |
| :--- | :---: | ---: |
| A | B | C |
| Long text | Middle | End |`,
				undefined,
				undefined,
				undefined,
				0,
				0,
			);

			const lines = markdown.render(80);
			const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));

			// Check headers
			assert.ok(plainLines.some((line) => line.includes("Left")));
			assert.ok(plainLines.some((line) => line.includes("Center")));
			assert.ok(plainLines.some((line) => line.includes("Right")));
			// Check content
			assert.ok(plainLines.some((line) => line.includes("Long text")));
		});

		it("should handle tables with varying column widths", () => {
			const markdown = new Markdown(
				`| Short | Very long column header |
| --- | --- |
| A | This is a much longer cell content |
| B | Short |`,
				undefined,
				undefined,
				undefined,
				0,
				0,
			);

			const lines = markdown.render(80);

			// Should render without errors
			assert.ok(lines.length > 0);

			const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));
			assert.ok(plainLines.some((line) => line.includes("Very long column header")));
			assert.ok(plainLines.some((line) => line.includes("This is a much longer cell content")));
		});
	});

	describe("Combined features", () => {
		it("should render lists and tables together", () => {
			const markdown = new Markdown(
				`# Test Document

- Item 1
  - Nested item
- Item 2

| Col1 | Col2 |
| --- | --- |
| A | B |`,
				undefined,
				undefined,
				undefined,
				0,
				0,
			);

			const lines = markdown.render(80);
			const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, ""));

			// Check heading
			assert.ok(plainLines.some((line) => line.includes("Test Document")));
			// Check list
			assert.ok(plainLines.some((line) => line.includes("- Item 1")));
			assert.ok(plainLines.some((line) => line.includes("  - Nested item")));
			// Check table
			assert.ok(plainLines.some((line) => line.includes("Col1")));
			assert.ok(plainLines.some((line) => line.includes("│")));
		});
	});
});
