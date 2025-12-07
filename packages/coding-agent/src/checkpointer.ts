import { execSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export interface CheckpointData {
	id: string;
	headSha: string; // HEAD commit (or "0".repeat(40) for unborn)
	indexTreeSha: string; // Tree of staged changes
	worktreeTreeSha: string; // Tree of all files (incl. untracked)
	timestamp: string;
}

const ZEROS = "0".repeat(40);
const REF_PREFIX = "refs/pi-checkpoints";

/**
 * Check if cwd is inside a git working tree.
 * Sync because it's called once at startup.
 */
export function isGitRepo(cwd: string): boolean {
	try {
		execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

/**
 * Get git repo root directory.
 * Throws if not in a git repo.
 */
export function getRepoRoot(cwd: string): string {
	return execSync("git rev-parse --show-toplevel", { cwd, encoding: "utf8" }).trim();
}

/**
 * Create a checkpoint capturing HEAD, index, and worktree state.
 * Does NOT modify any files or HEAD.
 *
 * Synchronous - git operations are fast (<100ms typically).
 */
export function createCheckpoint(cwd: string, id: string): CheckpointData {
	const root = getRepoRoot(cwd);
	const timestamp = new Date().toISOString();

	// 1. Get HEAD (handle unborn HEAD)
	let headSha: string;
	try {
		headSha = execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
	} catch {
		headSha = ZEROS; // Unborn HEAD (no commits yet)
	}

	// 2. Capture index (staged state)
	let indexTreeSha: string;
	try {
		indexTreeSha = execSync("git write-tree", { cwd: root, encoding: "utf8" }).trim();
	} catch {
		throw new Error("Cannot create checkpoint: index has unresolved merge conflicts");
	}

	// 3. Capture worktree (all files including untracked) via temp index
	//    Use os.tmpdir() for cross-platform compatibility (not /tmp)
	const tmpDir = mkdtempSync(join(tmpdir(), "pi-checkpoint-"));
	const tmpIndex = join(tmpDir, "index");

	try {
		// Add all files to temp index (honors .gitignore)
		execSync("git add -A .", {
			cwd: root,
			encoding: "utf8",
			env: { ...process.env, GIT_INDEX_FILE: tmpIndex },
		});

		// Write temp index to tree object
		const worktreeTreeSha = execSync("git write-tree", {
			cwd: root,
			encoding: "utf8",
			env: { ...process.env, GIT_INDEX_FILE: tmpIndex },
		}).trim();

		// 4. Create checkpoint commit with metadata
		//    Use array + join to avoid shell escaping issues with message
		const message = [
			`checkpoint:${id}`,
			`head ${headSha}`,
			`index-tree ${indexTreeSha}`,
			`worktree-tree ${worktreeTreeSha}`,
			`created ${timestamp}`,
		].join("\n");

		// Use stdin for message to avoid shell escaping issues
		const commitSha = execSync(`git commit-tree ${worktreeTreeSha}`, {
			cwd: root,
			encoding: "utf8",
			input: message,
			env: {
				...process.env,
				GIT_AUTHOR_NAME: "pi-checkpoint",
				GIT_AUTHOR_EMAIL: "checkpoint@pi",
				GIT_AUTHOR_DATE: timestamp,
				GIT_COMMITTER_NAME: "pi-checkpoint",
				GIT_COMMITTER_EMAIL: "checkpoint@pi",
				GIT_COMMITTER_DATE: timestamp,
			},
		}).trim();

		// 5. Store as private ref
		const ref = `${REF_PREFIX}/${id}`;
		execSync(`git update-ref ${ref} ${commitSha}`, { cwd: root });

		return { id, headSha, indexTreeSha, worktreeTreeSha, timestamp };
	} finally {
		// Always clean up temp dir
		rmSync(tmpDir, { recursive: true, force: true });
	}
}

/**
 * Restore repository to checkpoint state.
 * WARNING: This WILL modify files on disk and reset HEAD.
 * Synchronous - user triggered, blocking is acceptable.
 */
export function restoreCheckpoint(cwd: string, id: string): void {
	const root = getRepoRoot(cwd);
	const ref = `${REF_PREFIX}/${id}`;

	// Get checkpoint commit
	let commitSha: string;
	try {
		commitSha = execSync(`git rev-parse --verify ${ref}`, { cwd: root, encoding: "utf8" }).trim();
	} catch {
		throw new Error(`Checkpoint not found: ${id}`);
	}

	// Parse metadata from commit message
	const commitMsg = execSync(`git cat-file commit ${commitSha}`, { cwd: root, encoding: "utf8" });
	const headSha = commitMsg.match(/^head (.+)$/m)?.[1]?.trim();
	const indexTreeSha = commitMsg.match(/^index-tree (.+)$/m)?.[1]?.trim();
	const worktreeTreeSha = commitMsg.match(/^worktree-tree (.+)$/m)?.[1]?.trim();

	if (!headSha || !indexTreeSha || !worktreeTreeSha) {
		throw new Error(`Checkpoint ${id} has invalid metadata`);
	}

	if (headSha === ZEROS) {
		throw new Error("Cannot restore: checkpoint was saved with no commits (unborn HEAD)");
	}

	// 1. Reset HEAD to saved commit
	execSync(`git reset --hard ${headSha}`, { cwd: root });

	// 2. Restore worktree from saved tree (overwrites files)
	execSync(`git read-tree --reset -u ${worktreeTreeSha}`, { cwd: root });

	// 3. Clean extra files not in worktree snapshot (but keep ignored files)
	execSync("git clean -fd", { cwd: root });

	// 4. Restore index (staged state) without touching files
	execSync(`git read-tree --reset ${indexTreeSha}`, { cwd: root });
}

/**
 * List all checkpoint IDs
 */
export function listCheckpoints(cwd: string): string[] {
	try {
		const root = getRepoRoot(cwd);
		// Use full refname to avoid ambiguity with short ref stripping
		const output = execSync(`git for-each-ref --format='%(refname)' ${REF_PREFIX}/`, {
			cwd: root,
			encoding: "utf8",
		});
		const prefix = `${REF_PREFIX}/`;
		return output
			.split("\n")
			.filter(Boolean)
			.map((ref) => (ref.startsWith(prefix) ? ref.slice(prefix.length) : ref));
	} catch {
		return [];
	}
}

const MAX_CHECKPOINTS = 100;

/**
 * Clean up old checkpoints, keeping the most recent N.
 * Uses committer date for ordering (set during checkpoint creation).
 */
export function pruneCheckpoints(cwd: string, keepCount: number = MAX_CHECKPOINTS): void {
	try {
		const root = getRepoRoot(cwd);

		// Get all checkpoint refs sorted by committer date (oldest first)
		const output = execSync(`git for-each-ref --sort=committerdate --format='%(refname)' ${REF_PREFIX}/`, {
			cwd: root,
			encoding: "utf8",
		});

		const refs = output.split("\n").filter(Boolean);
		if (refs.length <= keepCount) return;

		// Delete oldest refs (first N in sorted list)
		const toDelete = refs.slice(0, refs.length - keepCount);
		for (const ref of toDelete) {
			try {
				execSync(`git update-ref -d ${ref}`, { cwd: root });
			} catch {
				// Ignore deletion failures
			}
		}
	} catch {
		// Ignore errors - pruning is best-effort
	}
}
