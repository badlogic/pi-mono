import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Detect if we're running as a Bun compiled binary.
 * Bun binaries have import.meta.url starting with "file:///$bunfs/"
 */
export const isBunBinary = import.meta.url.startsWith("file:///$bunfs/");

/**
 * Get the base directory for resolving package assets (themes, package.json, README.md, CHANGELOG.md).
 * - For Bun binary: returns the directory containing the executable
 * - For Node.js (dist/): returns __dirname (the dist/ directory)
 * - For tsx (src/): returns parent directory (the package root)
 */
export function getPackageDir(): string {
	if (isBunBinary) {
		// Bun binary: resolve relative to the executable
		return dirname(process.execPath);
	}
	// Node.js: check if package.json exists in __dirname (dist/) or parent (src/ case)
	if (existsSync(join(__dirname, "package.json"))) {
		return __dirname;
	}
	// Running from src/ via tsx - go up one level to package root
	return dirname(__dirname);
}

/**
 * Get path to the theme directory
 * - For Bun binary: dist/theme/ next to executable
 * - For Node.js (dist/): dist/theme/
 * - For tsx (src/): src/theme/
 */
export function getThemeDir(): string {
	if (isBunBinary) {
		return join(dirname(process.execPath), "theme");
	}
	// __dirname is either dist/ or src/ - theme is always a subdirectory
	return join(__dirname, "theme");
}

/**
 * Get path to package.json
 */
export function getPackageJsonPath(): string {
	return join(getPackageDir(), "package.json");
}

/**
 * Get path to README.md
 */
export function getReadmePath(): string {
	return resolve(join(getPackageDir(), "README.md"));
}

/**
 * Get path to CHANGELOG.md
 */
export function getChangelogPath(): string {
	return resolve(join(getPackageDir(), "CHANGELOG.md"));
}
