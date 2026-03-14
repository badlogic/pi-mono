import { existsSync, type FSWatcher, readFileSync, statSync, watch } from "fs";
import { basename, dirname, join, resolve } from "path";

/**
 * Find git metadata by walking up from cwd.
 * Handles both regular git repos (.git is a directory) and worktrees (.git is a file).
 */
function findGitInfo(): { headPath: string; repoRoot: string } | null {
	let dir = process.cwd();
	while (true) {
		const gitPath = join(dir, ".git");
		if (existsSync(gitPath)) {
			try {
				const stat = statSync(gitPath);
				if (stat.isFile()) {
					const content = readFileSync(gitPath, "utf8").trim();
					if (content.startsWith("gitdir: ")) {
						const gitDir = content.slice(8);
						const headPath = resolve(dir, gitDir, "HEAD");
						if (existsSync(headPath)) return { headPath, repoRoot: dir };
					}
				} else if (stat.isDirectory()) {
					const headPath = join(gitPath, "HEAD");
					if (existsSync(headPath)) return { headPath, repoRoot: dir };
				}
			} catch {
				return null;
			}
		}
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

/**
 * Provides git branch and extension statuses - data not otherwise accessible to extensions.
 * Token stats, model info available via ctx.sessionManager and ctx.model.
 */
export class FooterDataProvider {
	private extensionStatuses = new Map<string, string>();
	private cachedBranch: string | null | undefined = undefined;
	private cachedRepoName: string | null | undefined = undefined;
	private gitWatcher: FSWatcher | null = null;
	private branchChangeCallbacks = new Set<() => void>();
	private availableProviderCount = 0;

	constructor() {
		this.setupGitWatcher();
	}

	/** Current git branch, null if not in repo, "detached" if detached HEAD */
	getGitBranch(): string | null {
		if (this.cachedBranch !== undefined) return this.cachedBranch;

		try {
			const gitInfo = findGitInfo();
			if (!gitInfo) {
				this.cachedBranch = null;
				return null;
			}
			const content = readFileSync(gitInfo.headPath, "utf8").trim();
			this.cachedBranch = content.startsWith("ref: refs/heads/") ? content.slice(16) : "detached";
		} catch {
			this.cachedBranch = null;
		}
		return this.cachedBranch;
	}

	/** Current git repo name, or null if not in a repo. */
	getGitRepoName(): string | null {
		if (this.cachedRepoName !== undefined) return this.cachedRepoName;

		try {
			const gitInfo = findGitInfo();
			this.cachedRepoName = gitInfo ? basename(gitInfo.repoRoot) || null : null;
		} catch {
			this.cachedRepoName = null;
		}

		return this.cachedRepoName;
	}

	/** Extension status texts set via ctx.ui.setStatus() */
	getExtensionStatuses(): ReadonlyMap<string, string> {
		return this.extensionStatuses;
	}

	/** Subscribe to git branch changes. Returns unsubscribe function. */
	onBranchChange(callback: () => void): () => void {
		this.branchChangeCallbacks.add(callback);
		return () => this.branchChangeCallbacks.delete(callback);
	}

	/** Internal: set extension status */
	setExtensionStatus(key: string, text: string | undefined): void {
		if (text === undefined) {
			this.extensionStatuses.delete(key);
		} else {
			this.extensionStatuses.set(key, text);
		}
	}

	/** Internal: clear extension statuses */
	clearExtensionStatuses(): void {
		this.extensionStatuses.clear();
	}

	/** Number of unique providers with available models (for footer display) */
	getAvailableProviderCount(): number {
		return this.availableProviderCount;
	}

	/** Internal: update available provider count */
	setAvailableProviderCount(count: number): void {
		this.availableProviderCount = count;
	}

	/** Internal: cleanup */
	dispose(): void {
		if (this.gitWatcher) {
			this.gitWatcher.close();
			this.gitWatcher = null;
		}
		this.branchChangeCallbacks.clear();
	}

	private setupGitWatcher(): void {
		if (this.gitWatcher) {
			this.gitWatcher.close();
			this.gitWatcher = null;
		}

		const gitInfo = findGitInfo();
		if (!gitInfo) return;

		// Watch the directory containing HEAD, not HEAD itself.
		// Git uses atomic writes (write temp, rename over HEAD), which changes the inode.
		// fs.watch on a file stops working after the inode changes.
		const gitDir = dirname(gitInfo.headPath);

		try {
			this.gitWatcher = watch(gitDir, (_eventType, filename) => {
				if (filename === "HEAD") {
					this.cachedBranch = undefined;
					for (const cb of this.branchChangeCallbacks) cb();
				}
			});
		} catch {
			// Silently fail if we can't watch
		}
	}
}

/** Read-only view for extensions - excludes setExtensionStatus, setAvailableProviderCount and dispose */
export type ReadonlyFooterDataProvider = Pick<
	FooterDataProvider,
	"getGitBranch" | "getGitRepoName" | "getExtensionStatuses" | "getAvailableProviderCount" | "onBranchChange"
>;
