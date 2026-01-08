import { type Dirent, existsSync, type FSWatcher, readdirSync, watch } from "fs";
import { resolve } from "path";

export interface SkillsWatcherOptions {
	roots: string[];
	debounceMs?: number;
	onChange: () => void;
}

export class SkillsWatcher {
	private watchers: FSWatcher[] = [];
	private watchedDirs: Map<string, FSWatcher> = new Map();
	private fallbackRoots: Set<string> = new Set();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;
	private debounceMs: number;
	private onChange: () => void;
	readonly roots: string[];
	private _handleFsEvent = (): void => this.schedule();

	constructor(options: SkillsWatcherOptions) {
		this.debounceMs = options.debounceMs ?? 300;
		this.onChange = options.onChange;
		this.roots = Array.from(new Set(options.roots.map((root) => resolve(root))));
		this.start();
	}

	private start(): void {
		for (const root of this.roots) {
			if (!existsSync(root)) {
				continue;
			}
			this._startRootWatcher(root, this._handleFsEvent);
		}
	}

	private _startRootWatcher(root: string, handler: () => void): void {
		// Prefer native recursive watch where supported (macOS/Windows).
		try {
			const watcher = watch(root, { recursive: true }, handler);
			this.watchers.push(watcher);
			return;
		} catch {
			// Fall through to portable recursive emulation.
		}

		// On platforms without recursive support (notably Linux), emulate recursion by
		// watching all subdirectories non-recursively. Refresh on change to pick up new dirs.
		this.fallbackRoots.add(root);
		this._refreshWatchedDirs(root, handler);
	}

	private _refreshWatchedDirs(root: string, handler: () => void): void {
		const dirs = this._collectDirs(root);
		for (const dir of dirs) {
			if (this.watchedDirs.has(dir)) continue;
			try {
				const watcher = watch(dir, handler);
				this.watchedDirs.set(dir, watcher);
				this.watchers.push(watcher);
			} catch {
				// Ignore watcher creation failures (e.g. permission issues or transient dirs).
			}
		}
	}

	private _collectDirs(root: string): string[] {
		const result: string[] = [];
		const stack: string[] = [root];
		while (stack.length > 0) {
			const dir = stack.pop();
			if (!dir) continue;
			result.push(dir);
			let entries: Dirent[];
			try {
				entries = readdirSync(dir, { withFileTypes: true });
			} catch {
				continue;
			}
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				stack.push(resolve(dir, entry.name));
			}
		}
		return result;
	}

	private schedule(): void {
		if (this.disposed) return;
		if (this.timer) {
			clearTimeout(this.timer);
		}
		this.timer = setTimeout(() => {
			this.timer = undefined;
			if (!this.disposed) {
				// Ensure fallback watchers stay in sync with new directories.
				for (const root of this.fallbackRoots) {
					if (!existsSync(root)) continue;
					this._refreshWatchedDirs(root, this._handleFsEvent);
				}
				this.onChange();
			}
		}, this.debounceMs);
	}

	close(): void {
		if (this.disposed) return;
		this.disposed = true;
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
		for (const watcher of this.watchers) {
			try {
				watcher.close();
			} catch {
				// Ignore watcher close errors
			}
		}
		this.watchers = [];
		this.watchedDirs.clear();
		this.fallbackRoots.clear();
	}
}
