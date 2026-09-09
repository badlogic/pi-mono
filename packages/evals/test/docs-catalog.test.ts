import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadDocumentationCatalog } from "../src/docs-catalog.ts";

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

function catalogJson(navigation: unknown, unlisted: unknown = []): string {
	return `${JSON.stringify({ schemaVersion: 1, navigation, unlisted }, null, 2)}\n`;
}

describe("loadDocumentationCatalog", () => {
	it("loads valid groups, labels, paths, and ordering", () => {
		const root = createDocumentationFixture({
			"docs.json": JSON.stringify({
				schemaVersion: 1,
				navigation: [
					{ title: "Start here", items: [{ title: "Overview", path: "index.md" }] },
					{ title: "Reference", items: [{ title: "Guide", path: "guide.md" }] },
				],
				unlisted: [{ title: "Internal", path: "internal.md" }],
				redirects: [{ from: "old.md", to: "guide.md" }],
			}),
			"index.md": "# Overview\n",
			"guide.md": "# Guide\n",
			"internal.md": "# Internal\n",
		});

		expect(loadDocumentationCatalog(join(root, "docs.json"))).toEqual({
			schemaVersion: 1,
			navigation: [
				{ title: "Start here", items: [{ title: "Overview", path: "index.md" }] },
				{ title: "Reference", items: [{ title: "Guide", path: "guide.md" }] },
			],
			unlisted: [{ title: "Internal", path: "internal.md" }],
		});
	});

	it("rejects missing documentation files", () => {
		const root = createDocumentationFixture({
			"docs.json": catalogJson([
				{
					title: "Docs",
					items: [
						{ title: "Overview", path: "index.md" },
						{ title: "Missing", path: "missing.md" },
					],
				},
			]),
			"index.md": "# Overview\n",
		});

		expect(() => loadDocumentationCatalog(join(root, "docs.json"))).toThrow(
			"Missing documentation files: missing.md",
		);
	});

	it("rejects uncataloged Markdown files in sorted order", () => {
		const root = createDocumentationFixture({
			"docs.json": catalogJson([{ title: "Docs", items: [{ title: "Overview", path: "index.md" }] }]),
			"index.md": "# Overview\n",
			"z.md": "# Z\n",
			"a.md": "# A\n",
		});

		expect(() => loadDocumentationCatalog(join(root, "docs.json"))).toThrow("Uncataloged Markdown files: a.md, z.md");
	});

	it("rejects duplicate catalog entries", () => {
		const root = createDocumentationFixture({
			"docs.json": catalogJson(
				[{ title: "Docs", items: [{ title: "First", path: "index.md" }] }],
				[{ title: "Second", path: "index.md" }],
			),
			"index.md": "# Overview\n",
		});

		expect(() => loadDocumentationCatalog(join(root, "docs.json"))).toThrow(
			"Duplicate documentation paths: index.md",
		);
	});

	it.each([
		["../outside.md", "relative normalized .md path"],
		["/absolute.md", "relative normalized .md path"],
		["./index.md", "relative normalized .md path"],
		["guide.txt", "relative normalized .md path"],
		["", "must be a nonempty string"],
	])("rejects invalid documentation path %j", (path, error) => {
		const root = createDocumentationFixture({
			"docs.json": catalogJson([{ title: "Docs", items: [{ title: "Page", path }] }]),
		});

		expect(() => loadDocumentationCatalog(join(root, "docs.json"))).toThrow(error);
	});

	it.each([
		["the root type", [], "Documentation catalog must be an object"],
		[
			"unsupported fields",
			{ schemaVersion: 1, navigation: [], extra: true },
			"Documentation catalog has unsupported fields: extra",
		],
		["the schema version", { schemaVersion: 2, navigation: [] }, "schemaVersion must be 1"],
		["the navigation type", { schemaVersion: 1, navigation: {} }, "navigation must be an array"],
		[
			"the unlisted type",
			{ schemaVersion: 1, navigation: [], unlisted: {} },
			"Documentation catalog unlisted must be an array",
		],
		[
			"the group shape",
			{ schemaVersion: 1, navigation: [null] },
			"Documentation catalog navigation[0] must be an object",
		],
		[
			"the items type",
			{ schemaVersion: 1, navigation: [{ title: "Docs", items: {} }] },
			"Documentation catalog navigation[0].items must be an array",
		],
		[
			"the item shape",
			{ schemaVersion: 1, navigation: [{ title: "Docs", items: [null] }] },
			"Documentation catalog navigation[0].items[0] must be an object",
		],
		[
			"an empty group title",
			{ schemaVersion: 1, navigation: [{ title: " ", items: [] }] },
			"navigation[0].title must be a nonempty string",
		],
		[
			"an empty item title",
			{ schemaVersion: 1, navigation: [{ title: "Docs", items: [{ title: "", path: "index.md" }] }] },
			"navigation[0].items[0].title must be a nonempty string",
		],
	])("rejects malformed schema: %s", (_condition, catalog, error) => {
		const root = createDocumentationFixture({ "docs.json": JSON.stringify(catalog) });

		expect(() => loadDocumentationCatalog(join(root, "docs.json"))).toThrow(error);
	});

	it("rejects duplicate public slugs", () => {
		const root = createDocumentationFixture({
			"docs.json": catalogJson(
				[
					{
						title: "Docs",
						items: [
							{ title: "Overview", path: "index.md" },
							{ title: "Foo", path: "foo.md" },
						],
					},
				],
				[{ title: "Foo index", path: "foo/index.md" }],
			),
			"index.md": "# Overview\n",
			"foo.md": "# Foo\n",
			"foo/index.md": "# Foo index\n",
		});

		expect(() => loadDocumentationCatalog(join(root, "docs.json"))).toThrow(
			"Duplicate public documentation slugs: foo (foo.md, foo/index.md)",
		);
	});

	it("rejects malformed JSON without fallback parsing", () => {
		const root = createDocumentationFixture({ "docs.json": "{" });

		expect(() => loadDocumentationCatalog(join(root, "docs.json"))).toThrow(SyntaxError);
	});
});
