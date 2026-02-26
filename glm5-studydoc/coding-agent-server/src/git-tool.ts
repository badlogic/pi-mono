import type { AgentTool } from "@mariozechner/pi-agent-core";
import { type Static, Type } from "@sinclair/typebox";
import { spawn } from "child_process";
import { existsSync, mkdirSync, createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { randomBytes } from "node:crypto";

const gitCloneSchema = Type.Object({
	url: Type.String({ description: "Git repository URL to clone" }),
	path: Type.Optional(Type.String({ description: "Local path where to clone (relative or absolute). If not provided, uses repo name from URL" })),
	branch: Type.Optional(Type.String({ description: "Branch to checkout after cloning (optional)" })),
	depth: Type.Optional(Type.Number({ description: "Clone depth (1 for shallow clone, optional)" })),
});

export type GitCloneToolInput = Static<typeof gitCloneSchema>;

export interface GitCloneToolDetails {
	clonedPath: string;
	branch?: string;
}

const githubZipSchema = Type.Object({
	owner: Type.String({ description: "Repository owner (user or organization)" }),
	repo: Type.String({ description: "Repository name" }),
	ref: Type.Optional(Type.String({ description: "Branch, tag, or commit SHA (default: main)" })),
	path: Type.Optional(Type.String({ description: "Local path where to extract (relative or absolute). If not provided, uses repo name" })),
});

export type GitHubZipToolInput = Static<typeof githubZipSchema>;

export interface GitHubZipToolDetails {
	downloadedPath: string;
	extractedPath: string;
	ref: string;
}

/**
 * Extract repository name from Git URL
 */
function extractRepoName(url: string): string {
	// Remove .git suffix if present
	const withoutGit = url.replace(/\.git$/, "");
	// Extract last part of path
	const parts = withoutGit.split("/");
	const lastPart = parts[parts.length - 1];
	return lastPart || "repo";
}

/**
 * Resolve the target path for cloning
 */
function resolveClonePath(path: string | undefined, url: string, cwd: string): string {
	if (!path) {
		// Use repo name from URL
		const repoName = extractRepoName(url);
		return `${cwd}/${repoName}`;
	}

	// If absolute path, use as is
	if (path.startsWith("/") || (process.platform === "win32" && /^[a-zA-Z]:/.test(path))) {
		return path;
	}

	// Relative path
	return `${cwd}/${path}`;
}

/**
 * Resolve the target path for extraction
 */
function resolveExtractPath(path: string | undefined, repo: string, cwd: string): string {
	if (!path) {
		return `${cwd}/${repo}`;
	}

	// If absolute path, use as is
	if (path.startsWith("/") || (process.platform === "win32" && /^[a-zA-Z]:/.test(path))) {
		return path;
	}

	// Relative path
	return `${cwd}/${path}`;
}

/**
 * Execute git clone command
 */
function executeGitClone(
	url: string,
	targetPath: string,
	options: { depth?: number; branch?: string; signal?: AbortSignal },
	onUpdate: (data: string) => void,
): Promise<{ success: boolean; error?: string }> {
	return new Promise((resolve, reject) => {
		// Build git clone command
		const args = ["clone"];

		if (options.depth !== undefined) {
			args.push("--depth", options.depth.toString());
		}

		if (options.branch) {
			args.push("--branch", options.branch);
			args.push("--single-branch");
		}

		args.push(url, targetPath);

		const child = spawn("git", args, {
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		if (child.stdout) {
			child.stdout.on("data", (data: Buffer) => {
				const text = data.toString("utf-8");
				stdout += text;
				onUpdate(text);
			});
		}

		if (child.stderr) {
			child.stderr.on("data", (data: Buffer) => {
				const text = data.toString("utf-8");
				stderr += text;
				onUpdate(text);
			});
		}

		// Handle abort signal
		const onAbort = () => {
			if (child.pid) {
				process.kill(child.pid, "SIGTERM");
			}
		};

		if (options.signal) {
			if (options.signal.aborted) {
				onAbort();
			} else {
				options.signal.addEventListener("abort", onAbort, { once: true });
			}
		}

		child.on("error", (err) => {
			if (options.signal) {
				options.signal.removeEventListener("abort", onAbort);
			}
			reject(err);
		});

		child.on("close", (code) => {
			if (options.signal) {
				options.signal.removeEventListener("abort", onAbort);
			}

			if (options.signal?.aborted) {
				reject(new Error("Clone aborted"));
				return;
			}

			if (code === 0) {
				resolve({ success: true });
			} else {
				resolve({ success: false, error: stderr || stdout || `Git clone failed with code ${code}` });
			}
		});
	});
}

/**
 * Download GitHub repository as ZIP using Fine-grained PAT
 */
async function downloadGitHubZip(
	owner: string,
	repo: string,
	ref: string,
	targetDir: string,
	options: { signal?: AbortSignal },
	onUpdate: (data: string) => void,
): Promise<{ success: boolean; zipPath: string; extractedPath: string; error?: string }> {
	const pat = process.env.GITHUB_PAT;
	if (!pat) {
		throw new Error("GITHUB_PAT environment variable is not set");
	}

	const zipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${ref}`;
	const id = randomBytes(8).toString("hex");
	const zipPath = join(targetDir, `${repo}-${id}.zip`);
	const extractPath = join(targetDir, `${repo}-${ref}`);

	// Ensure target directory exists
	if (!existsSync(targetDir)) {
		mkdirSync(targetDir, { recursive: true });
	}

	onUpdate(`Downloading ${owner}/${repo}@${ref}...\n`);

	try {
		// Use curl to download with PAT
		const args = [
			"-L",
			"-H", `Authorization: Bearer ${pat}`,
			"-H", "Accept: application/vnd.github+json",
			"-o", zipPath,
			zipUrl,
		];

		const result = await new Promise<{ success: boolean; error?: string }>((resolve, reject) => {
			const child = spawn("curl", args, {
				stdio: ["ignore", "pipe", "pipe"],
			});

			let stdout = "";
			let stderr = "";

			if (child.stdout) {
				child.stdout.on("data", (data: Buffer) => {
					stdout += data.toString("utf-8");
				});
			}

			if (child.stderr) {
				child.stderr.on("data", (data: Buffer) => {
					const text = data.toString("utf-8");
					stderr += text;
					onUpdate(text);
				});
			}

			// Handle abort signal
			const onAbort = () => {
				if (child.pid) {
					process.kill(child.pid, "SIGTERM");
				}
			};

			if (options.signal) {
				if (options.signal.aborted) {
					onAbort();
				} else {
					options.signal.addEventListener("abort", onAbort, { once: true });
				}
			}

			child.on("error", (err) => {
				if (options.signal) {
					options.signal.removeEventListener("abort", onAbort);
				}
				reject(err);
			});

			child.on("close", (code) => {
				if (options.signal) {
					options.signal.removeEventListener("abort", onAbort);
				}

				if (options.signal?.aborted) {
					reject(new Error("Download aborted"));
					return;
				}

				if (code === 0) {
					resolve({ success: true });
				} else {
					resolve({ success: false, error: stderr || stdout || `curl failed with code ${code}` });
				}
			});
		});

		if (!result.success) {
			return { success: false, zipPath, extractedPath: extractPath, error: result.error };
		}

		onUpdate(`Downloaded to ${zipPath}, extracting...\n`);

		// Extract ZIP file
		const extractResult = await new Promise<{ success: boolean; error?: string }>((resolve, reject) => {
			// unzip will extract to a directory named like "owner-repo-commit"
			// We need to find that directory and rename it to our target
			const child = spawn("unzip", ["-q", zipPath, "-d", targetDir], {
				stdio: ["ignore", "pipe", "pipe"],
			});

			let stderr = "";

			if (child.stderr) {
				child.stderr.on("data", (data: Buffer) => {
					stderr += data.toString("utf-8");
				});
			}

			// Handle abort signal
			const onAbort = () => {
				if (child.pid) {
					process.kill(child.pid, "SIGTERM");
				}
			};

			if (options.signal) {
				if (options.signal.aborted) {
					onAbort();
				} else {
					options.signal.addEventListener("abort", onAbort, { once: true });
				}
			}

			child.on("error", (err) => {
				if (options.signal) {
					options.signal.removeEventListener("abort", onAbort);
				}
				reject(err);
			});

			child.on("close", (code) => {
				if (options.signal) {
					options.signal.removeEventListener("abort", onAbort);
				}

				if (options.signal?.aborted) {
					reject(new Error("Extraction aborted"));
					return;
				}

				if (code === 0) {
					resolve({ success: true });
				} else {
					resolve({ success: false, error: stderr || `unzip failed with code ${code}` });
				}
			});
		});

		if (!extractResult.success) {
			return { success: false, zipPath, extractedPath: extractPath, error: extractResult.error };
		}

		// Find the extracted directory (it will be named like "owner-repo-commitsha")
		const extractedDir = await new Promise<string | null>((resolve) => {
			const child = spawn("ls", ["-1", targetDir], {
				stdio: ["ignore", "pipe", "pipe"],
			});

			let stdout = "";
			if (child.stdout) {
				child.stdout.on("data", (data: Buffer) => {
					stdout += data.toString("utf-8");
				});
			}

			child.on("close", () => {
				const dirs = stdout.split("\n").filter(line => line.startsWith(`${owner}-${repo}-`));
				resolve(dirs[0] || null);
			});
		});

		if (!extractedDir) {
			return { success: false, zipPath, extractedPath: extractPath, error: "Could not find extracted directory" };
		}

		// Rename to our target path
		const fullExtractedPath = join(targetDir, extractedDir);
		const finalPath = extractPath;

		if (existsSync(finalPath)) {
			// Remove existing directory
			await new Promise<void>((resolve, reject) => {
				const child = spawn("rm", ["-rf", finalPath], {
					stdio: ["ignore", "pipe", "pipe"],
				});
				child.on("close", (code) => {
					if (code === 0) {
						resolve();
					} else {
						reject(new Error(`Failed to remove existing directory: ${finalPath}`));
					}
				});
			});
		}

		await new Promise<void>((resolve, reject) => {
			const child = spawn("mv", [fullExtractedPath, finalPath], {
				stdio: ["ignore", "pipe", "pipe"],
			});
			child.on("close", (code) => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`Failed to rename extracted directory`));
				}
			});
		});

		// Clean up ZIP file
		await new Promise<void>((resolve) => {
			const child = spawn("rm", [zipPath], {
				stdio: ["ignore", "pipe", "pipe"],
			});
			child.on("close", () => resolve());
		});

		return { success: true, zipPath, extractedPath: finalPath };
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return { success: false, zipPath, extractedPath: extractPath, error: errorMessage };
	}
}

/**
 * Create a git clone tool configured for a specific working directory
 */
export function createGitCloneTool(cwd: string): AgentTool<typeof gitCloneSchema> {
	return {
		name: "git_clone",
		label: "git clone",
		description: "Clone a Git repository to the local filesystem. Supports shallow clones and specific branches.",
		parameters: gitCloneSchema,
		execute: async (
			_toolCallId: string,
			{ url, path, branch, depth }: { url: string; path?: string; branch?: string; depth?: number },
			signal?: AbortSignal,
			onUpdate?,
		) => {
			const targetPath = resolveClonePath(path, url, cwd);

			// Check if directory already exists
			if (existsSync(targetPath)) {
				throw new Error(`Directory already exists: ${targetPath}`);
			}

			// Ensure parent directory exists
			const parentDir = dirname(targetPath);
			if (!existsSync(parentDir)) {
				mkdirSync(parentDir, { recursive: true });
			}

			// Execute git clone
			const result = await executeGitClone(
				url,
				targetPath,
				{ depth, branch, signal },
				(data) => {
					if (onUpdate) {
						onUpdate({
							content: [{ type: "text", text: data }],
							details: { clonedPath: targetPath, branch },
						});
					}
				},
			);

			if (!result.success) {
				throw new Error(result.error || "Git clone failed");
			}

			const details: GitCloneToolDetails = {
				clonedPath: targetPath,
				branch,
			};

			return {
				content: [
					{
						type: "text",
						text: `Successfully cloned ${url} to ${targetPath}${branch ? ` (branch: ${branch})` : ""}`,
					},
				],
				details,
			};
		},
	};
}

/**
 * Create a GitHub ZIP download tool configured for a specific working directory
 */
export function createGitHubZipTool(cwd: string): AgentTool<typeof githubZipSchema> {
	return {
		name: "github_zip",
		label: "github zip",
		description: "Download a GitHub repository as ZIP using Fine-grained PAT (from GITHUB_PAT env var). Faster than git clone for large repositories.",
		parameters: githubZipSchema,
		execute: async (
			_toolCallId: string,
			{ owner, repo, ref, path }: { owner: string; repo: string; ref?: string; path?: string },
			signal?: AbortSignal,
			onUpdate?,
		) => {
			const targetRef = ref || "main";
			const extractPath = resolveExtractPath(path, repo, cwd);

			// Check if directory already exists
			if (existsSync(extractPath)) {
				throw new Error(`Directory already exists: ${extractPath}`);
			}

			// Ensure parent directory exists
			const parentDir = dirname(extractPath);
			if (!existsSync(parentDir)) {
				mkdirSync(parentDir, { recursive: true });
			}

			// Download and extract
			const result = await downloadGitHubZip(
				owner,
				repo,
				targetRef,
				parentDir,
				{ signal },
				(data) => {
					if (onUpdate) {
						onUpdate({
							content: [{ type: "text", text: data }],
							details: { downloadedPath: "", extractedPath: extractPath, ref: targetRef },
						});
					}
				},
			);

			if (!result.success) {
				throw new Error(result.error || "GitHub ZIP download failed");
			}

			const details: GitHubZipToolDetails = {
				downloadedPath: result.zipPath,
				extractedPath: result.extractedPath,
				ref: targetRef,
			};

			return {
				content: [
					{
						type: "text",
						text: `Successfully downloaded and extracted ${owner}/${repo}@${targetRef} to ${result.extractedPath}`,
					},
				],
				details,
			};
		},
	};
}

/**
 * Default git clone tool using process.cwd() - for backwards compatibility
 */
export const gitCloneTool = createGitCloneTool(process.cwd());

/**
 * Default GitHub ZIP tool using process.cwd() - for backwards compatibility
 */
export const gitHubZipTool = createGitHubZipTool(process.cwd());
