/**
 * Process @file CLI arguments into text content and image attachments
 */

import { access, readFile, stat } from "node:fs/promises";
import type { Attachment } from "@mariozechner/pi-agent-core";
import chalk from "chalk";
import { resolve } from "path";
import { resolveReadPath } from "../core/tools/path-utils.js";
import { detectSupportedImageMimeTypeFromFile } from "../utils/mime.js";

export interface ProcessedFiles {
	textContent: string;
	imageAttachments: Attachment[];
}

/** Process @file arguments into text content and image attachments */
export async function processFileArguments(fileArgs: string[]): Promise<ProcessedFiles> {
	const imageAttachments: Attachment[] = [];
	const fileEntries: string[] = [];

	for (const fileArg of fileArgs) {
		// Expand and resolve path (handles ~ expansion and macOS screenshot Unicode spaces)
		const absolutePath = resolve(resolveReadPath(fileArg, process.cwd()));

		// Check if file exists
		try {
			await access(absolutePath);
		} catch {
			console.error(chalk.red(`Error: File not found: ${absolutePath}`));
			process.exit(1);
		}

		// Check if file is empty
		const stats = await stat(absolutePath);
		if (stats.size === 0) {
			// Skip empty files
			continue;
		}

		const mimeType = await detectSupportedImageMimeTypeFromFile(absolutePath);

		if (mimeType) {
			// Handle image file
			const content = await readFile(absolutePath);
			const base64Content = content.toString("base64");

			const attachment: Attachment = {
				id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
				type: "image",
				fileName: absolutePath.split("/").pop() || absolutePath,
				mimeType,
				size: stats.size,
				content: base64Content,
			};

			imageAttachments.push(attachment);

			// Add file entry with empty content (attachment handles the data)
			fileEntries.push(formatFileEntry(absolutePath, mimeType, ""));
		} else {
			// Handle text file
			try {
				const content = await readFile(absolutePath, "utf-8");
				fileEntries.push(formatFileEntry(absolutePath, getLanguageFromPath(absolutePath), content));
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Error: Could not read file ${absolutePath}: ${message}`));
				process.exit(1);
			}
		}
	}

	const textContent = fileEntries.length > 0 ? `<files>\n${fileEntries.join("\n")}\n</files>\n` : "";

	return { textContent, imageAttachments };
}

/** Escape special characters in XML attributes */
export function escapeXmlAttr(str: string): string {
	return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Escape CDATA content by splitting ]]> sequences */
export function escapeCdataContent(str: string): string {
	return str.replace(/]]>/g, "]]]]><![CDATA[>");
}

/** Build a single file entry with CDATA */
export function formatFileEntry(path: string, language: string, content: string): string {
	const escapedPath = escapeXmlAttr(path);
	const escapedLang = escapeXmlAttr(language);
	const escapedContent = escapeCdataContent(content);
	return `  <file path="${escapedPath}" language="${escapedLang}">\n<![CDATA[\n${escapedContent}\n]]>\n  </file>`;
}

/** Map file extensions to language names */
const EXTENSION_MAP: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	js: "javascript",
	jsx: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	py: "python",
	rb: "ruby",
	rs: "rust",
	go: "go",
	java: "java",
	kt: "kotlin",
	swift: "swift",
	c: "c",
	cpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	h: "c",
	hpp: "cpp",
	cs: "csharp",
	php: "php",
	md: "markdown",
	json: "json",
	yaml: "yaml",
	yml: "yaml",
	xml: "xml",
	html: "html",
	htm: "html",
	css: "css",
	scss: "scss",
	sass: "sass",
	less: "less",
	sql: "sql",
	sh: "shell",
	bash: "shell",
	zsh: "shell",
	fish: "shell",
	ps1: "powershell",
	toml: "toml",
	ini: "ini",
	cfg: "ini",
	conf: "ini",
	dockerfile: "dockerfile",
	makefile: "makefile",
	vue: "vue",
	svelte: "svelte",
	r: "r",
	lua: "lua",
	perl: "perl",
	pl: "perl",
	scala: "scala",
	clj: "clojure",
	ex: "elixir",
	exs: "elixir",
	erl: "erlang",
	hs: "haskell",
	ml: "ocaml",
	fs: "fsharp",
	fsx: "fsharp",
	dart: "dart",
	zig: "zig",
	nim: "nim",
	v: "v",
	txt: "text",
	log: "text",
	csv: "csv",
	tsv: "tsv",
	graphql: "graphql",
	gql: "graphql",
	proto: "protobuf",
	tf: "terraform",
	hcl: "hcl",
};

export function getLanguageFromPath(filePath: string): string {
	const ext = filePath.split(".").pop()?.toLowerCase() || "";
	return EXTENSION_MAP[ext] || "text";
}
