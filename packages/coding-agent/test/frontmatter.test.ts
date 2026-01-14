import { describe, expect, it } from "vitest";
import { parseFrontmatter, stripFrontmatter } from "../src/utils/frontmatter.js";

describe("frontmatter helpers", () => {
	it("parses frontmatter and body", () => {
		const input = "---\nname: demo\ncustom-key: value\n---\nHello";
		const result = parseFrontmatter(input);

		expect(result.frontmatter.name).toBe("demo");
		expect(result.frontmatter["custom-key"]).toBe("value");
		expect(result.body).toBe("Hello");
		expect(result.keys).toEqual(["name", "custom-key"]);
	});

	it("strips surrounding quotes", () => {
		const input = "---\nname: \"quoted\"\ndescription: 'single'\n---\nBody";
		const result = parseFrontmatter(input);

		expect(result.frontmatter.name).toBe("quoted");
		expect(result.frontmatter.description).toBe("single");
	});

	it("returns original content when frontmatter is missing", () => {
		const input = "# Title\nContent";
		const result = parseFrontmatter(input);

		expect(result.frontmatter).toEqual({});
		expect(result.keys).toHaveLength(0);
		expect(result.body).toBe(input);
	});

	it("returns original content when frontmatter is unterminated", () => {
		const input = "---\nname: demo\nBody line";
		const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		const result = parseFrontmatter(input);

		expect(result.frontmatter).toEqual({});
		expect(result.keys).toHaveLength(0);
		expect(result.body).toBe(normalized);
	});

	it("strips frontmatter from content", () => {
		const input = "---\nname: demo\n---\nBody\n\nMore";
		const result = stripFrontmatter(input);

		expect(result).toBe("Body\n\nMore");
	});
});
