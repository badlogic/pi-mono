import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDocumentationCatalog } from "../src/docs-catalog.ts";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const codingAgentDocsRoot = resolve(repositoryRoot, "packages/coding-agent/docs");
const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function createDocumentationFixture(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "pi-docs-catalog-"));
	temporaryDirectories.push(root);
	for (const [path, content] of Object.entries(files)) {
		const filePath = join(root, path);
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, content);
	}
	return root;
}

function listMarkdownFiles(root: string, directory: string = root): string[] {
	const paths: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			paths.push(...listMarkdownFiles(root, path));
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			paths.push(relative(root, path).replaceAll("\\", "/"));
		}
	}
	return paths.sort();
}

describe("loadDocumentationCatalog", () => {
	const invalidCatalogFixtures: Array<{
		condition: string;
		files: Record<string, string>;
		error: string;
	}> = [
		{
			condition: "missing pages",
			files: { "contents.md": "- [Missing](missing.md)\n" },
			error: "Missing documentation page: missing.md",
		},
		{
			condition: "duplicate page entries",
			files: {
				"contents.md": "- [First](guide.md)\n- [Second](guide.md)\n",
				"guide.md": "# Guide\n",
			},
			error: "Duplicate documentation page: guide.md",
		},
		{
			condition: "paths outside the documentation root",
			files: { "contents.md": "- [Outside](../outside.md)\n" },
			error: "Documentation link escapes the documentation root",
		},
	];

	it("builds the page inventory from the supplied Markdown file", () => {
		const root = createDocumentationFixture({
			"contents.md": [
				"# Documentation",
				"",
				"- [Guide](guide.md) - Guide description.",
				"- [SDK quickstart](sdk/quickstart.md)",
				"",
				"An unrelated [draft](draft.md) is not a catalog entry.",
				"- [Website](https://example.com/docs.md)",
				"```md",
				"- [Example only](missing.md)",
				"```",
			].join("\n"),
			"guide.md": "# Guide\n",
			"sdk/quickstart.md": "# SDK quickstart\n",
		});

		expect(loadDocumentationCatalog(join(root, "contents.md"))).toEqual([
			{ relativePath: "guide.md" },
			{ relativePath: "sdk/quickstart.md" },
		]);
	});

	it.each(invalidCatalogFixtures)("rejects $condition", ({ files, error }) => {
		const root = createDocumentationFixture(files);

		expect(() => loadDocumentationCatalog(join(root, "contents.md"))).toThrow(error);
	});
});

describe("coding-agent documentation", () => {
	it("lists every Markdown document in the catalog", () => {
		const catalogPath = join(codingAgentDocsRoot, "index.md");
		const pages = loadDocumentationCatalog(catalogPath);
		const catalogedFiles = [
			relative(codingAgentDocsRoot, catalogPath),
			...pages.map(({ relativePath }) => relativePath),
		].sort();

		expect(catalogedFiles).toEqual(listMarkdownFiles(codingAgentDocsRoot));
	});
});
