import { accessSync, constants } from "node:fs";
import * as os from "node:os";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";

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

export function resolveReadPath(filePath: string): string {
	const expanded = expandPath(filePath);

	if (fileExists(expanded)) {
		return expanded;
	}

	const macOSVariant = tryMacOSScreenshotPath(expanded);
	if (macOSVariant !== expanded && fileExists(macOSVariant)) {
		return macOSVariant;
	}

	return expanded;
}
