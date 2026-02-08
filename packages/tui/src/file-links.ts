import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

export interface FileReference {
	path: string;
	line?: number;
	column?: number;
}

export type EditorLinkScheme = "file" | "vscode" | "cursor" | "windsurf";

export interface EditorFileUrlOptions {
	cwd?: string;
	scheme?: EditorLinkScheme;
}

const KNOWN_EXTENSIONLESS_FILE_NAMES = new Set(["Dockerfile", "Makefile", "LICENSE"]);

export function lineMayContainFileReference(line: string): boolean {
	return line.length > 0 && (line.includes("/") || line.includes("\\"));
}

export function parseFileReference(candidate: string): FileReference | undefined {
	if (candidate.includes("://")) {
		return undefined;
	}

	if (/\s/.test(candidate)) {
		return undefined;
	}

	if (candidate.endsWith("/*")) {
		return undefined;
	}

	let filePath = candidate;
	let line: number | undefined;
	let column: number | undefined;

	const lineMatch = candidate.match(/:(\d+)(?:(?::(\d+))|(?:-\d+))?$/);
	if (lineMatch) {
		const parsedLine = Number.parseInt(lineMatch[1], 10);
		const parsedColumn = lineMatch[2] ? Number.parseInt(lineMatch[2], 10) : undefined;
		if (!Number.isNaN(parsedLine) && parsedLine > 0) {
			line = parsedLine;
			column =
				parsedColumn !== undefined && !Number.isNaN(parsedColumn) && parsedColumn > 0 ? parsedColumn : undefined;
			filePath = candidate.slice(0, -lineMatch[0].length);
		}
	}

	if (!hasExplicitPath(filePath)) {
		return undefined;
	}

	if (!isValidFileReferencePath(filePath)) {
		return undefined;
	}

	return {
		path: filePath,
		line,
		column,
	};
}

export function buildEditorFileUrl(file: string | FileReference, options: EditorFileUrlOptions = {}): string {
	const fileReference: FileReference = typeof file === "string" ? { path: file } : file;
	const scheme = options.scheme ?? "file";

	const cwd = options.cwd ?? process.cwd();
	const expandedPath = fileReference.path.startsWith("~/")
		? path.join(os.homedir(), fileReference.path.slice(2))
		: fileReference.path;
	const absolutePath = path.isAbsolute(expandedPath) ? expandedPath : path.resolve(cwd, expandedPath);

	if (scheme === "vscode" || scheme === "cursor" || scheme === "windsurf") {
		const line = fileReference.line ?? 1;
		const column = fileReference.column ?? 1;
		return `${scheme}://file${absolutePath}:${line}:${column}`;
	}

	return pathToFileURL(absolutePath).toString();
}

export function linkFileDisplayText(
	displayText: string,
	file: string | FileReference,
	options: EditorFileUrlOptions = {},
): string {
	const href = buildEditorFileUrl(file, options);
	return createTerminalHyperlink(displayText, href);
}

export function createTerminalHyperlink(text: string, href: string): string {
	return `\x1b]8;;${href}\x07${text}\x1b]8;;\x07`;
}

function isValidFileReferencePath(filePath: string): boolean {
	if (filePath.length === 0 || /\s/.test(filePath)) {
		return false;
	}

	if (filePath.endsWith("/") || filePath.endsWith("\\")) {
		return false;
	}

	const lastSegment = filePath.split(/[\\/]/).pop();
	if (!lastSegment) {
		return false;
	}

	return looksLikeFilePath(lastSegment);
}

function hasExplicitPath(filePath: string): boolean {
	return filePath.includes("/") || filePath.includes("\\") || filePath.startsWith("~/");
}

function looksLikeFilePath(fileName: string): boolean {
	if (/\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(fileName)) {
		return true;
	}

	return KNOWN_EXTENSIONLESS_FILE_NAMES.has(fileName);
}
