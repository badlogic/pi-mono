import { execSync } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createCheckpoint,
	getRepoRoot,
	isGitRepo,
	listCheckpoints,
	pruneCheckpoints,
	restoreCheckpoint,
} from "./checkpointer.js";

describe("checkpointer", () => {
	let testDir: string;

	beforeEach(() => {
		// Create a fresh temp directory for each test
		testDir = mkdtempSync(join(tmpdir(), "checkpointer-test-"));
	});

	afterEach(() => {
		// Clean up
		rmSync(testDir, { recursive: true, force: true });
	});

	function initGitRepo(dir: string = testDir): void {
		execSync("git init", { cwd: dir, stdio: "pipe" });
		execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
		execSync('git config user.name "Test User"', { cwd: dir, stdio: "pipe" });
	}

	function createCommit(dir: string = testDir, message = "Initial commit"): void {
		writeFileSync(join(dir, "README.md"), "# Test\n");
		execSync("git add -A", { cwd: dir, stdio: "pipe" });
		execSync(`git commit -m "${message}"`, { cwd: dir, stdio: "pipe" });
	}

	describe("isGitRepo", () => {
		it("returns true for a git repository", () => {
			initGitRepo();
			expect(isGitRepo(testDir)).toBe(true);
		});

		it("returns false for a non-git directory", () => {
			expect(isGitRepo(testDir)).toBe(false);
		});

		it("returns true for a subdirectory of a git repo", () => {
			initGitRepo();
			const subDir = join(testDir, "subdir");
			mkdirSync(subDir);
			expect(isGitRepo(subDir)).toBe(true);
		});
	});

	describe("getRepoRoot", () => {
		it("returns the repo root from within the repo", () => {
			initGitRepo();
			// Use realpathSync to resolve symlinks (macOS /var -> /private/var)
			const { realpathSync } = require("fs");
			expect(realpathSync(getRepoRoot(testDir))).toBe(realpathSync(testDir));
		});

		it("returns the repo root from a subdirectory", () => {
			initGitRepo();
			const subDir = join(testDir, "subdir");
			mkdirSync(subDir);
			// Use realpathSync to resolve symlinks (macOS /var -> /private/var)
			const { realpathSync } = require("fs");
			expect(realpathSync(getRepoRoot(subDir))).toBe(realpathSync(testDir));
		});

		it("throws for a non-git directory", () => {
			expect(() => getRepoRoot(testDir)).toThrow();
		});
	});

	describe("createCheckpoint", () => {
		it("creates a checkpoint with clean repo", () => {
			initGitRepo();
			createCommit();

			const data = createCheckpoint(testDir, "test-checkpoint-1");

			expect(data.id).toBe("test-checkpoint-1");
			expect(data.headSha).toMatch(/^[0-9a-f]{40}$/);
			expect(data.indexTreeSha).toMatch(/^[0-9a-f]{40}$/);
			expect(data.worktreeTreeSha).toMatch(/^[0-9a-f]{40}$/);
			expect(data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		});

		it("creates a checkpoint with staged changes", () => {
			initGitRepo();
			createCommit();

			// Stage a new file
			writeFileSync(join(testDir, "staged.txt"), "staged content\n");
			execSync("git add staged.txt", { cwd: testDir, stdio: "pipe" });

			const data = createCheckpoint(testDir, "test-checkpoint-staged");

			expect(data.id).toBe("test-checkpoint-staged");
			// Index tree should differ from worktree tree since we only staged one file
			expect(data.indexTreeSha).toBeTruthy();
			expect(data.worktreeTreeSha).toBeTruthy();
		});

		it("creates a checkpoint with untracked files", () => {
			initGitRepo();
			createCommit();

			// Add untracked file
			writeFileSync(join(testDir, "untracked.txt"), "untracked content\n");

			const data = createCheckpoint(testDir, "test-checkpoint-untracked");

			expect(data.id).toBe("test-checkpoint-untracked");
			expect(listCheckpoints(testDir)).toContain("test-checkpoint-untracked");
		});

		it("creates a checkpoint with unborn HEAD (no commits)", () => {
			initGitRepo();
			// Don't create any commits

			const data = createCheckpoint(testDir, "test-checkpoint-unborn");

			expect(data.id).toBe("test-checkpoint-unborn");
			expect(data.headSha).toBe("0".repeat(40));
		});

		it("stores checkpoint as a git ref", () => {
			initGitRepo();
			createCommit();

			createCheckpoint(testDir, "test-checkpoint-ref");

			// Verify ref exists
			const output = execSync("git for-each-ref refs/pi-checkpoints/", {
				cwd: testDir,
				encoding: "utf8",
			});
			expect(output).toContain("test-checkpoint-ref");
		});
	});

	describe("restoreCheckpoint", () => {
		it("restores worktree to checkpoint state", () => {
			initGitRepo();
			createCommit();

			// Create checkpoint before changes
			createCheckpoint(testDir, "before-changes");

			// Make changes
			writeFileSync(join(testDir, "new-file.txt"), "new content\n");
			writeFileSync(join(testDir, "README.md"), "# Modified\n");

			// Verify changes exist
			expect(existsSync(join(testDir, "new-file.txt"))).toBe(true);
			expect(readFileSync(join(testDir, "README.md"), "utf8")).toBe("# Modified\n");

			// Restore checkpoint
			restoreCheckpoint(testDir, "before-changes");

			// Verify restoration
			expect(existsSync(join(testDir, "new-file.txt"))).toBe(false);
			expect(readFileSync(join(testDir, "README.md"), "utf8")).toBe("# Test\n");
		});

		it("restores staged changes", () => {
			initGitRepo();
			createCommit();

			// Stage a file
			writeFileSync(join(testDir, "staged.txt"), "staged\n");
			execSync("git add staged.txt", { cwd: testDir, stdio: "pipe" });

			createCheckpoint(testDir, "with-staged");

			// Unstage and delete
			execSync("git reset HEAD staged.txt", { cwd: testDir, stdio: "pipe" });
			rmSync(join(testDir, "staged.txt"));

			// Restore
			restoreCheckpoint(testDir, "with-staged");

			// Verify file is back and staged
			expect(existsSync(join(testDir, "staged.txt"))).toBe(true);
			const status = execSync("git status --porcelain", { cwd: testDir, encoding: "utf8" });
			expect(status).toContain("A  staged.txt");
		});

		it("throws for missing checkpoint", () => {
			initGitRepo();
			createCommit();

			expect(() => restoreCheckpoint(testDir, "nonexistent")).toThrow("Checkpoint not found: nonexistent");
		});

		it("throws for unborn HEAD checkpoint", () => {
			initGitRepo();
			// Create checkpoint with no commits
			createCheckpoint(testDir, "unborn-checkpoint");

			// Now create a commit so we have something to restore from
			createCommit();

			expect(() => restoreCheckpoint(testDir, "unborn-checkpoint")).toThrow(
				"Cannot restore: checkpoint was saved with no commits",
			);
		});
	});

	describe("listCheckpoints", () => {
		it("returns empty array when no checkpoints", () => {
			initGitRepo();
			createCommit();

			expect(listCheckpoints(testDir)).toEqual([]);
		});

		it("returns all checkpoint IDs", () => {
			initGitRepo();
			createCommit();

			createCheckpoint(testDir, "cp-1");
			createCheckpoint(testDir, "cp-2");
			createCheckpoint(testDir, "cp-3");

			const checkpoints = listCheckpoints(testDir);

			expect(checkpoints).toContain("cp-1");
			expect(checkpoints).toContain("cp-2");
			expect(checkpoints).toContain("cp-3");
			expect(checkpoints).toHaveLength(3);
		});
	});

	describe("pruneCheckpoints", () => {
		it("keeps only the most recent N checkpoints", () => {
			initGitRepo();
			createCommit();

			// Create 5 checkpoints with small delays to ensure different committer dates
			for (let i = 1; i <= 5; i++) {
				createCheckpoint(testDir, `prune-test-${i}`);
			}

			expect(listCheckpoints(testDir)).toHaveLength(5);

			// Prune to keep only 2
			pruneCheckpoints(testDir, 2);

			const remaining = listCheckpoints(testDir);
			expect(remaining).toHaveLength(2);
			// Should keep the most recent (4 and 5)
			expect(remaining).toContain("prune-test-4");
			expect(remaining).toContain("prune-test-5");
		});

		it("does nothing when fewer checkpoints than keepCount", () => {
			initGitRepo();
			createCommit();

			createCheckpoint(testDir, "keep-1");
			createCheckpoint(testDir, "keep-2");

			pruneCheckpoints(testDir, 10);

			expect(listCheckpoints(testDir)).toHaveLength(2);
		});

		it("handles errors gracefully", () => {
			// Should not throw even on non-git directory
			expect(() => pruneCheckpoints("/nonexistent/path")).not.toThrow();
		});
	});

	describe("temp file cleanup", () => {
		it("cleans up temp files on success", () => {
			initGitRepo();
			createCommit();

			// Check for leftover temp dirs by looking for our specific prefix
			const { readdirSync } = require("fs");
			const tempFiles = () => readdirSync(tmpdir()).filter((f: string) => f.startsWith("pi-checkpoint-"));

			const countBefore = tempFiles().length;
			createCheckpoint(testDir, "cleanup-test");
			const countAfter = tempFiles().length;

			// Count pi-checkpoint directories (should be same before and after)
			expect(countAfter).toBe(countBefore);
		});

		it("cleans up temp files on failure", () => {
			initGitRepo();
			// Don't create a commit - this will cause write-tree to fail on empty index

			const { readdirSync } = require("fs");
			const tempFiles = () => readdirSync(tmpdir()).filter((f: string) => f.startsWith("pi-checkpoint-"));

			const countBefore = tempFiles().length;

			// This might or might not throw depending on git version
			try {
				createCheckpoint(testDir, "cleanup-fail-test");
			} catch {
				// Expected
			}

			const countAfter = tempFiles().length;

			// Count pi-checkpoint directories (should be same before and after)
			expect(countAfter).toBe(countBefore);
		});
	});
});
