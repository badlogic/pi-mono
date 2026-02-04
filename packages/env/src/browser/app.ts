import { join } from "./path.js";

/** No-op in browser. */
export function initEnv(_callerImportMetaUrl: string): void {}

/** Get the base directory for resolving package assets. */
export function getPackageDir(): string {
	return "/browser";
}

/** Resolve an asset directory relative to the package. */
export function getAssetDir(subpath: string): string {
	return join("/browser", subpath);
}

/** Get the update action string for version notifications. */
export function getUpdateAction(_packageName: string): string {
	return "";
}

/** Get jiti options for extension loading. */
export function getJitiOptions(
	_virtualModules: Record<string, unknown>,
	getAliases: () => Record<string, string>,
): { alias?: Record<string, string>; virtualModules?: Record<string, unknown>; tryNative?: boolean } {
	return { alias: getAliases() };
}
