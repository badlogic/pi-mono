/**
 * Browser filesystem fallbacks.
 *
 * Provides an in-memory filesystem for basic operations and no-op/error
 * fallbacks for operations that cannot work in a browser environment.
 * For real file operations in the browser, use the tool Operations interfaces
 * to delegate to a backend server.
 */

// In-memory file store for basic config/settings support
const memoryStore = new Map<string, string | Uint8Array>();
const memoryDirs = new Set<string>(["/", "/home", "/home/browser"]);

function normalizePath(p: string): string {
	// Simple normalize: remove trailing slash, collapse double slashes
	return p.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function parentDir(p: string): string {
	const normalized = normalizePath(p);
	const idx = normalized.lastIndexOf("/");
	return idx <= 0 ? "/" : normalized.slice(0, idx);
}

// ---- Constants ----

export const constants = {
	R_OK: 4,
	W_OK: 2,
	X_OK: 1,
	F_OK: 0,
} as const;

// ---- Sync APIs ----

export function accessSync(path: string, _mode?: number): void {
	if (!existsSync(path)) {
		throw new Error(`ENOENT: no such file or directory, access '${path}'`);
	}
}

export function existsSync(path: string): boolean {
	const p = normalizePath(path);
	return memoryStore.has(p) || memoryDirs.has(p);
}

export function readFileSync(path: string, encoding?: string): string | Uint8Array {
	const p = normalizePath(path);
	const data = memoryStore.get(p);
	if (data === undefined) {
		throw new Error(`ENOENT: no such file or directory, open '${path}'`);
	}
	if (encoding === "utf-8" || encoding === "utf8") {
		return typeof data === "string" ? data : new TextDecoder().decode(data);
	}
	return data;
}

export function writeFileSync(path: string, data: string | Uint8Array, _encoding?: string): void {
	const p = normalizePath(path);
	// Auto-create parent directories
	const parent = parentDir(p);
	if (!memoryDirs.has(parent)) {
		mkdirSync(parent, { recursive: true });
	}
	memoryStore.set(p, data);
}

export function mkdirSync(path: string, options?: { recursive?: boolean; mode?: number }): void {
	const p = normalizePath(path);
	if (memoryDirs.has(p)) return;
	if (options?.recursive) {
		const parts = p.split("/").filter(Boolean);
		let current = "";
		for (const part of parts) {
			current += `/${part}`;
			memoryDirs.add(current);
		}
	} else {
		const parent = parentDir(p);
		if (!memoryDirs.has(parent)) {
			throw new Error(`ENOENT: no such file or directory, mkdir '${path}'`);
		}
		memoryDirs.add(p);
	}
}

export function readdirSync(path: string): string[] {
	const p = normalizePath(path);
	if (!memoryDirs.has(p)) {
		throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
	}
	const prefix = p === "/" ? "/" : `${p}/`;
	const entries: string[] = [];
	for (const key of memoryStore.keys()) {
		if (key.startsWith(prefix)) {
			const rest = key.slice(prefix.length);
			if (!rest.includes("/")) {
				entries.push(rest);
			}
		}
	}
	for (const dir of memoryDirs) {
		if (dir.startsWith(prefix) && dir !== p) {
			const rest = dir.slice(prefix.length);
			if (!rest.includes("/")) {
				entries.push(rest);
			}
		}
	}
	return [...new Set(entries)];
}

export interface BrowserStats {
	isFile(): boolean;
	isDirectory(): boolean;
	isSymbolicLink(): boolean;
	size: number;
	mtime: Date;
	mode: number;
}

export type Stats = BrowserStats;

export function statSync(path: string): BrowserStats {
	const p = normalizePath(path);
	if (memoryDirs.has(p)) {
		return {
			isFile: () => false,
			isDirectory: () => true,
			isSymbolicLink: () => false,
			size: 0,
			mtime: new Date(),
			mode: 0o755,
		};
	}
	const data = memoryStore.get(p);
	if (data !== undefined) {
		const size = typeof data === "string" ? new TextEncoder().encode(data).length : data.length;
		return {
			isFile: () => true,
			isDirectory: () => false,
			isSymbolicLink: () => false,
			size,
			mtime: new Date(),
			mode: 0o644,
		};
	}
	throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
}

export function realpathSync(path: string): string {
	return normalizePath(path);
}

export function renameSync(oldPath: string, newPath: string): void {
	const op = normalizePath(oldPath);
	const np = normalizePath(newPath);
	const data = memoryStore.get(op);
	if (data === undefined) {
		throw new Error(`ENOENT: no such file or directory, rename '${oldPath}'`);
	}
	memoryStore.delete(op);
	memoryStore.set(np, data);
}

export function unlinkSync(path: string): void {
	const p = normalizePath(path);
	if (!memoryStore.delete(p)) {
		throw new Error(`ENOENT: no such file or directory, unlink '${path}'`);
	}
}

export function rmSync(path: string, _options?: { recursive?: boolean; force?: boolean }): void {
	const p = normalizePath(path);
	memoryStore.delete(p);
	memoryDirs.delete(p);
	// If recursive, remove children
	const prefix = `${p}/`;
	for (const key of memoryStore.keys()) {
		if (key.startsWith(prefix)) memoryStore.delete(key);
	}
	for (const dir of memoryDirs) {
		if (dir.startsWith(prefix)) memoryDirs.delete(dir);
	}
}

export function chmodSync(_path: string, _mode: number): void {
	// No-op in browser
}

// ---- Low-level sync APIs (stubs for session-manager compatibility) ----

export function appendFileSync(path: string, data: string | Uint8Array, _encoding?: string): void {
	const p = normalizePath(path);
	const existing = memoryStore.get(p);
	if (existing === undefined) {
		memoryStore.set(p, data);
	} else if (typeof existing === "string" && typeof data === "string") {
		memoryStore.set(p, existing + data);
	} else {
		const prev = typeof existing === "string" ? new TextEncoder().encode(existing) : existing;
		const next = typeof data === "string" ? new TextEncoder().encode(data) : data;
		const merged = new Uint8Array(prev.length + next.length);
		merged.set(prev);
		merged.set(next, prev.length);
		memoryStore.set(p, merged);
	}
}

let fdCounter = 100;
const fdMap = new Map<number, string>();

export function openSync(path: string, _flags?: string | number, _mode?: number): number {
	const p = normalizePath(path);
	const fd = fdCounter++;
	fdMap.set(fd, p);
	if (!memoryStore.has(p)) {
		memoryStore.set(p, "");
	}
	return fd;
}

export function closeSync(_fd: number): void {
	fdMap.delete(_fd);
}

export function readSync(
	_fd: number,
	_buffer: Uint8Array,
	_offset: number,
	_length: number,
	_position: number,
): number {
	// Minimal stub — real file operations should use Operations interfaces
	return 0;
}

// ---- Watch (no-op) ----

export interface FSWatcher {
	close(): void;
}

export function watch(_path: string, _options?: unknown, _listener?: unknown): FSWatcher {
	return { close() {} };
}

// ---- Stream (stub) ----

export interface WriteStream {
	write(data: string | Uint8Array): boolean;
	end(): void;
	close(): void;
}

export function createWriteStream(_path: string): WriteStream {
	const chunks: (string | Uint8Array)[] = [];
	return {
		write(data: string | Uint8Array) {
			chunks.push(data);
			return true;
		},
		end() {},
		close() {},
	};
}

// ---- Async APIs (fs/promises equivalents) ----

export async function readFile(path: string): Promise<Uint8Array>;
export async function readFile(path: string, encoding: string): Promise<string>;
export async function readFile(path: string, encoding?: string): Promise<string | Uint8Array> {
	return readFileSync(path, encoding);
}

export async function writeFile(path: string, data: string | Uint8Array, encoding?: string): Promise<void> {
	writeFileSync(path, data, encoding);
}

export async function access(path: string, _mode?: number): Promise<void> {
	if (!existsSync(path)) {
		throw new Error(`ENOENT: no such file or directory, access '${path}'`);
	}
}

export async function stat(path: string): Promise<BrowserStats> {
	return statSync(path);
}

export async function readdir(path: string): Promise<string[]> {
	return readdirSync(path);
}

export async function mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void> {
	mkdirSync(path, options);
}

export async function unlink(path: string): Promise<void> {
	const p = normalizePath(path);
	if (!memoryStore.delete(p)) {
		throw new Error(`ENOENT: no such file or directory, unlink '${path}'`);
	}
}

export async function open(_path: string, _flags?: string): Promise<never> {
	throw new Error("fs.open() is not supported in browser environment");
}

// ---- Utility: pre-populate the in-memory filesystem ----

/** Load data into the in-memory filesystem (browser only). */
export function preload(files: Record<string, string | Uint8Array>): void {
	for (const [filePath, data] of Object.entries(files)) {
		const p = normalizePath(filePath);
		// Ensure parent dirs exist
		const parent = parentDir(p);
		mkdirSync(parent, { recursive: true });
		memoryStore.set(p, data);
	}
}

/** Clear the in-memory filesystem (browser only). */
export function clear(): void {
	memoryStore.clear();
	memoryDirs.clear();
	memoryDirs.add("/");
}
