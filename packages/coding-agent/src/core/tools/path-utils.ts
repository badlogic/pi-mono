import { accessSync, constants } from "node:fs";
import * as os from "node:os";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { getPackageDir } from "../../config.js";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";
export const PI_INTERNAL_SCHEME = "pi-internal://";

function normalizeUnicodeSpaces(str: string): string {
	return str.replace(UNICODE_SPACES, " ");
}

function tryMacOSScreenshotPath(filePath: string): string {
	return filePath.replace(/ (AM|PM)\./g, `${NARROW_NO_BREAK_SPACE}$1.`);
}

function fileExists(filePath: string): boolean {
	try {
		accessSync(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

export function expandPath(filePath: string): string {
	const normalized = normalizeUnicodeSpaces(filePath);
	if (normalized === "~") {
		return os.homedir();
	}
	if (normalized.startsWith("~/")) {
		return os.homedir() + normalized.slice(1);
	}
	return normalized;
}

/**
 * Resolve a path relative to the given cwd.
 * Handles ~ expansion and absolute paths.
 */
export function resolveToCwd(filePath: string, cwd: string): string {
	const expanded = expandPath(filePath);
	if (isAbsolute(expanded)) {
		return expanded;
	}
	return resolvePath(cwd, expanded);
}

export function resolveReadPath(filePath: string, cwd: string): string {
	// Handle pi-internal:// scheme for Pi package documentation
	if (filePath.startsWith(PI_INTERNAL_SCHEME)) {
		const relativePath = filePath.slice(PI_INTERNAL_SCHEME.length);
		return resolvePath(getPackageDir(), relativePath);
	}

	const resolved = resolveToCwd(filePath, cwd);

	if (fileExists(resolved)) {
		return resolved;
	}

	const macOSVariant = tryMacOSScreenshotPath(resolved);
	if (macOSVariant !== resolved && fileExists(macOSVariant)) {
		return macOSVariant;
	}

	return resolved;
}
