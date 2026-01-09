/**
 * VM-based extension loader for isolated extension execution.
 *
 * Each extension runs in its own Node.js VM context with fresh builtins.
 * This provides isolation from the main process:
 * - Monkeypatches to Array.prototype, Object.prototype, etc. don't leak out
 * - On reload, the old context (and all its state) is garbage collected
 * - Extension dependencies also run in the isolated context
 */

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as vm from "node:vm";
import { createJiti, type Jiti } from "jiti";

const mainRequire = createRequire(import.meta.url);

// Node.js built-in modules that we pass through from the main process
const NODE_BUILTINS = new Set([
	"assert",
	"buffer",
	"child_process",
	"crypto",
	"dns",
	"events",
	"fs",
	"http",
	"https",
	"net",
	"os",
	"path",
	"querystring",
	"readline",
	"stream",
	"string_decoder",
	"timers",
	"tls",
	"tty",
	"url",
	"util",
	"zlib",
]);

/**
 * Get the resolved paths for our injected packages.
 * These are loaded from the main process and passed into the VM context.
 */
function getInjectedPackages(): Map<string, unknown> {
	const __dirname = path.dirname(fileURLToPath(import.meta.url));
	const packages = new Map<string, unknown>();

	// Lazy-load packages to avoid circular dependencies during startup
	return new Proxy(packages, {
		get(_target, prop) {
			if (prop === "has") {
				return (key: string) => {
					return (
						key === "@mariozechner/pi-coding-agent" ||
						key === "@mariozechner/pi-coding-agent/extensions" ||
						key === "@mariozechner/pi-tui" ||
						key === "@mariozechner/pi-ai" ||
						key === "@sinclair/typebox"
					);
				};
			}
			if (prop === "get") {
				return (key: string) => {
					switch (key) {
						case "@mariozechner/pi-coding-agent":
							return mainRequire(path.resolve(__dirname, "../..", "index.js"));
						case "@mariozechner/pi-coding-agent/extensions":
							return mainRequire(path.resolve(__dirname, "index.js"));
						case "@mariozechner/pi-tui":
							return mainRequire("@mariozechner/pi-tui");
						case "@mariozechner/pi-ai":
							return mainRequire("@mariozechner/pi-ai");
						case "@sinclair/typebox": {
							const entry = mainRequire.resolve("@sinclair/typebox");
							const root = entry.replace(/\/build\/cjs\/index\.js$/, "");
							return mainRequire(root);
						}
						default:
							return undefined;
					}
				};
			}
			return undefined;
		},
	}) as Map<string, unknown>;
}

/**
 * Find the node_modules directory for an extension.
 */
function findNodeModules(startDir: string): string | null {
	let dir = startDir;
	while (dir !== path.dirname(dir)) {
		const nm = path.join(dir, "node_modules");
		if (fs.existsSync(nm)) return nm;
		dir = path.dirname(dir);
	}
	return null;
}

/**
 * Find the main entry point for a package.
 */
function findPackageMain(pkgDir: string): string | null {
	const pkgJsonPath = path.join(pkgDir, "package.json");
	if (fs.existsSync(pkgJsonPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
			const main = pkg.main || "index.js";
			const mainPath = path.join(pkgDir, main);
			if (fs.existsSync(mainPath)) return mainPath;
			// Try adding extensions
			for (const ext of [".ts", ".js", ".mjs", ".cjs"]) {
				const withExt = mainPath + ext;
				if (fs.existsSync(withExt)) return withExt;
			}
		} catch {
			// Ignore JSON parse errors
		}
	}

	// Fall back to index files
	for (const name of ["index.ts", "index.js", "index.mjs"]) {
		const p = path.join(pkgDir, name);
		if (fs.existsSync(p)) return p;
	}
	return null;
}

/**
 * Resolve a module path with extension fallbacks.
 */
function resolveModulePath(basePath: string): string | null {
	if (fs.existsSync(basePath)) {
		const stat = fs.statSync(basePath);
		if (stat.isDirectory()) {
			return findPackageMain(basePath);
		}
		return basePath;
	}

	// Try adding extensions
	for (const ext of [".ts", ".tsx", ".js", ".mjs", ".cjs"]) {
		const withExt = basePath + ext;
		if (fs.existsSync(withExt)) return withExt;
	}

	// Try as directory with index
	for (const index of ["/index.ts", "/index.js"]) {
		const withIndex = basePath + index;
		if (fs.existsSync(withIndex)) return withIndex;
	}

	return null;
}

export interface VMExtensionLoaderOptions {
	/** Extension entry point path */
	extensionPath: string;
	/** Working directory for relative imports */
	cwd: string;
}

/**
 * Loads and runs an extension in an isolated VM context.
 *
 * The context has:
 * - Fresh builtins (Array, Object, etc.) that extensions can patch without affecting main process
 * - Console, timers, Buffer from main process (safe to share)
 * - A sandboxed require that routes imports appropriately
 */
export class VMExtensionLoader {
	private context: vm.Context;
	private moduleCache: Map<string, unknown>;
	private extensionDir: string;
	private cwd: string;
	private jiti: Jiti;
	private injectedPackages: Map<string, unknown>;

	constructor(options: VMExtensionLoaderOptions) {
		this.extensionDir = path.dirname(options.extensionPath);
		this.cwd = options.cwd;
		this.moduleCache = new Map();
		this.injectedPackages = getInjectedPackages();

		// Create jiti for TypeScript compilation (without execution)
		this.jiti = createJiti(options.extensionPath, {
			moduleCache: false, // We handle caching ourselves
			fsCache: false, // Don't use cache - we need fresh transforms for reload
		});

		// Create isolated VM context
		// DO NOT pass builtins like Array, Object - the context creates fresh ones
		this.context = vm.createContext({
			// Safe to share: console, timers, Buffer
			console,
			setTimeout,
			setInterval,
			clearTimeout,
			clearInterval,
			setImmediate,
			clearImmediate,
			queueMicrotask,
			Buffer,
			// Limited process object
			process: {
				env: process.env,
				cwd: () => process.cwd(),
				platform: process.platform,
				version: process.version,
				versions: process.versions,
				arch: process.arch,
				// Don't expose exit, kill, etc.
			},
			// URL and URLSearchParams are commonly needed
			URL,
			URLSearchParams,
			// TextEncoder/TextDecoder
			TextEncoder,
			TextDecoder,
			// Fetch API if available
			...(typeof fetch !== "undefined" ? { fetch, Request, Response, Headers } : {}),
		});
	}

	/**
	 * Transform a file using jiti (TypeScript compilation).
	 */
	private transformFile(filePath: string): string {
		const source = fs.readFileSync(filePath, "utf-8");
		const ext = path.extname(filePath);

		if (ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts") {
			return this.jiti.transform({ source, filename: filePath, ts: true });
		}

		if (ext === ".mjs" || ext === ".cjs" || ext === ".js") {
			// May need transform for ESM syntax
			return this.jiti.transform({ source, filename: filePath });
		}

		if (ext === ".json") {
			return `module.exports = ${source}`;
		}

		return source;
	}

	/**
	 * Load a module into the VM context.
	 */
	private loadModuleInContext(modulePath: string): unknown {
		const resolved = path.resolve(modulePath);

		if (this.moduleCache.has(resolved)) {
			return this.moduleCache.get(resolved);
		}

		// Set cache entry early to handle circular dependencies
		const moduleObj = { exports: {} as Record<string, unknown> };
		this.moduleCache.set(resolved, moduleObj.exports);

		try {
			const code = this.transformFile(resolved);

			// CommonJS wrapper
			const wrapped = `
				(function(module, exports, require, __filename, __dirname) {
					${code}
				})
			`;

			const fn = vm.runInContext(wrapped, this.context, {
				filename: resolved,
				lineOffset: 0,
				columnOffset: 0,
			});

			fn(moduleObj, moduleObj.exports, this.createRequire(path.dirname(resolved)), resolved, path.dirname(resolved));

			// Handle ESM interop - if there's a default export, also expose it
			const exports = moduleObj.exports;
			this.moduleCache.set(resolved, exports);
			return exports;
		} catch (err) {
			// Remove from cache on error
			this.moduleCache.delete(resolved);
			throw err;
		}
	}

	/**
	 * Create a sandboxed require function for use within the VM context.
	 */
	private createRequire(fromDir: string): (id: string) => unknown {
		return (moduleId: string): unknown => {
			// Our injected packages (pi-coding-agent, pi-tui, etc.)
			if (this.injectedPackages.has(moduleId)) {
				return this.injectedPackages.get(moduleId);
			}

			// Node.js built-ins with node: prefix
			if (moduleId.startsWith("node:")) {
				return mainRequire(moduleId);
			}

			// Node.js built-ins without prefix
			if (NODE_BUILTINS.has(moduleId)) {
				return mainRequire(moduleId);
			}

			// Relative imports
			if (moduleId.startsWith(".")) {
				const basePath = path.resolve(fromDir, moduleId);
				const resolved = resolveModulePath(basePath);
				if (resolved) {
					return this.loadModuleInContext(resolved);
				}
				throw new Error(`Cannot find module '${moduleId}' from '${fromDir}'`);
			}

			// npm packages from extension's node_modules
			const nodeModules = findNodeModules(this.extensionDir);
			if (nodeModules) {
				// Handle scoped packages (@org/pkg)
				const pkgDir = path.join(nodeModules, moduleId);
				if (fs.existsSync(pkgDir)) {
					const main = findPackageMain(pkgDir);
					if (main) {
						return this.loadModuleInContext(main);
					}
				}
			}

			// Try to load from main process as fallback for shared dependencies
			try {
				return mainRequire(moduleId);
			} catch {
				throw new Error(`Cannot find module '${moduleId}' from '${fromDir}'`);
			}
		};
	}

	/**
	 * Load the extension entry point.
	 * Returns the module exports (should be a factory function or { default: factory }).
	 */
	load(): unknown {
		// Load from parent directory (the extensionDir is the directory containing the extension)
		return this.loadModuleInContext(path.join(this.extensionDir, ".."));
	}

	/**
	 * Load a specific file as the extension entry point.
	 */
	loadFile(filePath: string): unknown {
		return this.loadModuleInContext(filePath);
	}

	/**
	 * Dispose of this loader, allowing the VM context to be garbage collected.
	 */
	dispose(): void {
		this.moduleCache.clear();
		// The context will be GC'd once there are no more references
	}
}

/**
 * Load an extension using the VM-based loader.
 *
 * @param extensionPath - Path to the extension file
 * @param cwd - Working directory
 * @returns The loaded module exports
 */
export function loadExtensionInVM(extensionPath: string, cwd: string): { exports: unknown; loader: VMExtensionLoader } {
	const loader = new VMExtensionLoader({ extensionPath, cwd });
	const exports = loader.loadFile(extensionPath);
	return { exports, loader };
}
