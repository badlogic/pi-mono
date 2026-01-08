/**
 * Shared version check utilities for checking npm registry for updates.
 */
import { readFileSync } from "fs";
import { getPackageJsonPath, VERSION } from "../config.js";

const pkg = JSON.parse(readFileSync(getPackageJsonPath(), "utf-8"));
const PACKAGE_NAME: string = pkg.name;

/**
 * Fetch the latest version from npm registry.
 * Returns null on network errors or if fetch fails.
 */
export async function getLatestVersion(): Promise<string | null> {
	try {
		const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`);
		if (!response.ok) return null;

		const data = (await response.json()) as { version?: string };
		return data.version ?? null;
	} catch {
		return null;
	}
}

/**
 * Check if a new version is available.
 * Returns the new version string if available, undefined otherwise.
 * Respects PI_SKIP_VERSION_CHECK environment variable.
 */
export async function checkForNewVersion(): Promise<string | undefined> {
	if (process.env.PI_SKIP_VERSION_CHECK) return undefined;

	const latestVersion = await getLatestVersion();
	if (latestVersion && latestVersion !== VERSION) {
		return latestVersion;
	}
	return undefined;
}
