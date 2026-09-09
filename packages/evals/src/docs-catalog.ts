import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";

export interface DocumentationCatalogItem {
	title: string;
	path: string;
}

export interface DocumentationCatalogGroup {
	title: string;
	items: DocumentationCatalogItem[];
}

export interface DocumentationCatalog {
	schemaVersion: 1;
	navigation: DocumentationCatalogGroup[];
	unlisted: DocumentationCatalogItem[];
}

function requireObject(value: unknown, location: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${location} must be an object`);
	}
	return value as Record<string, unknown>;
}

function requireNonemptyString(value: unknown, location: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${location} must be a nonempty string`);
	}
	return value;
}

function requireFields(value: Record<string, unknown>, fields: string[], location: string): void {
	const unsupportedFields = Object.keys(value)
		.filter((field) => !fields.includes(field))
		.sort();
	if (unsupportedFields.length > 0) {
		throw new Error(`${location} has unsupported fields: ${unsupportedFields.join(", ")}`);
	}
}

function requireDocumentationPath(value: unknown, location: string): string {
	const path = requireNonemptyString(value, location);
	const normalizedPath = posix.normalize(path);
	const escapesDocsRoot = normalizedPath === ".." || normalizedPath.startsWith("../");
	const hasUrlSyntax = path.includes("?") || path.includes("#");
	const hasWindowsSyntax = path.includes("\\") || /^[a-z]:/i.test(path);

	if (
		path !== path.trim() ||
		path !== normalizedPath ||
		posix.isAbsolute(path) ||
		escapesDocsRoot ||
		hasUrlSyntax ||
		hasWindowsSyntax ||
		!path.endsWith(".md")
	) {
		throw new Error(`${location} must be a nonempty relative normalized .md path`);
	}
	return path;
}

function readDocumentationItem(rawItem: unknown, location: string): DocumentationCatalogItem {
	const item = requireObject(rawItem, location);
	requireFields(item, ["title", "path"], location);
	return {
		title: requireNonemptyString(item.title, `${location}.title`),
		path: requireDocumentationPath(item.path, `${location}.path`),
	};
}

function readDocumentationCatalog(catalogPath: string): DocumentationCatalog {
	const rawCatalog = requireObject(JSON.parse(readFileSync(catalogPath, "utf8")), "Documentation catalog");

	// redirects remains temporarily for website compatibility, but is not catalog data.
	requireFields(rawCatalog, ["schemaVersion", "navigation", "unlisted", "redirects"], "Documentation catalog");
	if (rawCatalog.schemaVersion !== 1) throw new Error("Documentation catalog schemaVersion must be 1");
	if (!Array.isArray(rawCatalog.navigation)) throw new Error("Documentation catalog navigation must be an array");

	const navigation = rawCatalog.navigation.map((rawGroup, groupIndex): DocumentationCatalogGroup => {
		const groupLocation = `Documentation catalog navigation[${groupIndex}]`;
		const group = requireObject(rawGroup, groupLocation);
		requireFields(group, ["title", "items"], groupLocation);

		const title = requireNonemptyString(group.title, `${groupLocation}.title`);
		if (!Array.isArray(group.items)) throw new Error(`${groupLocation}.items must be an array`);
		if (group.items.length === 0) throw new Error(`${groupLocation}.items must contain at least one item`);

		const items = group.items.map((item, itemIndex) =>
			readDocumentationItem(item, `${groupLocation}.items[${itemIndex}]`),
		);

		return { title, items };
	});

	const rawUnlisted = rawCatalog.unlisted ?? [];
	if (!Array.isArray(rawUnlisted)) throw new Error("Documentation catalog unlisted must be an array");
	const unlisted = rawUnlisted.map((item, index) =>
		readDocumentationItem(item, `Documentation catalog unlisted[${index}]`),
	);

	return { schemaVersion: 1, navigation, unlisted };
}

function listMarkdownFiles(docsRoot: string): string[] {
	return readdirSync(docsRoot, { recursive: true, encoding: "utf8" })
		.map((path) => path.replaceAll("\\", "/"))
		.filter((path) => path.endsWith(".md") && statSync(join(docsRoot, path)).isFile())
		.sort();
}

function publicSlug(path: string): string {
	const withoutExtension = path.slice(0, -3);
	if (withoutExtension === "index") return "";
	return withoutExtension.endsWith("/index") ? withoutExtension.slice(0, -6) : withoutExtension;
}

function findPublicSlugCollisions(paths: string[]): string[] {
	const pathsBySlug = new Map<string, string[]>();
	for (const path of paths) {
		const slug = publicSlug(path);
		pathsBySlug.set(slug, [...(pathsBySlug.get(slug) ?? []), path]);
	}
	return [...pathsBySlug]
		.filter(([, slugPaths]) => slugPaths.length > 1)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([slug, slugPaths]) => `${slug || "/"} (${slugPaths.join(", ")})`);
}

function validateDocumentationInventory(catalog: DocumentationCatalog, docsRoot: string): void {
	const catalogPaths = [...catalog.navigation.flatMap(({ items }) => items), ...catalog.unlisted].map(
		({ path }) => path,
	);
	const pathCounts = new Map<string, number>();
	for (const path of catalogPaths) pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);

	const uniquePaths = [...pathCounts.keys()].sort();
	const duplicatePaths = uniquePaths.filter((path) => pathCounts.get(path) !== 1);
	const missingPaths: string[] = [];
	for (const path of uniquePaths) {
		try {
			if (!statSync(resolve(docsRoot, path)).isFile()) missingPaths.push(path);
		} catch (error) {
			if (
				error &&
				typeof error === "object" &&
				"code" in error &&
				(error.code === "ENOENT" || error.code === "ENOTDIR")
			) {
				missingPaths.push(path);
				continue;
			}
			throw error;
		}
	}

	const uncatalogedPaths = listMarkdownFiles(docsRoot).filter((path) => !pathCounts.has(path));
	const slugCollisions = findPublicSlugCollisions(uniquePaths);
	const issues: string[] = [];
	if (duplicatePaths.length > 0) issues.push(`Duplicate documentation paths: ${duplicatePaths.join(", ")}`);
	if (slugCollisions.length > 0) issues.push(`Duplicate public documentation slugs: ${slugCollisions.join("; ")}`);
	if (missingPaths.length > 0) issues.push(`Missing documentation files: ${missingPaths.join(", ")}`);
	if (uncatalogedPaths.length > 0) issues.push(`Uncataloged Markdown files: ${uncatalogedPaths.join(", ")}`);

	if (issues.length > 0) throw new Error(`Invalid documentation catalog:\n- ${issues.join("\n- ")}`);
}

/** Read and validate docs.json against the Markdown files beside it. */
export function loadDocumentationCatalog(catalogPath: string): DocumentationCatalog {
	const resolvedCatalogPath = resolve(catalogPath);
	const catalog = readDocumentationCatalog(resolvedCatalogPath);
	validateDocumentationInventory(catalog, dirname(resolvedCatalogPath));
	return catalog;
}
