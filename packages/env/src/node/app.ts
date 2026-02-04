import { existsSync } from "./fs.js";
import { homedir } from "./os.js";
import { dirname, join } from "./path.js";
import { env as processEnv } from "./process.js";

let _storedDirname: string | undefined;

/** Store the caller's import.meta.url for use by other env functions. */
export function initEnv(callerImportMetaUrl: string): void {
	_storedDirname = dirname(new URL(callerImportMetaUrl).pathname);
}

/** Get the base directory for resolving package assets. */
export function getPackageDir(): string {
	const envDir = processEnv.PI_PACKAGE_DIR;
	if (envDir) {
		if (envDir === "~") return homedir();
		if (envDir.startsWith("~/")) return homedir() + envDir.slice(1);
		return envDir;
	}

	// Node.js: walk up from stored dirname until we find package.json
	let dir = _storedDirname!;
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) {
			return dir;
		}
		dir = dirname(dir);
	}
	return _storedDirname!;
}

/** Resolve an asset directory relative to the package. */
export function getAssetDir(subpath: string): string {
	const packageDir = getPackageDir();
	const srcOrDist = existsSync(join(packageDir, "src")) ? "src" : "dist";
	return join(packageDir, srcOrDist, subpath);
}

/** Get the update action string for version notifications. */
export function getUpdateAction(packageName: string): string {
	return `Run: npm install -g ${packageName}`;
}

/** Get jiti options for extension loading. */
export function getJitiOptions(
	_virtualModules: Record<string, unknown>,
	getAliases: () => Record<string, string>,
): { alias?: Record<string, string>; virtualModules?: Record<string, unknown>; tryNative?: boolean } {
	return { alias: getAliases() };
}
