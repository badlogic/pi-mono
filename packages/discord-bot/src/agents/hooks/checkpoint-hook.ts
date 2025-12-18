/**
 * Git-based Checkpoint Hook for Discord Bot Agent System
 *
 * Creates checkpoints at the start of each turn so you can restore
 * code state when branching conversations.
 *
 * Features:
 * - Captures tracked, staged, AND untracked files (respects .gitignore)
 * - Persists checkpoints as git refs (survives session resume)
 * - Saves current state before restore (allows going back to latest)
 *
 * Adapted from pi-hooks checkpoint.ts for discord-bot agent system.
 */

import { exec, spawn } from "child_process";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { AgentHookAPI, CheckpointConfig, CheckpointData } from "./types.js";

// ============================================================================
// Constants
// ============================================================================

const ZEROS = "0".repeat(40);
const DEFAULT_CONFIG: CheckpointConfig = {
	enabled: true,
	autoCreate: true,
	maxCheckpoints: 100,
	refBase: "refs/pi-checkpoints",
};

// ============================================================================
// Git Helpers
// ============================================================================

function git(cmd: string, cwd: string, opts: { env?: NodeJS.ProcessEnv; input?: string } = {}): Promise<string> {
	return new Promise((resolve, reject) => {
		const proc = exec(`git ${cmd}`, { cwd, env: opts.env, maxBuffer: 10 * 1024 * 1024 }, (error, stdout) =>
			error ? reject(error) : resolve(stdout.trim()),
		);
		if (opts.input && proc.stdin) {
			proc.stdin.write(opts.input);
			proc.stdin.end();
		}
	});
}

function gitLowPriority(cmd: string, cwd: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const args: string[] = [];
		let current = "";
		let inQuote = false;
		for (const char of cmd) {
			if (char === "'" || char === '"') {
				inQuote = !inQuote;
			} else if (char === " " && !inQuote) {
				if (current) args.push(current);
				current = "";
			} else {
				current += char;
			}
		}
		if (current) args.push(current);

		const proc = spawn("git", args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (data) => {
			stdout += data;
		});
		proc.stderr.on("data", (data) => {
			stderr += data;
		});

		proc.on("close", (code) => {
			if (code === 0) {
				resolve(stdout.trim());
			} else {
				reject(new Error(stderr || `git ${cmd} failed with code ${code}`));
			}
		});

		proc.on("error", reject);
	});
}

const isGitRepo = (cwd: string) =>
	git("rev-parse --is-inside-work-tree", cwd)
		.then(() => true)
		.catch(() => false);

let cachedRepoRoot: string | null = null;
const getRepoRoot = async (cwd: string) => {
	if (!cachedRepoRoot) {
		cachedRepoRoot = await git("rev-parse --show-toplevel", cwd);
	}
	return cachedRepoRoot;
};

const isSafeId = (id: string) => /^[\w-]+$/.test(id);

// ============================================================================
// Checkpoint Operations
// ============================================================================

export async function createCheckpoint(
	cwd: string,
	id: string,
	turnIndex: number,
	sessionId: string,
	config: CheckpointConfig = DEFAULT_CONFIG,
): Promise<CheckpointData> {
	const root = await getRepoRoot(cwd);
	const timestamp = Date.now();
	const isoTimestamp = new Date(timestamp).toISOString();

	// Get HEAD (handle unborn)
	const headSha = await git("rev-parse HEAD", root).catch(() => ZEROS);

	// Capture index (staged changes)
	const indexTreeSha = await git("write-tree", root);

	// Capture worktree (ALL files including untracked) via temp index
	const tmpDir = await mkdtemp(join(tmpdir(), "pi-checkpoint-"));
	const tmpIndex = join(tmpDir, "index");

	try {
		const tmpEnv = { ...process.env, GIT_INDEX_FILE: tmpIndex };
		await git("add -A .", root, { env: tmpEnv });
		const worktreeTreeSha = await git("write-tree", root, { env: tmpEnv });

		// Create checkpoint commit with metadata
		const message = [
			`checkpoint:${id}`,
			`sessionId ${sessionId}`,
			`turn ${turnIndex}`,
			`head ${headSha}`,
			`index-tree ${indexTreeSha}`,
			`worktree-tree ${worktreeTreeSha}`,
			`created ${isoTimestamp}`,
		].join("\n");

		const commitEnv = {
			...process.env,
			GIT_AUTHOR_NAME: "pi-checkpoint",
			GIT_AUTHOR_EMAIL: "checkpoint@pi",
			GIT_AUTHOR_DATE: isoTimestamp,
			GIT_COMMITTER_NAME: "pi-checkpoint",
			GIT_COMMITTER_EMAIL: "checkpoint@pi",
			GIT_COMMITTER_DATE: isoTimestamp,
		};

		const commitSha = await git(`commit-tree ${worktreeTreeSha}`, root, {
			input: message,
			env: commitEnv,
		});

		// Store as git ref
		await git(`update-ref ${config.refBase}/${id} ${commitSha}`, root);

		return {
			id,
			turnIndex,
			sessionId,
			headSha,
			indexTreeSha,
			worktreeTreeSha,
			timestamp,
		};
	} finally {
		await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	}
}

export async function restoreCheckpoint(cwd: string, cp: CheckpointData): Promise<void> {
	if (cp.headSha === ZEROS) {
		throw new Error("Cannot restore: checkpoint was saved with no commits");
	}

	const root = await getRepoRoot(cwd);
	// Clean untracked files first (respects .gitignore)
	await git("clean -fd", root);
	await git(`reset --hard ${cp.headSha}`, root);
	await git(`read-tree --reset ${cp.worktreeTreeSha}`, root);
	await git("checkout-index -a -f", root);
	await git(`read-tree --reset ${cp.indexTreeSha}`, root);
}

export async function loadCheckpointFromRef(
	cwd: string,
	refName: string,
	config: CheckpointConfig = DEFAULT_CONFIG,
	lowPriority = false,
): Promise<CheckpointData | null> {
	try {
		const root = await getRepoRoot(cwd);
		const gitFn = lowPriority ? gitLowPriority : git;
		const commitSha = await gitFn(`rev-parse --verify ${config.refBase}/${refName}`, root);
		const commitMsg = await gitFn(`cat-file commit ${commitSha}`, root);

		const get = (key: string) => commitMsg.match(new RegExp(`^${key} (.+)$`, "m"))?.[1]?.trim();

		const sessionId = get("sessionId");
		const turn = get("turn");
		const head = get("head");
		const index = get("index-tree");
		const worktree = get("worktree-tree");
		const created = get("created");

		if (!sessionId || !turn || !head || !index || !worktree) return null;

		return {
			id: refName,
			turnIndex: parseInt(turn, 10),
			sessionId,
			headSha: head,
			indexTreeSha: index,
			worktreeTreeSha: worktree,
			timestamp: created ? new Date(created).getTime() : 0,
		};
	} catch {
		return null;
	}
}

export async function listCheckpointRefs(
	cwd: string,
	config: CheckpointConfig = DEFAULT_CONFIG,
	lowPriority = false,
): Promise<string[]> {
	try {
		const root = await getRepoRoot(cwd);
		const prefix = `${config.refBase}/`;
		const gitFn = lowPriority ? gitLowPriority : git;
		const stdout = await gitFn(`for-each-ref --format=%(refname) ${prefix}`, root);
		return stdout
			.split("\n")
			.filter(Boolean)
			.map((ref) => ref.replace(prefix, ""));
	} catch {
		return [];
	}
}

export async function loadAllCheckpoints(
	cwd: string,
	sessionFilter?: string,
	config: CheckpointConfig = DEFAULT_CONFIG,
	lowPriority = false,
): Promise<CheckpointData[]> {
	const refs = await listCheckpointRefs(cwd, config, lowPriority);

	if (lowPriority) {
		const results: CheckpointData[] = [];
		const BATCH_SIZE = 3;
		for (let i = 0; i < refs.length; i += BATCH_SIZE) {
			const batch = refs.slice(i, i + BATCH_SIZE);
			const batchResults = await Promise.all(batch.map((ref) => loadCheckpointFromRef(cwd, ref, config, true)));
			results.push(
				...batchResults.filter(
					(cp): cp is CheckpointData => cp !== null && (!sessionFilter || cp.sessionId === sessionFilter),
				),
			);
			await new Promise((resolve) => setImmediate(resolve));
		}
		return results;
	}

	const results = await Promise.all(refs.map((ref) => loadCheckpointFromRef(cwd, ref, config)));
	return results.filter(
		(cp): cp is CheckpointData => cp !== null && (!sessionFilter || cp.sessionId === sessionFilter),
	);
}

export async function cleanupOldCheckpoints(cwd: string, config: CheckpointConfig = DEFAULT_CONFIG): Promise<number> {
	const refs = await listCheckpointRefs(cwd, config);
	if (refs.length <= config.maxCheckpoints) return 0;

	const root = await getRepoRoot(cwd);
	const toDelete = refs.slice(0, refs.length - config.maxCheckpoints);

	for (const ref of toDelete) {
		await git(`update-ref -d ${config.refBase}/${ref}`, root).catch(() => {});
	}

	return toDelete.length;
}

// ============================================================================
// Checkpoint Diff
// ============================================================================

export interface CheckpointDiff {
	added: string[];
	modified: string[];
	deleted: string[];
	summary: string;
}

/**
 * Get diff between current state and a checkpoint
 */
export async function getCheckpointDiff(
	cwd: string,
	checkpointId: string,
	config: CheckpointConfig = DEFAULT_CONFIG,
): Promise<CheckpointDiff | null> {
	try {
		const root = await getRepoRoot(cwd);
		const cpRef = `${config.refBase}/${checkpointId}`;

		// Get the worktree tree from checkpoint
		const cpSha = await git(`rev-parse --verify ${cpRef}`, root).catch(() => null);
		if (!cpSha) return null;

		const commitMsg = await git(`cat-file commit ${cpSha}`, root);
		const worktreeTree = commitMsg.match(/^worktree-tree (.+)$/m)?.[1]?.trim();
		if (!worktreeTree) return null;

		// Get current worktree state
		const tmpDir = await mkdtemp(join(tmpdir(), "pi-diff-"));
		const tmpIndex = join(tmpDir, "index");

		try {
			const tmpEnv = { ...process.env, GIT_INDEX_FILE: tmpIndex };
			await git("add -A .", root, { env: tmpEnv });
			const currentTree = await git("write-tree", root, { env: tmpEnv });

			// Get diff between trees
			const diffOutput = await git(`diff-tree -r --name-status ${worktreeTree} ${currentTree}`, root);
			const lines = diffOutput.split("\n").filter(Boolean);

			const added: string[] = [];
			const modified: string[] = [];
			const deleted: string[] = [];

			for (const line of lines) {
				const [status, ...pathParts] = line.split("\t");
				const filePath = pathParts.join("\t");
				switch (status) {
					case "A":
						added.push(filePath);
						break;
					case "M":
						modified.push(filePath);
						break;
					case "D":
						deleted.push(filePath);
						break;
				}
			}

			const parts: string[] = [];
			if (added.length > 0) parts.push(`+${added.length} added`);
			if (modified.length > 0) parts.push(`~${modified.length} modified`);
			if (deleted.length > 0) parts.push(`-${deleted.length} deleted`);

			return {
				added,
				modified,
				deleted,
				summary: parts.length > 0 ? parts.join(", ") : "No changes",
			};
		} finally {
			await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
		}
	} catch (error) {
		console.error("Checkpoint diff failed:", error);
		return null;
	}
}

/**
 * Get file content diff for a specific file
 */
export async function getFileDiff(
	cwd: string,
	checkpointId: string,
	filePath: string,
	config: CheckpointConfig = DEFAULT_CONFIG,
): Promise<string | null> {
	try {
		const root = await getRepoRoot(cwd);
		const cpRef = `${config.refBase}/${checkpointId}`;

		const cpSha = await git(`rev-parse --verify ${cpRef}`, root).catch(() => null);
		if (!cpSha) return null;

		const commitMsg = await git(`cat-file commit ${cpSha}`, root);
		const worktreeTree = commitMsg.match(/^worktree-tree (.+)$/m)?.[1]?.trim();
		if (!worktreeTree) return null;

		// Get diff for specific file
		const diff = await git(`diff ${worktreeTree}:${filePath} ${filePath}`, root).catch(() => null);
		return diff;
	} catch {
		return null;
	}
}

// ============================================================================
// Branch Support
// ============================================================================

export interface BranchMetadata {
	branchId: string;
	parentCheckpointId: string;
	parentTurnIndex: number;
	createdAt: number;
	description?: string;
}

/**
 * Create a branch point from a checkpoint
 */
export async function createBranchPoint(
	cwd: string,
	checkpointId: string,
	description?: string,
	config: CheckpointConfig = DEFAULT_CONFIG,
): Promise<BranchMetadata | null> {
	try {
		const root = await getRepoRoot(cwd);
		const cpRef = `${config.refBase}/${checkpointId}`;

		// Verify checkpoint exists
		const cpSha = await git(`rev-parse --verify ${cpRef}`, root).catch(() => null);
		if (!cpSha) return null;

		// Load checkpoint to get turn index
		const checkpoint = await loadCheckpointFromRef(cwd, checkpointId, config);
		if (!checkpoint) return null;

		// Generate branch ID
		const branchId = `branch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const createdAt = Date.now();

		// Create branch ref with metadata
		const message = [
			`branch:${branchId}`,
			`parent ${checkpointId}`,
			`parentTurn ${checkpoint.turnIndex}`,
			`created ${new Date(createdAt).toISOString()}`,
			description ? `description ${description}` : "",
		]
			.filter(Boolean)
			.join("\n");

		const branchEnv = {
			...process.env,
			GIT_AUTHOR_NAME: "pi-branch",
			GIT_AUTHOR_EMAIL: "branch@pi",
			GIT_COMMITTER_NAME: "pi-branch",
			GIT_COMMITTER_EMAIL: "branch@pi",
		};

		const commitSha = await git(`commit-tree ${cpSha}^{tree}`, root, {
			input: message,
			env: branchEnv,
		});
		await git(`update-ref refs/pi-branches/${branchId} ${commitSha}`, root);

		return {
			branchId,
			parentCheckpointId: checkpointId,
			parentTurnIndex: checkpoint.turnIndex,
			createdAt,
			description,
		};
	} catch (error) {
		console.error("Branch creation failed:", error);
		return null;
	}
}

/**
 * List all branch points
 */
export async function listBranches(cwd: string): Promise<BranchMetadata[]> {
	try {
		const root = await getRepoRoot(cwd);
		const prefix = "refs/pi-branches/";
		const stdout = await git(`for-each-ref --format=%(refname) ${prefix}`, root);
		const branchRefs = stdout
			.split("\n")
			.filter(Boolean)
			.map((ref) => ref.replace(prefix, ""));

		const branches: BranchMetadata[] = [];
		for (const branchId of branchRefs) {
			try {
				const commitSha = await git(`rev-parse --verify refs/pi-branches/${branchId}`, root);
				const commitMsg = await git(`cat-file commit ${commitSha}`, root);

				const get = (key: string) => commitMsg.match(new RegExp(`^${key} (.+)$`, "m"))?.[1]?.trim();
				const parentCheckpointId = get("parent");
				const parentTurn = get("parentTurn");
				const created = get("created");
				const description = get("description");

				if (parentCheckpointId && parentTurn) {
					branches.push({
						branchId,
						parentCheckpointId,
						parentTurnIndex: parseInt(parentTurn, 10),
						createdAt: created ? new Date(created).getTime() : 0,
						description,
					});
				}
			} catch {
				// Skip invalid branches
			}
		}

		return branches.sort((a, b) => b.createdAt - a.createdAt);
	} catch {
		return [];
	}
}

/**
 * Switch to a branch (restore its checkpoint)
 */
export async function switchToBranch(
	cwd: string,
	branchId: string,
	config: CheckpointConfig = DEFAULT_CONFIG,
): Promise<CheckpointData | null> {
	try {
		const root = await getRepoRoot(cwd);
		const commitSha = await git(`rev-parse --verify refs/pi-branches/${branchId}`, root);
		const commitMsg = await git(`cat-file commit ${commitSha}`, root);

		const parentCheckpointId = commitMsg.match(/^parent (.+)$/m)?.[1]?.trim();
		if (!parentCheckpointId) return null;

		// Load and restore the parent checkpoint
		const checkpoint = await loadCheckpointFromRef(cwd, parentCheckpointId, config);
		if (!checkpoint) return null;

		await restoreCheckpoint(cwd, checkpoint);
		return checkpoint;
	} catch {
		return null;
	}
}

/**
 * Delete a branch
 */
export async function deleteBranch(cwd: string, branchId: string): Promise<boolean> {
	try {
		const root = await getRepoRoot(cwd);
		await git(`update-ref -d refs/pi-branches/${branchId}`, root);
		return true;
	} catch {
		return false;
	}
}

// ============================================================================
// Auto-Cleanup
// ============================================================================

export interface CleanupResult {
	checkpointsRemoved: number;
	tagsRemoved: number;
	branchesRemoved: number;
	freedSpace: string;
}

/**
 * Cleanup old checkpoints, keeping only recent ones
 * Also cleans orphaned tags and branches
 */
export async function autoCleanup(
	cwd: string,
	options: {
		maxCheckpoints?: number;
		maxAgeDays?: number;
		keepTagged?: boolean;
	} = {},
	config: CheckpointConfig = DEFAULT_CONFIG,
): Promise<CleanupResult> {
	const { maxCheckpoints = config.maxCheckpoints, maxAgeDays = 30, keepTagged = true } = options;

	let checkpointsRemoved = 0;
	let tagsRemoved = 0;
	let branchesRemoved = 0;

	try {
		const root = await getRepoRoot(cwd);

		// Get all checkpoints
		const allCheckpoints = await loadAllCheckpoints(cwd, undefined, config);
		const tags = await listTags(cwd);
		const taggedIds = new Set(tags.map((t) => t.checkpointId));

		// Sort by timestamp (newest first)
		allCheckpoints.sort((a, b) => b.timestamp - a.timestamp);

		const now = Date.now();
		const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
		const toDelete: string[] = [];

		// Determine which checkpoints to delete
		for (let i = 0; i < allCheckpoints.length; i++) {
			const cp = allCheckpoints[i];
			const age = now - cp.timestamp;

			// Keep if tagged and keepTagged is true
			if (keepTagged && taggedIds.has(cp.id)) continue;

			// Delete if over max count or too old
			if (i >= maxCheckpoints || age > maxAgeMs) {
				toDelete.push(cp.id);
			}
		}

		// Delete checkpoints
		for (const id of toDelete) {
			try {
				await git(`update-ref -d ${config.refBase}/${id}`, root);
				checkpointsRemoved++;
			} catch {
				// Ignore errors
			}
		}

		// Clean orphaned tags (pointing to deleted checkpoints)
		const remainingCpIds = new Set(allCheckpoints.filter((cp) => !toDelete.includes(cp.id)).map((cp) => cp.id));
		for (const tag of tags) {
			if (!remainingCpIds.has(tag.checkpointId)) {
				try {
					await deleteTag(cwd, tag.tag);
					tagsRemoved++;
				} catch {
					// Ignore errors
				}
			}
		}

		// Clean orphaned branches
		const branches = await listBranches(cwd);
		for (const branch of branches) {
			if (!remainingCpIds.has(branch.parentCheckpointId)) {
				try {
					await deleteBranch(cwd, branch.branchId);
					branchesRemoved++;
				} catch {
					// Ignore errors
				}
			}
		}

		// Run git gc to free space
		await git("gc --prune=now --quiet", root).catch(() => {});

		// Get freed space (rough estimate based on objects removed)
		const freedSpace = `~${(checkpointsRemoved * 0.1).toFixed(1)}MB`;

		return { checkpointsRemoved, tagsRemoved, branchesRemoved, freedSpace };
	} catch (error) {
		console.error("Auto-cleanup failed:", error);
		return { checkpointsRemoved, tagsRemoved, branchesRemoved, freedSpace: "0MB" };
	}
}

// ============================================================================
// Checkpoint Tagging
// ============================================================================

const TAG_REF_BASE = "refs/pi-checkpoint-tags";

export interface CheckpointTag {
	tag: string;
	checkpointId: string;
	timestamp: number;
	description?: string;
}

/**
 * Tag a checkpoint with a friendly name
 */
export async function tagCheckpoint(
	cwd: string,
	checkpointId: string,
	tag: string,
	description?: string,
	config: CheckpointConfig = DEFAULT_CONFIG,
): Promise<CheckpointTag> {
	if (!isSafeId(tag)) {
		throw new Error(`Invalid tag name: ${tag} (only alphanumeric, hyphens, underscores allowed)`);
	}

	const root = await getRepoRoot(cwd);
	const timestamp = Date.now();

	// Verify checkpoint exists
	const cpRef = `${config.refBase}/${checkpointId}`;
	const cpSha = await git(`rev-parse --verify ${cpRef}`, root).catch(() => null);
	if (!cpSha) {
		throw new Error(`Checkpoint not found: ${checkpointId}`);
	}

	// Create tag commit with metadata
	const message = [
		`tag:${tag}`,
		`checkpoint ${checkpointId}`,
		`created ${new Date(timestamp).toISOString()}`,
		description ? `description ${description}` : "",
	]
		.filter(Boolean)
		.join("\n");

	const tagEnv = {
		...process.env,
		GIT_AUTHOR_NAME: "pi-checkpoint",
		GIT_AUTHOR_EMAIL: "checkpoint@pi",
		GIT_COMMITTER_NAME: "pi-checkpoint",
		GIT_COMMITTER_EMAIL: "checkpoint@pi",
	};

	// Create a tag ref pointing to the checkpoint
	const commitSha = await git(`commit-tree ${cpSha}^{tree}`, root, {
		input: message,
		env: tagEnv,
	});
	await git(`update-ref ${TAG_REF_BASE}/${tag} ${commitSha}`, root);

	return { tag, checkpointId, timestamp, description };
}

/**
 * List all checkpoint tags
 */
export async function listTags(cwd: string): Promise<CheckpointTag[]> {
	try {
		const root = await getRepoRoot(cwd);
		const prefix = `${TAG_REF_BASE}/`;
		const stdout = await git(`for-each-ref --format=%(refname) ${prefix}`, root);
		const tagNames = stdout
			.split("\n")
			.filter(Boolean)
			.map((ref) => ref.replace(prefix, ""));

		const tags: CheckpointTag[] = [];
		for (const tagName of tagNames) {
			try {
				const commitSha = await git(`rev-parse --verify ${TAG_REF_BASE}/${tagName}`, root);
				const commitMsg = await git(`cat-file commit ${commitSha}`, root);

				const get = (key: string) => commitMsg.match(new RegExp(`^${key} (.+)$`, "m"))?.[1]?.trim();
				const checkpointId = get("checkpoint");
				const created = get("created");
				const description = get("description");

				if (checkpointId) {
					tags.push({
						tag: tagName,
						checkpointId,
						timestamp: created ? new Date(created).getTime() : 0,
						description,
					});
				}
			} catch {
				// Skip invalid tags
			}
		}

		return tags.sort((a, b) => b.timestamp - a.timestamp);
	} catch {
		return [];
	}
}

/**
 * Get checkpoint by tag name
 */
export async function getCheckpointByTag(
	cwd: string,
	tag: string,
	config: CheckpointConfig = DEFAULT_CONFIG,
): Promise<CheckpointData | null> {
	try {
		const root = await getRepoRoot(cwd);
		const commitSha = await git(`rev-parse --verify ${TAG_REF_BASE}/${tag}`, root);
		const commitMsg = await git(`cat-file commit ${commitSha}`, root);

		const checkpointId = commitMsg.match(/^checkpoint (.+)$/m)?.[1]?.trim();
		if (!checkpointId) return null;

		return loadCheckpointFromRef(cwd, checkpointId, config);
	} catch {
		return null;
	}
}

/**
 * Delete a checkpoint tag
 */
export async function deleteTag(cwd: string, tag: string): Promise<boolean> {
	try {
		const root = await getRepoRoot(cwd);
		await git(`update-ref -d ${TAG_REF_BASE}/${tag}`, root);
		return true;
	} catch {
		return false;
	}
}

// ============================================================================
// Hook Factory
// ============================================================================

/**
 * Create checkpoint hook for agent system
 */
export function createCheckpointHook(config: Partial<CheckpointConfig> = {}): (api: AgentHookAPI) => void {
	const finalConfig: CheckpointConfig = { ...DEFAULT_CONFIG, ...config };

	return (api: AgentHookAPI) => {
		let pendingCheckpoint: Promise<void> | null = null;
		let gitAvailable = false;
		let checkpointingFailed = false;
		let currentSessionId = "";
		let checkpointCache: CheckpointData[] | null = null;

		// Session start - initialize git check
		api.on("session", async (event, ctx) => {
			if (!finalConfig.enabled) return;

			gitAvailable = await isGitRepo(ctx.cwd);
			if (!gitAvailable) return;

			currentSessionId = event.sessionId;
			cachedRepoRoot = null; // Reset cache on session change

			// Defer checkpoint loading
			setImmediate(() => {
				loadAllCheckpoints(ctx.cwd, undefined, finalConfig, true)
					.then((cps) => {
						checkpointCache = cps;
					})
					.catch(() => {});
			});
		});

		// Turn start - create checkpoint
		api.on("turn_start", async (event, ctx) => {
			if (!finalConfig.enabled || !finalConfig.autoCreate || !gitAvailable || checkpointingFailed) return;
			if (!currentSessionId) return;

			pendingCheckpoint = (async () => {
				try {
					const id = `${currentSessionId}-turn-${event.turnIndex}-${event.timestamp}`;
					const cp = await createCheckpoint(ctx.cwd, id, event.turnIndex, currentSessionId, finalConfig);
					if (checkpointCache) {
						checkpointCache.push(cp);
					}
				} catch (error) {
					console.error("Checkpoint creation failed:", error);
					checkpointingFailed = true;
				}
			})();
		});

		// Branch event - offer restore options
		api.on("branch", async (event, ctx) => {
			if (!finalConfig.enabled || !gitAvailable) return undefined;

			// Wait for pending checkpoint
			if (pendingCheckpoint) await pendingCheckpoint;

			// Load checkpoints for this session
			let checkpoints = checkpointCache?.filter((cp) => cp.sessionId === event.sessionId) || [];
			if (checkpoints.length === 0) {
				checkpoints = await loadAllCheckpoints(ctx.cwd, event.sessionId, finalConfig);
			}

			if (checkpoints.length === 0) {
				ctx.ui.notify("No checkpoints available for this session", "warning");
				return undefined;
			}

			// Find checkpoint closest to target turn
			const checkpoint = checkpoints.reduce((best, cp) => {
				const bestDiff = Math.abs(best.turnIndex - event.targetTurnIndex);
				const cpDiff = Math.abs(cp.turnIndex - event.targetTurnIndex);
				if (cp.turnIndex <= event.targetTurnIndex && best.turnIndex > event.targetTurnIndex) return cp;
				if (best.turnIndex <= event.targetTurnIndex && cp.turnIndex > event.targetTurnIndex) return best;
				return cpDiff < bestDiff ? cp : best;
			});

			// Ask user what to restore
			const options = ["Restore all (files + conversation)", "Conversation only", "Code only", "Cancel"];

			const choice = await ctx.ui.select("Restore code state?", options);

			if (choice === "Cancel" || !choice) {
				return { skipConversationRestore: true };
			}

			if (choice === "Conversation only") {
				return undefined; // Let default restore happen
			}

			// Save current state before restore
			try {
				const beforeId = `${currentSessionId}-before-restore-${Date.now()}`;
				await createCheckpoint(ctx.cwd, beforeId, event.targetTurnIndex, currentSessionId, finalConfig);
				await restoreCheckpoint(ctx.cwd, checkpoint);
				ctx.ui.notify(`Restored to turn ${checkpoint.turnIndex}`, "info");
			} catch (error) {
				ctx.ui.notify(`Restore failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}

			return choice === "Code only" ? { skipConversationRestore: true } : undefined;
		});
	};
}

/**
 * Default checkpoint hook instance
 */
export const checkpointHook = createCheckpointHook();

/**
 * Export utilities for external use
 */
export const CheckpointUtils = {
	createCheckpoint,
	restoreCheckpoint,
	loadCheckpointFromRef,
	listCheckpointRefs,
	loadAllCheckpoints,
	cleanupOldCheckpoints,
	isGitRepo,
	getRepoRoot,
	// Tagging support
	tagCheckpoint,
	listTags,
	getCheckpointByTag,
	deleteTag,
	// Diff support
	getCheckpointDiff,
	getFileDiff,
	// Branch support
	createBranchPoint,
	listBranches,
	switchToBranch,
	deleteBranch,
	// Auto-cleanup
	autoCleanup,
};
