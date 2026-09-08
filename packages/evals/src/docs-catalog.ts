/**
 * Builds a documentation catalog from the local Markdown list links
 * (`- [Title](path.md)`) in one Markdown file. Every cataloged page must exist
 * and remain beneath the catalog file's directory.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function relativeDocumentationPath(root: string, path: string): string {
	const relativePath = relative(root, path);
	if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
		throw new Error(`Documentation link escapes the documentation root: ${path}`);
	}
	return relativePath.replaceAll("\\", "/");
}

function* markdownLines(path: string): Generator<string> {
	let fence: "```" | "~~~" | undefined;
	for (const line of readFileSync(path, "utf8").split("\n")) {
		const trimmed = line.trimStart();
		if (fence) {
			if (trimmed.startsWith(fence)) fence = undefined;
			continue;
		}
		if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
			fence = trimmed.startsWith("```") ? "```" : "~~~";
			continue;
		}
		yield line;
	}
}

function catalogPagePaths(catalogPath: string): string[] {
	const paths: string[] = [];
	for (const line of markdownLines(catalogPath)) {
		const match = /^\s*-\s+\[[^\]]+]\(([^)\s]+)\)(?:\s|$)/.exec(line);
		if (!match) continue;
		const target = match[1];
		if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//")) continue;
		const path = target.split("#", 1)[0];
		if (!path.endsWith(".md")) continue;
		paths.push(path);
	}
	return paths;
}

export function loadDocumentationCatalog(catalogPath: string): Array<{ relativePath: string }> {
	const resolvedCatalogPath = resolve(catalogPath);
	const root = dirname(resolvedCatalogPath);
	const pages: Array<{ relativePath: string }> = [];
	const seenPages = new Set<string>();
	for (const path of catalogPagePaths(resolvedCatalogPath)) {
		const target = resolve(root, path);
		const relativePath = relativeDocumentationPath(root, target);
		if (!existsSync(target)) throw new Error(`Missing documentation page: ${relativePath}`);
		if (seenPages.has(target)) throw new Error(`Duplicate documentation page: ${relativePath}`);
		seenPages.add(target);
		pages.push({ relativePath });
	}
	return pages;
}
